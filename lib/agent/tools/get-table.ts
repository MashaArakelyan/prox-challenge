import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getTable } from "../../knowledge/index.js";

export const definition: Tool = {
  name: "get_table",
  description:
    "Retrieve a specification or reference table from the manual by exact ID (e.g. 'table_7_1') " +
    "or case-insensitive name substring (e.g. 'MIG Specifications'). " +
    "Returns all columns and rows. Use this when the user asks for a specific spec number, " +
    "a range of values, or when search_critical_facts doesn't return the needed detail. " +
    "Known tables: MIG Specifications (table_7_1), TIG Specifications (table_7_2), " +
    "Stick Specifications (table_7_3), Duty Cycle Summary (table_23_2), " +
    "TIG Rated Duty Cycles (table_29_1), Stick Rated Duty Cycles (table_29_2), " +
    "MIG/Flux-Cored Troubleshooting (table_42_1), TIG/Stick Troubleshooting (table_44_1).",
  input_schema: {
    type: "object" as const,
    properties: {
      idOrName: {
        type: "string",
        description: "Exact table ID like 'table_7_1' or a name substring like 'MIG Specifications'.",
      },
    },
    required: ["idOrName"],
  },
};

export function handle(input: { idOrName: string }): string {
  const table = getTable(input.idOrName);
  if (!table) return JSON.stringify({ found: false, idOrName: input.idOrName });
  return JSON.stringify({ found: true, table });
}
