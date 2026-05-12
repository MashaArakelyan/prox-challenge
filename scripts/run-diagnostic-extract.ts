// Stage 1b — Diagnostic extraction pass (Opus 4.7)
// Processes troubleshooting pages of the manual. Extracts symptom→cause Bayesian trees
// with flat checks and likelihood ratios.
// Pages scanned: any page with troubleshooting/diagnosis/welding-tips headings.
// For the Vulcan OmniPro 220, this is pages 34–45.
// Outputs: data/diagnostic_trees.json

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
const TMP_DIR = "/tmp/prox-diagnostic";

// Troubleshooting section of the Vulcan OmniPro 220 manual
const DIAG_FIRST_PAGE = 34;
const DIAG_LAST_PAGE = 45;

const SYSTEM_PROMPT = `You are extracting diagnostic knowledge from one page of a product manual.
You will receive a rendered image of the page.

For each distinct symptom described on this page, produce a symptom object with:
- A causes array: the candidate explanations with prior probabilities
- A checks array: the observations the user can make at the machine

IMPORTANT: causes and checks are SIBLING arrays at the symptom level.
Checks are NOT nested inside causes.

WHY THE STRUCTURE IS FLAT:
Each check provides evidence about multiple causes simultaneously. Asking "is your
gas flow above 15 CFH?" should update beliefs about low_shielding_gas (sharply),
about contaminated_base_metal (not at all), and about draft_in_workspace (not at all)
in a single operation. Nesting checks inside a single cause loses this cross-cause signal.
The flat structure is what enables the entropy-reduction algorithm in diagnose mode:
at each turn, the agent picks the check whose answer most splits the remaining candidate
set — the question that compresses the belief distribution the fastest.

RULES:
1. A "symptom" is observable by the user without tools (visual, auditory, tactile).
   Do not create symptoms for internal machine states the user cannot observe.
2. Priors across all causes for one symptom must sum to ≤ 1.0 (leave slack for unknown causes).
3. Every cause prior must include a "prior_source" field:
   - "manual_derived"         — explicit frequency stated in the manual
   - "manual_order_heuristic" — inferred from listing order in a troubleshooting table
   - "llm_estimated"          — Claude's domain knowledge; no manual grounding
4. Each check must declare its "modality":
   - "self_report"         — user answers yes/no from memory or direct observation
   - "user_photo"          — user takes or uploads a photo for interpretation
   - "numeric_measurement" — user reads a gauge, display, or meter
   This field determines what the UI renders: yes/no buttons, a camera prompt, or a number input.
5. Each check carries a "likelihood_ratios" object keyed by cause_id.
   - Include an entry ONLY for causes this check is informative about.
   - Omit causes where the check gives no signal — they default to lr_positive = 1.0 (neutral) at runtime.
   - This sparsity is intentional: it forces you to think about which causes each check distinguishes.
   - lr_positive semantics:
       > 1.0 : a positive answer makes this cause MORE likely (typical range: 3.0–7.0)
       < 1.0 : a positive answer makes this cause LESS likely (typical range: 0.1–0.3)
       = 1.0 : neutral — OMIT this entry entirely
   - Each entry includes a "source" field: "manual_derived" or "llm_estimated" only.
     (manual_order_heuristic does not apply to likelihood ratios.)
6. Checks must be phrased as yes/no questions or numeric observations answerable
   while standing at the machine (e.g., "Is the flow rate below 15 CFH?").
7. process_scope names the specific process(es) if known, or "all" if universal.
   Use the process names as they appear in the manual.
8. If a page contains no diagnostic content, return: { "page": number, "symptoms": [] }
9. Return ONLY the JSON object. No prose, no markdown fences.

REQUIRED OUTPUT SHAPE:
{
  "page": number,
  "symptoms": [
    {
      "id": "symptom_slug_in_snake_case",
      "label": "Short human-readable label",
      "description": "What the user observes",
      "process_scope": ["process name 1", "process name 2"] | "all",
      "causes": [
        {
          "id": "cause_slug",
          "label": "Cause name",
          "prior": 0.0,
          "prior_source": "manual_derived" | "manual_order_heuristic" | "llm_estimated",
          "prior_note": "optional: quoted phrase from manual if manual_derived"
        }
      ],
      "checks": [
        {
          "id": "check_slug",
          "question": "Yes/no question or numeric observation",
          "modality": "self_report" | "user_photo" | "numeric_measurement",
          "positive_meaning": "What a yes or above-threshold answer means physically",
          "likelihood_ratios": {
            "<cause_id>": {
              "lr_positive": 0.0,
              "source": "manual_derived" | "llm_estimated",
              "note": "optional"
            }
          },
          "recommended_action_if_positive": "What to do if the answer is positive"
        }
      ],
      "manual_citation": {
        "page": number,
        "section": "section heading or figure label"
      }
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
type Check = {
  id: string;
  question: string;
  modality: string;
  positive_meaning: string;
  likelihood_ratios: Record<string, LREntry>;
  recommended_action_if_positive: string;
};
type Cause = { id: string; label: string; prior: number; prior_source: string; prior_note?: string };
type Symptom = {
  id: string;
  label: string;
  description: string;
  process_scope: string[] | string;
  causes: Cause[];
  checks: Check[];
  manual_citation: { page: number; section: string };
};

function mergeSymptoms(existing: Symptom, incoming: Symptom): Symptom {
  // Merge causes: deduplicate by cause ID, keep existing if duplicate
  const causeMap = new Map<string, Cause>();
  for (const c of existing.causes) causeMap.set(c.id, c);
  for (const c of incoming.causes) {
    if (!causeMap.has(c.id)) causeMap.set(c.id, c);
  }

  // Merge checks: deduplicate by check ID, merge likelihood_ratios if same check appears
  const checkMap = new Map<string, Check>();
  for (const ch of existing.checks) checkMap.set(ch.id, ch);
  for (const ch of incoming.checks) {
    if (!checkMap.has(ch.id)) {
      checkMap.set(ch.id, ch);
    } else {
      const existingCheck = checkMap.get(ch.id)!;
      existingCheck.likelihood_ratios = { ...ch.likelihood_ratios, ...existingCheck.likelihood_ratios };
    }
  }

  // Re-normalize priors if they exceed 1.0 after merge
  const causes = Array.from(causeMap.values());
  const priorSum = causes.reduce((sum, c) => sum + c.prior, 0);
  if (priorSum > 1.0) {
    const scale = 0.95 / priorSum;
    for (const c of causes) c.prior = Math.round(c.prior * scale * 1000) / 1000;
  }

  return {
    ...existing,
    causes,
    checks: Array.from(checkMap.values()),
  };
}

async function extractPage(client: Anthropic, pageNum: number): Promise<Symptom[]> {
  const pageFile = renderPage(pageNum);

  const response = await client.messages.create({
    model: MODEL_DIAGNOSTIC,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        toImageBlock(pageFile),
        { type: "text", text: `PAGE: ${pageNum}\n\nExtract all diagnostic content from this page.` },
      ],
    }],
  });

  const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim()
    .replace(/^```(?:json)?\n?/m, "").replace(/```\s*$/m, "").trim();

  let result: { symptoms?: Symptom[] };
  try {
    result = JSON.parse(raw);
  } catch {
    console.log(`  Page ${pageNum}: JSON parse failed — treating as empty`);
    return [];
  }

  return result.symptoms ?? [];
}

async function main() {
  console.log(`\n=== Diagnostic Extraction Pass (${MODEL_DIAGNOSTIC}) ===`);
  console.log(`Pages: ${DIAG_FIRST_PAGE}–${DIAG_LAST_PAGE}\n`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const symptomMap = new Map<string, Symptom>();

  for (let page = DIAG_FIRST_PAGE; page <= DIAG_LAST_PAGE; page++) {
    process.stdout.write(`  Page ${page}/${DIAG_LAST_PAGE}... `);
    const symptoms = await extractPage(client, page);

    let newCount = 0;
    let mergedCount = 0;
    for (const s of symptoms) {
      if (symptomMap.has(s.id)) {
        symptomMap.set(s.id, mergeSymptoms(symptomMap.get(s.id)!, s));
        mergedCount++;
      } else {
        symptomMap.set(s.id, s);
        newCount++;
      }
    }
    console.log(`${newCount}new ${mergedCount}merged`);

    if (page < DIAG_LAST_PAGE) await new Promise(r => setTimeout(r, 500));
  }

  const symptoms = Array.from(symptomMap.values());
  writeFileSync(join(DATA_PATH, "diagnostic_trees.json"), JSON.stringify({ symptoms }, null, 2));
  console.log(`\n✓ Wrote diagnostic_trees.json (${symptoms.length} symptoms)`);
}

main().catch(err => { console.error(err); process.exit(1); });
