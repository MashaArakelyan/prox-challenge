// Stage 1b — Procedural extraction pass (Sonnet 4.6)
// Processes every page of the manual. Extracts setup procedures with structured steps,
// postconditions, and branches. Handles multi-page continuations via extends/new_steps.
// Outputs: data/procedures.json

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { MODEL_PROCEDURAL, INGEST_PDF_PATH, DATA_DIR } from "./ingest-config.js";

config();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PDF_PATH = join(ROOT, INGEST_PDF_PATH);
const DATA_PATH = join(ROOT, DATA_DIR);
const TMP_DIR = "/tmp/prox-procedural";

const SCHEMA = JSON.parse(readFileSync(join(DATA_PATH, "schema.json"), "utf8"));
const SCHEMA_CONTEXT = JSON.stringify(
  SCHEMA.entity_types.map((t: { name: string; description: string }) => ({ name: t.name, description: t.description })),
  null, 2
);

const TOTAL_PAGES = 48;

const SYSTEM_PROMPT = `You are extracting procedural knowledge from one page of a product manual.
You will receive:
  - A rendered image of the page
  - SCHEMA: the allowed entity types (JSON) — use these canonical names in step references
  - PRIOR_PROCEDURES: procedures already extracted from earlier pages (JSON array of {id, name, last_step})
  - PAGE: the page number

Your job is to find every procedure on this page and convert it into a structured state machine.

A PROCEDURE is any numbered or bulleted sequence of steps instructing the operator to perform
a physical action on the machine. This includes setup sequences, installation steps, operating
instructions, adjustment procedures, and maintenance tasks.

NOT a procedure: safety warnings, specifications tables, explanatory paragraphs, tips boxes.
If a page has no procedures, return: { "page": number, "procedures": [] }

CONTINUATION RULES:
Before creating a new procedure, check PRIOR_PROCEDURES. If this page contains a continuation
of an existing procedure — the same procedure name, or step numbers that pick up where a prior
page left off (e.g., the page starts at step 6 and PRIOR_PROCEDURES has a procedure with
last_step = 5) — emit a continuation entry instead of a new procedure:
  { "extends": "<prior_procedure_id>", "new_steps": [...] }
Only include the steps visible on this page. Do not re-emit steps already in the prior procedure.
If you are unsure whether this is a continuation, prefer treating it as one (conservatively avoid
creating a duplicate procedure with a different ID).

PROCEDURE RULES:
1. Give each NEW procedure a stable snake_case ID: "{verb}_{object}_p{page}"
   Example: "install_wire_spool_p10", "set_mig_polarity_p20"
2. Name it in the form "[Verb] [Object]" — imperative, concise.
   Example: "Install Wire Spool (1–2 lb)", "Set MIG Shielding Gas Flow"
3. Record the welding_process this procedure applies to, if identifiable. Use the exact
   process name from the schema (e.g., "MIG", "TIG", "Flux-Cored", "Stick") or null.

STEP RULES:
4. Number steps sequentially. For continuations, number from (last_step + 1).
5. instruction: the imperative action the operator takes. One sentence. Active voice.
   Bad: "The spool should be placed on the spindle."
   Good: "Place the wire spool over the spool spindle with the wire unwinding clockwise."
6. postcondition: a verifiable physical state after the step is completed.
   - Must be observable by the operator without tools (visual, tactile, auditory)
   - Phrased as a present-tense description of the physical world, not an action
   - Bad postcondition: "You have tightened the wingnut."
   - Good postcondition: "The wire spool does not spin freely when pushed by hand."
   - If no specific postcondition is stated or implied, write null.
7. expected_image: optional. If a photo of the completed step would help verify the
   postcondition (e.g., "wire protrudes 1/4 inch past contact tip"), describe what
   the photo should show. Otherwise null.
8. entity_refs: list of entity IDs from the schema that this step directly involves.
   Use the naming convention from the structural pass: "type_name_slug".
9. branches: only extract conditional forks that are explicitly stated in the manual.
   Each branch: { condition, goto_step, note (optional) }

RETURN FORMAT:
10. If a page has no procedures, return: { "page": number, "procedures": [] }
11. Return ONLY the JSON object. No prose, no markdown fences.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "procedures": [
    {
      "id": "verb_object_p{page}",
      "name": "Verb Object (qualifier if needed)",
      "description": "One sentence: what this procedure accomplishes",
      "applies_to_process": "MIG" | "TIG" | "Flux-Cored" | "Stick" | null,
      "manual_citation": {
        "page": number,
        "section": "Section heading from the page"
      },
      "steps": [
        {
          "step": number,
          "instruction": "Imperative action in active voice",
          "postcondition": "Verifiable physical state after step, or null",
          "expected_image": "What a verification photo should show, or null",
          "entity_refs": ["entity_id_1"],
          "branches": [
            {
              "condition": "If condition text",
              "goto_step": number,
              "note": "Optional clarifying note"
            }
          ]
        }
      ]
    },
    {
      "extends": "prior_procedure_id",
      "new_steps": [
        {
          "step": number,
          "instruction": "...",
          "postcondition": "...",
          "expected_image": null,
          "entity_refs": [],
          "branches": []
        }
      ]
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
  step: number;
  instruction: string;
  postcondition: string | null;
  expected_image: string | null;
  entity_refs: string[];
  branches: Array<{ condition: string; goto_step: number; note?: string }>;
};

type Procedure = {
  id: string;
  name: string;
  description: string;
  applies_to_process: string | null;
  manual_citation: { page: number; section: string };
  steps: Step[];
};

type PriorProcedure = { id: string; name: string; last_step: number };

async function extractPage(
  client: Anthropic,
  pageNum: number,
  priorProcedures: PriorProcedure[]
): Promise<Array<Procedure | { extends: string; new_steps: Step[] }>> {
  const pageFile = renderPage(pageNum);
  const userContent: Anthropic.ContentBlockParam[] = [
    toImageBlock(pageFile),
    {
      type: "text",
      text: `SCHEMA:\n${SCHEMA_CONTEXT}\n\nPRIOR_PROCEDURES:\n${JSON.stringify(priorProcedures)}\n\nPAGE: ${pageNum}\n\nExtract all procedures from this page.`,
    },
  ];

  const response = await client.messages.create({
    model: MODEL_PROCEDURAL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim()
    .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

  let result: { procedures?: unknown[] };
  try {
    result = JSON.parse(raw);
  } catch {
    console.log(`  Page ${pageNum}: JSON parse failed — treating as empty`);
    return [];
  }

  return (result.procedures ?? []) as Array<Procedure | { extends: string; new_steps: Step[] }>;
}

async function main() {
  console.log(`\n=== Procedural Extraction Pass (${MODEL_PROCEDURAL}) ===`);
  console.log(`Pages: 1–${TOTAL_PAGES}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Map from procedure ID to assembled procedure
  const procedureMap = new Map<string, Procedure>();
  // Running list for the prompt context (id, name, last_step only)
  const priorProcedures: PriorProcedure[] = [];

  for (let page = 1; page <= TOTAL_PAGES; page++) {
    process.stdout.write(`  Page ${String(page).padStart(2)}/${TOTAL_PAGES}... `);
    const items = await extractPage(client, page, priorProcedures);

    let newCount = 0;
    let continuationCount = 0;

    for (const item of items) {
      if ("extends" in item) {
        // Continuation — merge new_steps into existing procedure
        const parent = procedureMap.get(item.extends);
        if (parent) {
          parent.steps.push(...item.new_steps);
          parent.steps.sort((a, b) => a.step - b.step);
          const maxStep = Math.max(...parent.steps.map(s => s.step));
          const prior = priorProcedures.find(p => p.id === item.extends);
          if (prior) prior.last_step = maxStep;
        } else {
          console.log(`\n    Warning: extends "${item.extends}" not found in procedureMap`);
        }
        continuationCount++;
      } else {
        // New procedure
        procedureMap.set(item.id, item);
        const lastStep = item.steps.length > 0 ? Math.max(...item.steps.map(s => s.step)) : 0;
        priorProcedures.push({ id: item.id, name: item.name, last_step: lastStep });
        newCount++;
      }
    }

    console.log(`${newCount}new ${continuationCount}cont`);

    if (page < TOTAL_PAGES) await new Promise(r => setTimeout(r, 400));
  }

  const procedures = Array.from(procedureMap.values());
  writeFileSync(join(DATA_PATH, "procedures.json"), JSON.stringify(procedures, null, 2));
  console.log(`\n✓ Wrote procedures.json (${procedures.length} procedures)`);
}

main().catch(err => { console.error(err); process.exit(1); });
