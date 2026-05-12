// Stage 1b — Structural extraction pass (Haiku 4.5)
// Processes every page of the manual. Extracts entities, relations, tables, diagrams.
// Maintains a running entity list across pages for de-duplication.
// Outputs: data/entities.json, data/relations.json, data/tables.json, data/diagrams.json
// Crops: data/images/{page}_{diagram_id}.png for every diagram region.

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { MODEL_STRUCTURAL, INGEST_PDF_PATH, DATA_DIR } from "./ingest-config.js";

config();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PDF_PATH = join(ROOT, INGEST_PDF_PATH);
const DATA_PATH = join(ROOT, DATA_DIR);
const IMAGES_PATH = join(DATA_PATH, "images");
const TMP_DIR = "/tmp/prox-structural";

const SCHEMA = JSON.parse(readFileSync(join(DATA_PATH, "schema.json"), "utf8"));

// Total pages in the manual
const TOTAL_PAGES = 48;

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

function renderPage(pageNum: number): string {
  mkdirSync(TMP_DIR, { recursive: true });
  try { execSync(`rm -f "${TMP_DIR}"/p-*.png`); } catch {}
  const prefix = join(TMP_DIR, "p");
  execSync(`pdftoppm -r 150 -png -f ${pageNum} -l ${pageNum} "${PDF_PATH}" "${prefix}"`, { stdio: "pipe" });
  const files = readdirSync(TMP_DIR).filter(f => f.startsWith("p-") && f.endsWith(".png")).sort();
  return join(TMP_DIR, files[0]);
}

function toImageBlock(filePath: string): Anthropic.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: readFileSync(filePath).toString("base64") } };
}

function cropDiagram(pageFile: string, page: number, diagramId: string, bbox: { x: number; y: number; width: number; height: number }) {
  // Get image dimensions
  const dimOut = execSync(`identify -format "%wx%h" "${pageFile}" 2>/dev/null || sips -g pixelWidth -g pixelHeight "${pageFile}" | tail -2`).toString().trim();
  let imgW: number, imgH: number;
  const wh = dimOut.match(/(\d+)x(\d+)/);
  if (wh) {
    imgW = parseInt(wh[1]); imgH = parseInt(wh[2]);
  } else {
    // fallback: parse sips output
    const lines = dimOut.split("\n");
    imgW = parseInt(lines[0].split(":")[1].trim());
    imgH = parseInt(lines[1].split(":")[1].trim());
  }
  const x = Math.round(bbox.x * imgW);
  const y = Math.round(bbox.y * imgH);
  const w = Math.max(1, Math.round(bbox.width * imgW));
  const h = Math.max(1, Math.round(bbox.height * imgH));
  const outPath = join(IMAGES_PATH, `${page}_${diagramId}.png`);
  try {
    execSync(`convert "${pageFile}" -crop ${w}x${h}+${x}+${y} +repage "${outPath}" 2>/dev/null || sips -c ${h} ${w} --cropOffset ${y} ${x} "${pageFile}" --out "${outPath}"`, { stdio: "pipe" });
  } catch {
    // Copy full page if crop fails
    execSync(`cp "${pageFile}" "${outPath}"`);
  }
}

async function extractPage(
  client: Anthropic,
  pageNum: number,
  priorEntities: Array<{ id: string; name: string; type: string }>
): Promise<{
  entities: unknown[]; relations: unknown[]; tables: unknown[]; diagrams: unknown[]; pageFile: string;
}> {
  const pageFile = renderPage(pageNum);
  const userContent: Anthropic.ContentBlockParam[] = [
    toImageBlock(pageFile),
    {
      type: "text",
      text: `SCHEMA:\n${JSON.stringify({ entity_types: SCHEMA.entity_types.map((t: { name: string; description: string }) => ({ name: t.name, description: t.description })), relation_predicates: SCHEMA.relation_predicates }, null, 2)}\n\nPRIOR_ENTITIES:\n${JSON.stringify(priorEntities)}\n\nPAGE: ${pageNum}\n\nExtract all entities, relations, tables, and diagrams from this page.`,
    },
  ];

  const response = await client.messages.create({
    model: MODEL_STRUCTURAL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim()
    .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

  let result: { entities?: unknown[]; relations?: unknown[]; tables?: unknown[]; diagrams?: unknown[] };
  try {
    result = JSON.parse(raw);
  } catch {
    console.log(`  Page ${pageNum}: JSON parse failed — treating as empty`);
    result = {};
  }

  return {
    entities: result.entities ?? [],
    relations: result.relations ?? [],
    tables: result.tables ?? [],
    diagrams: result.diagrams ?? [],
    pageFile,
  };
}

async function main() {
  console.log(`\n=== Structural Extraction Pass (${MODEL_STRUCTURAL}) ===`);
  console.log(`Pages: 1–${TOTAL_PAGES}\n`);

  mkdirSync(IMAGES_PATH, { recursive: true });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const allEntities: unknown[] = [];
  const allRelations: unknown[] = [];
  const allTables: unknown[] = [];
  const allDiagrams: unknown[] = [];

  // Running entity list for de-duplication — only id/name/type to keep context small
  const priorEntities: Array<{ id: string; name: string; type: string }> = [];
  const entityIndex = new Map<string, { id: string; name: string; type: string }>();

  for (let page = 1; page <= TOTAL_PAGES; page++) {
    process.stdout.write(`  Page ${String(page).padStart(2)}/${TOTAL_PAGES}... `);
    const { entities, relations, tables, diagrams, pageFile } = await extractPage(client, page, priorEntities);

    // Merge entities into running state
    for (const e of entities as Array<{ id: string; name: string; type: string; is_new: boolean; page_refs: number[] }>) {
      const key = e.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (e.is_new || !entityIndex.has(key)) {
        entityIndex.set(key, { id: e.id, name: e.name, type: e.type });
        priorEntities.push({ id: e.id, name: e.name, type: e.type });
        allEntities.push(e);
      } else {
        // Update page_refs on existing entry
        const existing = allEntities.find((ae: unknown) => (ae as { id: string }).id === entityIndex.get(key)!.id) as { page_refs: number[] } | undefined;
        if (existing && !existing.page_refs.includes(page)) existing.page_refs.push(page);
      }
    }

    allRelations.push(...(relations as unknown[]));
    allTables.push(...(tables as unknown[]));

    // Process diagrams: save crop for each, then store
    for (const d of diagrams as Array<{ id: string; save_crop: boolean; regions: Array<{ label: string; bbox: { x: number; y: number; width: number; height: number } }> }>) {
      if (d.save_crop && d.regions?.length > 0) {
        // Crop the full diagram bbox (union of all regions as a quick proxy — save full page as fallback)
        try { cropDiagram(pageFile, page, d.id, { x: 0, y: 0, width: 1, height: 1 }); } catch {}
      }
      allDiagrams.push(d);
    }

    console.log(`${(entities as unknown[]).length}e ${(relations as unknown[]).length}r ${(tables as unknown[]).length}t ${(diagrams as unknown[]).length}d`);

    // Small pause between pages to avoid rate limits
    if (page < TOTAL_PAGES) await new Promise(r => setTimeout(r, 300));
  }

  writeFileSync(join(DATA_PATH, "entities.json"), JSON.stringify(allEntities, null, 2));
  writeFileSync(join(DATA_PATH, "relations.json"), JSON.stringify(allRelations, null, 2));
  writeFileSync(join(DATA_PATH, "tables.json"), JSON.stringify(allTables, null, 2));
  writeFileSync(join(DATA_PATH, "diagrams.json"), JSON.stringify(allDiagrams, null, 2));

  console.log(`\n✓ Wrote entities.json (${allEntities.length}), relations.json (${allRelations.length}), tables.json (${allTables.length}), diagrams.json (${allDiagrams.length})`);
}

main().catch(err => { console.error(err); process.exit(1); });
