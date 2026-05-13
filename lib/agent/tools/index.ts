import type { Tool } from "@anthropic-ai/sdk/resources/messages";

import { definition as searchCriticalFactsDef, handle as handleSearchCriticalFacts } from "./search-critical-facts.js";
import { definition as getTableDef,             handle as handleGetTable }             from "./get-table.js";
import { definition as surfaceRegionDef,         handle as handleSurfaceRegion }        from "./surface-region.js";
import { definition as queryGraphDef,            handle as handleQueryGraph }           from "./query-graph.js";
import { definition as renderArtifactDef,        handle as handleRenderArtifact }       from "./render-artifact.js";
import { definition as listSymptomsDef,          handle as handleListSymptoms }         from "./list-symptoms.js";
import { definition as diagnoseLoopDef,          handle as handleDiagnoseLoop }         from "./diagnose-loop.js";
import { definition as verifySetupDef,           handle as handleVerifySetup }          from "./verify-setup.js";

export const tools: Tool[] = [
  searchCriticalFactsDef,
  getTableDef,
  surfaceRegionDef,
  queryGraphDef,
  renderArtifactDef,
  listSymptomsDef,
  diagnoseLoopDef,
  verifySetupDef,
];

export function dispatch(name: string, input: unknown): string {
  switch (name) {
    case "search_critical_facts": return handleSearchCriticalFacts(input as Parameters<typeof handleSearchCriticalFacts>[0]);
    case "get_table":             return handleGetTable(input as Parameters<typeof handleGetTable>[0]);
    case "surface_region":        return handleSurfaceRegion(input as Parameters<typeof handleSurfaceRegion>[0]);
    case "query_graph":           return handleQueryGraph(input as Parameters<typeof handleQueryGraph>[0]);
    case "render_artifact":       return handleRenderArtifact(input);
    case "list_symptoms":         return handleListSymptoms(input as Parameters<typeof handleListSymptoms>[0]);
    case "diagnose_loop":         return handleDiagnoseLoop(input as Parameters<typeof handleDiagnoseLoop>[0]);
    case "verify_setup":          return handleVerifySetup(input as Parameters<typeof handleVerifySetup>[0]);
    default: return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
