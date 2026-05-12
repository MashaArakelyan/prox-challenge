# Schema Inference Prompt

## Stage 0a — Lock the schema contract

This document defines the exact prompt sent to Claude during the schema inference pass,
the JSON shape it must return, and the validation + fallback policy.

---

## Input selection policy

The schema inference pass sends Claude:
- The table of contents page(s)
- Pages 1–8 (covers safety, symbology, specifications, controls)
- Any page whose section heading contains "specification", "specifications", "safety", or "parts list"
  (identified by scanning headings before sending)

Rationale: these pages contain the ontology of the product — what entities exist (processes,
components, materials, settings), what numeric attributes they carry, and what relations bind them.
The rest of the manual (procedures, troubleshooting) is extracted in later passes against this schema.

Images of each selected page are sent as vision blocks. Text is not pre-extracted; Claude reads
the rendered page directly so it captures both text and diagram labels.

---

## Exact prompt

```
You are building a domain-specific ontology from a product manual.
You will receive rendered images of selected pages from the manual.
Your job is to infer the entity types, relation predicates, and attribute schemas
that a knowledge graph for this product should use.

Output only valid JSON matching the schema below. No prose, no markdown fences.

RULES:
1. Entity type names must be singular nouns in snake_case (e.g., "welding_process", "connector").
2. No two entity types may overlap in the set of things they describe.
   If you are unsure, merge into a more general type rather than split.
3. Relation predicates must be snake_case verb phrases (e.g., "requires", "connects_to", "outputs_at").
   Every predicate must be directional: subject → object.
4. Every attribute must list its expected type: "string" | "number" | "boolean" | "enum" | "range".
   For "enum", include a non-exhaustive sample_values array.
   For "range", include expected_unit (e.g., "A", "V", "%", "IPM").
5. Include a "salience_hint" field per entity type: "high" | "medium" | "low".
   High = directly actionable (settings, procedures, connectors).
   Medium = reference context (materials, processes, specifications).
   Low = administrative (warranty, contact info, legal).
6. Include a top-level "domain_summary" string: one sentence naming the product and its primary function.
7. Return ONLY the JSON object. Any non-JSON output will be rejected.

REQUIRED OUTPUT SHAPE:
{
  "domain_summary": "string",
  "entity_types": [
    {
      "name": "snake_case_name",
      "description": "what instances of this type are",
      "salience_hint": "high" | "medium" | "low",
      "attributes": [
        {
          "name": "attribute_name",
          "type": "string" | "number" | "boolean" | "enum" | "range",
          "required": true | false,
          "sample_values": ["..."],   // only for enum type
          "expected_unit": "..."       // only for range type
        }
      ]
    }
  ],
  "relation_predicates": [
    {
      "predicate": "snake_case_verb_phrase",
      "subject_type": "entity_type_name",
      "object_type": "entity_type_name",
      "description": "what this relation means"
    }
  ]
}
```

---

## Expected entity types (grounded in Vulcan OmniPro 220)

The validator enforces these types are present. Additional types are allowed.

| Name | Description | Salience |
|------|-------------|----------|
| `welding_process` | A welding mode (MIG, TIG, Flux-Cored, Stick) | high |
| `connector` | A physical socket or terminal on the machine | high |
| `control` | A knob, button, switch, or display element | high |
| `setting` | A numeric or mode parameter (amperage, wire speed, voltage) | high |
| `procedure` | An ordered sequence of steps | high |
| `consumable` | A replaceable item (wire, electrode, contact tip) | medium |
| `material` | A workpiece material (mild steel, stainless, aluminum) | medium |
| `symptom` | An observable problem during welding | high |
| `specification` | A product-level numeric constraint | medium |
| `safety_rule` | An imperative safety instruction | low |
| `diagram` | A figure, schematic, or photo in the manual | medium |

---

## Validator design (scripts/validate-schema.ts)

The validator runs after each Claude response and checks:

```typescript
type ValidationError =
  | { code: "MISSING_ENTITY_TYPE"; expected: string }
  | { code: "DUPLICATE_ENTITY_TYPE"; name: string }
  | { code: "OVERLAPPING_TYPES"; a: string; b: string; reason: string }
  | { code: "MISSING_FIELD"; entity: string; field: string }
  | { code: "INVALID_PREDICATE_FORMAT"; predicate: string }
  | { code: "UNKNOWN_TYPE_REFERENCE"; predicate: string; ref: string }
  | { code: "MISSING_DOMAIN_SUMMARY" }
```

**Checks performed:**
1. `domain_summary` is a non-empty string.
2. All required entity type names from the table above are present.
3. No two entity type names are identical (case-insensitive).
4. No two entity types have identical descriptions (catches copy-paste overlaps).
5. Every attribute has `name`, `type`, and `required` fields.
6. Enum attributes have non-empty `sample_values`.
7. Range attributes have a non-empty `expected_unit`.
8. All predicate names match `/^[a-z][a-z_]+$/`.
9. `subject_type` and `object_type` in every predicate reference a defined entity type name.
10. No predicate is missing `description`.

**Overlap check** (check #4 extended): For entity types with descriptions that share >60% of
trigrams with another type's description, emit `OVERLAPPING_TYPES` with an explanation.
This is a heuristic; Claude must resolve it by merging or clarifying.

---

## Fallback policy

```
attempt 1: send prompt with page images
  → validate output
  → if valid: write data/schema.json, done

attempt 2 (on failure): resend with errors appended
  → append to prompt:
    "The previous response failed validation with these errors:
    <error list>
    Fix only the listed issues. Do not change passing fields."
  → validate output
  → if valid: write data/schema.json, done

attempt 3 (on second failure): resend again with fresh errors
  → same append pattern
  → validate output
  → if valid: write data/schema.json, done

if all 3 attempts fail:
  → write data/schema.review.json with the last response + all validation errors
  → exit with code 1 and message:
    "Schema inference failed after 3 attempts. Run `npm run schema:review` to inspect."
  → npm run schema:review opens data/schema.review.json in $EDITOR and prints errors to stdout
```

The `npm run schema:review` command is defined in package.json as:
```json
"schema:review": "node scripts/schema-review.js"
```

`scripts/schema-review.js` prints the validation errors to stdout and opens `data/schema.review.json`
in the user's `$EDITOR` (defaulting to `less` if unset). The user edits the file, saves it, and
the ingest pipeline picks it up on next run without re-calling Claude.
