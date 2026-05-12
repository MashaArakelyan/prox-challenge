// Public query API for the knowledge layer.
// All functions are pure reads over the in-memory stores loaded by store.ts.

import {
  entityById, entityByType, tableById, procedureById, symptomById, diagramById,
  adjacency, allRelations, allTables, allDiagrams, allProcedures, allSymptoms,
  allFacts, allSetups,
} from "./store.js";
import type {
  Entity, Relation, Table, Procedure, Symptom, Diagram, DiagramRegion,
  CriticalFact, CanonicalSetup,
} from "./types.js";

export type { Entity, Relation, Table, Procedure, Symptom, Diagram, DiagramRegion, CriticalFact, CanonicalSetup };

// ── Entities ──────────────────────────────────────────────────────────────────

export function getEntity(id: string): Entity | null {
  return entityById.get(id) ?? null;
}

export function getEntitiesByType(type: string): Entity[] {
  return entityByType.get(type) ?? [];
}

// ── Graph traversal ───────────────────────────────────────────────────────────

/**
 * BFS from seedId up to `depth` hops along outgoing relation edges.
 * Returns every reached entity (seed included) and every traversed relation,
 * both without duplicates regardless of how many paths lead to the same node.
 */
export function queryGraph(seedId: string, depth: number): { entities: Entity[]; relations: Relation[] } {
  const seenEntityIds = new Set<string>([seedId]);
  const seenRelKeys   = new Set<string>();
  const entities: Entity[]    = [];
  const relations: Relation[] = [];

  const seed = entityById.get(seedId);
  if (seed) entities.push(seed);

  let frontier = [seedId];
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const rel of adjacency.get(id) ?? []) {
        const key = `${rel.predicate}:${rel.subject_id}:${rel.object_id}`;
        if (!seenRelKeys.has(key)) {
          seenRelKeys.add(key);
          relations.push(rel);
        }
        if (!seenEntityIds.has(rel.object_id)) {
          seenEntityIds.add(rel.object_id);
          const neighbor = entityById.get(rel.object_id);
          if (neighbor) { entities.push(neighbor); next.push(rel.object_id); }
        }
      }
    }
    frontier = next;
  }

  return { entities, relations };
}

// ── Tables ────────────────────────────────────────────────────────────────────

/** Lookup by exact id (e.g. "table_7_1") or case-insensitive name substring. */
export function getTable(idOrName: string): Table | null {
  if (tableById.has(idOrName)) return tableById.get(idOrName)!;
  const lower = idOrName.toLowerCase();
  return allTables.find(t => t.name.toLowerCase().includes(lower)) ?? null;
}

// ── Procedures ────────────────────────────────────────────────────────────────

export function getProcedure(id: string): Procedure | null {
  return procedureById.get(id) ?? null;
}

export function listProcedures(filter?: { process?: string }): Procedure[] {
  if (!filter?.process) return allProcedures;
  const p = filter.process.toLowerCase();
  return allProcedures.filter(proc => proc.applies_to_process?.toLowerCase() === p);
}

// ── Symptoms ──────────────────────────────────────────────────────────────────

export function getSymptom(id: string): Symptom | null {
  return symptomById.get(id) ?? null;
}

export function listSymptoms(filter?: { process?: string }): Symptom[] {
  if (!filter?.process) return allSymptoms;
  const p = filter.process.toLowerCase();
  return allSymptoms.filter(s => {
    const scope = s.process_scope;
    if (scope === "all") return true;
    if (Array.isArray(scope)) return scope.some(x => x.toLowerCase() === p);
    return String(scope).toLowerCase() === p;
  });
}

// ── Diagrams ──────────────────────────────────────────────────────────────────

/** Returns the diagram and the first region whose label contains regionLabel (case-insensitive). */
export function surfaceRegion(
  diagramId: string,
  regionLabel?: string,
): { diagram: Diagram; region: DiagramRegion | null } | null {
  const diagram = diagramById.get(diagramId);
  if (!diagram) return null;
  const region = regionLabel
    ? (diagram.regions.find(r => r.label.toLowerCase().includes(regionLabel.toLowerCase())) ?? null)
    : null;
  return { diagram, region };
}

/** All diagrams sorted by salience descending; optionally filtered to a single page. */
export function rankDiagramsBySalience(filter?: { page?: number }): Diagram[] {
  const pool = filter?.page !== undefined
    ? allDiagrams.filter(d => d.page === filter.page)
    : allDiagrams;
  return [...pool].sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));
}

// ── Critical Facts ────────────────────────────────────────────────────────────

/** Filter by exact process scope and/or case-insensitive substring in the claim text. */
export function searchCriticalFacts(query: { processScope?: string; substring?: string }): CriticalFact[] {
  let results = allFacts;
  if (query.processScope) {
    const p = query.processScope.toLowerCase();
    results = results.filter(f => f.process_scope?.toLowerCase() === p);
  }
  if (query.substring) {
    const sub = query.substring.toLowerCase();
    results = results.filter(f => f.claim.toLowerCase().includes(sub));
  }
  return results;
}

// ── Canonical Setups ──────────────────────────────────────────────────────────

/**
 * Finds the canonical setup for a process + material, picking the closest
 * thickness match when thicknessIn is provided (exact match preferred).
 */
export function getCanonicalSetup(
  process: string,
  material: string,
  thicknessIn?: number,
): CanonicalSetup | null {
  const p = process.toLowerCase();
  const m = material.toLowerCase();
  const candidates = allSetups.filter(
    s => s.process.toLowerCase() === p && s.material.toLowerCase() === m,
  );
  if (!candidates.length) return null;
  if (thicknessIn === undefined) return candidates[0];

  return candidates.reduce((best, c) => {
    const bestDelta = Math.abs((best.thickness_in ?? 0) - thicknessIn);
    const cDelta    = Math.abs((c.thickness_in ?? 0) - thicknessIn);
    return cDelta < bestDelta ? c : best;
  });
}
