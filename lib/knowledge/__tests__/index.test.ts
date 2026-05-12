// Unit tests for the knowledge query layer.
// Uses Node's built-in test runner (node:test) via tsx.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getEntity, getEntitiesByType, queryGraph,
  getTable, getProcedure, listProcedures,
  getSymptom, listSymptoms,
  surfaceRegion, rankDiagramsBySalience,
  searchCriticalFacts, getCanonicalSetup,
} from "../index.js";
// allRelations is store-internal but needed to derive a guaranteed seed→neighbor pair.
import { allRelations } from "../store.js";

// ── Entity lookup ─────────────────────────────────────────────────────────────

test("getEntity returns a known entity", () => {
  const e = getEntity("product_specification_omnipro_220");
  assert.ok(e !== null, "product_specification_omnipro_220 must exist");
  assert.equal(e.type, "product_specification");
  assert.ok(e.salience > 0, "salience should be stamped");
});

test("getEntity returns null for an unknown id", () => {
  assert.equal(getEntity("definitely_not_real_xyz"), null);
});

test("getEntitiesByType returns only entities of the requested type", () => {
  const processes = getEntitiesByType("welding_process");
  assert.ok(processes.length > 0, "welding_process entities must exist");
  assert.ok(processes.every(e => e.type === "welding_process"));
});

// ── Graph traversal ───────────────────────────────────────────────────────────

test("queryGraph: seed entity always appears in result", () => {
  // welding_process_mig has 11 outgoing edges — reliable seed.
  const { entities } = queryGraph("welding_process_mig", 1);
  assert.ok(entities.some(e => e.id === "welding_process_mig"), "seed must be present");
});

test("queryGraph: no duplicate entities at any depth", () => {
  const { entities } = queryGraph("welding_process_mig", 2);
  const ids = entities.map(e => e.id);
  assert.equal(ids.length, new Set(ids).size, "each entity should appear exactly once");
});

test("queryGraph: reaches expected neighbor via known relation", () => {
  // Known from extraction: safety_guideline_general_safety --mitigates_hazard--> failure_mode_electric_shock
  const { entities } = queryGraph("safety_guideline_general_safety", 1);
  const ids = entities.map(e => e.id);
  assert.ok(ids.includes("safety_guideline_general_safety"), "seed present");
  assert.ok(ids.includes("failure_mode_electric_shock"),
    "failure_mode_electric_shock must be reachable at depth 1");
});

test("queryGraph: depth 2 reaches at least as many nodes as depth 1", () => {
  const d1 = queryGraph("welding_process_mig", 1);
  const d2 = queryGraph("welding_process_mig", 2);
  assert.ok(d2.entities.length  >= d1.entities.length,  "depth-2 entities ≥ depth-1");
  assert.ok(d2.relations.length >= d1.relations.length, "depth-2 relations ≥ depth-1");
});

test("queryGraph: uses first known relation to reach its object (data-driven)", () => {
  // Derive the seed and expected neighbor from the actual relation store —
  // this test stays correct even if specific IDs change between ingest runs.
  assert.ok(allRelations.length > 0, "need at least one relation");
  const rel = allRelations[0];
  const seed = getEntity(rel.subject_id);
  if (!seed) return; // subject entity was pruned by dedup — harmless skip

  const { entities } = queryGraph(rel.subject_id, 1);
  const ids = entities.map(e => e.id);
  assert.ok(ids.includes(rel.object_id),
    `object "${rel.object_id}" of "${rel.predicate}" not reached at depth 1`);
});

// ── Tables ────────────────────────────────────────────────────────────────────

test("getTable by exact id returns the MIG spec table", () => {
  const t = getTable("table_7_1");
  assert.ok(t !== null, "table_7_1 (MIG Specifications) must exist after page-7 rescue");
  assert.ok(t.columns.includes("120VAC / 60Hz"), "should have voltage columns");
  const dcRow = t.rows.find(r => String(r["Specification"]).includes("Duty Cycle"));
  assert.ok(dcRow !== undefined, "duty cycle row must be present");
});

test("getTable by name substring is case-insensitive", () => {
  const t = getTable("mig specifications");
  assert.ok(t !== null);
  assert.equal(t.id, "table_7_1");
});

// ── Salience-ranked diagrams ──────────────────────────────────────────────────

test("rankDiagramsBySalience returns all diagrams in descending salience order", () => {
  const diagrams = rankDiagramsBySalience();
  assert.ok(diagrams.length > 0);
  for (let i = 0; i < diagrams.length - 1; i++) {
    assert.ok(
      (diagrams[i].salience ?? 0) >= (diagrams[i + 1].salience ?? 0),
      `order broken at [${i}]: ${diagrams[i].salience} < ${diagrams[i + 1].salience}`,
    );
  }
});

test("rankDiagramsBySalience page filter returns only diagrams from that page", () => {
  const diagrams = rankDiagramsBySalience({ page: 1 });
  assert.ok(diagrams.length > 0, "page 1 has the product cover diagram");
  assert.ok(diagrams.every(d => d.page === 1));
  // Must still be sorted
  for (let i = 0; i < diagrams.length - 1; i++) {
    assert.ok((diagrams[i].salience ?? 0) >= (diagrams[i + 1].salience ?? 0));
  }
});

// ── Critical facts ────────────────────────────────────────────────────────────

test("searchCriticalFacts by MIG scope returns only MIG-scoped facts", () => {
  const facts = searchCriticalFacts({ processScope: "MIG" });
  assert.ok(facts.length > 0, "MIG facts must exist");
  assert.ok(facts.every(f => f.process_scope === "MIG"));
});

test("searchCriticalFacts MIG scope includes duty cycle facts (confirms page 7 tables are reachable)", () => {
  const facts = searchCriticalFacts({ processScope: "MIG" });
  const dcFacts = facts.filter(f => f.claim.toLowerCase().includes("duty cycle"));
  assert.ok(dcFacts.length > 0, "at least one MIG duty cycle fact must be in critical_facts.json");
});

test("searchCriticalFacts substring filter narrows to matching claims only", () => {
  const narrow = searchCriticalFacts({ substring: "duty cycle" });
  assert.ok(narrow.length > 0);
  assert.ok(narrow.every(f => f.claim.toLowerCase().includes("duty cycle")));
});

test("searchCriticalFacts combined filters are ANDed", () => {
  const facts = searchCriticalFacts({ processScope: "MIG", substring: "duty cycle" });
  assert.ok(facts.every(f => f.process_scope === "MIG" && f.claim.toLowerCase().includes("duty cycle")));
});

// ── Canonical setups ──────────────────────────────────────────────────────────

test("getCanonicalSetup returns a setup for MIG mild_steel", () => {
  const setup = getCanonicalSetup("MIG", "mild_steel");
  assert.ok(setup !== null, "MIG mild_steel canonical setup must exist");
  assert.equal(setup.process, "MIG");
  assert.equal(setup.material, "mild_steel");
});

test("getCanonicalSetup picks closest thickness to 1/8 inch (0.125)", () => {
  const setup = getCanonicalSetup("MIG", "mild_steel", 0.125);
  assert.ok(setup !== null);
  // Confirmed setups at 0.125: mig_mild_steel_1_8_120v and mig_mild_steel_1_8_240v
  assert.equal(setup.thickness_in, 0.125,
    "should pick the exact 1/8-inch setup, not a thicker one");
  assert.equal(setup.material, "mild_steel");
});

test("getCanonicalSetup returns null for an unsupported process", () => {
  assert.equal(getCanonicalSetup("Plasma", "mild_steel"), null);
});

// ── Procedures & Symptoms (smoke tests) ──────────────────────────────────────

test("listProcedures with no filter returns all procedures", () => {
  const all = listProcedures();
  assert.ok(all.length > 0);
});

test("listProcedures filtered by process returns only that process", () => {
  const mig = listProcedures({ process: "MIG" });
  assert.ok(mig.every(p => p.applies_to_process?.toLowerCase() === "mig"));
});

test("listSymptoms with no filter returns all symptoms", () => {
  const all = listSymptoms();
  assert.ok(all.length >= 35, "should have at least 35 symptoms after diagnostic rescue");
});

test("surfaceRegion returns null for unknown diagram id", () => {
  assert.equal(surfaceRegion("diagram_does_not_exist"), null);
});

test("surfaceRegion returns diagram for known id", () => {
  const result = surfaceRegion("diagram_1_1");
  assert.ok(result !== null);
  assert.equal(result.diagram.id, "diagram_1_1");
  assert.equal(result.region, null); // no label filter
});

// ── Bidirectional traversal & predicate filtering ─────────────────────────────

test("direction: 'both' reaches strictly more entities than direction: 'out' from a node with incoming edges", () => {
  // Find programmatically: an entity that appears as both subject AND object
  // so it has both outgoing and incoming edges to traverse.
  const subjectSet = new Set(allRelations.map(r => r.subject_id));
  const biId = allRelations.map(r => r.object_id).find(id => subjectSet.has(id));
  assert.ok(biId, "there must be an entity that appears as both subject and object");

  const outOnly = queryGraph(biId, 1, { direction: "out" });
  const both    = queryGraph(biId, 1, { direction: "both" });

  // "both" must include everything "out" found
  const outIds  = new Set(outOnly.entities.map(e => e.id));
  const bothIds = new Set(both.entities.map(e => e.id));
  for (const id of outIds) assert.ok(bothIds.has(id), `direction:'both' dropped entity ${id}`);

  // "both" must reach strictly more because there are incoming edges to follow
  assert.ok(
    both.entities.length > outOnly.entities.length,
    `direction:'both' (${both.entities.length}) should exceed direction:'out' (${outOnly.entities.length})`,
  );
});

test("direction: 'in' reaches incoming neighbor; direction: 'out' does not", () => {
  // Known relation: safety_guideline_general_safety --mitigates_hazard--> failure_mode_electric_shock
  // Seed: failure_mode_electric_shock
  //   direction:"in"  → should walk the reverse edge → reach safety_guideline_general_safety
  //   direction:"out" → no outgoing edges from electric_shock to that node → must NOT reach it
  const withIn  = queryGraph("failure_mode_electric_shock", 1, { direction: "in" });
  const withOut = queryGraph("failure_mode_electric_shock", 1, { direction: "out" });

  assert.ok(
    withIn.entities.some(e => e.id === "safety_guideline_general_safety"),
    "direction:'in' must reach safety_guideline_general_safety via the reverse mitigates_hazard edge",
  );
  assert.ok(
    !withOut.entities.some(e => e.id === "safety_guideline_general_safety"),
    "direction:'out' must NOT reach safety_guideline_general_safety",
  );
});

test("predicates allow-list returns only relations matching that predicate", () => {
  // Find the most common predicate programmatically so the test survives ingest changes.
  const counts = new Map<string, number>();
  for (const r of allRelations) counts.set(r.predicate, (counts.get(r.predicate) ?? 0) + 1);
  const [topPredicate] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  // Seed from the subject of a known relation with this predicate — guarantees ≥1 result.
  const seedRel = allRelations.find(r => r.predicate === topPredicate);
  assert.ok(seedRel, `must find a relation with predicate "${topPredicate}"`);

  const { relations } = queryGraph(seedRel.subject_id, 1, { predicates: [topPredicate] });

  assert.ok(relations.every(r => r.predicate === topPredicate),
    `every returned relation must be "${topPredicate}"`);
  assert.ok(relations.length > 0,
    `"${topPredicate}" must appear when seeded from its own subject`);
});

test("predicates: [] (empty allow-list) returns only the seed, zero relations", () => {
  const { entities, relations } = queryGraph("welding_process_mig", 2, { predicates: [] });
  assert.equal(relations.length, 0, "empty predicate set blocks all relations");
  assert.equal(entities.length, 1, "only the seed entity should be present");
  assert.equal(entities[0].id, "welding_process_mig");
});
