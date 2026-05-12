// Structural rescue — re-runs specific pages with Opus 4.7 and 16k tokens.
// Merges into existing data/ stores without overwriting unaffected pages.
// Retries up to 3× per page, appending validation errors each time.
// Usage: npx tsx scripts/rescue-structural.ts

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { MODEL_DIAGNOSTIC, INGEST_PDF_PATH, DATA_DIR } from "./ingest-config.js";

config();

const ROOT     = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PDF_PATH = join(ROOT, INGEST_PDF_PATH);
const DATA     = join(ROOT, DATA_DIR);
const IMAGES   = join(DATA, "images");
const TMP_DIR  = "/tmp/prox-structural-rescue";

const RESCUE_PAGES = [7, 20, 30, 32, 43];
const MAX_TOKENS   = 16384;
const MAX_RETRIES  = 3;

const SCHEMA = JSON.parse(readFileSync(join(DATA, "schema.json"), "utf8"));
const VALID_TYPES      = new Set<string>(SCHEMA.entity_types.map((t: { name: string }) => t.name));
const VALID_PREDICATES = new Set<string>(SCHEMA.relation_predicates.map((p: { predicate: string }) => p.predicate));
const SCHEMA_CTX = JSON.stringify({
  entity_types:        SCHEMA.entity_types.map((t: { name: string; description: string }) => ({ name: t.name, description: t.description })),
  relation_predicates: SCHEMA.relation_predicates,
}, null, 2);

// Identical system prompt to run-structural-extract.ts — must stay in sync.
const SYSTEM_PROMPT = `You are extracting structured knowledge from one page of a product manual.
You will receive a rendered image of the page, the allowed entity type schema, and the list of
entities already extracted from prior pages.

OUTPUT: Return ONLY a valid JSON object matching the required shape. No prose, no markdown fences.

ENTITY RULES:
1. Only create entities whose type matches one of the names in SCHEMA.entity_types.
2. Before creating an entity, check PRIOR_ENTITIES for an existing entry with the same
   canonical name (case-insensitive). If found, reuse its ID and set is_new: false.
3. Entity IDs: stable snake_case slugs using the pattern type_name_slug.
   For entities with no natural unique name, append the page: type_name_p{page}.
4. page_refs: always include the current page. For reused entities, it extends the prior list.

RELATION RULES:
5. Only emit relations whose predicate is in SCHEMA.relation_predicates.
6. Both subject_id and object_id must exist in this page's entities[] or in PRIOR_ENTITIES.
7. Only emit a relation if both endpoints are visible or explicitly co-mentioned on this page.

TABLE RULES:
8. Extract all column headers and data rows. Numeric values as numbers, not strings.
9. Table IDs: table_{page}_{n}

DIAGRAM RULES:
10. For every labeled figure or illustration: assign ID diagram_{page}_{n}, extract caption,
    extract every labeled callout region with normalized bbox (0.0–1.0, top-left origin).
    Set save_crop: true on every diagram.
11. Bboxes enclose the labeled object, not the callout line. Err toward larger rather than tight.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "entities": [{"id":"...","name":"...","type":"...","description":"...","page_refs":[number],"is_new":true}],
  "relations": [{"predicate":"...","subject_id":"...","object_id":"...","page":number}],
  "tables": [{"id":"...","name":"...","page":number,"columns":["..."],"rows":[{}]}],
  "diagrams": [{"id":"...","page":number,"caption":"...","save_crop":true,"regions":[{"label":"...","bbox":{"x":0,"y":0,"width":0,"height":0}}]}]
}`;

type BBox    = { x: number; y: number; width: number; height: number };
type Entity  = { id: string; name: string; type: string; description: string; page_refs: number[]; is_new: boolean; salience?: number };
type Relation= { predicate: string; subject_id: string; object_id: string; page: number; salience?: number };
type Table   = { id: string; name: string; page: number; columns: string[]; rows: Record<string, unknown>[] };
type Diagram = { id: string; page: number; caption: string; save_crop: boolean; regions: { label: string; bbox: BBox }[]; salience?: number };
type PageResult = { page: number; entities: Entity[]; relations: Relation[]; tables: Table[]; diagrams: Diagram[] };

// ── Validation ────────────────────────────────────────────────────────────────

function validate(raw: unknown): string[] {
  const errors: string[] = [];
  const r = raw as PageResult;
  if (!Array.isArray(r.entities))  errors.push("entities must be an array");
  if (!Array.isArray(r.relations)) errors.push("relations must be an array");
  if (!Array.isArray(r.tables))    errors.push("tables must be an array");
  if (!Array.isArray(r.diagrams))  errors.push("diagrams must be an array");
  if (errors.length) return errors;

  for (const e of r.entities) {
    if (!e.id || !e.name || !e.type)
      errors.push(`entity missing id/name/type: ${JSON.stringify(e).slice(0, 80)}`);
    else if (!VALID_TYPES.has(e.type))
      errors.push(`unknown entity type "${e.type}" on "${e.id}". Valid: ${[...VALID_TYPES].join(", ")}`);
    if (!Array.isArray(e.page_refs))
      errors.push(`entity "${e.id}" missing page_refs array`);
  }
  for (const rel of r.relations) {
    if (!VALID_PREDICATES.has(rel.predicate))
      errors.push(`unknown predicate "${rel.predicate}". Valid: ${[...VALID_PREDICATES].join(", ")}`);
    if (!rel.subject_id || !rel.object_id)
      errors.push("relation missing subject_id or object_id");
  }
  for (const t of r.tables) {
    if (!t.id || !t.name || !Array.isArray(t.columns) || !Array.isArray(t.rows))
      errors.push(`table "${t.id ?? "?"}" missing id/name/columns/rows`);
  }
  return errors;
}

// ── PDF + crop helpers ────────────────────────────────────────────────────────

function renderPage(pageNum: number): string {
  mkdirSync(TMP_DIR, { recursive: true });
  try { execSync(`rm -f "${TMP_DIR}"/p-*.png`); } catch {}
  const prefix = join(TMP_DIR, "p");
  execSync(`pdftoppm -r 150 -png -f ${pageNum} -l ${pageNum} "${PDF_PATH}" "${prefix}"`, { stdio: "pipe" });
  const files = readdirSync(TMP_DIR).filter(f => f.startsWith("p-") && f.endsWith(".png")).sort();
  return join(TMP_DIR, files[0]);
}

function toImageBlock(path: string): Anthropic.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(path).toString("base64") } };
}

function saveDiagramCrop(pageFile: string, page: number, diagramId: string) {
  // Full-page save, consistent with run-structural-extract.ts behaviour.
  const out = join(IMAGES, `${page}_${diagramId}.png`);
  if (!existsSync(out)) {
    try { execSync(`cp "${pageFile}" "${out}"`); } catch {}
  }
}

// ── Extraction with retry ─────────────────────────────────────────────────────

async function extractWithRetry(
  client: Anthropic,
  pageNum: number,
  pageFile: string,
  priorEntities: Array<{ id: string; name: string; type: string }>,
): Promise<PageResult | null> {
  const baseText = `SCHEMA:\n${SCHEMA_CTX}\n\nPRIOR_ENTITIES:\n${JSON.stringify(priorEntities)}\n\nPAGE: ${pageNum}\n\nExtract all entities, relations, tables, and diagrams from this page.`;
  let prevErrors = "";

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const userText = prevErrors
      ? `${baseText}\n\nPREVIOUS ATTEMPT FAILED VALIDATION — fix these errors before responding:\n${prevErrors}`
      : baseText;

    const resp = await client.messages.create({
      model: MODEL_DIAGNOSTIC,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [toImageBlock(pageFile), { type: "text", text: userText }] }],
    });

    const raw = (resp.content[0].type === "text" ? resp.content[0].text : "").trim()
      .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      prevErrors = `JSON parse error: ${(e as Error).message}. Your response started: ${raw.slice(0, 300)}`;
      console.log(`    attempt ${attempt}/${MAX_RETRIES}: JSON parse failed`);
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 600));
      continue;
    }

    const errors = validate(parsed);
    if (errors.length === 0) {
      console.log(`    attempt ${attempt}/${MAX_RETRIES}: valid`);
      return parsed as PageResult;
    }

    console.log(`    attempt ${attempt}/${MAX_RETRIES}: ${errors.length} error(s) — ${errors[0]}`);
    prevErrors = errors.join("\n");
    if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 600));
  }

  console.log(`    all ${MAX_RETRIES} attempts exhausted — skipping page ${pageNum}`);
  return null;
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mergeIntoStores(
  result: PageResult,
  entities: Entity[],
  entityIndex: Map<string, string>,   // normalizedName → id
  entityById:  Map<string, Entity>,   // id → entity
  relations:   Relation[],
  relIndex:    Set<string>,            // "predicate:subj:obj"
  tables:      Table[],
  tableIndex:  Set<string>,            // table id
  diagrams:    Diagram[],
  diagramIndex:Set<string>,            // diagram id
  pageFile:    string,
) {
  const page = result.page;

  // Entities
  for (const e of result.entities) {
    const key = normalizeKey(e.name);
    if (e.is_new || !entityIndex.has(key)) {
      if (!entityIndex.has(key)) {
        entityIndex.set(key, e.id);
        entityById.set(e.id, e);
        entities.push(e);
      }
    } else {
      // is_new: false — extend page_refs on the canonical entry
      const canonId  = entityIndex.get(key)!;
      const existing = entityById.get(canonId);
      if (existing && !existing.page_refs.includes(page)) existing.page_refs.push(page);
    }
  }

  // Relations
  for (const r of result.relations) {
    const key = `${r.predicate}:${r.subject_id}:${r.object_id}`;
    if (!relIndex.has(key)) { relIndex.add(key); relations.push(r); }
  }

  // Tables
  for (const t of result.tables) {
    if (!tableIndex.has(t.id)) { tableIndex.add(t.id); tables.push(t); }
  }

  // Diagrams
  for (const d of result.diagrams) {
    if (!diagramIndex.has(d.id)) {
      diagramIndex.add(d.id);
      diagrams.push(d);
      if (d.save_crop) saveDiagramCrop(pageFile, page, d.id);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Structural Rescue (${MODEL_DIAGNOSTIC}, max_tokens=${MAX_TOKENS}) ===`);
  console.log(`Rescue pages: ${RESCUE_PAGES.join(", ")}\n`);

  mkdirSync(IMAGES, { recursive: true });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Load existing stores
  const entities:  Entity[]   = JSON.parse(readFileSync(join(DATA, "entities.json"), "utf8"));
  const relations: Relation[] = JSON.parse(readFileSync(join(DATA, "relations.json"), "utf8"));
  const tables:    Table[]    = JSON.parse(readFileSync(join(DATA, "tables.json"), "utf8"));
  const diagrams:  Diagram[]  = JSON.parse(readFileSync(join(DATA, "diagrams.json"), "utf8"));

  // Build in-memory indexes for fast dedup
  const entityIndex  = new Map<string, string>(entities.map(e => [normalizeKey(e.name), e.id]));
  const entityById   = new Map<string, Entity>(entities.map(e => [e.id, e]));
  const relIndex     = new Set<string>(relations.map(r => `${r.predicate}:${r.subject_id}:${r.object_id}`));
  const tableIndex   = new Set<string>(tables.map(t => t.id));
  const diagramIndex = new Set<string>(diagrams.map(d => d.id));

  // PRIOR_ENTITIES for each rescue page = all currently known entities
  const priorSummary = entities.map(e => ({ id: e.id, name: e.name, type: e.type }));

  const summary: Record<number, { entities: number; relations: number; tables: number; diagrams: number } | "failed"> = {};

  for (const page of RESCUE_PAGES) {
    process.stdout.write(`  Page ${page}... \n`);
    const pageFile = renderPage(page);

    const result = await extractWithRetry(client, page, pageFile, priorSummary);
    if (!result) {
      summary[page] = "failed";
      continue;
    }

    const before = { e: entities.length, r: relations.length, t: tables.length, d: diagrams.length };
    mergeIntoStores(result, entities, entityIndex, entityById, relations, relIndex, tables, tableIndex, diagrams, diagramIndex, pageFile);

    const added = {
      entities:  entities.length  - before.e,
      relations: relations.length - before.r,
      tables:    tables.length    - before.t,
      diagrams:  diagrams.length  - before.d,
    };
    summary[page] = added;
    console.log(`    → +${added.entities}e +${added.relations}r +${added.tables}t +${added.diagrams}d`);

    // Extend PRIOR_ENTITIES with anything newly added so later rescue pages benefit
    for (const e of result.entities) {
      if (!priorSummary.find(p => p.id === e.id)) priorSummary.push({ id: e.id, name: e.name, type: e.type });
    }

    if (page !== RESCUE_PAGES[RESCUE_PAGES.length - 1]) await new Promise(r => setTimeout(r, 800));
  }

  // Write back all four stores
  writeFileSync(join(DATA, "entities.json"),  JSON.stringify(entities,  null, 2));
  writeFileSync(join(DATA, "relations.json"), JSON.stringify(relations, null, 2));
  writeFileSync(join(DATA, "tables.json"),    JSON.stringify(tables,    null, 2));
  writeFileSync(join(DATA, "diagrams.json"),  JSON.stringify(diagrams,  null, 2));

  console.log("\n=== Rescue Summary ===");
  for (const [page, s] of Object.entries(summary)) {
    if (s === "failed") console.log(`  Page ${page}: FAILED (all retries exhausted)`);
    else console.log(`  Page ${page}: +${s.entities}e +${s.relations}r +${s.tables}t +${s.diagrams}d`);
  }
  console.log(`\n✓ entities.json (${entities.length}), relations.json (${relations.length}), tables.json (${tables.length}), diagrams.json (${diagrams.length})`);
}

main().catch(err => { console.error(err); process.exit(1); });
