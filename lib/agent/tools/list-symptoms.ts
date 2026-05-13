import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { listSymptoms } from "../../knowledge/index.js";

export const definition: Tool = {
  name: "list_symptoms",
  description:
    "Return every canonical symptom in the diagnostic tree (id, label, process_scope). " +
    "Call this FIRST when the user describes a weld defect or equipment problem in natural language " +
    "— 'my weld looks like Swiss cheese', 'spatter is everywhere', 'arc keeps cutting out'. " +
    "After receiving the list, pick the best-matching symptom ID by label similarity plus " +
    "process context, then enter Diagnose mode: call verify_setup (if process/material/thickness " +
    "known), then loop on diagnose_loop with the chosen symptom ID. " +
    "Optional filter: restrict to symptoms for a specific process (MIG, TIG, Stick, Flux-Cored). " +
    "Do NOT call this for lookup questions — only for defect/problem reports.",
  input_schema: {
    type: "object" as const,
    properties: {
      process: {
        type: "string",
        enum: ["MIG", "TIG", "Stick", "Flux-Cored"],
        description: "Restrict to symptoms scoped to this process. Omit to return all symptoms.",
      },
    },
  },
};

export function handle(input: { process?: string }): string {
  const symptoms = listSymptoms(input.process ? { process: input.process } : undefined);
  return JSON.stringify({
    count: symptoms.length,
    symptoms: symptoms.map((s) => ({
      id: s.id,
      label: s.label,
      process_scope: s.process_scope,
      cause_count: s.causes.length,
      check_count: s.checks.length,
    })),
  });
}
