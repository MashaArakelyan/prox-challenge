// Procedural rescue pass — re-runs specific failed pages with Opus 4.7.
// Merges recovered procedures into existing data/procedures.json without overwriting.
// Usage: npx tsx scripts/rescue-procedural.ts

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { MODEL_DIAGNOSTIC, INGEST_PDF_PATH, DATA_DIR } from "./ingest-config.js";

config();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PDF_PATH = join(ROOT, INGEST_PDF_PATH);
const DATA_PATH = join(ROOT, DATA_DIR);
const TMP_DIR = "/tmp/prox-procedural-rescue";

// Pages that failed on Sonnet — retry with Opus
const RESCUE_PAGES = [13, 15, 36];

const SCHEMA = JSON.parse(readFileSync(join(DATA_PATH, "schema.json"), "utf8"));
const SCHEMA_CONTEXT = JSON.stringify(
  SCHEMA.entity_types.map((t: { name: string; description: string }) => ({ name: t.name, description: t.description })),
  null, 2
);

const SYSTEM_PROMPT = `You are extracting procedural knowledge from one page of a product manual.
You will receive:
  - A rendered image of the page
  - SCHEMA: the allowed entity types (JSON)
  - PRIOR_PROCEDURES: procedures already extracted from earlier pages (JSON array of {id, name, last_step})
  - PAGE: the page number

Your job is to find every procedure on this page and convert it into a structured state machine.

A PROCEDURE is any numbered or bulleted sequence of steps instructing the operator to perform
a physical action on the machine.

NOT a procedure: safety warnings, specifications tables, explanatory paragraphs, tips boxes.
If a page has no procedures, return: { "page": number, "procedures": [] }

CONTINUATION RULES:
Check PRIOR_PROCEDURES first. If step numbers pick up where a prior procedure left off, emit:
  { "extends": "<prior_procedure_id>", "new_steps": [...] }

PROCEDURE RULES:
1. ID: "{verb}_{object}_p{page}" in snake_case
2. Name: "[Verb] [Object]" — imperative, concise
3. applies_to_process: "MIG" | "TIG" | "Flux-Cored" | "Stick" | null

STEP RULES:
4. Number sequentially (continuations start at last_step + 1)
5. instruction: imperative, one sentence, active voice
6. postcondition: verifiable physical state or null
7. expected_image: description of verification photo or null
8. entity_refs: entity IDs from schema using type_name_slug convention
9. branches: only explicitly stated conditional forks

Return ONLY the JSON object. No prose, no markdown fences.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "procedures": [
    {
      "id": "verb_object_p{page}",
      "name": "Verb Object",
      "description": "One sentence",
      "applies_to_process": null,
      "manual_citation": { "page": number, "section": "..." },
      "steps": [{ "step": number, "instruction": "...", "postcondition": null, "expected_image": null, "entity_refs": [], "branches": [] }]
    }
  ]
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

type Step = {
  step: number; instruction: string; postcondition: string | null;
  expected_image: string | null; entity_refs: string[];
  branches: Array<{ condition: string; goto_step: number; note?: string }>;
};
type Procedure = {
  id: string; name: string; description: string; applies_to_process: string | null;
  manual_citation: { page: number; section: string }; steps: Step[];
};

async function main() {
  console.log(`\n=== Procedural Rescue Pass (${MODEL_DIAGNOSTIC}) ===`);
  console.log(`Rescue pages: ${RESCUE_PAGES.join(", ")}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Load existing procedures
  const existing: Procedure[] = JSON.parse(readFileSync(join(DATA_PATH, "procedures.json"), "utf8"));
  const procedureMap = new Map<string, Procedure>(existing.map(p => [p.id, p]));

  // Build prior list from existing procedures (for continuation detection)
  const priorProcedures = existing.map(p => ({
    id: p.id, name: p.name,
    last_step: p.steps.length > 0 ? Math.max(...p.steps.map(s => s.step)) : 0,
  }));

  const recovered: string[] = [];

  for (const page of RESCUE_PAGES) {
    process.stdout.write(`  Rescue page ${page}... `);
    const pageFile = renderPage(page);

    const response = await client.messages.create({
      model: MODEL_DIAGNOSTIC,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          toImageBlock(pageFile),
          { type: "text", text: `SCHEMA:\n${SCHEMA_CONTEXT}\n\nPRIOR_PROCEDURES:\n${JSON.stringify(priorProcedures)}\n\nPAGE: ${page}\n\nExtract all procedures from this page.` },
        ],
      }],
    });

    const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim()
      .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

    let result: { procedures?: Array<Procedure | { extends: string; new_steps: Step[] }> };
    try {
      result = JSON.parse(raw);
    } catch {
      console.log(`parse failed — skipping`);
      continue;
    }

    const items = result.procedures ?? [];
    let newCount = 0;
    let contCount = 0;

    for (const item of items) {
      if ("extends" in item) {
        const parent = procedureMap.get(item.extends);
        if (parent) {
          parent.steps.push(...item.new_steps);
          parent.steps.sort((a, b) => a.step - b.step);
          const prior = priorProcedures.find(p => p.id === item.extends);
          if (prior) prior.last_step = Math.max(...parent.steps.map(s => s.step));
          recovered.push(`  continues "${item.extends}" (+${item.new_steps.length} steps)`);
        }
        contCount++;
      } else {
        procedureMap.set(item.id, item);
        priorProcedures.push({ id: item.id, name: item.name, last_step: item.steps.length > 0 ? Math.max(...item.steps.map(s => s.step)) : 0 });
        recovered.push(`  new: "${item.name}" (${item.steps.length} steps)`);
        newCount++;
      }
    }
    console.log(`${newCount}new ${contCount}cont`);

    if (page !== RESCUE_PAGES[RESCUE_PAGES.length - 1]) await new Promise(r => setTimeout(r, 500));
  }

  const procedures = Array.from(procedureMap.values());
  writeFileSync(join(DATA_PATH, "procedures.json"), JSON.stringify(procedures, null, 2));

  console.log(`\nRecovered:`);
  if (recovered.length === 0) console.log("  (nothing new)");
  else recovered.forEach(r => console.log(r));
  console.log(`\n✓ procedures.json updated (${procedures.length} total)`);
}

main().catch(err => { console.error(err); process.exit(1); });
