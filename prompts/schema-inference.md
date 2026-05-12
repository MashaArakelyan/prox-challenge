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
1. Entity type names must be singular nouns in snake_case (e.g., "cutting_path", "valve", "fault_code").
   Do not use product-specific names — name the concept, not the instance.
2. No two entity types may overlap in the set of things they describe.
   If you are unsure, merge into a more general type rather than split.
3. Each entity type must declare a meta_role from this fixed set:
   - "operator_concept"   — a process, mode, or cycle the operator selects or runs
   - "physical_interface" — a physical connector, port, socket, valve, or terminal
   - "control_element"    — a knob, button, switch, display, or adjustment on the machine
   - "parameter"          — a numeric or enumerated setting (speed, current, temperature)
   - "procedure"          — an ordered sequence of steps the operator follows
   - "consumable_input"   — a replaceable or expendable material used by the machine
   - "workpiece_material" — a material the machine acts upon
   - "failure_mode"       — an observable symptom, fault code, or error condition
   - "specification"      — a product-level numeric constraint or rating
   - "reference_artifact" — a diagram, figure, photo, or table in the manual
   - "other"              — use only if none of the above fit; explain in description
   Downstream code queries by meta_role (e.g., "all failure_mode entities") so this field
   must be precise. When in doubt, pick the closest fit rather than "other".
4. Relation predicates must be snake_case verb phrases (e.g., "requires", "connects_to", "outputs_at").
   Every predicate must be directional: subject → object.
5. Every attribute must list its expected type: "string" | "number" | "boolean" | "enum" | "range".
   For "enum", include a non-exhaustive sample_values array.
   For "range", include expected_unit (e.g., "A", "V", "%", "IPM").
6. Include a "salience_hint" field per entity type: "high" | "medium" | "low".
   High = directly actionable (settings, procedures, interfaces).
   Medium = reference context (materials, processes, specifications).
   Low = administrative (warranty, contact info, legal).
7. Include a top-level "domain_summary" string: one sentence naming the product and its primary function.
8. Return ONLY the JSON object. Any non-JSON output will be rejected.

REQUIRED OUTPUT SHAPE:
{
  "domain_summary": "string",
  "entity_types": [
    {
      "name": "snake_case_name",
      "description": "what instances of this type are",
      "meta_role": "operator_concept" | "physical_interface" | "control_element" | "parameter" |
                   "procedure" | "consumable_input" | "workpiece_material" | "failure_mode" |
                   "specification" | "reference_artifact" | "other",
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

## Why meta_role instead of required type names

We do not require specific entity type names because type names are product-specific:
a welder has `welding_process`, a CNC mill has `toolpath`, a furnace has `heating_cycle` —
but all three are `operator_concept`. Downstream code always queries by meta_role, so it
is product-agnostic. The agent inherits the same stable hooks regardless of which PDF was ingested.

---

## Validator design (scripts/validate-schema.ts)

The validator runs after each Claude response and checks:

```typescript
const VALID_META_ROLES = [
  "operator_concept", "physical_interface", "control_element", "parameter",
  "procedure", "consumable_input", "workpiece_material", "failure_mode",
  "specification", "reference_artifact", "other"
] as const

type ValidationError =
  | { code: "MISSING_DOMAIN_SUMMARY" }
  | { code: "TOO_FEW_ENTITY_TYPES"; count: number; min: number }
  | { code: "TOO_MANY_ENTITY_TYPES"; count: number; max: number }
  | { code: "DUPLICATE_ENTITY_TYPE"; name: string }
  | { code: "OVERLAPPING_TYPES"; a: string; b: string; reason: string }
  | { code: "INVALID_META_ROLE"; entity: string; value: string }
  | { code: "MISSING_REQUIRED_META_ROLES"; missing: string[] }
  | { code: "MISSING_FIELD"; entity: string; field: string }
  | { code: "INVALID_PREDICATE_FORMAT"; predicate: string }
  | { code: "UNKNOWN_TYPE_REFERENCE"; predicate: string; ref: string }
```

**Checks performed:**
1. `domain_summary` is a non-empty string.
2. Entity type count is between 5 and 15 inclusive (sanity bounds — fewer suggests incomplete extraction, more suggests over-splitting).
3. No two entity type names are identical (case-insensitive).
4. No two entity types have descriptions sharing >60% trigram overlap (`OVERLAPPING_TYPES`). Claude must resolve by merging or clarifying the boundary.
5. Every entity type's `meta_role` is a value from `VALID_META_ROLES`.
6. The schema covers at least these four meta_roles: `failure_mode`, `procedure`, `physical_interface`, `operator_concept`. A product manual that lacks any of these is probably missing a section. (This is a coverage check on meta_roles, not on type names — it generalizes across products.)
7. Every attribute has `name`, `type`, and `required` fields.
8. Enum attributes have non-empty `sample_values`.
9. Range attributes have a non-empty `expected_unit`.
10. All predicate names match `/^[a-z][a-z_]+$/`.
11. `subject_type` and `object_type` in every predicate reference a defined entity type name.
12. No predicate is missing `description`.

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
