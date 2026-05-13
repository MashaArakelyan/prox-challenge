import type { Tool } from "@anthropic-ai/sdk/resources/messages";

import { definition as searchCriticalFactsDef, handle as handleSearchCriticalFacts } from "./search-critical-facts.js";
import { definition as getTableDef, handle as handleGetTable } from "./get-table.js";
import { definition as surfaceRegionDef, handle as handleSurfaceRegion } from "./surface-region.js";
import { definition as queryGraphDef, handle as handleQueryGraph } from "./query-graph.js";

export const tools: Tool[] = [
  searchCriticalFactsDef,
  getTableDef,
  surfaceRegionDef,
  queryGraphDef,
];

// Dispatch a tool call by name. Returns a JSON string ready for tool_result content.
export function dispatch(name: string, input: unknown): string {
  switch (name) {
    case "search_critical_facts": return handleSearchCriticalFacts(input as Parameters<typeof handleSearchCriticalFacts>[0]);
    case "get_table":             return handleGetTable(input as Parameters<typeof handleGetTable>[0]);
    case "surface_region":        return handleSurfaceRegion(input as Parameters<typeof handleSurfaceRegion>[0]);
    case "query_graph":           return handleQueryGraph(input as Parameters<typeof handleQueryGraph>[0]);
    default: return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
