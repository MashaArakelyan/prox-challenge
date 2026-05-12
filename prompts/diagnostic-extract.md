# Diagnostic Extraction Prompt

## Stage 0b — Lock the diagnostic pass contract

This document defines the exact prompt sent to Claude during the diagnostic extraction pass,
the priors policy, the output JSON shape, and a worked example grounded in the welder manual.

---

## What pages are sent

The diagnostic pass processes the manual's troubleshooting section page-by-page.
Pages are identified by scanning headings for: "troubleshoot", "welding tips",
"diagnosis", "problem", "cause", "solution", "remedy".

For the Vulcan OmniPro 220, this is pages 34–45 (Welding Tips + Troubleshooting + Maintenance).
Each page is sent as a rendered image (vision block), one page per Claude call,
so the model can read diagram labels alongside prose.

---

## Priors policy

There are three source values for numeric values in the diagnostic output:

| Source | Meaning | UI badge |
|--------|---------|----------|
| `manual_derived` | A number stated explicitly in the manual (e.g., "this is the most common cause") | solid badge |
| `manual_order_heuristic` | Inferred from the listing order in a troubleshooting table — first-listed = more common | dashed badge |
| `llm_estimated` | Claude's domain knowledge; no manual grounding | light badge |

The README's honesty section names all three explicitly. The diagnosis side panel renders
a different confidence badge for each, so reviewers can see the epistemics at a glance.

**Position-to-prior conversion (for `manual_order_heuristic`):**

When the manual lists causes in a numbered or bulleted sequence without explicit frequencies,
treat listing order as editorial signal and assign priors using this schedule:

```
position 1 of N → prior = 0.40
position 2 of N → prior = 0.25
position 3 of N → prior = 0.15
position 4+ of N → remaining mass (1 - sum of above) split equally, minus 0.05 for unknowns
```

These numbers are deliberately softer than the previous 0.50/0.30/0.15 schedule to reflect
the fact that listing order is a heuristic, not a frequency measurement. Every prior from
this schedule carries `"prior_source": "manual_order_heuristic"`.

When the manual does provide an explicit statement of frequency ("almost always", "rarely"),
use `manual_derived` and note the quoted phrase in a `prior_note` field.

When a cause is inferred from context (not explicitly named in the manual), use
`"prior_source": "llm_estimated"`.

Likelihood ratios are always `llm_estimated` unless the manual says something like
"almost always" or "rarely" adjacent to a specific cause. In that case use `manual_derived`.

---

## Exact prompt

```
You are extracting diagnostic knowledge from one page of a product manual.
You will receive a rendered image of the page.

For each distinct symptom described on this page:
1. Name the symptom — the observable problem the user sees or hears.
2. List candidate causes, preserving the manual's ordering when it provides one.
3. For each cause, assign a prior probability (0–1) and a source flag.
4. For each cause, list checks — specific observations or tests the user can perform.
   For each check, assign a likelihood ratio (positive = how much higher belief if check is TRUE).
5. List vernacular synonyms — informal ways a user might describe this symptom.

Output only valid JSON matching the schema below. No prose, no markdown fences.

RULES:
1. A "symptom" is observable by the user without tools (visual, auditory, tactile).
   Do not create symptoms for internal machine states the user cannot observe.
2. Priors across all causes for one symptom must sum to ≤ 1.0 (leave slack for unknown causes).
3. Every prior must include a "prior_source" field with one of:
   - "manual_derived"         — explicit frequency stated in the manual
   - "manual_order_heuristic" — inferred from listing order in a manual table
   - "llm_estimated"          — Claude's domain knowledge; no manual grounding
4. Every likelihood_ratio must include a "likelihood_ratio_source" with the same three values.
5. Each check must declare its "modality" — how the user answers it:
   - "self_report"         — user recalls or observes something (yes/no answer)
   - "user_photo"          — user takes or uploads a photo for interpretation
   - "numeric_measurement" — user reads a gauge, display, or meter
   This field determines whether the UI prompts for a photo upload, a number input, or a yes/no button.
6. Checks must be phrased as yes/no questions or numeric observations the user can answer
   while standing at the machine (e.g., "Is the wire feed speed above 300 IPM?").
7. process_scope should name the specific process(es) if known, or "all" if universal.
   Use the process names as they appear in the manual.
8. If a page contains no diagnostic content, return: { "symptoms": [] }
9. Return ONLY the JSON object.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "symptoms": [
    {
      "id": "symptom_slug_in_snake_case",
      "label": "Short human-readable label",
      "description": "What the user observes",
      "process_scope": ["process name 1", "process name 2"] | "all",
      "causes": [
        {
          "id": "cause_slug",
          "label": "Cause name",
          "prior": 0.0–1.0,
          "prior_source": "manual_derived" | "manual_order_heuristic" | "llm_estimated",
          "prior_note": "optional: quoted phrase from manual if manual_derived",
          "checks": [
            {
              "id": "check_slug",
              "question": "Yes/no question or numeric observation",
              "modality": "self_report" | "user_photo" | "numeric_measurement",
              "positive_meaning": "What it means when the answer is yes / above threshold",
              "likelihood_ratio_positive": number,
              "likelihood_ratio_source": "manual_derived" | "manual_order_heuristic" | "llm_estimated",
              "recommended_action_if_positive": "What to do"
            }
          ]
        }
      ],
      "manual_citation": {
        "page": number,
        "section": "section heading or figure label"
      }
    }
  ]
}
```

---

## Worked example

**Source:** Page 37 of the Vulcan OmniPro 220 manual — "Wire Weld – Porosity / Gas Pockets"

The manual lists these causes and solutions in order:
1. Dirty workpiece or welding wire → clean down to bare metal; ensure wire is clean
2. Incorrect polarity → check polarity is set correctly for type of welding
3. Insufficient shielding gas (MIG only) → increase flow; clean nozzle; maintain proper CTWD
4. Wire feeding too fast → reduce wire feed speed
5. CTWD too long → reduce CTWD

Using the priors policy (5 causes, listing order only → `manual_order_heuristic`):
- Cause 1: prior = 0.40 (manual_order_heuristic)
- Cause 2: prior = 0.25 (manual_order_heuristic) — second listed
- Cause 3: prior = 0.15 (manual_order_heuristic) — third listed
- Cause 4: prior = 0.10 (manual_order_heuristic) — remaining mass split over 4 + 5, minus 0.05 for unknowns
- Cause 5: prior = 0.05 (manual_order_heuristic)
- Unknown causes: remaining 0.05

```json
{
  "page": 37,
  "symptoms": [
    {
      "id": "wire_weld_porosity",
      "label": "Porosity / Gas Pockets in Weld",
      "description": "Small holes or pits visible on the weld surface or in cross-section; weld appears porous or bubbly",
      "process_scope": ["MIG", "Flux-Cored"],
      "causes": [
        {
          "id": "dirty_workpiece_or_wire",
          "label": "Dirty workpiece or welding wire",
          "prior": 0.40,
          "prior_source": "manual_order_heuristic",
          "checks": [
            {
              "id": "check_surface_contamination",
              "question": "Is there visible rust, paint, oil, or mill scale on the workpiece surface?",
              "modality": "user_photo",
              "positive_meaning": "Surface contamination is introducing gas into the arc",
              "likelihood_ratio_positive": 6.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Grind or wire-brush the weld zone to bare metal before welding"
            },
            {
              "id": "check_wire_condition",
              "question": "Is the welding wire discolored, rusty, or coated with residue?",
              "modality": "user_photo",
              "positive_meaning": "Wire contamination is introducing gas into the arc",
              "likelihood_ratio_positive": 5.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Replace the wire spool; store wire in a sealed container"
            }
          ]
        },
        {
          "id": "incorrect_polarity",
          "label": "Incorrect polarity",
          "prior": 0.25,
          "prior_source": "manual_order_heuristic",
          "checks": [
            {
              "id": "check_polarity_mig",
              "question": "For MIG solid wire: is the MIG gun cable in the positive (+) socket and the ground in the negative (−) socket?",
              "modality": "self_report",
              "positive_meaning": "Polarity is correct for MIG — this cause is unlikely",
              "likelihood_ratio_positive": 0.1,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Polarity is fine — investigate other causes"
            },
            {
              "id": "check_polarity_fcaw",
              "question": "For Flux-Cored wire: is the MIG gun cable in the negative (−) socket and the ground in the positive (+) socket?",
              "modality": "self_report",
              "positive_meaning": "Polarity is correct for FCAW — this cause is unlikely",
              "likelihood_ratio_positive": 0.1,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Polarity is fine — investigate other causes"
            }
          ]
        },
        {
          "id": "insufficient_shielding_gas",
          "label": "Insufficient shielding gas (MIG only)",
          "prior": 0.15,
          "prior_source": "manual_order_heuristic",
          "checks": [
            {
              "id": "check_gas_flow_rate",
              "question": "What is the flow rate shown on your regulator? (in CFH)",
              "modality": "numeric_measurement",
              "positive_meaning": "Flow rate below 20 CFH is allowing atmospheric air to contaminate the weld pool",
              "likelihood_ratio_positive": 7.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Set flow rate to 20–25 CFH; check for kinks in the gas hose"
            },
            {
              "id": "check_nozzle_blockage",
              "question": "Is the nozzle interior caked with spatter buildup?",
              "modality": "user_photo",
              "positive_meaning": "Spatter is restricting gas flow to the arc",
              "likelihood_ratio_positive": 4.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Clean the nozzle with nozzle dip or pliers; replace if blocked"
            },
            {
              "id": "check_ctwd_gas",
              "question": "Is the contact-tip-to-work distance (CTWD) greater than 1/2 inch?",
              "modality": "self_report",
              "positive_meaning": "Excessive CTWD disperses the gas shield before it reaches the arc",
              "likelihood_ratio_positive": 3.5,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Reduce CTWD to 3/8\"–1/2\" and maintain it consistently"
            }
          ]
        },
        {
          "id": "wire_feed_too_fast",
          "label": "Wire feeding too fast",
          "prior": 0.10,
          "prior_source": "manual_order_heuristic",
          "checks": [
            {
              "id": "check_wire_speed_setting",
              "question": "Is the wire feed speed set above the recommended range for the material thickness?",
              "modality": "self_report",
              "positive_meaning": "Excess wire is outrunning the gas shield and shielded arc",
              "likelihood_ratio_positive": 3.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Reduce wire feed speed in small increments (10–20 IPM) and test"
            }
          ]
        },
        {
          "id": "ctwd_too_long",
          "label": "CTWD too long",
          "prior": 0.05,
          "prior_source": "manual_order_heuristic",
          "checks": [
            {
              "id": "check_ctwd_length",
              "question": "Is the visible wire stickout between the contact tip and workpiece greater than 1/2 inch?",
              "modality": "self_report",
              "positive_meaning": "Long stickout reduces shielding gas coverage and increases resistive heating",
              "likelihood_ratio_positive": 3.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Trim stickout to 3/8\"–1/2\"; hold gun closer to the workpiece"
            }
          ]
        }
      ],
      "manual_citation": {
        "page": 37,
        "section": "Wire Weld – Porosity / Gas Pockets"
      }
    }
  ]
}
```

---

## Notes on the worked example

- All five causes are `manual_order_heuristic` — the manual lists them in order but gives no explicit frequencies.
- All likelihood ratios are `llm_estimated` because the manual does not quantify them.
- Each check declares a `modality`: the regulator reading is `numeric_measurement` (triggers a number input), surface contamination is `user_photo` (triggers camera/upload), polarity checks are `self_report` (yes/no buttons).
- The polarity checks use inverted likelihood ratios (< 1) to reduce belief when polarity is confirmed correct.
- Prior for cause 3 (insufficient gas) is slightly higher than the formula schedule because it is process-specific (MIG only) — a larger fraction of the MIG-applicable prior mass.
- Symptom matching from user vocabulary ("Swiss cheese weld" → this symptom) happens at runtime: the agent calls list_symptoms(), receives the canonical IDs and descriptions, and reasons over them against the user's words. No synonym pre-computation needed.

---

## Aggregation across pages

After the per-page pass, `scripts/ingest-diagnostic.ts` merges all per-page symptom arrays into
`data/diagnostic_trees.json`. Duplicate symptom IDs across pages are merged by appending
causes and checks (deduplicating by check ID), then re-normalizing priors to sum ≤ 1.0.
