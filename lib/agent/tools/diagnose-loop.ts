import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getSymptom } from "../../knowledge/index.js";
import type { Cause, Check } from "../../knowledge/types.js";

export const definition: Tool = {
  name: "diagnose_loop",
  description:
    "Bayesian narrowing tool for Diagnose mode. " +
    "On first call (no lastAnswer): initialise posteriors from priors, pick the check that " +
    "maximises expected entropy reduction, return it. " +
    "On subsequent calls: apply Bayes rule, zero out eliminated causes (<2% of max), " +
    "recompute posteriors, pick the next entropy-maximising check. " +
    "Returns: nextCheck, rankedBeliefs (with probability, previousProbability, delta, eliminated), " +
    "leadingCause, confidence, done. Terminates when confidence > 0.50 or checks exhausted. " +
    "After each call, narrate the belief shift inline: 'porosity: 45% ▲ from 31%' or " +
    "'gas flow: 0% ▼ (ruled out)'. Do NOT emit any artifact — just narrate in text. " +
    "Pass updatedBeliefs and answeredCheckIds back on every subsequent call.",
  input_schema: {
    type: "object" as const,
    properties: {
      symptomId: {
        type: "string",
        description: "Canonical symptom ID returned by list_symptoms.",
      },
      currentBeliefs: {
        type: "object",
        description:
          "Current posterior probability for each causeId. Omit on first call — " +
          "will be initialised from priors.",
        additionalProperties: { type: "number" },
      },
      lastAnswer: {
        type: "object",
        description: "The user's answer to the previous check. Omit on first call.",
        properties: {
          checkId: { type: "string" },
          // true = positive (the check question answered YES); false = negative
          value: { type: "boolean" },
        },
        required: ["checkId", "value"],
      },
      answeredCheckIds: {
        type: "array",
        items: { type: "string" },
        description: "IDs of checks already answered, so they are not repeated.",
      },
    },
    required: ["symptomId"],
  },
};

// ── Entropy utilities ─────────────────────────────────────────────────────────

function entropy(probs: number[]): number {
  return probs.reduce((h, p) => (p > 0 ? h - p * Math.log2(p) : h), 0);
}

// Given current beliefs and a check, compute expected entropy after asking it.
// We approximate P(positive) = weighted average of LR-positive values adjusted by beliefs.
function expectedEntropyAfterCheck(
  beliefs: Record<string, number>,
  check: Check,
  causes: Cause[],
): number {
  const causeIds = causes.map((c) => c.id);
  const probs = causeIds.map((id) => beliefs[id] ?? 0);

  // P(check positive) using total probability
  // For causes with no LR entry we assume LR=1 (neutral, no info)
  const lrMap = check.likelihood_ratios;

  const pPos = probs.reduce((sum, p, i) => {
    const id = causeIds[i];
    const lr = lrMap[id]?.lr_positive ?? 1;
    // Approximate P(positive | cause) from LR: assumes ~0.5 base rate → P(+|c) ~ lr/(1+lr)
    const pPosGivenCause = lr / (1 + lr);
    return sum + p * pPosGivenCause;
  }, 0);

  const pNeg = 1 - pPos;

  // Posterior after positive answer
  const posteriorPos = causeIds.map((id, i) => {
    const lr = lrMap[id]?.lr_positive ?? 1;
    const pPosGivenCause = lr / (1 + lr);
    return pPos > 0 ? (probs[i] * pPosGivenCause) / pPos : 0;
  });
  const normalisePos = posteriorPos.reduce((s, p) => s + p, 0);
  const normPos = normalisePos > 0 ? posteriorPos.map((p) => p / normalisePos) : posteriorPos;

  // Posterior after negative answer (LR_negative approximated as 1/LR_positive if LR>1 else 1)
  const posteriorNeg = causeIds.map((id, i) => {
    const lr = lrMap[id]?.lr_positive ?? 1;
    const pNegGivenCause = 1 - lr / (1 + lr);
    return pNeg > 0 ? (probs[i] * pNegGivenCause) / pNeg : 0;
  });
  const normaliseNeg = posteriorNeg.reduce((s, p) => s + p, 0);
  const normNeg = normaliseNeg > 0 ? posteriorNeg.map((p) => p / normaliseNeg) : posteriorNeg;

  return pPos * entropy(normPos) + pNeg * entropy(normNeg);
}

// ── Bayes update ──────────────────────────────────────────────────────────────

function bayesUpdate(
  beliefs: Record<string, number>,
  check: Check,
  positive: boolean,
  causes: Cause[],
): Record<string, number> {
  const updated: Record<string, number> = {};
  const lrMap = check.likelihood_ratios;

  for (const cause of causes) {
    const prior = beliefs[cause.id] ?? 0;
    const lr = lrMap[cause.id]?.lr_positive ?? 1;
    const pPosGivenCause = lr / (1 + lr);
    const likelihood = positive ? pPosGivenCause : 1 - pPosGivenCause;
    updated[cause.id] = prior * likelihood;
  }

  // Zero out practically eliminated causes before normalising
  for (const id in updated) {
    const maxPossible = Math.max(...Object.values(updated));
    if (maxPossible > 0 && updated[id] / maxPossible < ELIMINATION_THRESHOLD) {
      updated[id] = 0;
    }
  }

  // Normalise
  const total = Object.values(updated).reduce((s, p) => s + p, 0);
  if (total === 0) return beliefs; // degenerate — leave unchanged
  for (const id in updated) updated[id] /= total;

  return updated;
}

// ── Handler ───────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.50;
const ELIMINATION_THRESHOLD = 0.02; // causes below this after update are zeroed out

export function handle(input: {
  symptomId: string;
  currentBeliefs?: Record<string, number>;
  lastAnswer?: { checkId: string; value: boolean };
  answeredCheckIds?: string[];
}): string {
  const symptom = getSymptom(input.symptomId);
  if (!symptom) {
    return JSON.stringify({ error: `Symptom not found: ${input.symptomId}` });
  }

  const { causes, checks } = symptom;
  const answered = new Set(input.answeredCheckIds ?? []);

  // Initialise beliefs from priors if not provided
  let beliefs: Record<string, number> = input.currentBeliefs ?? {};
  if (!input.currentBeliefs) {
    const total = causes.reduce((s, c) => s + c.prior, 0);
    for (const cause of causes) {
      beliefs[cause.id] = total > 0 ? cause.prior / total : 1 / causes.length;
    }
  }

  // Snapshot beliefs before update so we can compute deltas for UI display
  const beliefsBeforeUpdate = { ...beliefs };

  // Apply Bayes update for the last answered check
  if (input.lastAnswer) {
    const check = checks.find((c) => c.id === input.lastAnswer!.checkId);
    if (check) {
      beliefs = bayesUpdate(beliefs, check, input.lastAnswer.value, causes);
      answered.add(input.lastAnswer.checkId);
    }
  }

  // Find leading cause
  const sortedCauses = [...causes].sort(
    (a, b) => (beliefs[b.id] ?? 0) - (beliefs[a.id] ?? 0),
  );
  const leading = sortedCauses[0];
  const confidence = beliefs[leading.id] ?? 0;

  // Rank beliefs with deltas — agent uses these to narrate "X% ▲ from Y%" changes
  const rankedBeliefs = sortedCauses.map((c) => {
    const current = Math.round((beliefs[c.id] ?? 0) * 1000) / 1000;
    const previous = Math.round((beliefsBeforeUpdate[c.id] ?? 0) * 1000) / 1000;
    return {
      causeId: c.id,
      label: c.label,
      probability: current,
      previousProbability: previous,
      delta: Math.round((current - previous) * 1000) / 1000,
      eliminated: current === 0 && previous > 0,
      prior_source: c.prior_source,
    };
  });

  // Check if we should stop
  const remainingChecks = checks.filter((c) => !answered.has(c.id));

  if (confidence >= CONFIDENCE_THRESHOLD || remainingChecks.length === 0) {
    return JSON.stringify({
      done: true,
      updatedBeliefs: beliefs,
      rankedBeliefs,
      leadingCause: { id: leading.id, label: leading.label },
      confidence,
      recommendedAction:
        (leading.id
          ? (checks.find((c) => !answered.has(c.id) && c.likelihood_ratios[leading.id])
              ?.recommended_action_if_positive ?? `Address: ${leading.label}`)
          : `Address: ${leading.label}`),
      answeredCheckIds: [...answered],
    });
  }

  // Pick the check with minimum expected entropy (maximum information gain)
  let bestCheck: Check | null = null;
  let bestExpectedEntropy = Infinity;

  for (const check of remainingChecks) {
    const ee = expectedEntropyAfterCheck(beliefs, check, causes);
    if (ee < bestExpectedEntropy) {
      bestExpectedEntropy = ee;
      bestCheck = check;
    }
  }

  if (!bestCheck) {
    return JSON.stringify({
      done: true,
      updatedBeliefs: beliefs,
      rankedBeliefs,
      leadingCause: { id: leading.id, label: leading.label },
      confidence,
      answeredCheckIds: [...answered],
    });
  }

  return JSON.stringify({
    done: false,
    nextCheck: {
      id: bestCheck.id,
      question: bestCheck.question,
      modality: bestCheck.modality,
      positive_meaning: bestCheck.positive_meaning,
    },
    updatedBeliefs: beliefs,
    rankedBeliefs,
    leadingCause: { id: leading.id, label: leading.label },
    confidence,
    answeredCheckIds: [...answered],
  });
}
