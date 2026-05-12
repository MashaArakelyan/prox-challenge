// Loads all JSON stores once at module init and exposes typed indexed maps.
// The graph is small (≤500 entities) — no lazy loading needed.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Entity, Relation, Table, Diagram, Procedure, Symptom, CriticalFact, CanonicalSetup } from "./types.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), "utf8")) as T;
}

// ── Raw arrays ────────────────────────────────────────────────────────────────
export const allEntities   = load<Entity[]>("entities.json");
export const allRelations  = load<Relation[]>("relations.json");
export const allTables     = load<Table[]>("tables.json");
export const allDiagrams   = load<Diagram[]>("diagrams.json");
export const allProcedures = load<Procedure[]>("procedures.json");
export const allSymptoms   = load<{ symptoms: Symptom[] }>("diagnostic_trees.json").symptoms;
export const allFacts      = load<CriticalFact[]>("critical_facts.json");
export const allSetups     = load<CanonicalSetup[]>("canonical_setups.json");

// ── Indexed maps (built once) ─────────────────────────────────────────────────
export const entityById    = new Map<string, Entity>(allEntities.map(e => [e.id, e]));
export const tableById     = new Map<string, Table>(allTables.map(t => [t.id, t]));
export const procedureById = new Map<string, Procedure>(allProcedures.map(p => [p.id, p]));
export const symptomById   = new Map<string, Symptom>(allSymptoms.map(s => [s.id, s]));
export const diagramById   = new Map<string, Diagram>(allDiagrams.map(d => [d.id, d]));

export const entityByType  = new Map<string, Entity[]>();
for (const e of allEntities) {
  const bucket = entityByType.get(e.type) ?? [];
  bucket.push(e);
  entityByType.set(e.type, bucket);
}

// Adjacency lists for bidirectional graph traversal.
export const outgoing = new Map<string, Relation[]>(); // subject_id → relations leaving that node
export const incoming = new Map<string, Relation[]>(); // object_id  → relations arriving at that node

for (const r of allRelations) {
  const out = outgoing.get(r.subject_id) ?? [];
  out.push(r);
  outgoing.set(r.subject_id, out);

  const inc = incoming.get(r.object_id) ?? [];
  inc.push(r);
  incoming.set(r.object_id, inc);
}

// Backward-compat alias — existing code that imports `adjacency` still works.
export const adjacency = outgoing;
