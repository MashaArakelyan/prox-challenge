import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getCanonicalSetup } from "../../knowledge/index.js";

export const definition: Tool = {
  name: "verify_setup",
  description:
    "Check whether the user's reported settings match the canonical setup for their process, " +
    "material, and thickness. Call this BEFORE entering the diagnose_loop when the user has " +
    "provided process + material context — setup errors are the most common root cause and " +
    "should be ruled out first. " +
    "Returns the canonical setup and a list of mismatches (if any). " +
    "A mismatch should be surfaced as a 'check this first' before running Bayesian checks.",
  input_schema: {
    type: "object" as const,
    properties: {
      process: {
        type: "string",
        enum: ["MIG", "TIG", "Stick", "Flux-Cored"],
        description: "Welding process the user is running.",
      },
      material: {
        type: "string",
        description: "Base material, e.g. 'mild_steel', 'stainless', 'aluminum'.",
      },
      thicknessIn: {
        type: "number",
        description: "Material thickness in inches, e.g. 0.125 for 1/8 inch.",
      },
      reportedSettings: {
        type: "object",
        description: "Settings the user reports currently using. All keys optional.",
        properties: {
          polarity:          { type: "string" },
          wire_diameter_in:  { type: "string" },
          shielding_gas:     { type: "string" },
          electrode_class:   { type: "string" },
        },
      },
    },
    required: ["process", "material"],
  },
};

export function handle(input: {
  process: string;
  material: string;
  thicknessIn?: number;
  reportedSettings?: Record<string, string | null>;
}): string {
  const setup = getCanonicalSetup(input.process, input.material, input.thicknessIn);

  if (!setup) {
    return JSON.stringify({
      found: false,
      message: `No canonical setup found for ${input.process} / ${input.material}. Cannot verify — proceed with diagnostic checks.`,
    });
  }

  const mismatches: Array<{ field: string; expected: string; reported: string }> = [];
  const reported = input.reportedSettings ?? {};

  for (const [field, expected] of Object.entries(setup.settings)) {
    if (expected == null) continue; // no canonical value — can't check
    const rep = reported[field];
    if (rep == null) continue; // user didn't report this — skip
    if (String(rep).toLowerCase() !== String(expected).toLowerCase()) {
      mismatches.push({ field, expected: String(expected), reported: String(rep) });
    }
  }

  return JSON.stringify({
    found: true,
    setup: {
      id: setup.id,
      label: setup.label,
      settings: setup.settings,
      citation: setup.manual_citation,
    },
    mismatches,
    verdict:
      mismatches.length === 0
        ? "Setup matches canonical — proceed with symptom checks."
        : `${mismatches.length} mismatch(es) found — fix these before running diagnostic checks.`,
  });
}
