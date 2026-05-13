import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { searchCriticalFacts } from "../../knowledge/index.js";

export const definition: Tool = {
  name: "search_critical_facts",
  description:
    "Search the manual's extracted critical facts — atomic, citation-backed assertions like " +
    "duty cycle numbers, socket assignments, polarity rules, safety limits, and gas requirements. " +
    "Use this before get_table when you need a quick factual answer with a page citation. " +
    "Filter by processScope (MIG | TIG | Stick | Flux-Cored) and/or a substring in the claim text. " +
    "Substring matching is case-insensitive but exact — try shorter or alternate phrasings if the first query returns nothing.",
  input_schema: {
    type: "object" as const,
    properties: {
      processScope: {
        type: "string",
        enum: ["MIG", "TIG", "Stick", "Flux-Cored"],
        description: "Restrict to facts for this welding process. Omit to search all processes.",
      },
      substring: {
        type: "string",
        description: "Case-insensitive substring that must appear in the claim text.",
      },
    },
  },
};

export function handle(input: { processScope?: string; substring?: string }): string {
  const facts = searchCriticalFacts({
    processScope: input.processScope,
    substring: input.substring,
  });
  if (!facts.length) return JSON.stringify({ found: false, results: [] });
  return JSON.stringify({ found: true, count: facts.length, results: facts });
}
