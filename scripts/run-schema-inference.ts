// Stage 1a — Schema inference
// Renders TOC + pages 1–8 of the manual as images, sends them to Claude with the
// structured ontology prompt, validates the response, and writes data/schema.json.
// Retries up to 3× appending validation errors each time.

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { MODEL_SCHEMA, INGEST_PDF_PATH, DATA_DIR } from "./ingest-config.js";
import { validateSchema } from "./validate-schema.js";

config();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TMP_DIR = "/tmp/prox-schema-pages";
const OUTPUT_PATH = join(ROOT, DATA_DIR, "schema.json");
const REVIEW_PATH = join(ROOT, DATA_DIR, "schema.review.json");
const PDF_PATH = join(ROOT, INGEST_PDF_PATH);

// Pages selected per prompts/schema-inference.md:
// TOC + first 8 pages covers safety, symbology, specifications, and controls.
const FIRST_PAGE = 1;
const LAST_PAGE = 8;

const SCHEMA_PROMPT = `You are building a domain-specific ontology from a product manual.
You will receive rendered images of selected pages from the manual.
Your job is to infer the entity types, relation predicates, and attribute schemas
that a knowledge graph for this product should use.

Output only valid JSON matching the schema below. No prose, no markdown fences.

RULES:
1. Entity type names must be singular nouns in snake_case (e.g., "cutting_path", "valve", "fault_code").
   Do not use product-specific names — name the concept, not the instance.
2. No two entity types may overlap in the set of things they describe.
   If you are unsure, merge into a more general type rather than split.
3. Each entity type must declare a meta_role from this fixed set:
   - "operator_concept"   — a process, mode, or cycle the operator selects or runs
   - "physical_interface" — a physical connector, port, socket, valve, or terminal
   - "control_element"    — a knob, button, switch, display, or adjustment on the machine
   - "parameter"          — a numeric or enumerated setting (speed, current, temperature)
   - "procedure"          — an ordered sequence of steps the operator follows
   - "consumable_input"   — a replaceable or expendable material used by the machine
   - "workpiece_material" — a material the machine acts upon
   - "failure_mode"       — an observable symptom, fault code, or error condition
   - "specification"      — a product-level numeric constraint or rating
   - "reference_artifact" — a diagram, figure, photo, or table in the manual
   - "other"              — use only if none of the above fit; explain in description
   Downstream code queries by meta_role (e.g., "all failure_mode entities") so this field
   must be precise. When in doubt, pick the closest fit rather than "other".
4. Relation predicates must be snake_case verb phrases (e.g., "requires", "connects_to", "outputs_at").
   Every predicate must be directional: subject -> object.
5. Every attribute must list its expected type: "string" | "number" | "boolean" | "enum" | "range".
   For "enum", include a non-exhaustive sample_values array.
   For "range", include expected_unit (e.g., "A", "V", "%", "IPM").
6. Include a "salience_hint" field per entity type: "high" | "medium" | "low".
   High = directly actionable (settings, procedures, interfaces).
   Medium = reference context (materials, processes, specifications).
   Low = administrative (warranty, contact info, legal).
7. Include a top-level "domain_summary" string: one sentence naming the product and its primary function.
8. Return ONLY the JSON object. Any non-JSON output will be rejected.

REQUIRED OUTPUT SHAPE:
{
  "domain_summary": "string",
  "entity_types": [
    {
      "name": "snake_case_name",
      "description": "what instances of this type are",
      "meta_role": "operator_concept | physical_interface | control_element | parameter | procedure | consumable_input | workpiece_material | failure_mode | specification | reference_artifact | other",
      "salience_hint": "high | medium | low",
      "attributes": [
        {
          "name": "attribute_name",
          "type": "string | number | boolean | enum | range",
          "required": true,
          "sample_values": ["..."],
          "expected_unit": "..."
        }
      ]
    }
  ],
  "relation_predicates": [
    {
      "predicate": "snake_case_verb_phrase",
      "subject_type": "entity_type_name",
      "object_type": "entity_type_name",
      "description": "what this relation means"
    }
  ]
}`;

function renderPages(): string[] {
  mkdirSync(TMP_DIR, { recursive: true });
  // Clear stale files
  try {
    execSync(`rm -f "${TMP_DIR}"/p-*.png`);
  } catch {}

  const prefix = join(TMP_DIR, "p");
  execSync(
    `pdftoppm -r 150 -png -f ${FIRST_PAGE} -l ${LAST_PAGE} "${PDF_PATH}" "${prefix}"`,
    { stdio: "pipe" }
  );

  return readdirSync(TMP_DIR)
    .filter(f => f.startsWith("p-") && f.endsWith(".png"))
    .sort()
    .map(f => join(TMP_DIR, f));
}

function toImageBlock(filePath: string): Anthropic.ImageBlockParam {
  const data = readFileSync(filePath).toString("base64");
  return { type: "image", source: { type: "base64", media_type: "image/png", data } };
}

async function callClaude(
  client: Anthropic,
  imageBlocks: Anthropic.ImageBlockParam[],
  priorErrors?: string[]
): Promise<string> {
  const systemPrompt = priorErrors?.length
    ? `${SCHEMA_PROMPT}\n\nThe previous response failed validation with these errors:\n${priorErrors.join("\n")}\nFix only the listed issues. Do not change passing fields.`
    : SCHEMA_PROMPT;

  const response = await client.messages.create({
    model: MODEL_SCHEMA,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          { type: "text", text: "Extract the domain ontology from these manual pages as JSON." },
        ],
      },
    ],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text.trim() : "";
}

async function main() {
  console.log(`\n=== Stage 1a: Schema Inference ===`);
  console.log(`Model: ${MODEL_SCHEMA}`);
  console.log(`PDF:   ${INGEST_PDF_PATH}`);
  console.log(`Pages: ${FIRST_PAGE}–${LAST_PAGE}\n`);

  console.log("Rendering pages...");
  const pageFiles = renderPages();
  console.log(`Rendered ${pageFiles.length} pages.\n`);

  const imageBlocks = pageFiles.map(toImageBlock);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let lastRaw = "";
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`Attempt ${attempt}/3...`);
    lastRaw = await callClaude(client, imageBlocks, attempt > 1 ? lastErrors : undefined);

    // Strip accidental markdown fences
    const cleaned = lastRaw.replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

    let schema: unknown;
    try {
      schema = JSON.parse(cleaned);
    } catch (e) {
      lastErrors = [`Response is not valid JSON: ${(e as Error).message}`];
      console.log(`  ✗ JSON parse failed: ${lastErrors[0]}\n`);
      lastRaw = cleaned;
      continue;
    }

    lastErrors = validateSchema(schema);
    if (lastErrors.length === 0) {
      writeFileSync(OUTPUT_PATH, JSON.stringify(schema, null, 2));
      console.log(`  ✓ Valid — wrote data/schema.json\n`);
      return;
    }

    console.log(`  ✗ ${lastErrors.length} validation error(s):`);
    lastErrors.forEach(e => console.log(`    · ${e}`));
    console.log();
  }

  // All attempts failed
  writeFileSync(REVIEW_PATH, JSON.stringify({ raw_response: lastRaw, errors: lastErrors }, null, 2));
  console.error(
    `\n❌ Schema inference failed after 3 attempts.\n` +
    `   Run \`npm run schema:review\` to inspect data/schema.review.json`
  );
  process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
