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

**Rule:** priors must be grounded in the manual's own ordering when possible.

The manual lists causes in troubleshooting tables. The ordering of causes within a table is
treated as editorial signal — causes listed first are presumed more common. We convert this
position into a prior:

```
position 1 of N causes → prior = 0.5
position 2 of N causes → prior = 0.3
position 3 of N causes → prior = 0.15
position 4+ of N causes → prior split equally over remaining probability mass
```

These are rough but internally consistent. Every prior derived this way gets
`"source": "manual_derived"`.

When the manual does not provide an ordering, or when a cause is inferred from context
(not explicitly named in the manual), use domain-knowledge estimation:
`"source": "llm_estimated"`.

**This distinction is surfaced in the UI** as a small indicator next to each belief bar
in the diagnosis side panel, and is disclosed in the README.

Likelihood ratios (how much a positive check shifts belief) are always `llm_estimated`
unless the manual explicitly says something like "this is almost always caused by X."

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
3. Every numeric value (prior, likelihood_ratio) must include a "source" field:
   - "manual_derived" if the value is grounded in the manual's explicit ordering or text
   - "llm_estimated" if the value is based on domain knowledge not stated in the manual
4. Checks must be phrased as yes/no questions or binary observations the user can answer
   while standing at the machine (e.g., "Is the wire feed speed above 300 IPM?").
5. Vernacular synonyms must reflect how a non-expert in a garage would describe the problem
   (e.g., "holes in the weld", "weld blew through", "burn hole").
6. If a page contains no diagnostic content, return: { "symptoms": [] }
7. Return ONLY the JSON object.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "symptoms": [
    {
      "id": "symptom_slug_in_snake_case",
      "label": "Short human-readable label",
      "description": "What the user observes",
      "vernacular_synonyms": ["informal phrase 1", "informal phrase 2"],
      "welding_process_scope": ["MIG", "TIG", "Flux-Cored", "Stick"] | "all",
      "causes": [
        {
          "id": "cause_slug",
          "label": "Cause name",
          "prior": 0.0–1.0,
          "prior_source": "manual_derived" | "llm_estimated",
          "checks": [
            {
              "id": "check_slug",
              "question": "Yes/no question or binary observation",
              "positive_meaning": "What it means when the answer is yes",
              "likelihood_ratio_positive": number,
              "likelihood_ratio_source": "manual_derived" | "llm_estimated",
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

Using the priors policy (5 causes):
- Cause 1: prior = 0.50 (manual_derived)
- Cause 2: prior = 0.25 (manual_derived) — second listed
- Cause 3: prior = 0.12 (manual_derived) — third listed
- Cause 4: prior = 0.07 (manual_derived) — fourth listed
- Cause 5: prior = 0.04 (manual_derived) — fifth listed
- Unknown causes: remaining 0.02

```json
{
  "page": 37,
  "symptoms": [
    {
      "id": "wire_weld_porosity",
      "label": "Porosity / Gas Pockets in Weld",
      "description": "Small holes or pits visible on the weld surface or in cross-section; weld appears porous or bubbly",
      "vernacular_synonyms": [
        "holes in the weld",
        "pits in the bead",
        "bubbly weld",
        "weld looks like Swiss cheese",
        "pinholes",
        "gas pockets",
        "weld is porous"
      ],
      "welding_process_scope": ["MIG", "Flux-Cored"],
      "causes": [
        {
          "id": "dirty_workpiece_or_wire",
          "label": "Dirty workpiece or welding wire",
          "prior": 0.50,
          "prior_source": "manual_derived",
          "checks": [
            {
              "id": "check_surface_contamination",
              "question": "Is there visible rust, paint, oil, or mill scale on the workpiece surface?",
              "positive_meaning": "Surface contamination is introducing gas into the arc",
              "likelihood_ratio_positive": 6.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Grind or wire-brush the weld zone to bare metal before welding"
            },
            {
              "id": "check_wire_condition",
              "question": "Is the welding wire discolored, rusty, or coated with residue?",
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
          "prior_source": "manual_derived",
          "checks": [
            {
              "id": "check_polarity_mig",
              "question": "For MIG solid wire: is the MIG gun cable in the positive (+) socket and the ground in the negative (−) socket?",
              "positive_meaning": "Polarity is correct for MIG — this cause is unlikely",
              "likelihood_ratio_positive": 0.1,
              "likelihood_ratio_source": "manual_derived",
              "recommended_action_if_positive": "Polarity is fine — investigate other causes"
            },
            {
              "id": "check_polarity_fcaw",
              "question": "For Flux-Cored wire: is the MIG gun cable in the negative (−) socket and the ground in the positive (+) socket?",
              "positive_meaning": "Polarity is correct for FCAW — this cause is unlikely",
              "likelihood_ratio_positive": 0.1,
              "likelihood_ratio_source": "manual_derived",
              "recommended_action_if_positive": "Polarity is fine — investigate other causes"
            }
          ]
        },
        {
          "id": "insufficient_shielding_gas",
          "label": "Insufficient shielding gas (MIG only)",
          "prior": 0.12,
          "prior_source": "manual_derived",
          "checks": [
            {
              "id": "check_gas_flow_rate",
              "question": "Is the gas flow rate below 20 CFH on the regulator?",
              "positive_meaning": "Low flow rate is allowing atmospheric air to contaminate the weld pool",
              "likelihood_ratio_positive": 7.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Set flow rate to 20–25 CFH; check for kinks in the gas hose"
            },
            {
              "id": "check_nozzle_blockage",
              "question": "Is the nozzle interior caked with spatter buildup?",
              "positive_meaning": "Spatter is restricting gas flow to the arc",
              "likelihood_ratio_positive": 4.0,
              "likelihood_ratio_source": "llm_estimated",
              "recommended_action_if_positive": "Clean the nozzle with nozzle dip or pliers; replace if blocked"
            },
            {
              "id": "check_ctwd_gas",
              "question": "Is the contact-tip-to-work distance (CTWD) greater than 1/2 inch?",
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
          "prior": 0.07,
          "prior_source": "manual_derived",
          "checks": [
            {
              "id": "check_wire_speed_setting",
              "question": "Is the wire feed speed set above the recommended range for the material thickness?",
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
          "prior": 0.04,
          "prior_source": "manual_derived",
          "checks": [
            {
              "id": "check_ctwd_length",
              "question": "Is the visible wire stickout between the contact tip and workpiece greater than 1/2 inch?",
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

- All five causes are `manual_derived` because the manual explicitly lists them in order.
- All likelihood ratios are `llm_estimated` because the manual does not quantify them.
- The checks are phrased so a user standing at the machine can answer them in under 10 seconds.
- The polarity checks use inverted likelihood ratios (< 1) to reduce belief when polarity is confirmed correct.
- Vernacular synonyms are intentionally colloquial to match fuzzy user queries.

---

## Aggregation across pages

After the per-page pass, `scripts/ingest-diagnostic.ts` merges all per-page symptom arrays into
`data/diagnostic_trees.json`. Duplicate symptom IDs across pages are merged by appending
causes and checks (deduplicating by check ID), then re-normalizing priors to sum ≤ 1.0.
