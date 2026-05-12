// Stage 1d — Salience synthesis
// Reads all assembled stores (no PDF access). Produces:
//   data/critical_facts.json       — atomic quotable assertions with citations
//   data/canonical_setups.json     — common task cross-section assemblies
// Also stamps salience weights (0–1) inline on entities, relations, and diagrams.
//
// Runs in three Claude calls to keep each prompt focused:
//   Call A — critical_facts (reads tables + high-salience entities)
//   Call B — salience scoring (reads entity/relation/diagram metadata)
//   Call C — canonical_setups (reads tables + procedures + scored entities)

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { MODEL_SALIENCE, DATA_DIR } from "./ingest-config.js";

config();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, DATA_DIR);

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), "utf8")) as T;
}

type Entity = { id: string; name: string; type: string; description: string; page_refs: number[]; salience?: number };
type Relation = { predicate: string; subject_id: string; object_id: string; page: number; salience?: number };
type TableRow = Record<string, unknown>;
type Table = { id: string; name: string; page: number; columns: string[]; rows: TableRow[] };
type DiagramRegion = { label: string; bbox: { x: number; y: number; width: number; height: number } };
type Diagram = { id: string; page: number; caption: string; regions: DiagramRegion[]; salience?: number };
type Step = { step: number; instruction: string; postcondition: string | null; entity_refs: string[] };
type Procedure = { id: string; name: string; description: string; applies_to_process: string | null; steps: Step[] };
type Cause = { id: string; label: string; prior: number };
type Check = { id: string; question: string; modality: string };
type Symptom = { id: string; label: string; causes: Cause[]; checks: Check[] };

type CriticalFact = {
  id: string;
  claim: string;
  process_scope: string | null;
  citation: { page?: number; table_id?: string; entity_id?: string; section?: string };
};

type CanonicalSetup = {
  id: string;
  label: string;
  process: string;
  material: string;
  thickness_in: number | null;
  settings: Record<string, unknown>;
  entity_refs: string[];
  diagram_refs: string[];
  manual_citation: { page: number };
};

async function callA_criticalFacts(
  client: Anthropic,
  tables: Table[],
  entities: Entity[]
): Promise<CriticalFact[]> {
  console.log("  Call A: extracting critical facts from tables + specs...");

  // Send all tables + high-salience entity types
  const keyTypes = ["product_specification", "welding_process", "welding_parameter", "physical_connector", "welding_wire", "shielding_gas"];
  const keyEntities = entities.filter(e => keyTypes.includes(e.type)).slice(0, 150);

  const prompt = `You are synthesizing critical facts from a product manual's extracted knowledge stores.

TABLES (all tables extracted from the manual):
${JSON.stringify(tables, null, 2)}

KEY_ENTITIES (specifications, parameters, connectors, processes):
${JSON.stringify(keyEntities.map(e => ({ id: e.id, name: e.name, type: e.type, description: e.description, pages: e.page_refs })), null, 2)}

Produce a JSON array of critical facts. A critical fact is:
- Atomic: one claim, one number or decision
- Quotable: could appear verbatim in a quick-reference card
- Cited: linked to a table row or entity ID and page number
- Examples: "MIG duty cycle at 200A on 240V is 30%", "TIG ground clamp goes in the negative DINSE socket", "Wire protrudes 1/4 inch past contact tip after trimming"

Cover: duty cycle specs, current ranges per voltage, connector polarity assignments, wire diameter recommendations, shielding gas type per process, key safety thresholds.

Return ONLY a JSON array. Each entry:
{
  "id": "fact_slug",
  "claim": "One precise sentence, numbers included.",
  "process_scope": "MIG" | "TIG" | "Flux-Cored" | "Stick" | "all" | null,
  "citation": { "page": number, "table_id": "..." | null, "entity_id": "..." | null, "section": "..." | null }
}

Aim for 30–60 facts. No prose, no markdown fences.`;

  const response = await client.messages.create({
    model: MODEL_SALIENCE,
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim()
    .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

  try {
    return JSON.parse(raw) as CriticalFact[];
  } catch {
    console.log("  Call A: JSON parse failed — returning empty");
    return [];
  }
}

// Schema salience_hint → numeric fallback when Claude fails
const HINT_SCORE: Record<string, number> = { high: 0.8, medium: 0.5, low: 0.2 };

async function scoreChunk(
  client: Anthropic,
  label: string,
  itemsJson: string,
  keyField: string
): Promise<Record<string, number>> {
  const prompt = `Assign salience scores (0.0–1.0) for each item below. Return ONLY a JSON object mapping ${keyField} → score.

Salience = how important for a garage operator asking setup, troubleshooting, or process-selection questions.
- 1.0 = essential (front panel diagram, duty cycle spec, connector polarity)
- 0.7 = frequently relevant (connector names, process parameters)
- 0.4 = context-building (safety guidelines, general specs)
- 0.1 = reference-only (parts list items, repetitive safety text)

ITEMS:
${itemsJson}

Return ONLY { "<${keyField}>": score, ... }. No prose, no fences.`;

  const response = await client.messages.create({
    model: MODEL_SALIENCE,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim()
    .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    console.log(`  Call B (${label}): parse failed — using defaults`);
    return {};
  }
}

async function callB_salience(
  client: Anthropic,
  entities: Entity[],
  relations: Relation[],
  diagrams: Diagram[],
  schema: { entity_types: Array<{ name: string; salience_hint?: string }> }
): Promise<{ entityScores: Record<string, number>; relationScores: Record<string, number>; diagramScores: Record<string, number> }> {
  console.log("  Call B: scoring salience (three sub-calls)...");

  // Build schema-hint fallback lookup
  const hintByType: Record<string, number> = {};
  for (const t of schema.entity_types) {
    hintByType[t.name] = HINT_SCORE[t.salience_hint ?? "medium"] ?? 0.5;
  }

  // Score entities in chunks of 80 to stay within token limits
  const entityScores: Record<string, number> = {};
  const CHUNK = 80;
  for (let i = 0; i < entities.length; i += CHUNK) {
    const chunk = entities.slice(i, i + CHUNK);
    const meta = chunk.map(e => ({ id: e.id, name: e.name, type: e.type, page_count: e.page_refs.length }));
    const scores = await scoreChunk(client, `entities ${i}–${i + chunk.length}`, JSON.stringify(meta), "id");
    Object.assign(entityScores, scores);
    if (i + CHUNK < entities.length) await new Promise(r => setTimeout(r, 300));
  }
  // Fill missing with schema hint
  for (const e of entities) {
    if (entityScores[e.id] === undefined) entityScores[e.id] = hintByType[e.type] ?? 0.4;
  }

  // Relations: send all at once — compact format
  const relationMeta = relations.map((r, i) => ({ idx: String(i), pred: r.predicate, s: r.subject_id, o: r.object_id }));
  const relChunk = await scoreChunk(client, "relations", JSON.stringify(relationMeta), "idx");
  const relationScores: Record<string, number> = {};
  for (let i = 0; i < relations.length; i++) {
    relationScores[String(i)] = relChunk[String(i)] ?? 0.4;
  }

  await new Promise(r => setTimeout(r, 300));

  // Diagrams
  const diagramMeta = diagrams.map(d => ({ id: d.id, page: d.page, caption: d.caption, regions: d.regions?.length ?? 0 }));
  const diagramScores = await scoreChunk(client, "diagrams", JSON.stringify(diagramMeta), "id");
  for (const d of diagrams) {
    if (diagramScores[d.id] === undefined) diagramScores[d.id] = 0.4;
  }

  return { entityScores, relationScores, diagramScores };
}

async function callC_canonicalSetups(
  client: Anthropic,
  tables: Table[],
  procedures: Procedure[],
  entities: Entity[]
): Promise<CanonicalSetup[]> {
  console.log("  Call C: synthesizing canonical setups...");

  const keyEntities = entities.filter(e =>
    ["welding_process", "welding_wire", "shielding_gas", "welding_parameter", "physical_connector"].includes(e.type)
  ).slice(0, 100);

  const procSummary = procedures.map(p => ({
    id: p.id, name: p.name, process: p.applies_to_process,
    steps: p.steps.slice(0, 5).map(s => ({ n: s.step, instr: s.instruction })),
  }));

  const prompt = `You are synthesizing canonical setup cross-sections for a multiprocess welder.

A canonical setup is a complete, machine-ready configuration for one common task pattern — everything an operator would need to write on a sticky note before striking an arc.

TABLES (settings charts, specifications):
${JSON.stringify(tables, null, 2)}

PROCEDURES (summarized):
${JSON.stringify(procSummary, null, 2)}

KEY_ENTITIES:
${JSON.stringify(keyEntities.map(e => ({ id: e.id, name: e.name, type: e.type })), null, 2)}

Produce a JSON array of canonical setups for the most common task patterns (aim for 8–15):
- MIG mild steel at several thicknesses (1/16", 1/8", 3/16", 1/4")
- Flux-Cored mild steel
- TIG mild steel / aluminum
- Stick at common electrode sizes

Each entry:
{
  "id": "setup_slug",
  "label": "Human-readable label, e.g. MIG 1/8 inch mild steel 240V",
  "process": "MIG" | "Flux-Cored" | "TIG" | "Stick",
  "material": "mild_steel" | "stainless" | "aluminum" | "chrome_moly",
  "thickness_in": number | null,
  "input_voltage": "120V" | "240V" | null,
  "settings": {
    "voltage_v": number | null,
    "wire_feed_speed_ipm": number | null,
    "amperage_a": number | null,
    "wire_type": "solid" | "flux_cored" | null,
    "wire_diameter_in": "0.025" | "0.030" | "0.035" | "0.045" | null,
    "shielding_gas": "C25" | "100% CO2" | "100% Argon" | null,
    "polarity": "DCEP" | "DCEN" | "AC" | null,
    "electrode_class": "6011" | "6013" | "7018" | null
  },
  "entity_refs": ["<entity_id>", ...],
  "diagram_refs": ["<diagram_id>", ...],
  "manual_citation": { "page": number }
}

Only include settings that are explicitly in the tables or manual text. Use null for anything not found.
Return ONLY a JSON array. No prose, no markdown fences.`;

  const response = await client.messages.create({
    model: MODEL_SALIENCE,
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim()
    .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

  try {
    return JSON.parse(raw) as CanonicalSetup[];
  } catch {
    console.log("  Call C: JSON parse failed — returning empty");
    return [];
  }
}

async function main() {
  console.log(`\n=== Salience Synthesis (${MODEL_SALIENCE}) ===\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Load all stores
  const schema = load<{ entity_types: Array<{ name: string; salience_hint?: string }> }>("schema.json");
  const entities: Entity[]   = load("entities.json");
  const relations: Relation[] = load("relations.json");
  const tables: Table[]       = load("tables.json");
  const diagrams: Diagram[]   = load("diagrams.json");
  const procedures: Procedure[] = load("procedures.json");
  const dtrees = load<{ symptoms: Symptom[] }>("diagnostic_trees.json");

  console.log(`Loaded: ${entities.length}e ${relations.length}r ${tables.length}t ${diagrams.length}d ${procedures.length}p ${dtrees.symptoms.length}s`);

  // Call A — critical facts
  const criticalFacts = await callA_criticalFacts(client, tables, entities);
  writeFileSync(join(DATA, "critical_facts.json"), JSON.stringify(criticalFacts, null, 2));
  console.log(`  ✓ critical_facts.json: ${criticalFacts.length} facts`);

  await new Promise(r => setTimeout(r, 500));

  // Call B — salience scores (chunked; schema hints as fallback)
  const { entityScores, relationScores, diagramScores } = await callB_salience(client, entities, relations, diagrams, schema);

  // Stamp salience onto entities
  for (const e of entities) {
    e.salience = Math.min(1, Math.max(0, entityScores[e.id] ?? 0.4));
  }
  writeFileSync(join(DATA, "entities.json"), JSON.stringify(entities, null, 2));
  console.log(`  ✓ entities.json: ${entities.length} salience scores stamped`);

  // Stamp salience onto relations
  for (let i = 0; i < relations.length; i++) {
    relations[i].salience = Math.min(1, Math.max(0, relationScores[String(i)] ?? 0.4));
  }
  writeFileSync(join(DATA, "relations.json"), JSON.stringify(relations, null, 2));
  console.log(`  ✓ relations.json: ${relations.length} salience scores stamped`);

  // Stamp salience onto diagrams
  for (const d of diagrams) {
    d.salience = Math.min(1, Math.max(0, diagramScores[d.id] ?? 0.4));
  }
  writeFileSync(join(DATA, "diagrams.json"), JSON.stringify(diagrams, null, 2));
  console.log(`  ✓ diagrams.json: ${diagrams.length} salience scores stamped`);

  await new Promise(r => setTimeout(r, 500));

  // Call C — canonical setups
  const canonicalSetups = await callC_canonicalSetups(client, tables, procedures, entities);
  writeFileSync(join(DATA, "canonical_setups.json"), JSON.stringify(canonicalSetups, null, 2));
  console.log(`  ✓ canonical_setups.json: ${canonicalSetups.length} setups`);

  console.log(`\n=== Salience Synthesis Complete ===`);
  console.log(`  critical_facts:    ${criticalFacts.length}`);
  console.log(`  canonical_setups:  ${canonicalSetups.length}`);
  console.log(`  entities w/score:  ${entities.length}`);
  console.log(`  relations w/score: ${relations.length}`);
  console.log(`  diagrams w/score:  ${diagrams.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
