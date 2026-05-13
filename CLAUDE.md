# Founding context for this project
You are helping me build a submission for the Prox Technologies founding engineer challenge. The repo is forked from prox-technologies/prox-challenge. The deliverable is a multimodal reasoning agent over the 48-page Vulcan OmniPro 220 welder manual, judged on technical accuracy, multimodal output quality, tone, and knowledge extraction quality. Reviewers must be able to clone, paste their own API key, and run within 2 minutes.
Before writing any code, your first action is to commit the rest of this prompt verbatim to CLAUDE.md at the repo root, so future sessions in Cursor pick it up automatically. After that, follow the staged build plan.

## Mission
Build a multimodal reasoning agent for the Vulcan OmniPro 220 using the Claude Agent SDK. The agent must answer deep technical questions correctly, surface diagrams and images when geometry or appearance is the answer, generate interactive artifacts when the question is about relationships, and diagnose problems agentically when the user is in trouble.
The thesis driving every design decision: the manual is an artifact for someone sitting at a desk; the agent is a tool for someone standing at a machine. Their hands are busy. Their eyes are on the equipment. They want the next action, not the explanation. Every UI choice flows from this.
The second thesis is that this should generalize. Nothing in the code should hardcode "welder." Swap the PDF in files/, re-run ingestion, and the agent should work on a CNC mill or a furnace. The mechanism for generalization is per-manual schema inference (described below).

## Architecture (three tiers)

### Tier 1 — Ingestion (offline, run once, results committed to data/)
Reviewers must not pay your API bill. Run ingestion once on your own key, commit the JSON outputs, ship the repo with everything pre-computed. Provide a npm run ingest script that regenerates them but do not run it as part of npm run dev.
Pipeline stages, in order:

1. Schema inference. Claude reads the manual's table of contents, the first ~8 pages, and any spec/safety summary, then proposes a domain-specific ontology as JSON: entity types, relation predicates, expected attributes per entity type. Output committed as data/schema.json. This step is what lets the system generalize across product classes.
2. Three parallel extraction passes against the inferred schema, page-by-page, using Claude with vision. Each pass uses the model best suited to its task — model constants live in scripts/ingest-config.ts:
   - Structural pass (Haiku 4.5) — transcription-heavy work: entities, relations, tables parsed into rows, diagrams with bounding boxes for every labeled region, embedded photos. Output: data/entities.json, data/relations.json, data/tables.json, data/diagrams.json, data/images/.
   - Procedural pass (Sonnet 4.6) — moderate reasoning: every "how to..." section becomes a state machine with ordered steps, explicit postconditions per step (e.g., "wire protrudes 1/4 inch past contact tip"), and branching on failure. Output: data/procedures.json.
   - Diagnostic pass (Opus 4.7) — strong reasoning required: for every symptom, build a Bayesian network with flat checks and per-cause likelihood ratios. Every prior and likelihood ratio carries a source flag (manual_derived, manual_order_heuristic, or llm_estimated). Output: data/diagnostic_trees.json.
   This split drops a full ingestion run from ~$25 to ~$5–8, making extraction-prompt iteration cheap.
3. Salience synthesis. Reads the assembled stores (not the raw PDF again) and produces:
   - data/critical_facts.json — atomic, quotable assertions like "MIG duty cycle at 200A on 240V is 30%", "TIG ground clamp goes in the negative DINSE socket". One fact, one citation per entry.
   - Salience weights (0–1) attached to every entity, relation, and diagram. Stored as updates to the existing JSON files.
   - data/canonical_setups.json — pre-computed cross-section assemblies for common task patterns (e.g., "full setup for 1/8" mild steel MIG").
4. Cross-page resolution. Links duplicate entity mentions across pages, resolves "see figure 7-3" references to hard pointers, attaches canonical citations (page + region bbox + photo if applicable) to every entity. Mutates the existing JSON files in place.

### Tier 2 — Knowledge layer (committed JSON, no database)
Five stores in data/: entities+relations, tables, procedures, diagnostic_trees, diagrams. A thin TypeScript query layer in lib/knowledge/ exposes typed functions over them. The graph is small enough (≤500 entities) that the entire JS query layer is ~200 lines. Do not add a database, do not chunk for RAG, do not add a vector DB. If you feel the urge, write the question in a comment and ask me first.

**README honesty note to include near the knowledge layer description:** "Relations are intra-page only; cross-page navigation works through shared entity IDs and citation sets rather than graph edges. The alternative would have invited hallucinated relations between entities the LLM never observed together."

### Tier 3 — Runtime (Claude Agent SDK)
Use the official Claude Agent SDK for TypeScript. The agent has seven tools:

- query_graph(start_entity, relation, depth) — graph traversal
- get_table(name, filters) — typed row lookup
- surface_region(diagram_id | page) — returns image URL + caption + optional highlighted bbox
- render_artifact(spec) — emits a widget descriptor that renders in the artifact panel (contract defined in Stage 0, see below)
- diagnose_loop(belief_state, last_observation) — Bayesian update + next-best-check selection
- verify_setup(procedure_id, current_step) — walks postconditions, returns the first failure or ok
- list_symptoms() — returns the full list of canonical symptom IDs and short descriptions from diagnostic_trees.json; used at diagnose-mode entry to match the user's reported problem to the correct Bayesian tree via LLM reasoning over the list

The agent operates in four modes, all sharing the same tool surface. The mode is determined by an intent router that runs on each user turn:

- Lookup mode (default) — Q&A with citation, diagram surfacing, table excerpts.
- Procedure mode — guided one-step-at-a-time UI with postcondition photo verification.
- Diagnose mode — runs verify_setup first; if clean, calls list_symptoms() to match the user's reported problem to a canonical symptom, then enters Bayesian narrowing. At each turn in the differential phase the agent picks the next check by maximizing expected entropy reduction over the current belief distribution — the question whose answer most splits the remaining candidate set. The flat-checks structure in diagnostic_trees.json (checks are siblings to causes, not nested inside them) is what makes this cross-cause computation possible. A live side panel shows the candidate-cause distribution as bars that compress as questions are answered. Each completed check is rewindable. Terminates when one cause crosses ~0.85 posterior mass OR offers a human handoff.
- Configure mode — interactive SVG of the front panel (extracted from the manual's labeled diagrams). User picks process + material + thickness; the panel animates to the recommended settings. User can drag dials and the agent narrates what would change.

### Lookup mode response classifier

Lookup mode is the demo's centerpiece and serves every rubric question shape — short factual answers, diagram surfacing, on-the-fly artifact generation. To stay consistent across runs, the first action on every Lookup-mode turn is an explicit classification of the expected response shape. This classifier is a structured-output call — either a Haiku 4.5 call for cost, or a structured tool call from the main Opus turn, whichever fits the SDK ergonomics best.

Output classes (exactly one per turn):

- text_only — short factual answer with no useful visual. Example: "What's the maximum input current at 120V?" → look up the spec, cite the page, return text + citation badge.
- text_plus_surfaced_diagram — the answer references a diagram already in the manual. Example: "Which socket does the ground clamp go into for TIG?" → return text + crop of the front panel diagram with the relevant region highlighted.
- text_plus_generated_artifact — the question is about relationships between variables or asks for an interactive widget. Example: "How does duty cycle change with amperage at 240V vs 120V?" → text + a generated artifact (one of the five kinds: react, html, svg, mermaid, template).
- needs_clarification — the question is ambiguous in a way that one short clarifier resolves. Example: "What polarity should I use?" with no process context → reply with quick-pick chips (MIG / TIG / Flux-cored / Stick) and wait.

The classifier prompt runs on the user message plus the last 2 turns of conversation context, and returns one of the four classes plus an optional reason string. Confidence below ~0.6 → default to text_only and surface the answer with a "want me to show this as a diagram or interactive widget?" affordance at the end.

The chosen class is included in the agent's system-prompt context for that turn (e.g., "Current response shape: text_plus_generated_artifact") so the rest of the response composition follows from it.

Without this explicit classifier the agent improvises differently across runs — sometimes generating artifacts when text would suffice, sometimes answering in prose when a diagram is the right call. The classifier makes Lookup mode legible, testable, and consistent. It's also what enables unit tests against Lookup behavior — pin the class, send a user message, assert on the response shape.

Do not implement the classifier yet. This is documentation for what Stage 3 will build.

### UI surfaces

- Chat (linear spine, the worst-case fallback when no other surface fits)
- Artifact panel (right side, renders widgets emitted by render_artifact)
- Diagnosis side panel (only visible in diagnose mode, shows live belief bars + completed-check chips)
- Manual companion (collapsible quarter-width PDF sliver, synced to citations; clicking a citation thumbnail jumps the PDF to the highlighted region)
- Camera input (photo upload, prepared for live webcam later)
- Bench card export (one-page PDF download with the user's current configuration + QR code that deep-links back to the agent in this exact context)

### What's been deliberately cut (do not build these, and explain why in the README)

- Voice in / voice out — only worthwhile if flawless; janky voice undercuts the polished parts. Architecture-friendly to add later.
- Live AR overlay — requires WebRTC + edge inference, way out of scope for the time budget.
- Cross-product compatibility queries — needs a multi-product graph, only meaningful in the SaaS version.
- Fully freeform LLM-generated JSX as artifacts — we constrain to a small set of widget templates for reliability; mention you considered the freeform path.
- Vernacular embedding index — considered pre-computing symptom synonyms ("Swiss cheese weld" → porosity) and embedding them for fuzzy matching at runtime. The LLM does this natively: the agent calls list_symptoms(), gets the canonical list, and reasons over it against the user's words. Pre-computing synonyms means guessing what users will say — exactly the brittleness an LLM should erase. The embedding path becomes worth it past ~200 symptoms, where the list grows too long to fit in a single tool-result context window.

## Rubric (the four things being graded)

1. Deep technical accuracy — must correctly answer questions like "what's the duty cycle for MIG at 200A on 240V" by pulling the actual cell, not paraphrasing nearby prose. Critical facts and tables exist for this.
2. Multimodal responses — the most important axis. Show diagrams, generate calculators, surface reference photos. When something is "too cognitively hard to explain in words, the agent should draw it." This is the entire point of render_artifact and surface_region.
3. Tone and helpfulness — user is in their garage, smart but not a professional welder. Short answers, sockets named not described, page citations as light footnotes.
4. Knowledge extraction quality — reviewers will see how well the visual content was extracted. The diagram with labeled regions is the artifact that proves this.

## Tech stack and non-negotiable constraints

- TypeScript, Next.js App Router, Claude Agent SDK
- Single repo, npm install && npm run dev to start
- Vercel for hosting with a "bring your own API key" landing page — the key lives in the user's browser (sessionStorage), is sent with each request as a header, and is never logged server-side
- data/ contains all pre-computed ingestion outputs, committed to the repo
- Ingestion artifacts must not regenerate as part of dev startup; reviewers should never wait
- README at the root, written with senior-eng readers in mind: explains the three load-bearing decisions (schema inference, structured extraction over RAG, salience synthesis), lists what was deliberately cut and why, and includes a 60-second "how to demo this" section
- 2-minute clone-to-running setup, tested on a clean machine before submission

## Build plan (staged, do not skip stages)

### Stage 0 — Lock the three load-bearing contracts before writing any framework code
These are the three places where guessing now will cost 1–2 days of rework later. Deliver them as documents/specs, not as running code yet. Pause after each and report back to me.

**0a. prompts/schema-inference.md** — the exact prompt sent to Claude during schema inference, including:
- What pages are included in the input (decision: TOC + first 8 pages + any chapter named "specifications" or "safety")
- The exact JSON shape Claude must return
- A validator (scripts/validate-schema.ts) that catches overlapping entity types, missing required fields, and incoherent relation predicates
- A fallback policy when validation fails (retry up to 2× with the validator's error message appended; then surface for human review via a npm run schema:review command)

**0b. prompts/diagnostic-extract.md** — the prompt for the diagnostic extraction pass, including:
- The explicit priors policy: priors should be derived from the manual's troubleshooting section ordering (most-commonly-listed cause first) when possible, and LLM-estimated otherwise. Every numeric value carries a source: "manual_derived" | "llm_estimated" flag in the output. This flag drives a UI indicator and is mentioned honestly in the README.
- The output JSON shape (see Tier 1 description)
- A small worked example using one symptom from the welder manual

**0c. lib/artifact-harness/CONTRACT.md** — the contract between the agent's render_artifact(spec) tool call and the iframe renderer:
- Decision: constrained widget descriptors, not freeform JSX. The agent emits { type: "duty_cycle_calculator" | "two_curve_chart" | "polarity_router" | "troubleshooting_flowchart" | "front_panel_twin" | "comparison_table", props: {...} }. Define the props schema for each type as TypeScript interfaces in lib/artifact-harness/types.ts.
- Include a freeform escape hatch: { type: "custom", jsx: string, imports: string[] } — used only when none of the templates fit. Imports allowlist: react, recharts, lucide-react. Babel standalone for JSX compilation. Sandboxed iframe for rendering.
- Self-correction protocol: if the iframe reports a render error, the agent retries once with the error message in the next tool call.

Stop after Stage 0 and show me the three documents before proceeding.

### Stage 1 — Run ingestion against the actual PDF and commit results
Run schema inference first against files/owner-manual.pdf and eyeball the output — cheap insurance before spending on extraction. If the schema is sane, proceed to the three extraction passes in parallel, then salience synthesis, then cross-page resolution. Commit all five JSON outputs to data/. Add npm run ingest to package.json but mark in README that it must not be run as part of dev startup.

### Stage 2 — Knowledge query layer
TypeScript modules in lib/knowledge/ exposing typed query functions over the JSON stores. ~200 lines total. Unit tests for non-trivial query paths (graph traversal, salience-ranked diagram retrieval).

### Stage 3 — Agent + tools
Claude Agent SDK setup, the six tools above, the mode router, the system prompt (tone: garage, smart-not-pro, short answers, sockets named, page-cited). The system prompt is its own file at prompts/system.md.

### Stage 4 — UI surfaces
Chat + artifact panel + manual companion + diagnosis side panel + camera input + bench card export. The diagnosis side panel with live compressing belief bars is one of the three demo wow moments and deserves extra polish.

### Stage 5 — The three asymmetric demo wins, then polish
In order of priority:
1. Photo-of-bad-weld → defect identification with side-by-side reference + cited fix
2. On-the-fly calculator generation when user asks a relationship question
3. Bayesian diagnose mode with the live belief panel

Then: BYO-key Vercel deployment, README polish, record a 3-minute video walkthrough, test the 2-minute setup on a clean machine.

## Decisions you can make on your own without checking with me

- Code organization within each lib/ module
- React component structure for the UI
- Styling approach (Tailwind is fine, keep it minimal)
- Test framework and which paths to test
- Exact wording of Claude prompts beyond the load-bearing structure
- Bench card PDF library choice (react-pdf, @react-pdf/renderer, or server-side puppeteer — pick what's simplest)

## Decisions to surface to me before acting

- Any change to the architecture above
- Adding any external service (database, vector DB, queue, etc.)
- Anything that breaks the 2-minute setup contract
- Anything that would make ingestion need to run on the reviewer's machine
- Any deviation from the four modes or six tools without asking

## Quality bar

- Code is for humans reading on a tight schedule. Functions ≤30 lines where possible, names descriptive, comments explain why not what.
- README is the most important document in the repo after CLAUDE.md. Write it like a senior engineer is reading it. Lead with the three load-bearing decisions and what was cut.
- Honesty in the documentation is a feature. The llm_estimated flag on diagnostic priors, the schema-review escape hatch, the deliberate scope cuts — all of these are listed prominently. The reviewer is more impressed by honest scope than by hidden weaknesses.
- Every commit message is a sentence, not a fragment.

## Known data limitations

**Procedure step entity_refs use type-name hints, not specific entity IDs.**
Procedure steps list refs like `"welding_wire"` or `"shielding_gas"` rather than specific IDs like `"welding_wire_solid_core"`. This happened because the procedural extraction pass ran in parallel with structural extraction and had no access to the real entity ID set at the time it ran. The agent should treat these as type hints — when a step needs to dereference an entity, call `getEntitiesByType()` and select by context (e.g., the process currently in use). The `verify_setup` tool should degrade gracefully when an entity ref doesn't resolve: cite the step text directly rather than failing.

**Image files are named `{page}_{diagram_id}.png`, not `{diagram_id}.png`.**
The structural extraction script saves cropped diagram images as `data/images/{page}_{diagram_id}.png` (e.g., `14_diagram_14_1.png`). Any tooling that constructs image paths must use both fields from the diagram record. The audit script (`scripts/audit-data.ts`) enforces this naming convention.
