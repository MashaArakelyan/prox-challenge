# OmniPro 220 Agent

<img src="product.webp" alt="Vulcan OmniPro 220" width="400" /> <img src="product-inside.webp" alt="Vulcan OmniPro 220 — inside panel" width="400" />

A multimodal reasoning agent over the 48-page Vulcan OmniPro 220 welder manual. Built for the [Prox Technologies founding engineer challenge](https://useprox.com/join/challenge).

## Quick start (under 2 minutes)

```bash
git clone <your-fork>
cd <your-fork>
npm install
npm run dev          # http://localhost:3000
```

Open `http://localhost:3000`. On first load you'll see a modal asking for your Anthropic API key (`sk-ant-...`). The key is stored only in your browser — it is never sent to any server other than the official Anthropic API.

No `.env` file is needed. No build step for the knowledge data — it's already committed under `data/`.

---

## The thesis

The manual is an artifact for someone sitting at a desk. This agent is a tool for someone standing at a machine, hands busy, eyes on the equipment.

Every design decision flows from that gap:

- **Lead with the answer.** One sentence, concrete, with the unit. Detail comes after.
- **Surface diagrams, don't describe them.** When the answer is spatial — which socket, which cable — show the image.
- **Generate artifacts when text can't carry the relationship.** Duty cycle curves, calculators, belief-state tables. The right-hand panel exists to hold things that words can't.
- **Ask one question at a time.** A user mid-weld does not read a bulleted disambiguation list.

---

## Three load-bearing decisions

### 1. Schema inference before extraction

Before any extraction pass, Claude reads the manual's table of contents, the first eight pages, and any chapter named "specifications" or "safety" and proposes a domain-specific ontology: entity types, relation predicates, expected attributes per type.

This output (`data/schema.json`) is what lets the system generalize. Swap the PDF in `files/`, re-run `npm run ingest`, and the agent should work on a CNC mill or a furnace. Nothing in the query layer or the tool implementations hardcodes "welder."

The alternative — hardcoding entity types — would have made the knowledge layer brittle and domain-specific to this one product class.

### 2. Structured extraction over RAG

The standard RAG playbook (chunk → embed → retrieve → synthesize) fails on two question types this agent must handle:

- **Exact-cell lookup.** "What's the duty cycle for MIG at 200A on 240V?" A semantic search might return the paragraph next to the table. The agent needs the exact cell. `search_critical_facts` returns a flat list of atomic, quotable assertions (`data/critical_facts.json`) — one fact, one page citation per entry. The correct answer is pulled, not approximated.
- **Visual content.** The weld-diagnosis photos, the front-panel labels, the polarity wiring diagram — these exist only as images. RAG over text misses them entirely. Three parallel vision-capable extraction passes using Claude with the actual page images build `data/diagrams.json` with bounding-box-level regions, `data/entities.json`, `data/relations.json`, and `data/tables.json`.

The three passes use different models matched to task complexity:
- **Sonnet 4.6** — structural pass (entities, tables, diagram regions) and procedural pass (state machines)
- **Opus 4.7** — diagnostic pass (Bayesian networks requiring strong causal reasoning)

The structural pass initially used Haiku 4.5 for cost. It failed on a dense duty-cycle page where rotated text and multi-row spans defeated the model. The page was rescued with Opus and the structural pass was promoted to Sonnet 4.6 for the full run. The lesson — *cost optimization is for hot paths, not cold paths* — drove the upgrade. Ingestion runs once; pay for it.

### 3. Salience synthesis and critical facts

After extraction, a synthesis pass reads the assembled stores (not the raw PDF again) and produces:

- `data/critical_facts.json` — atomic quotable assertions with page citations. These are the fastest path to a correct answer for the most common question types.
- Salience weights (0–1) on every entity, relation, and diagram. The `surface_region` tool uses these to rank which diagram to surface when multiple apply.
- `data/canonical_setups.json` — pre-computed cross-section assemblies for common task patterns (e.g., "full setup for 1/8" mild steel MIG"), used by `verify_setup` to detect mismatches before entering diagnostic mode.

---

## Multimodal artifact harness

The right-hand panel renders artifacts emitted by the `render_artifact` tool. The design is a constrained widget descriptor system, not freeform JSX.

The agent emits one of five kinds: `template`, `react`, `html`, `svg`, `mermaid`. Templates (`two_curve_chart`, `comparison_table`, `parameter_calculator`, `connection_diagram`, `interactive_panel`, `troubleshooting_flowchart`) are purpose-built and always render correctly. The `react` kind is the freeform escape hatch for things no template covers.

The iframe sandbox for `react`/`html` kinds follows the pattern Reid Barber reverse-engineered from Claude Artifacts: parent sends `{type: "render", code}` via `postMessage`; iframe transpiles JSX via Babel standalone, executes in a sandboxed environment, and reports back height and errors. The import allowlist is `react`, `recharts`, `lucide-react`.

Constraining to templates first and reaching for freeform JSX only as a last resort is the right call at this scale. Freeform JSX from an LLM renders inconsistently and is hard to debug. Templates give the agent a reliable, predictable surface with zero render failures.

---

## Diagnose mode — Bayesian narrowing

When a user reports a weld defect or machine problem, the agent switches to Diagnose mode:

1. `list_symptoms()` — returns every canonical symptom ID + label from `data/diagnostic_trees.json`. The agent reasons over this list against the user's words to find the best match. No embedding index needed at this scale (~35 symptoms); the LLM does fuzzy matching natively.

2. `verify_setup(process, material)` — checks reported settings against the canonical setup for that process/material. Mismatches surface immediately, before the Bayesian loop starts. Most "porosity" complaints are setup errors, not root-cause unknowns.

3. `diagnose_loop(symptomId, currentBeliefs, lastAnswer)` — Bayesian update + next-best-check selection. Beliefs are initialized from priors extracted from the manual's troubleshooting section ordering (`manual_order_heuristic`) or estimated by the LLM (`llm_estimated`). Every prior carries its source flag — this distinction is visible in the comparison table artifact and documented honestly here.

   Check selection maximizes expected information gain: for each remaining check, compute the expected Shannon entropy of the posterior under both a positive and negative outcome, weighted by the probability of each outcome. Pick the check with minimum expected posterior entropy.

4. After every `diagnose_loop` call, the agent emits a `comparison_table` artifact showing the ranked belief state (cause → probability → source). The user watches the distribution compress in the right-hand panel as questions are answered.

5. Termination at 0.70 posterior confidence. The recommended action comes from the leading cause's `recommended_action_if_positive` field in the diagnostic tree.

Multi-turn context works through the `turn_messages` SSE event: the API route emits the full `MessageParam[]` exchange after each turn; the frontend accumulates these in `apiHistory` and sends them with the next request. The agent reconstructs diagnostic state by reading prior `diagnose_loop` tool results in context.

---

## What was deliberately cut

**Voice in / voice out.** Only worthwhile if flawless. Janky voice undercuts the polished parts. Architecture-friendly to add: the SSE stream is already structured, so a TTS layer clips onto `text_delta` events. Omitted because it's a polish risk, not a capability gap.

**Live AR overlay.** Would need WebRTC + edge inference for real-time overlays on a camera feed. Way out of scope for the time budget.

**Cross-product compatibility queries.** Meaningful only in the multi-product SaaS version. Needs a graph that spans products — this is one-product-at-a-time.

**Fully freeform LLM-generated JSX artifacts.** Considered it — it's what Claude.ai does. Rejected because freeform JSX from an LLM fails silently in too many ways. The constrained template system gives you 95% of the value with near-zero render failures. The `react` escape hatch exists for the remaining 5%.

**Vernacular embedding index.** Could pre-compute symptom synonyms ("Swiss cheese weld" → porosity) and embed them for runtime matching. Rejected because that's guessing what users will say — exactly the brittleness an LLM should erase. `list_symptoms()` returns the canonical list; the agent reasons over it against the user's words. The embedding path becomes worth it past ~200 symptoms, where the list outgrows a single tool-result context window.

---

## Known limitations

**Relations are intra-page only.** Cross-page navigation works through shared entity IDs and citation sets rather than graph edges. The alternative would have invited hallucinated relations between entities the LLM never observed together.

**Procedure entity refs use type-name hints, not specific IDs.** The procedural extraction pass ran in parallel with structural extraction and had no access to the real entity ID set. Steps list refs like `"welding_wire"` rather than `"welding_wire_solid_core"`. The `verify_setup` tool degrades gracefully: it cites step text directly when an entity ref doesn't resolve.

**Exact dial positions for most material/thickness combos are missing.** Only 1/8" mild steel setups have confirmed numbers in the extracted data. For anything else, the agent says so and cites the welding guide chart pages (15–18) directly.

**Diagnostic priors are position-heuristic, not frequency-derived.** The manual's troubleshooting section ordering is used as a proxy for cause frequency. This is documented with `manual_order_heuristic` source flags on every affected prior.

---

## Architecture

```
files/
  owner-manual.pdf          48-page source (not served at runtime)

data/
  schema.json               inferred domain ontology
  entities.json             450 extracted entities with salience weights
  relations.json            intra-page relations
  tables.json               typed table rows (duty cycle, wire specs, etc.)
  diagrams.json             labeled diagram regions with bounding boxes
  procedures.json           state machines with postconditions
  diagnostic_trees.json     Bayesian networks: symptoms → causes → checks
  critical_facts.json       66 atomic quotable assertions with citations
  canonical_setups.json     pre-computed setups for common process/material combos
  images/                   cropped diagram region PNGs (committed)

lib/
  knowledge/                typed query layer over data/ (~200 lines)
  agent/tools/              8 tool implementations
  artifact-harness/         renderer + 6 templates + iframe sandbox

app/
  api/agent/route.ts        streaming SSE endpoint, agentic loop
  api/images/route.ts       serves data/images/ via HTTP
  page.tsx                  two-panel chat + artifact UI
  components/               ApiKeyModal, KeyIndicator

prompts/
  system.md                 agent system prompt (mode router + full protocol)
```

**Knowledge layer query budget:** the entire `lib/knowledge/` query layer is ~200 lines of TypeScript. No database, no vector index, no chunking. The graph is small enough to query in-process.

---

## Running ingestion yourself

Ingestion is pre-computed and committed. You do not need to run it. If you want to regenerate:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run ingest
```

This re-runs all four pipeline stages (schema inference, three parallel extraction passes, salience synthesis, cross-page resolution) and overwrites `data/`. Expect 15–20 minutes.

Do not run `npm run ingest` as part of `npm run dev`.

---

## Deploy your own

The app is a standard Next.js 15 project with no required environment variables at build time (the API key is BYO at runtime).

1. Push to GitHub
2. Connect at [vercel.com](https://vercel.com) — Next.js is auto-detected
3. Deploy — no env vars needed
4. Open the URL, enter your `sk-ant-...` key in the modal

---

## Eval — try these

| Question | Expected behavior |
|---|---|
| "What's the duty cycle for MIG at 200A on 240V?" | Exact cell from duty cycle table: 25% @ 200A. Cites p. 23. |
| "Show me how duty cycle changes between 120V and 240V" | `two_curve_chart` artifact in right panel with both curves. |
| "Which socket does the TIG torch cable go into?" | Text: Negative Socket. Image of front panel with socket labeled. No artifact generated. |
| "Build me a duty cycle calculator" | `parameter_calculator` artifact with amperage + voltage inputs, duty % + weld time outputs. |
| "My MIG weld has porosity — tiny holes in the bead" | Matches symptom, calls `verify_setup`, enters Bayesian loop. Comparison table updates after each answer. |
| "What polarity for flux-cored?" | DCEN. Cites the process table. |
| "Can I use an extension cord?" | No — manual says use only the supplied cord. Cites p. 4. |
