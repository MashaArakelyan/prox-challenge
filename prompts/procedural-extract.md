# Procedural Extraction Prompt

## Stage 1b — Procedural pass (Sonnet 4.6)

This document defines the exact prompt sent to Claude during the procedural extraction pass,
the per-call context, the output JSON shape, and a worked example.

---

## What this pass extracts

The procedural pass runs page-by-page over the full manual. For each page it extracts
every "how to..." sequence — setup instructions, operating steps, adjustment procedures —
and converts them into structured state machines with explicit postconditions.

The postcondition is the load-bearing element: it turns a flat instruction ("tighten the
wingnut") into a verifiable physical state ("wire spool does not spin freely when pushed").
This is what `verify_setup()` checks at runtime and what the agent narrates during procedure mode.

---

## Per-call inputs

Each call receives:
1. One rendered page image (vision block)
2. `schema_context` — the `entity_types` array from `data/schema.json` as a JSON string.
   Used so step references to entities use the same canonical names as the structural pass.
3. `prior_procedures` — a JSON array of procedures already extracted from earlier pages,
   each with `{ id, name, last_step }`. The runner maintains this list across page calls.
4. Page number

The runner script (scripts/run-procedural-extract.ts) manages page iteration, maintains the
running `prior_procedures` list, handles continuation merging, and writes the assembled output
to `data/procedures.json` after all pages are processed.

---

## Exact prompt

```
You are extracting procedural knowledge from one page of a product manual.
You will receive:
  - A rendered image of the page
  - SCHEMA: the allowed entity types (JSON) — use these canonical names in step references
  - PRIOR_PROCEDURES: procedures already extracted from earlier pages (JSON array of {id, name, last_step})
  - PAGE: the page number

Your job is to find every procedure on this page and convert it into a structured state machine.

A PROCEDURE is any numbered or bulleted sequence of steps instructing the operator to perform
a physical action on the machine. This includes setup sequences, installation steps, operating
instructions, adjustment procedures, and maintenance tasks.

NOT a procedure: safety warnings, specifications tables, explanatory paragraphs, tips boxes.
If a page has no procedures, return: { "page": number, "procedures": [] }

CONTINUATION RULES:
Before creating a new procedure, check PRIOR_PROCEDURES. If this page contains a continuation
of an existing procedure — the same procedure name, or step numbers that pick up where a prior
page left off (e.g., the page starts at step 6 and PRIOR_PROCEDURES has a procedure with
last_step = 5) — emit a continuation entry instead of a new procedure:
  { "extends": "<prior_procedure_id>", "new_steps": [...] }
Only include the steps visible on this page. Do not re-emit steps already in the prior procedure.
If you are unsure whether this is a continuation, prefer treating it as one (conservatively avoid
creating a duplicate procedure with a different ID).

PROCEDURE RULES:
1. Give each NEW procedure a stable snake_case ID: "{verb}_{object}_p{page}"
   Example: "install_wire_spool_p10", "set_mig_polarity_p20"
2. Name it in the form "[Verb] [Object]" — imperative, concise.
   Example: "Install Wire Spool (1–2 lb)", "Set MIG Shielding Gas Flow"
3. Record the welding_process this procedure applies to, if identifiable. Use the exact
   process name from the schema (e.g., "MIG", "TIG", "Flux-Cored", "Stick") or null.

STEP RULES:
4. Number steps sequentially. For continuations, number from (last_step + 1).
5. instruction: the imperative action the operator takes. One sentence. Active voice.
   Bad: "The spool should be placed on the spindle."
   Good: "Place the wire spool over the spool spindle with the wire unwinding clockwise."
6. postcondition: a verifiable physical state after the step is completed.
   - Must be observable by the operator without tools (visual, tactile, auditory)
   - Phrased as a present-tense description of the physical world, not an action
   - Bad postcondition: "You have tightened the wingnut."
   - Good postcondition: "The wire spool does not spin freely when pushed by hand."
   - If no specific postcondition is stated or implied, write null.
7. expected_image: optional. If a photo of the completed step would help verify the
   postcondition (e.g., "wire protrudes 1/4 inch past contact tip"), describe what
   the photo should show. Otherwise null.
8. entity_refs: list of entity IDs from the schema that this step directly involves.
   Use the naming convention from the structural pass: "type_name_slug".
9. branches: only extract conditional forks that are explicitly stated in the manual.
   Each branch: { condition, goto_step, note (optional) }

RETURN FORMAT:
10. If a page has no procedures, return: { "page": number, "procedures": [] }
11. Return ONLY the JSON object. No prose, no markdown fences.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "procedures": [
    // New procedure starting on this page:
    {
      "id": "verb_object_p{page}",
      "name": "Verb Object (qualifier if needed)",
      "description": "One sentence: what this procedure accomplishes",
      "applies_to_process": "MIG" | "TIG" | "Flux-Cored" | "Stick" | null,
      "manual_citation": {
        "page": number,
        "section": "Section heading from the page"
      },
      "steps": [
        {
          "step": number,
          "instruction": "Imperative action in active voice",
          "postcondition": "Verifiable physical state after step, or null",
          "expected_image": "What a verification photo should show, or null",
          "entity_refs": ["entity_id_1", "entity_id_2"],
          "branches": [
            {
              "condition": "If condition text",
              "goto_step": number,
              "note": "Optional clarifying note"
            }
          ]
        }
      ]
    },
    // OR — continuation of a procedure that started on an earlier page:
    {
      "extends": "prior_procedure_id",
      "new_steps": [
        {
          "step": number,
          "instruction": "...",
          "postcondition": "...",
          "expected_image": null,
          "entity_refs": [],
          "branches": []
        }
      ]
    }
  ]
}
```

The runner merges `new_steps` into the parent procedure's `steps` array when assembling
`data/procedures.json`, in step-number order.

---

## Worked example

**Page 10** — procedure starts fresh (PRIOR_PROCEDURES is empty or doesn't contain this procedure):

```json
{
  "page": 10,
  "procedures": [
    {
      "id": "install_wire_spool_p10",
      "name": "Install Wire Spool",
      "description": "Load a wire spool onto the spool spindle and thread wire through the feed mechanism",
      "applies_to_process": null,
      "manual_citation": {
        "page": 10,
        "section": "Wire Spool Installation / Wire Setup"
      },
      "steps": [
        {
          "step": 1,
          "instruction": "Turn the Power Switch OFF and unplug the welder.",
          "postcondition": "Power Switch is in the OFF position and power cord is disconnected from the outlet.",
          "expected_image": null,
          "entity_refs": ["control_element_power_switch"],
          "branches": []
        },
        {
          "step": 2,
          "instruction": "Pull up on the Door Latch and open the Door.",
          "postcondition": "The side door is fully open, exposing the wire spool compartment.",
          "expected_image": null,
          "entity_refs": [],
          "branches": []
        },
        {
          "step": 3,
          "instruction": "Remove the Wingnut and Spacer; remove any old spool and remaining wire from the liners.",
          "postcondition": "Spool spindle is bare with no wire or old spool attached.",
          "expected_image": null,
          "entity_refs": [],
          "branches": [
            {
              "condition": "If installing a 10–12 lb spool",
              "goto_step": 6,
              "note": "Steps 6–10 cover the larger spool adapter installation"
            }
          ]
        },
        {
          "step": 4,
          "instruction": "Place the new wire spool over the Spool Spindle and against the Spool Brake Pad, oriented so the wire unwinds clockwise.",
          "postcondition": "Spool sits flush against the Spool Brake Pad and wire feeds off the top in a clockwise direction.",
          "expected_image": "Wire spool seated on spindle with wire coming off the top, feeding clockwise when viewed from the front",
          "entity_refs": [],
          "branches": []
        },
        {
          "step": 5,
          "instruction": "Replace the Spacer over the Spool Spindle and tighten the Wingnut until the spool does not spin freely.",
          "postcondition": "Wire spool does not spin freely when pushed by hand; slight resistance from the Spool Brake Pad is present.",
          "expected_image": null,
          "entity_refs": [],
          "branches": []
        }
      ]
    }
  ]
}
```

**Page 11** — continuation of the same procedure (PRIOR_PROCEDURES contains
`{ id: "install_wire_spool_p10", name: "Install Wire Spool", last_step: 5 }`):

```json
{
  "page": 11,
  "procedures": [
    {
      "extends": "install_wire_spool_p10",
      "new_steps": [
        {
          "step": 6,
          "instruction": "Remove the Wingnut and Spacer and place the Spool Adapter over the Spool Spindle against the Spool Brake Pad.",
          "postcondition": "Spool Adapter is seated flat against the Spool Brake Pad with the locating pin visible.",
          "expected_image": null,
          "entity_refs": [],
          "branches": []
        },
        {
          "step": 7,
          "instruction": "Place the 10–12 lb wire spool over the Adapter, aligning the pin on the Adapter with the hole in the Spool.",
          "postcondition": "Spool is seated on the Adapter with pin engaged; wire unwinds clockwise.",
          "expected_image": "Wire spool seated on adapter with pin alignment visible and wire feeding clockwise",
          "entity_refs": [],
          "branches": []
        },
        {
          "step": 8,
          "instruction": "Replace the Spacer and tighten the Wingnut, then screw the Spool Knob into the Spool Adapter.",
          "postcondition": "Spool does not spin freely; Spool Knob is hand-tight in the Adapter.",
          "expected_image": null,
          "entity_refs": [],
          "branches": []
        }
      ]
    }
  ]
}
```

The runner appends steps 6–8 to `install_wire_spool_p10`'s step array and updates `last_step` to 8.

---

## Notes on prompt design decisions

**Why Sonnet 4.6:** Postcondition generation requires moderate reasoning — Claude must infer
the observable physical state that results from an instruction, even when the manual doesn't
state it explicitly. Haiku 4.5 tends to either copy the instruction verbatim or write vague
postconditions ("the step is complete"). Sonnet produces verifiable physical descriptions.

**Why `PRIOR_PROCEDURES` with `last_step` rather than the full step list:** Sending full step
arrays across 48 pages would inflate the context window significantly (and cost). The runner
only needs Claude to know (a) whether a procedure already exists and (b) what step number
to continue from. Full steps are not needed for that decision.

**Why `extends` instead of re-emitting the full procedure:** Avoids duplicate step risk. The
runner is the merge authority; Claude just declares "these new steps belong to that procedure."

**Why null is an acceptable postcondition:** Some steps genuinely have no observable postcondition
distinct from performing the action (e.g., "Press the Home button"). Forcing a postcondition for
these would produce meaningless noise. Null is honest; the runtime skips postcondition verification
for null steps.

**Why `expected_image` is a description, not a URL:** The image doesn't exist yet — it will be
taken by the user during procedure mode. The description tells the agent what to ask the user
to photograph, and tells the vision model what to look for when verifying.

**Why `entity_refs` uses the structural pass naming convention:** The procedural and structural
passes run in parallel, so procedural Claude cannot look up actual structural IDs. The naming
convention (`type_name_slug`) is deterministic enough that the runner can link them after both
passes complete, without a separate resolution stage.

**Why branches only for explicitly-stated forks:** Inferring implicit branches ("you might want
to...") would pollute the state machine with non-canonical paths. The agent can handle implicit
branching in conversation; the data store only needs the manual's own documented forks.
