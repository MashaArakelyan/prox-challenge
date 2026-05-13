// Eyeball check on representative knowledge-layer queries.
// Run with: npx tsx scripts/spot-check.ts

import {
  getTable, getProcedure, searchCriticalFacts, listSymptoms,
  queryGraph, getCanonicalSetup, rankDiagramsBySalience,
} from "../lib/knowledge/index.js";

console.log("\n=== getTable('table_7_1') — MIG specs ===");
console.log(JSON.stringify(getTable("table_7_1"), null, 2));

console.log("\n=== searchCriticalFacts({ processScope: 'MIG', substring: 'duty cycle' }) ===");
console.log(searchCriticalFacts({ processScope: "MIG", substring: "duty cycle" }));

console.log("\n=== getProcedure('install_wire_spool_p10') ===");
console.log(JSON.stringify(getProcedure("install_wire_spool_p10"), null, 2));

console.log("\n=== listSymptoms() — first 5 (summary) ===");
console.log(listSymptoms().slice(0, 5).map(s => ({ id: s.id, label: s.label, causes: s.causes.length, checks: s.checks.length })));

console.log("\n=== full dump of listSymptoms()[0] ===");
console.log(JSON.stringify(listSymptoms()[0], null, 2));

console.log("\n=== queryGraph('welding_process_mig', 2, { direction: 'both' }) — summary ===");
const g = queryGraph("welding_process_mig", 2, { direction: "both" });
console.log({ entityCount: g.entities.length, relationCount: g.relations.length, entityIds: g.entities.map(e => e.id) });

console.log("\n=== getCanonicalSetup('MIG', 'mild_steel', 0.125) ===");
console.log(JSON.stringify(getCanonicalSetup("MIG", "mild_steel", 0.125), null, 2));

console.log("\n=== rankDiagramsBySalience() — top 10 ===");
console.log(rankDiagramsBySalience().slice(0, 10).map(d => ({ id: d.id, page: d.page, caption: d.caption, salience: d.salience })));
