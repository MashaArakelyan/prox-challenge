# Structural Extraction Prompt

## Stage 1b — Structural pass (Haiku 4.5)

This document defines the exact prompt sent to Claude during the structural extraction pass,
the per-call context, the output JSON shape, and a worked example.

---

## What this pass extracts

The structural pass runs page-by-page over the full manual. For each page it extracts:
- **Entities** — named things that match a type in the inferred schema
- **Relations** — directional links between two entities co-present on the page
- **Tables** — any grid of data with headers and typed rows
- **Diagrams** — figures and labeled illustrations with per-region bounding boxes

This is deliberately transcription-heavy: identify what's there and where it is.
Inference about meaning belongs in the diagnostic and salience passes.

---

## Per-call inputs

Each call receives:
1. One rendered page image (vision block)
2. `schema_context` — the `entity_types` and `relation_predicates` arrays from `data/schema.json`, sent as a JSON string in the user message. This constrains what entity types Claude may create.
3. `previously_extracted_entities` — a JSON array of `{id, name, type}` objects for every entity extracted so far across all prior pages. Used for de-duplication.

The runner script (scripts/run-structural-extract.ts) manages state across pages and injects
both context arrays into each call.

---

## Exact prompt

```
You are extracting structured knowledge from one page of a product manual.
You will receive:
  - A rendered image of the page
  - SCHEMA: the allowed entity types and relation predicates (JSON)
  - PRIOR_ENTITIES: entities already extracted from earlier pages (JSON array)

Your job is to extract every named thing, relation, table, and diagram visible on this page.

ENTITY RULES:
1. Only create entities whose type matches one of the names in SCHEMA.entity_types.
2. Before creating an entity, check PRIOR_ENTITIES for an existing entry with the same
   canonical name. If found, reuse its ID exactly — do not create a duplicate.
   Example: "Positive Socket" appears on page 3 and page 8. Page 8 should reuse the ID
   from page 3, not emit a new entity.
3. Entity IDs must be stable snake_case slugs: type_name_slug (e.g., "physical_connector_positive_socket").
   For entities with no natural unique name, append the page number: "setup_procedure_wire_spool_p10".
4. Include every page the entity appears on in its page_refs array (add the current page).

RELATION RULES:
5. Only emit relations whose predicate matches one of the names in SCHEMA.relation_predicates.
6. Both subject_id and object_id must be entity IDs present in this page's entities[] OR in PRIOR_ENTITIES.
7. Only emit relations whose subject and object are both visible or explicitly mentioned on this page.

TABLE RULES:
8. For every grid or table on the page, extract all column headers and all data rows.
9. Each row is a typed object keyed by column header. Numeric values should be numbers, not strings.
10. Give each table a stable ID: "table_{page}_{n}" (e.g., "table_7_1" for the first table on page 7).

DIAGRAM RULES:
11. For every figure, schematic, diagram, or labeled illustration on the page:
    - Assign an ID: "diagram_{page}_{n}"
    - Extract a caption (the figure title or nearest heading if no explicit caption)
    - Extract every labeled region: each callout, arrow label, or annotated part
    - For each region, estimate a bounding box in NORMALIZED coordinates (0.0–1.0),
      where (0,0) is top-left and (1,1) is bottom-right of the full page image
    - The bounding box encloses the labeled object/area, not the callout line
    - Set save_crop: true on every diagram — the runner will crop and save the image
12. If a page has no diagrams, omit the diagrams array or return it empty.

GENERAL:
13. If a page has no extractable content of a given type, return an empty array for that type.
14. Return ONLY the JSON object. No prose, no markdown fences.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "entities": [
    {
      "id": "type_name_slug",
      "name": "Canonical name as it appears in the manual",
      "type": "entity_type_name_from_schema",
      "description": "One sentence: what this entity is",
      "page_refs": [number],
      "is_new": true | false
    }
  ],
  "relations": [
    {
      "predicate": "predicate_from_schema",
      "subject_id": "entity_id",
      "object_id": "entity_id",
      "page": number
    }
  ],
  "tables": [
    {
      "id": "table_{page}_{n}",
      "name": "Table name or nearest heading",
      "page": number,
      "columns": ["Column Header 1", "Column Header 2"],
      "rows": [
        { "Column Header 1": value, "Column Header 2": value }
      ]
    }
  ],
  "diagrams": [
    {
      "id": "diagram_{page}_{n}",
      "page": number,
      "caption": "Figure title or description",
      "save_crop": true,
      "regions": [
        {
          "label": "Label text from the callout",
          "bbox": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 }
        }
      ]
    }
  ]
}
```

---

## De-duplication contract

The `is_new` field tells the runner whether to add this entity to the running state:
- `is_new: true` — first time this entity has been seen; runner adds it to PRIOR_ENTITIES
- `is_new: false` — entity already exists; runner only updates its `page_refs`

The runner passes PRIOR_ENTITIES as a JSON array in every call. Claude must do the matching.
Matching is by canonical name (case-insensitive, ignoring punctuation). When unsure, reuse.

---

## Bounding box guidance

The bbox coordinates are in normalized page space (0.0–1.0):
- `x`, `y` — top-left corner of the labeled region
- `width`, `height` — extent of the region

Err toward larger boxes (include the labeled part plus a small margin) rather than pixel-tight.
The runner will use these to crop `data/images/{page}_{diagram_id}.png` using ImageMagick.

Example estimates for a front-panel diagram where the page is 850×1100px:
- "Positive Socket" label pointing to a socket in the lower-left quadrant:
  bbox ≈ { x: 0.05, y: 0.70, width: 0.20, height: 0.08 }
- "LCD Display" label pointing to the screen in the upper-center:
  bbox ≈ { x: 0.35, y: 0.10, width: 0.30, height: 0.15 }

---

## Worked example

**Source:** Page 8 of the Vulcan OmniPro 220 manual — "Controls / Front Panel Controls"

This page shows a labeled photograph of the front panel with callouts for every control,
plus a labeled diagram of the bottom connectors. Below is the expected output structure
(abbreviated to 3 entities, 1 relation, 1 diagram, 0 tables):

```json
{
  "page": 8,
  "entities": [
    {
      "id": "physical_connector_positive_socket",
      "name": "Positive Socket",
      "type": "physical_connector",
      "description": "The positive (+) DINSE-style output socket on the front panel used for electrode cables",
      "page_refs": [8],
      "is_new": true
    },
    {
      "id": "physical_connector_negative_socket",
      "name": "Negative Socket",
      "type": "physical_connector",
      "description": "The negative (−) DINSE-style output socket on the front panel used for ground clamps",
      "page_refs": [8],
      "is_new": true
    },
    {
      "id": "control_element_lcd_display",
      "name": "LCD Display",
      "type": "control_element",
      "description": "The digital screen on the front panel showing current process, parameters, and mode",
      "page_refs": [8],
      "is_new": true
    }
  ],
  "relations": [
    {
      "predicate": "indicates_failure",
      "subject_id": "control_element_lcd_display",
      "object_id": "failure_mode_overheat_shutdown",
      "page": 8
    }
  ],
  "tables": [],
  "diagrams": [
    {
      "id": "diagram_8_1",
      "page": 8,
      "caption": "Front Panel Controls",
      "save_crop": true,
      "regions": [
        {
          "label": "Home Button",
          "bbox": { "x": 0.03, "y": 0.05, "width": 0.12, "height": 0.06 }
        },
        {
          "label": "LCD Display",
          "bbox": { "x": 0.30, "y": 0.08, "width": 0.38, "height": 0.18 }
        },
        {
          "label": "Left Knob",
          "bbox": { "x": 0.05, "y": 0.30, "width": 0.14, "height": 0.14 }
        },
        {
          "label": "Positive Socket",
          "bbox": { "x": 0.40, "y": 0.70, "width": 0.12, "height": 0.10 }
        },
        {
          "label": "Negative Socket",
          "bbox": { "x": 0.56, "y": 0.70, "width": 0.12, "height": 0.10 }
        }
      ]
    }
  ]
}
```

---

## Notes on prompt design decisions

**Why Haiku 4.5:** This pass is transcription, not reasoning. The entities and labels are present on
the page — Claude's job is to read and classify them, not infer anything. Haiku 4.5 handles
vision + JSON output well at 5–8× lower cost than Sonnet.

**Why bounding boxes on every region, not just the diagram as a whole:** The reviewer rubric
explicitly scores knowledge extraction quality. The per-region bbox is what enables the
`surface_region()` tool to highlight specific callout areas in the manual companion view.
It also proves the visual extraction was done properly.

**Why normalized coordinates:** The rendered page images may vary in pixel resolution depending
on the pdftoppm DPI setting. Normalized coordinates are resolution-independent and can be
applied to any render of the same page.

**Why `is_new` on the entity:** Avoids the runner needing to diff two lists. Claude declares
intent; the runner acts on it. The runner is the authority — it can override `is_new: true`
if a duplicate slipped through.
