import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { queryGraph } from "../../knowledge/index.js";

export const definition: Tool = {
  name: "query_graph",
  description:
    "BFS traversal of the entity-relation graph starting from a seed entity ID. " +
    "Returns all entities and relations reachable within `depth` hops. " +
    "Use this to answer questions about how components relate to each other, " +
    "what a process requires, or which entities share a predicate. " +
    "direction: 'out' follows subject→object edges; 'in' follows object→subject; " +
    "'both' (default) follows both. " +
    "predicates: optional allow-list of relation predicate names to filter on. " +
    "Useful seeds: 'welding_process_mig', 'welding_process_tig', 'welding_process_stick'.",
  input_schema: {
    type: "object" as const,
    properties: {
      seedId: {
        type: "string",
        description: "Entity ID to start the traversal from.",
      },
      depth: {
        type: "number",
        description: "Number of hops to traverse. Keep ≤2 to avoid large result sets.",
      },
      direction: {
        type: "string",
        enum: ["out", "in", "both"],
        description: "Edge direction to follow. Defaults to 'both'.",
      },
      predicates: {
        type: "array",
        items: { type: "string" },
        description: "Optional allow-list of predicate names. Omit for all predicates.",
      },
    },
    required: ["seedId", "depth"],
  },
};

export function handle(input: {
  seedId: string;
  depth: number;
  direction?: "out" | "in" | "both";
  predicates?: string[];
}): string {
  const result = queryGraph(input.seedId, input.depth, {
    direction: input.direction ?? "both",
    predicates: input.predicates,
  });

  if (!result.entities.length) {
    return JSON.stringify({ found: false, seedId: input.seedId });
  }

  return JSON.stringify({
    found: true,
    entityCount: result.entities.length,
    relationCount: result.relations.length,
    entities: result.entities.map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description,
      page_refs: e.page_refs,
    })),
    relations: result.relations.map(r => ({
      predicate: r.predicate,
      subject_id: r.subject_id,
      object_id: r.object_id,
      page: r.page,
    })),
  });
}
