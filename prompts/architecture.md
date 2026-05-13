# Architecture

Walking through the system step by step. Slow enough for someone seeing system design for the first time; honest about the shortcuts taken.

By the end you should be able to draw this whole thing on a whiteboard from memory and explain *why* each piece exists in a sentence.

## A note on vocabulary

A few terms come up that have specific meanings in system design:

- **Pipeline** — a sequence of processing steps where the output of one is the input of the next. Like an assembly line.
- **Ingestion** — turning unstructured input (a PDF) into structured data your code can query.
- **Schema** — the shape of your data. *"Every Symptom has a name, a list of causes, and a list of checks"* is a schema.
- **Knowledge graph** — entities (nouns: Process, Symptom, Component) connected by typed relations (verbs: CAUSED_BY, REQUIRES). It's a way of storing facts so that *"what causes porosity?"* becomes a graph traversal, not a text search.
- **Embedding** — a list of numbers (usually 1536 of them) that represents the *meaning* of a piece of text. Two pieces of text with similar meaning have lists of numbers that are close together geometrically. Embeddings let you do fuzzy matching ("hairdryer sound" ≈ "high-frequency whine") without exact word overlap.
- **RAG (retrieval-augmented generation)** — the standard approach where you embed all your text chunks, find the most similar chunks to the user's question, paste them into a prompt, and let the LLM answer. We are deliberately *not* doing this. Reasons below.
- **Agent** — an LLM in a loop that can call functions ("tools") to retrieve data, mutate state, or take actions, then read the results and decide what to do next.

## What we're actually building

A person bought a Vulcan OmniPro 220 welder. It has four welding processes, two input voltages, dozens of settings, a 48-page manual, and zero patience for users who want to weld today, not next week. They are standing in their garage with greasy hands, looking at the physical machine, trying to make it do something specific.

Our job is an agent — basically a chat box plus some smart panels around it — that answers their questions correctly, shows them diagrams when geometry is the answer, generates interactive calculators when the question is about relationships, and walks them through diagnosing problems when something isn't working.

The rubric we're graded on has four parts: (1) deep technical accuracy, (2) multimodal output (the most important — show, don't tell), (3) tone (smart but garage-friendly), (4) extraction quality from the visual content of the manual.

The secret second goal: this should also work on a *different* manual — a CNC mill, a furnace, a 3D printer — without rewriting the code. That's what turns the demo from "a cool welder app" into "infrastructure that Prox could build a SaaS on."

## The big idea: ingest once, query light

Most teams will see this challenge and reach for RAG: embed the PDF, chunk it, store the vectors, and at query time fetch the most relevant chunks. This approach is the default for a reason — it's general, it scales, and the tooling is mature. But it loses badly on this challenge.

Here's why. The manual's most valuable content isn't prose. It's tables ("duty cycle at 200A, 240V is 30%"), diagrams (which socket the ground clamp goes in), state machines (the wire-change procedure), and decision matrices (the troubleshooting section). RAG retrieves *prose around those structures*. It does not retrieve the structure itself. So when the user asks the killer question — *"duty cycle at 200A on 240V?"* — RAG returns paragraphs talking about duty cycle, and the LLM paraphrases. But the correct answer is a single cell in a matrix, and paraphrasing it loses precision.

Our approach inverts this. We spend a lot of compute *once*, up front, pulling all that structure into typed JSON. At runtime we don't retrieve prose — we query structured data. Cells in matrices stay cells. State machines stay state machines. Diagrams stay diagrams with labeled regions you can point at. The agent's job becomes *composing answers from structured pieces* rather than *summarizing nearby text.*

This is the load-bearing decision. Everything downstream falls out of it.

## The three tiers, in one paragraph

**Ingestion** is the offline pipeline that runs once on the developer's machine and turns the PDF into structured JSON files. **The knowledge layer** is those JSON files, committed into the repo, ready to query. **The runtime** is the Next.js app that loads at `npm run dev` — an agent on the backend, a UI on the frontend, talking to the knowledge layer via a thin query API. Plus a **feedback loop** that captures unanswered questions and feeds them back to improve the manual itself.

Now let's go through each.

## Tier 1: ingestion — turning a PDF into structured knowledge

This is where most of the interesting work lives. Think of it as a five-stage assembly line for facts.

### The PDF problem

The welder manual is 48 pages. Some are mostly text (the safety section). Some are mostly tables (the duty cycle matrices). Some are mostly diagrams (the front panel callouts, the wiring schematics). Some have all three. And the most important facts in the document are often *inside* the visual content, not the prose around it.

So we feed each page to Claude with vision — meaning Claude can see the page as an image, not just read its text. Claude can describe the diagram, parse the table, and read the labels. This is the unlock that makes the rest possible.

### Stage 1: schema inference (the per-manual ontology trick)

Before we extract anything, we need to know *what we're extracting*. For a welder we'd want to pull out Processes, Settings, Symptoms, Components, Procedures. For a furnace we'd want Refrigerants, Valves, Circuits, FaultCodes. These aren't the same. If we hardcode "Process, Setting, Symptom, Component, Procedure" into our code, our system works on welders and fails on furnaces.

The trick: ask Claude to *propose the schema itself*, from the first ~8 pages plus any specification or safety sections. Claude reads enough of the manual to figure out the shape of the domain, then proposes a JSON schema: *"this manual is about a welder, the key entity types are Process, Setting, Symptom..."*. That schema is written to `data/schema.json` and used by every subsequent extraction step.

**The safety net**: every proposed entity type also has a `meta_role` field — a tag from a small abstract vocabulary like `operator_concept`, `physical_interface`, `failure_mode`, `consumable_input`. Downstream code asks *"give me all entities tagged `failure_mode`"* without knowing or caring whether they're called `Symptom` or `FaultCode`. This is how the runtime stays product-agnostic.

**The validator**: Claude can produce subtly bad output. Two entity types whose descriptions overlap 80%. A relation predicate with no source or target type. These break extraction in surprising ways. We run a validator that catches structural issues (count bounds, no duplicate names, trigram similarity check, every essential meta-role covered) and, if it fails, retries up to 3× with the validator's errors appended to the prompt. If it still fails, we surface the schema for human review via a `npm run schema:review` command.

**The shortcut**: schema inference is *not* a perfect, deterministic process. On a weird manual Claude might propose something janky. We live with that and provide the review escape hatch rather than building a perfectly robust auto-correction system. Shipping is more important than completeness.

### Stage 2: three parallel extraction passes

Now that we know the schema, we extract content. We run *three separate passes* over the manual rather than one combined pass, because each pass has a different output shape and combining them confuses Claude.

**Structural pass** — pulls out entities (the "nouns"), relations between them (the "verbs"), tables (every row as a typed object), and diagrams (with bounding box coordinates for every labeled region in the image). These go into `entities.json`, `relations.json`, `tables.json`, `diagrams.json`, plus an `images/` folder with the cropped diagrams.

**Procedural pass** — extracts every "how to..." section as a *state machine*. That means: ordered steps, with explicit *postconditions* for each step. A postcondition is "after this step, the wire should protrude 1/4 inch past the contact tip." This matters because it lets the runtime *verify* the user did the step right (by asking them to upload a photo) rather than just listing instructions. Goes into `procedures.json`.

**Diagnostic pass** — for every symptom mentioned anywhere in the manual ("porosity," "undercut," "spatter"), build a *Bayesian network*: a list of candidate causes with prior probabilities, a list of checks with likelihood ratios, plus vernacular synonyms ("Swiss cheese," "popping sound," "pinholes"). Every numeric value is tagged with a `source`: `manual_derived` (the manual gave us the number directly), `manual_order_heuristic` (we inferred it from how the manual ordered the list), or `llm_estimated` (Claude's general welding knowledge). This honesty is what lets us ship a Bayesian diagnostic system without lying about its priors.

**Why three passes and not one?** Because the prompts that extract a Bayesian network look nothing like the prompts that extract diagram bounding boxes. Trying to do everything in one prompt produces mediocre everything. Three focused prompts produce excellent each.

### Stage 3: salience synthesis (the load-bearing facts layer)

After the three extraction passes finish, we have a lot of structured data. But it's *flat* — every entity, every table row, every relation is treated the same. In reality, the front panel diagram is far more important than the company-history paragraph; the duty cycle table is the answer to twenty different questions while the bobbin spin-direction footnote is the answer to none.

Salience synthesis runs *after* the three passes, takes the extracted stores as input (not the raw PDF again, since we've already done the heavy vision work), and produces three new artifacts:

- **`critical_facts.json`** — atomic, quotable assertions like *"MIG duty cycle at 200A on 240V is 30%"*, *"TIG ground clamp goes in the negative DINSE socket"*. One fact, one citation per entry. These are the answers to common specific questions.
- **Salience weights** — every entity, relation, and diagram gets a score from 0 to 1 reflecting how load-bearing it is. Computed from how often it's cross-referenced across the other stores.
- **`canonical_setups.json`** — pre-computed cross-section assemblies for common task patterns. *"The full setup for 1/8" mild steel MIG"* might require pulling from four different tables and a procedure; we assemble it once so the runtime doesn't have to re-derive it every time someone asks.

**Why this matters at runtime**: when the user asks *"what's the duty cycle at 200A on 240V?"*, the agent first checks `critical_facts`. If found, the answer comes back instantly with a strong-confidence citation. Only if not found does it fall through to graph traversal. This makes common questions cheap and trustworthy, and the citation badge in the UI carries information about *where the answer came from*, which is real trust calibration.

### Stage 4: cross-page resolution

The last extraction step is cleanup. The manual is full of references like *"see figure 7-3 on page 31"*. Our extraction tagged each one as a string. Now we resolve those strings to hard pointers — the actual diagram entity, with its bounding box and image URL. We also de-duplicate: if "wire feeder" was mentioned on pages 14, 22, and 39, those are now a single entity with a list of citations. Every entity comes out with its canonical citation set — page, region bounding box, optional photo.

### Stage 5: the vernacular embedding index

This is the *only* place we use embeddings in the whole system, and it's worth understanding why.

Users don't speak the manual's vocabulary. They say *"it sounds like a hairdryer"* when the manual would call this *"high-frequency_whine_at_idle"*. *"My weld is Swiss cheese"* maps to *"porosity in weld bead"*. We need to translate the user's words into the canonical symptom names so we can look up the right diagnostic tree.

So for every symptom in `diagnostic_trees.json`, we embed its vernacular synonyms — convert each synonym to a list of numbers representing its meaning. We end up with maybe 500 vectors total. We save them to `data/vernacular.index.json`. At runtime, when the user types something fuzzy, we embed their words too and find the canonical symptom whose vernacular is geometrically closest.

**The shortcut**: a "real" production system would put these vectors in a dedicated database like Pinecone or Weaviate. For 500 vectors, that's wildly overkill. We just load the JSON into memory and run cosine similarity (a simple math operation) over the array. 200 lines of TypeScript, no infrastructure to set up, no external service to fail. *The smallness of our corpus is a feature, not a limitation* — it's what lets us avoid all the heavy machinery RAG systems need.

### The big shortcut for Tier 1: commit everything

Ingestion is slow (10-15 minutes of vision calls) and expensive (~$20-30 in API costs). Running it on every `npm run dev` is unacceptable. So we run it *once*, on the developer's machine, and *commit the output JSON files to the git repo*. Reviewers clone, the ingestion artifacts are already there, the app loads instantly with no ingestion happening at all. `npm run ingest` exists but is documented as "only run this if you swap the PDF."

This is the single biggest shortcut in the system. It works because the manual doesn't change between when we ingest and when the reviewer demos. For a production version where new manuals are added daily, you'd run ingestion on the server. But for an interview demo, committing the artifacts is the right call.

## Tier 2: the knowledge layer

After ingestion, you end up with a folder of JSON files in `data/`. That folder *is* the knowledge layer. There are six stores:

1. `entities.json` + `relations.json` — the knowledge graph (entities like Process, Symptom, Component, connected by relations like CAUSED_BY, REQUIRES)
2. `tables.json` — every parsed table from the manual, as typed rows
3. `procedures.json` — state machines with postconditions
4. `diagnostic_trees.json` — Bayesian networks per symptom
5. `diagrams.json` — registry of diagrams with bounding boxes and labels
6. `critical_facts.json` — the atomic load-bearing assertions

Plus `vernacular.index.json` (the embedding index) and `schema.json` (the inferred ontology).

A thin TypeScript layer in `lib/knowledge/` exposes typed query functions over these files: `queryGraph(start, relation, depth)`, `getTable(name, filters)`, `getCriticalFact(question)`, `findCanonicalSymptom(userInput)`. It's maybe 300 lines total. The entire layer is in-process — no database, no server, just functions reading JSON.

**The shortcut**: a "real" system might use Neo4j for the graph, PostgreSQL for the tables, Pinecone for the vectors. We use none of those. The entire knowledge layer fits in maybe 5 MB of JSON and runs in your laptop's RAM. A database would be slower (network round-trip per query) and add deployment complexity. *The simplicity isn't a compromise; it's the right tool for the scale.*

## Tier 3: the runtime

This is the Next.js app the user sees. An agent on the server, a chat-plus-panels UI on the client, talking via a streaming API route.

### What the agent is

A "Claude Agent SDK agent" is essentially an LLM (Claude Opus) in a loop, with three things added:

1. A **system prompt** — instructions about its job, its tone, its constraints
2. A list of **tools** — TypeScript functions it can call to get data or take actions
3. A **loop**: user message → agent decides whether to answer directly or call a tool → if tool, the agent reads the result and decides again → eventually emits a final answer

Think of it as a junior employee who can read the manual (via the knowledge layer), see images (because Claude has vision), and write code (the `render_artifact` tool, see below). But it doesn't store anything between turns unless you give it tools to do so.

### The six tools

These are the functions the agent can call. They're the entire interface between Claude's reasoning and our knowledge layer.

- `query_graph(start_entity, relation, depth)` — traverse the entity-relation graph
- `get_table(name, filters)` — return rows from a specific table
- `surface_region(diagram_id | page)` — return an image URL + caption + optional highlighted bounding box, for showing the user a visual
- `render_artifact(spec)` — emit a widget descriptor that the UI's artifact panel renders as an interactive component
- `diagnose_loop(belief_state, last_observation)` — update Bayesian beliefs after a user answer, and return the next best question to ask
- `verify_setup(procedure_id, current_step)` — walk a procedure's postconditions and return the first one that fails

### What `render_artifact` actually does

This is the most interesting tool because it's how the agent *generates UI*. The challenge specifically asks us to "reverse engineer Claude artifacts" — meaning, replicate the thing that lets Claude.ai render interactive widgets inside its chat.

Our implementation: the agent emits a small descriptor — `{ type: "parameter_calculator", inputs: [...], formula: "...", ... }` — that maps to a pre-built React component in our frontend. Six templates exist: `parameter_calculator`, `two_curve_chart`, `connection_diagram`, `troubleshooting_flowchart`, `interactive_panel`, `comparison_table`. Each one is a generic React component that takes content (numbers, labels, SVG) as props.

**The shortcut here is huge.** The "impressive" version would let the agent emit *raw JSX as a string*, compile it in the browser with Babel, and render it in a sandboxed iframe. That's what real Claude artifacts do. We can do that too as an escape hatch (`{ type: "custom", jsx: string }`), but our default is the constrained-template path because it's massively more reliable. The agent picks from a known menu of widgets that we know work, rather than gambling on freeform code generation. Mention in the README that we considered the freeform path and chose constrained-with-escape-hatch — that signals you knew the alternative existed and made a deliberate call.

### The four modes

The agent has *one tool surface* but *four different postures* it takes depending on what the user is doing. The mode router decides which posture on each user turn.

**Lookup mode (default)** — user asks a question, agent answers. Uses `query_graph`, `get_table`, `surface_region`, maybe `render_artifact`. Answers come back as chat text plus citations and optional visual content. This is the boring 70% that has to be flawless.

**Procedure mode** — triggered when the user is doing a multi-step task ("I'm setting up TIG" / "I'm changing the wire"). The UI narrows down to one step at a time, with a big "next" button, a "doesn't look right?" branch that flips to diagnose mode, and prompts for postcondition photo verification at key steps. The procedure state lives in a sidebar so the user can scrub back to earlier steps.

**Diagnose mode** — the agentic moment. Triggered when the user reports a problem. Two phases:

- *verify_setup phase* — cheap, respectful: walk the relevant procedure's postconditions and fail fast at the first one that's broken. ("You said the wire feed tension is 4, but the manual says 2.5 for this wire size. That's probably your problem.")
- *differential phase* — if setup is clean, enter the Bayesian loop. Fuzzy-match the user's vernacular complaint against canonical symptoms via the embedding index. Load that symptom's Bayesian tree. At each turn, pick the next question to ask by *expected entropy reduction* — meaning, the question whose answer would most split the remaining candidate set. (Textbook fault diagnosis. It's what makes the candidate-cause bars in the side panel visibly compress as questions get answered.) Terminate when one cause crosses 0.85 belief mass, OR when the agent decides it's stuck and offers a human handoff.

**Configure mode** — interactive SVG of the welder's actual front panel, extracted from the manual's labeled diagrams. User picks process + material + thickness. The panel animates to the recommended knob/dial positions. User looks at the screen, mimics on the physical machine. No description of dial positions in prose; the diagram *is* the answer.

## UI surfaces

The chat input is the worst-case fallback, not the default. When typing is harder than other modalities, we route to those:

- **Chat** — the linear spine. One conversation, one history.
- **Artifact panel** — right side of the screen. Renders the widgets emitted by `render_artifact`. When the agent makes a calculator, this is where it shows up.
- **Diagnosis side panel** — only visible in diagnose mode. Live bar chart of the candidate causes, with their probabilities visibly compressing as the user answers questions. Completed checks shown as chips below, each clickable to rewind the belief state.
- **Manual companion** — a collapsible sliver of the actual PDF on the side, synced to whatever page the agent is citing. Every citation in chat is a clickable thumbnail; tapping it jumps the companion to the relevant region with the bounding box highlighted.
- **Camera input** — photo upload (and later live webcam). This is the "is this normal?" surface — user snaps their weld, agent compares against the manual's reference defect photos and prescribes a fix.
- **Bench card export** — at the end of a configure or diagnose session, "download bench card" generates a one-page PDF with the user's specific settings + a QR code that deep-links back into the agent in this exact context. The user tapes it to the machine. Physical-to-digital handoff.

## The feedback loop (gap log)

Every question the agent couldn't answer well, or answered with low confidence, is logged to `data/gaps.jsonl`. Weekly, we cluster the gaps using the same embedding index (repurposed) and surface them on a manufacturer-facing dashboard: *"Your customers asked about X 47 times this month and your manual doesn't cover it; here's a draft new section, citations included."*

We ship this even in the demo as a JSON log file plus a one-page mock dashboard. It doesn't have to do anything fancy — it just has to communicate that this is the kind of SaaS retention play the architecture enables. That's the slide that turns a support tool into infrastructure.

## The shortcuts, audited

Consolidating the simplifications we deliberately took:

1. **Commit ingestion artifacts to the repo instead of regenerating** — we trade staleness risk (you have to re-ingest if the PDF changes) for instant reviewer experience. Correct for a demo, wrong for production.
2. **JSON files instead of databases** — no Neo4j, no Postgres, no Pinecone. We trade scalability for simplicity. Correct for ≤500 entities and ≤500 embedding vectors, wrong above that.
3. **Constrained widget templates instead of freeform JSX generation** — we trade flexibility for reliability. Correct because reviewers see a confident demo, not a flaky one; mention the alternative in the README.
4. **Pre-designed UI modes instead of fully emergent agent behavior** — the agent doesn't get to invent its own UI. It picks from four known modes. Correct because the architecture is more legible to a reviewer and easier to debug.
5. **Bayesian state machine for diagnosis instead of a learned model** — we use a deterministic Bayesian update with extracted priors instead of fine-tuning anything. Correct because we have no training data; flag in the README that real priors would calibrate over time.
6. **Schema review escape hatch instead of fully autonomous schema correction** — when Claude proposes a weird schema, a human looks at it. Correct because perfect autonomy is hard and a human-in-the-loop fallback is good engineering, not a failure.
7. **No voice and no AR** — both deliberately cut. Voice only impresses if flawless; AR overlay needs WebRTC + edge inference. Listed in the README under "roadmap" with reasons.

Every one of these is a deliberate choice with a documented reason. Naming them in the README is one of the strongest signals a reviewer reads.

## Why this generalizes

The only welder-specific code in the system is zero lines. Swap `files/owners-manual.pdf` with a CNC mill manual or a furnace manual, run `npm run ingest`, and:

- Schema inference proposes a different ontology (Toolpath, Spindle, Material for the mill; Refrigerant, Valve, FaultCode for the furnace)
- The extraction passes target the new schema
- The runtime queries by meta-role (`failure_mode`, `operator_concept`), so it asks the same questions to a different graph
- The agent's tools don't know what product they're talking about
- The UI modes work the same way over the new data

The only thing that's welder-specific is the *content* of the JSON files in `data/`. The *code* knows nothing about welding. That's the difference between "I built a welder app" and "I built infrastructure that Prox could turn into a SaaS." Make this point loudly in the README; it's the answer to the unspoken question on every reviewer's mind.
