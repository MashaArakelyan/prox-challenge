// Diagnostic rescue — retries page 35 with higher max_tokens.
// Merges any recovered symptoms into existing data/diagnostic_trees.json.
// Logs to data/extraction_failures.jsonl if still failing after retry.

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { MODEL_DIAGNOSTIC, INGEST_PDF_PATH, DATA_DIR } from "./ingest-config.js";

config();

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PDF_PATH = join(ROOT, INGEST_PDF_PATH);
const DATA_PATH = join(ROOT, DATA_DIR);
const TMP_DIR = "/tmp/prox-diagnostic-rescue";

const RESCUE_PAGES = [35];
const MAX_TOKENS = 16384;

const SYSTEM_PROMPT = `You are extracting diagnostic knowledge from one page of a product manual.
You will receive a rendered image of the page.

For each distinct symptom described on this page, produce a symptom object with:
- A causes array: the candidate explanations with prior probabilities
- A checks array: the observations the user can make at the machine

IMPORTANT: causes and checks are SIBLING arrays at the symptom level.
Checks are NOT nested inside causes.

RULES:
1. A "symptom" is observable by the user without tools (visual, auditory, tactile).
2. Priors across all causes for one symptom must sum to ≤ 1.0.
3. Every cause prior must include a "prior_source" field:
   "manual_derived" | "manual_order_heuristic" | "llm_estimated"
4. Each check must declare its "modality":
   "self_report" | "user_photo" | "numeric_measurement"
5. Each check carries a sparse "likelihood_ratios" object keyed by cause_id.
   Only include causes this check is informative about. lr_positive > 1 = more likely,
   < 1 = less likely, = 1 = OMIT. Source: "manual_derived" | "llm_estimated" only.
6. Checks phrased as yes/no questions or numeric observations.
7. process_scope: specific process name(s) or "all".
8. If no diagnostic content on this page, return: { "page": number, "symptoms": [] }
9. Return ONLY the JSON object. No prose, no markdown fences.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "symptoms": [
    {
      "id": "symptom_slug",
      "label": "Short label",
      "description": "What the user observes",
      "process_scope": ["MIG"] | "all",
      "causes": [{ "id": "cause_slug", "label": "...", "prior": 0.0, "prior_source": "..." }],
      "checks": [
        {
          "id": "check_slug",
          "question": "...",
          "modality": "self_report",
          "positive_meaning": "...",
          "likelihood_ratios": { "<cause_id>": { "lr_positive": 0.0, "source": "..." } },
          "recommended_action_if_positive": "..."
        }
      ],
      "manual_citation": { "page": number, "section": "..." }
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

type LREntry = { lr_positive: number; source: string; note?: string };
type Check = { id: string; question: string; modality: string; positive_meaning: string; likelihood_ratios: Record<string, LREntry>; recommended_action_if_positive: string };
type Cause = { id: string; label: string; prior: number; prior_source: string; prior_note?: string };
type Symptom = { id: string; label: string; description: string; process_scope: string[] | string; causes: Cause[]; checks: Check[]; manual_citation: { page: number; section: string } };

function mergeSymptoms(existing: Symptom, incoming: Symptom): Symptom {
  const causeMap = new Map<string, Cause>();
  for (const c of existing.causes) causeMap.set(c.id, c);
  for (const c of incoming.causes) { if (!causeMap.has(c.id)) causeMap.set(c.id, c); }
  const checkMap = new Map<string, Check>();
  for (const ch of existing.checks) checkMap.set(ch.id, ch);
  for (const ch of incoming.checks) {
    if (!checkMap.has(ch.id)) checkMap.set(ch.id, ch);
    else { const e = checkMap.get(ch.id)!; e.likelihood_ratios = { ...ch.likelihood_ratios, ...e.likelihood_ratios }; }
  }
  const causes = Array.from(causeMap.values());
  const priorSum = causes.reduce((s, c) => s + c.prior, 0);
  if (priorSum > 1.0) { const scale = 0.95 / priorSum; for (const c of causes) c.prior = Math.round(c.prior * scale * 1000) / 1000; }
  return { ...existing, causes, checks: Array.from(checkMap.values()) };
}

async function main() {
  console.log(`\n=== Diagnostic Rescue Pass (${MODEL_DIAGNOSTIC}, max_tokens=${MAX_TOKENS}) ===`);
  console.log(`Rescue pages: ${RESCUE_PAGES.join(", ")}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const existing: { symptoms: Symptom[] } = JSON.parse(readFileSync(join(DATA_PATH, "diagnostic_trees.json"), "utf8"));
  const symptomMap = new Map<string, Symptom>(existing.symptoms.map(s => [s.id, s]));

  for (const page of RESCUE_PAGES) {
    process.stdout.write(`  Rescue page ${page} (max_tokens=${MAX_TOKENS})... `);
    const pageFile = renderPage(page);

    const response = await client.messages.create({
      model: MODEL_DIAGNOSTIC,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          toImageBlock(pageFile),
          { type: "text", text: `PAGE: ${page}\n\nExtract all diagnostic content from this page.` },
        ],
      }],
    });

    const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim()
      .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

    let result: { symptoms?: Symptom[] };
    try {
      result = JSON.parse(raw);
    } catch (e) {
      console.log(`parse failed — logging to extraction_failures.jsonl`);
      appendFileSync(
        join(DATA_PATH, "extraction_failures.jsonl"),
        JSON.stringify({ stage: "diagnostic", page, error: (e as Error).message, raw: raw.slice(0, 500) }) + "\n"
      );
      continue;
    }

    const symptoms = result.symptoms ?? [];
    let newCount = 0;
    let mergedCount = 0;
    for (const s of symptoms) {
      if (symptomMap.has(s.id)) { symptomMap.set(s.id, mergeSymptoms(symptomMap.get(s.id)!, s)); mergedCount++; }
      else { symptomMap.set(s.id, s); newCount++; }
    }
    console.log(`${newCount}new ${mergedCount}merged`);
  }

  const symptoms = Array.from(symptomMap.values());
  writeFileSync(join(DATA_PATH, "diagnostic_trees.json"), JSON.stringify({ symptoms }, null, 2));
  console.log(`\n✓ diagnostic_trees.json updated (${symptoms.length} total symptoms)`);
}

main().catch(err => { console.error(err); process.exit(1); });
