# Golden Questions — Vulcan OmniPro 220 Agent Eval

15 questions for pre-Stage-3 and post-Stage-3 regression. Each question is cold (no prior context assumed), answerable from committed data, and tied to a rubric axis. All expected answers are verified against the JSON stores and cross-checked against table cells — not paraphrased from prose.

---

## Category 1: Spec Lookups (deep technical accuracy)
*These require pulling exact cells from tables, not paraphrasing nearby text. The rubric calls these out explicitly.*

### Q1
**question:** What is the duty cycle for MIG at 200A on 240V?

**expected_answer:** 25% — at 200A on 240VAC, you can weld for 2.5 minutes then must rest for 7.5 minutes per 10-minute period.

**data_sources:**
- `critical_facts.json` → `mig_duty_cycle_240vac_25pct`
- `tables.json` → `table_7_1` rows["Rated Duty Cycles"]["240VAC / 60Hz"] = "25% @ 200A; 100% @ 115A"

**response_class:** text_only (or text_plus_surfaced_diagram if diagram_19_2 is surfaced)

**rubric_axis:** deep technical accuracy

---

### Q2
**question:** At what amperage can I weld all day without stopping on 240V in MIG mode?

**expected_answer:** 115A — at 115A on 240VAC the duty cycle is 100%, meaning continuous operation with no mandatory rest.

**data_sources:**
- `critical_facts.json` → `mig_duty_cycle_240vac_100pct`
- `tables.json` → `table_7_1` rows["Rated Duty Cycles"]["240VAC / 60Hz"] = "25% @ 200A; 100% @ 115A"

**response_class:** text_only

**rubric_axis:** deep technical accuracy

---

### Q3
**question:** What's the maximum welding current on 120V for TIG?

**expected_answer:** 125A — TIG on 120VAC tops out at 125A, with 40% duty cycle at that amperage.

**data_sources:**
- `critical_facts.json` → `tig_current_range_120vac`, `tig_duty_cycle_120vac_40pct`
- `tables.json` → `table_7_2` (TIG Specifications, 120VAC column)

**response_class:** text_only

**rubric_axis:** deep technical accuracy

---

### Q4
**question:** How many save slots does the OmniPro 220 have?

**expected_answer:** 5 — the Save Setting function stores up to 5 different welder configurations.

**data_sources:**
- `critical_facts.json` → `save_setting_slots`

**response_class:** text_only

**rubric_axis:** deep technical accuracy

---

## Category 2: Socket and Polarity Setup
*These exercise multimodal surfacing: the diagrams on pages 13–14 have labeled connector regions.*

### Q5
**question:** Which socket does the TIG torch cable go into?

**expected_answer:** The Negative Socket — TIG torch cable plugs into the Negative Socket, twisted clockwise to lock.

**data_sources:**
- `critical_facts.json` → `tig_torch_cable_negative_socket`
- `diagrams.json` → `diagram_24_1` (TIG cable setup, salience=0.9) and `diagram_14_1` (DCEP setup)

**response_class:** text_plus_surfaced_diagram (surface diagram_24_1 with the torch-cable region highlighted)

**rubric_axis:** multimodal responses + deep technical accuracy

---

### Q6
**question:** For flux-cored wire, do I set polarity to positive or negative?

**expected_answer:** Negative (DCEN — Direct Current Electrode Negative). Flux-cored self-shielded wire requires DCEN polarity.

**data_sources:**
- `critical_facts.json` → `flux_cored_polarity_dcen`
- `diagrams.json` → `diagram_13_3` (DCEN Flux-Cored Polarity Setup, salience=1)

**response_class:** text_plus_surfaced_diagram (surface diagram_13_3 which shows the cable swap)

**rubric_axis:** multimodal responses + deep technical accuracy

---

### Q7
**question:** Where does the ground clamp plug in for stick welding?

**expected_answer:** The Negative Socket — for Stick, the ground clamp goes into the Negative Socket; the electrode holder goes into the Positive Socket.

**data_sources:**
- `critical_facts.json` → `stick_ground_clamp_negative_socket`, `stick_electrode_holder_positive_socket`
- `diagrams.json` → `diagram_27_1` (Stick cable setup, salience=0.9)

**response_class:** text_plus_surfaced_diagram (surface diagram_27_1)

**rubric_axis:** multimodal responses + deep technical accuracy

---

## Category 3: Process-Specific Procedure
*These exercise operational details — the kind of thing someone in the garage needs to get right before striking an arc.*

### Q8
**question:** What shielding gas does TIG welding require?

**expected_answer:** 100% Argon — TIG welding requires pure Argon shielding gas at 20–30 SCFH flow rate.

**data_sources:**
- `critical_facts.json` → `tig_shielding_gas_100_argon`, `gas_flow_rate_scfh`

**response_class:** text_only

**rubric_axis:** deep technical accuracy + helpfulness

---

### Q9
**question:** Which way should a 10-pound wire spool unwind when installed?

**expected_answer:** Clockwise — a 10–12 lb spool must be installed so it unwinds clockwise. Installing it backwards causes wire feed problems.

**data_sources:**
- `critical_facts.json` → `10_12lb_spool_unwind_direction`
- `procedures.json` → `install_wire_spool_p10` (41-step procedure)

**response_class:** text_only (with offer to walk the full installation procedure)

**rubric_axis:** helpfulness + deep technical accuracy

---

### Q10
**question:** Can I use an extension cord with this welder?

**expected_answer:** No — the manual explicitly prohibits extension cord use. Use only the supplied power cords or an identical replacement.

**data_sources:**
- `critical_facts.json` → `no_extension_cord`

**response_class:** text_only

**rubric_axis:** helpfulness (safety-critical answer, must be unambiguous)

---

### Q11
**question:** What gun angle should I use for a T-joint fillet weld in MIG?

**expected_answer:** 45° — for fillet (T-shaped) welds, hold the MIG gun at a 45° angle between the two pieces.

**data_sources:**
- `critical_facts.json` → `fillet_weld_gun_angle`

**response_class:** text_only

**rubric_axis:** deep technical accuracy

---

## Category 4: Diagnostic (Bayesian narrowing)
*These exercise the diagnostic trees. The expected behavior is entry into Diagnose mode via verify_setup + list_symptoms matching.*

### Q12
**question:** My MIG weld looks like Swiss cheese — lots of little holes. What's wrong?

**expected_answer:** Porosity — likely causes are contaminated base metal, shielding gas flow problems (check regulator, hose, flow rate 20–30 SCFH), or CTWD too far from work (keep within 1/2"). Top differentiating check: is there visible rust/mill scale/oil on the base metal?

**data_sources:**
- `diagnostic_trees.json` → symptom `wire_weld_porosity` (causes + checks)
- `critical_facts.json` → `ctwd_distance`, `gas_flow_rate_scfh`

**response_class:** diagnose (enter Diagnose mode, surface wire_weld_porosity tree)

**rubric_axis:** deep technical accuracy + tone (garage user, hands-on language)

---

### Q13
**question:** The machine just shut off and the screen says something. What happened?

**expected_answer:** Thermal overload — the "Duty Cycle Exceeded" warning means the machine thermally tripped. Let it cool with the fan running; do not turn it off. Check which process and amperage you were using against the rated duty cycle.

**data_sources:**
- `critical_facts.json` → `warning_screen_duty_cycle_exceeded`
- `tables.json` → `table_23_1` (Warning Screen Problem and Remedy Table), `table_23_2` (Duty Cycle Summary)

**response_class:** text_only or text_plus_surfaced_diagram (surface duty cycle diagram)

**rubric_axis:** helpfulness + deep technical accuracy

---

### Q14
**question:** My flux-cored weld has a ton of spatter. I've already turned down the voltage. What else should I check?

**expected_answer:** Feed tensioner pressure (2–3 for flux-cored; too much crushes the wire), wire size match to the knurled roller, drag angle (should be 0–15° in travel direction for flux-core), and whether you've got the right polarity (DCEN for self-shielded).

**data_sources:**
- `diagnostic_trees.json` → symptom `wire_weld_excessive_spatter` (checks include tensioner, polarity, technique)
- `critical_facts.json` → `feed_tensioner_flux_cored_wire`, `flux_cored_wire_feed_roller_knurled`, `flux_cored_drag_angle`, `flux_cored_polarity_dcen`

**response_class:** diagnose (Diagnose mode, wire_weld_excessive_spatter tree; user has already eliminated voltage as cause)

**rubric_axis:** deep technical accuracy + helpfulness (prior check already eliminated)

---

## Category 5: Diagram and Artifact Surfacing
*These exercise the multimodal output rubric axis directly. The expected behavior requires the agent to call surface_region or render_artifact, not just describe.*

### Q15
**question:** Show me how duty cycle changes between 120V and 240V.

**expected_answer:** An artifact comparing the two duty cycle curves — at 120V: 40% @ 100A, 100% @ 75A; at 240V: 25% @ 200A, 100% @ 115A. The chart should show both curves on the same axes, with the 240V curve covering a higher amperage range but lower duty cycle at its peak.

**data_sources:**
- `critical_facts.json` → `mig_duty_cycle_120vac_40pct`, `mig_duty_cycle_120vac_100pct`, `mig_duty_cycle_240vac_25pct`, `mig_duty_cycle_240vac_100pct`
- `diagrams.json` → `diagram_19_1` (120VAC duty cycle visual, salience=1), `diagram_19_2` (240VAC duty cycle visual, salience=1)
- `tables.json` → `table_23_2` (Duty Cycle Summary Table)

**response_class:** text_plus_generated_artifact (`two_curve_chart` widget with both voltage curves) or text_plus_surfaced_diagram (surface both diagram_19_1 and diagram_19_2 side by side)

**rubric_axis:** multimodal responses (this is the demo centerpiece question from the challenge spec)

---

## Coverage Gaps

The following question areas are **not safely answerable** from current extracted data and are flagged here so Stage 3 agent prompting can handle graceful degradation:

1. **Exact voltage/wire-feed knob settings per thickness** — `canonical_setups.json` has 15 setups but most have `null` for `voltage_v` and `wire_feed_speed_ipm`. The agent must acknowledge the gap and direct the user to the manual's welding guide chart rather than hallucinate numbers.

2. **Spool gun setup details** — `mig_aluminum_spool_gun_240v` and `tig_aluminum_spool_gun_240v` setups exist but lack most parameters; aluminum via spool gun is flagged as "sold separately" and the manual pages covering it are sparse.

3. **Foot pedal operation** — only one fact (`foot_pedal_socket_inside_welder`) was extracted; detailed foot-pedal TIG operating procedure was not recovered.

4. **AC vs DC TIG selection flow** — facts distinguish DC TIG (mild steel/stainless) from AC TIG (aluminum) but no procedure walks the user through switching modes on the machine.

5. **Procedure step-level entity resolution** — 171 `UNRESOLVED_ENTITY_REF` in procedures mean that `verify_setup` tool calls crossing entity boundaries (e.g., looking up specs for a part referenced in a step) will silently return null. Acceptable limitation at Stage 3 — agent should degrade to citing the step text directly.
