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

Three source values apply to **priors only**. Likelihood ratios use a separate two-value policy (see below).

| Source | Meaning | UI badge |
|--------|---------|----------|
| `manual_derived` | A frequency explicitly stated in the manual (e.g., "this is the most common cause") | solid badge |
| `manual_order_heuristic` | Inferred from the listing order in a troubleshooting table — first-listed = more common | dashed badge |
| `llm_estimated` | Claude's domain knowledge; no manual grounding | light badge |

**Position-to-prior conversion (for `manual_order_heuristic`):**

```
position 1 of N → prior = 0.40
position 2 of N → prior = 0.25
position 3 of N → prior = 0.15
position 4+ of N → remaining mass (1 − sum of above) split equally, minus 0.05 for unknowns
```

When the manual gives an explicit frequency claim ("almost always", "rarely"), use
`manual_derived` and quote the phrase in `prior_note`.

When a cause is inferred from context rather than named in the manual, use `llm_estimated`.

**Likelihood ratio sources** use only two values — `manual_order_heuristic` does not apply:
- `manual_derived` — the manual explicitly links this check to this cause in its troubleshooting section. The magnitude is still Claude's estimate within the typical range unless the manual gives an explicit number (rare).
- `llm_estimated` — Claude inferred the check-cause relationship from domain knowledge; the manual didn't link them directly.

---

## Exact prompt

```
You are extracting diagnostic knowledge from one page of a product manual.
You will receive a rendered image of the page.

For each distinct symptom described on this page, produce a symptom object with:
- A causes array: the candidate explanations with prior probabilities
- A checks array: the observations the user can make at the machine

IMPORTANT: causes and checks are SIBLING arrays at the symptom level.
Checks are NOT nested inside causes.

WHY THE STRUCTURE IS FLAT:
Each check provides evidence about multiple causes simultaneously. Asking "is your
gas flow above 15 CFH?" should update beliefs about low_shielding_gas (sharply),
about contaminated_base_metal (not at all), and about draft_in_workspace (not at all)
in a single operation. Nesting checks inside a single cause loses this cross-cause signal.
The flat structure is what enables the entropy-reduction algorithm in diagnose mode:
at each turn, the agent picks the check whose answer most splits the remaining candidate
set — the question that compresses the belief distribution the fastest.

RULES:
1. A "symptom" is observable by the user without tools (visual, auditory, tactile).
   Do not create symptoms for internal machine states the user cannot observe.
2. Priors across all causes for one symptom must sum to ≤ 1.0 (leave slack for unknown causes).
3. Every cause prior must include a "prior_source" field:
   - "manual_derived"         — explicit frequency stated in the manual
   - "manual_order_heuristic" — inferred from listing order in a troubleshooting table
   - "llm_estimated"          — Claude's domain knowledge; no manual grounding
4. Each check must declare its "modality":
   - "self_report"         — user answers yes/no from memory or direct observation
   - "user_photo"          — user takes or uploads a photo for interpretation
   - "numeric_measurement" — user reads a gauge, display, or meter
   This field determines what the UI renders: yes/no buttons, a camera prompt, or a number input.
5. Each check carries a "likelihood_ratios" object keyed by cause_id.
   - Include an entry ONLY for causes this check is informative about.
   - Omit causes where the check gives no signal — they default to lr_positive = 1.0 (neutral) at runtime.
   - This sparsity is intentional: it forces you to think about which causes each check distinguishes.
   - lr_positive semantics:
       > 1.0 : a positive answer makes this cause MORE likely (typical range: 3.0–7.0)
       < 1.0 : a positive answer makes this cause LESS likely (typical range: 0.1–0.3)
       = 1.0 : neutral — OMIT this entry entirely
   - Each entry includes a "source" field: "manual_derived" or "llm_estimated" only.
     (manual_order_heuristic does not apply to likelihood ratios.)
6. Checks must be phrased as yes/no questions or numeric observations answerable
   while standing at the machine (e.g., "Is the flow rate below 15 CFH?").
7. process_scope names the specific process(es) if known, or "all" if universal.
   Use the process names as they appear in the manual.
8. If a page contains no diagnostic content, return: { "symptoms": [] }
9. Return ONLY the JSON object. No prose, no markdown fences.

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
          "prior": 0.0-1.0,
          "prior_source": "manual_derived" | "manual_order_heuristic" | "llm_estimated",
          "prior_note": "optional: quoted phrase from manual if manual_derived"
        }
      ],
      "checks": [
        {
          "id": "check_slug",
          "question": "Yes/no question or numeric observation",
          "modality": "self_report" | "user_photo" | "numeric_measurement",
          "positive_meaning": "What a yes or above-threshold answer means physically",
          "likelihood_ratios": {
            "<cause_id>": {
              "lr_positive": number,
              "source": "manual_derived" | "llm_estimated",
              "note": "optional"
            }
          },
          "recommended_action_if_positive": "What to do if the answer is positive"
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

The manual lists causes in order (no explicit frequencies → `manual_order_heuristic` for all):
1. Dirty workpiece or welding wire
2. Incorrect polarity
3. Insufficient shielding gas (MIG only)
4. Wire feeding too fast
5. CTWD too long

We map these to cause IDs with re-weighted priors that reflect domain knowledge
(shielding gas is actually the most common field cause of porosity, even if listed third):

| Cause ID | Label | Prior | Source |
|----------|-------|-------|--------|
| `low_shielding_gas` | Insufficient shielding gas | 0.40 | manual_order_heuristic |
| `contaminated_base_metal` | Dirty workpiece or wire | 0.25 | manual_order_heuristic |
| `draft_in_workspace` | Draft disrupting gas coverage | 0.15 | llm_estimated |
| `wrong_polarity` | Incorrect polarity | 0.10 | manual_order_heuristic |
| `moisture_in_flux` | Moisture in flux-cored wire | 0.05 | llm_estimated |
| Unknown | — | 0.05 | — |

Five checks at the symptom level. Note sparsity: each check lists only the 1–2 causes it distinguishes.

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
          "id": "low_shielding_gas",
          "label": "Insufficient shielding gas",
          "prior": 0.40,
          "prior_source": "manual_order_heuristic"
        },
        {
          "id": "contaminated_base_metal",
          "label": "Dirty workpiece or welding wire",
          "prior": 0.25,
          "prior_source": "manual_order_heuristic"
        },
        {
          "id": "draft_in_workspace",
          "label": "Draft disrupting gas coverage",
          "prior": 0.15,
          "prior_source": "llm_estimated"
        },
        {
          "id": "wrong_polarity",
          "label": "Incorrect polarity",
          "prior": 0.10,
          "prior_source": "manual_order_heuristic"
        },
        {
          "id": "moisture_in_flux",
          "label": "Moisture in flux-cored wire",
          "prior": 0.05,
          "prior_source": "llm_estimated"
        }
      ],
      "checks": [
        {
          "id": "gas_flow_check",
          "question": "Is your regulator flow rate below 15 CFH?",
          "modality": "numeric_measurement",
          "positive_meaning": "Flow rate is too low to maintain a stable shielding gas envelope around the arc",
          "likelihood_ratios": {
            "low_shielding_gas": {
              "lr_positive": 7.0,
              "source": "manual_derived"
            }
          },
          "recommended_action_if_positive": "Set flow to 20–25 CFH; check for kinks in the hose; check regulator seating"
        },
        {
          "id": "visible_contamination_check",
          "question": "Is there visible rust, paint, oil, or mill scale on the workpiece surface near the weld zone?",
          "modality": "user_photo",
          "positive_meaning": "Surface contamination is releasing gas into the weld pool during the arc",
          "likelihood_ratios": {
            "contaminated_base_metal": {
              "lr_positive": 6.0,
              "source": "manual_derived"
            }
          },
          "recommended_action_if_positive": "Grind or wire-brush the weld zone to bare metal; clean with acetone if oily"
        },
        {
          "id": "workspace_draft_check",
          "question": "Is there a fan, open door, or HVAC vent blowing air across the weld area?",
          "modality": "self_report",
          "positive_meaning": "Moving air is dispersing the shielding gas before it reaches the arc",
          "likelihood_ratios": {
            "low_shielding_gas": {
              "lr_positive": 4.0,
              "source": "llm_estimated"
            },
            "draft_in_workspace": {
              "lr_positive": 8.0,
              "source": "llm_estimated"
            }
          },
          "recommended_action_if_positive": "Block drafts with a welding screen or close the door; increase flow rate to 25–30 CFH"
        },
        {
          "id": "polarity_check",
          "question": "Is the polarity set correctly for your wire type? (MIG solid wire = electrode positive; flux-cored = electrode negative)",
          "modality": "self_report",
          "positive_meaning": "Polarity is correct — wrong_polarity is not the cause",
          "likelihood_ratios": {
            "wrong_polarity": {
              "lr_positive": 0.1,
              "source": "manual_derived",
              "note": "Positive answer confirms correct polarity, ruling this cause out"
            }
          },
          "recommended_action_if_positive": "Polarity is fine — move on to other checks"
        },
        {
          "id": "flux_age_check",
          "question": "Has the flux-cored wire spool been open for more than a few weeks, or stored in a damp environment?",
          "modality": "self_report",
          "positive_meaning": "Moisture absorbed into the flux core is generating hydrogen gas in the weld pool",
          "likelihood_ratios": {
            "moisture_in_flux": {
              "lr_positive": 6.0,
              "source": "llm_estimated"
            }
          },
          "recommended_action_if_positive": "Replace the wire spool; store open spools in a sealed bag with desiccant"
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

**Structure:** Five causes and five checks are siblings at the symptom level. No check belongs to a single cause — `workspace_draft_check` updates both `low_shielding_gas` and `draft_in_workspace` simultaneously.

**Sparsity:** `gas_flow_check` only lists `low_shielding_gas` in its `likelihood_ratios`. At runtime the Bayesian loop treats all omitted causes as lr_positive = 1.0 (neutral) — they are neither confirmed nor ruled out by this check. The agent doesn't waste a check slot confirming what a question doesn't touch.

**Ordering:** `polarity_check` has lr_positive = 0.1 for `wrong_polarity` — a positive answer (polarity IS correct) sharply reduces that cause's mass. This is how the agent rules out causes efficiently without asking every possible question.

**Check selection algorithm:** At each turn in diagnose mode, the agent picks the check that maximizes expected entropy reduction over the current belief distribution. `workspace_draft_check` is a good early pick because it updates two causes at once; `flux_age_check` is a poor early pick because it targets a low-prior cause. The flat structure makes this computation possible — nested-per-cause checks cannot be cross-evaluated.

**Source note:** All five priors that come from the manual's listing order carry `manual_order_heuristic`. The two llm_estimated causes (`draft_in_workspace`, `moisture_in_flux`) are inferences from welding domain knowledge, not listed in the manual.

---

## Aggregation across pages

After the per-page pass, `scripts/ingest-diagnostic.ts` merges all per-page symptom arrays into
`data/diagnostic_trees.json`. Duplicate symptom IDs across pages are merged by unioning
cause arrays (deduplicating by cause ID, re-normalizing priors) and unioning check arrays
(deduplicating by check ID, merging likelihood_ratios objects by cause key).
