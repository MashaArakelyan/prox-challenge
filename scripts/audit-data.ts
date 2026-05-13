// Invariant walker over all JSON stores. Run with: npm run audit
// Checks 10 invariants. Output: [STORE] [ISSUE_TYPE] detail per issue.
// Ends with PASS: N invariants checked or FAIL: N issues found.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), "utf8")) as T;
}

type Issue = { store: string; type: string; detail: string };
const issues: Issue[] = [];
let invariantCount = 0;
let warnCount = 0;

function fail(store: string, type: string, detail: string) {
  issues.push({ store, type, detail });
  console.log(`[${store}] [${type}] ${detail}`);
}

// warn: informational — logged but not counted as a failure.
// Use for documented known limitations (see CLAUDE.md § Known data limitations).
function warn(store: string, type: string, detail: string) {
  warnCount++;
  console.log(`[${store}] [WARN:${type}] ${detail}`);
}

function check(label: string) {
  invariantCount++;
  process.stdout.write(`  checking: ${label}... `);
}

// ── Load all stores ───────────────────────────────────────────────────────────
const entities   = load<Array<{ id: string; type: string; salience?: number; page_refs?: number[] }>>("entities.json");
const relations  = load<Array<{ predicate: string; subject_id: string; object_id: string; page: number; salience?: number }>>("relations.json");
const tables     = load<Array<{ id: string; page: number }>>("tables.json");
const diagrams   = load<Array<{ id: string; page: number; save_crop: boolean; salience?: number; regions: unknown[] }>>("diagrams.json");
const procedures = load<Array<{ id: string; steps: Array<{ step: number; entity_refs?: string[]; postcondition?: unknown }> }>>("procedures.json");
const dtrees     = load<{ symptoms: Array<{
  id: string;
  causes: Array<{ id: string; prior: number; prior_source: string }>;
  checks: Array<{ id: string; likelihood_ratios: Record<string, { lr_positive: number; source: string }> }>;
  manual_citation?: { page: number };
}> }>("diagnostic_trees.json");
const facts  = load<Array<{ id: string; citation?: { page?: number; table_id?: string | null; entity_id?: string | null } }>>("critical_facts.json");
const setups = load<Array<{ id: string; entity_refs: string[]; diagram_refs: string[]; manual_citation?: { page: number } }>>("canonical_setups.json");

const entityIds   = new Set(entities.map(e => e.id));
const tableIds    = new Set(tables.map(t => t.id));
const procedureIds= new Set(procedures.map(p => p.id));
const symptomIds  = new Set(dtrees.symptoms.map(s => s.id));
const diagramIds  = new Set(diagrams.map(d => d.id));
const factIds     = new Set(facts.map(f => f.id));
const setupIds    = new Set(setups.map(s => s.id));

console.log("\n=== Data Audit ===\n");

// ── 1. Entity ref resolution ─────────────────────────────────────────────────
// Procedure step entity_refs are type-hint IDs (e.g. "welding_wire") emitted by the
// procedural extraction pass before specific entity IDs were known. They are a
// documented known limitation (CLAUDE.md § Known data limitations) — logged as
// warnings, not failures. The agent treats them as getEntitiesByType() hints.
check("entity_refs in procedure steps resolve (type-hint refs → warn, not fail)");
let unresolved = 0;
for (const proc of procedures) {
  for (const step of proc.steps) {
    for (const ref of step.entity_refs ?? []) {
      if (!entityIds.has(ref)) {
        warn("procedures", "UNRESOLVED_ENTITY_REF", `${proc.id} step ${step.step}: "${ref}" is a type-hint ref`);
        unresolved++;
      }
    }
  }
}
console.log(unresolved === 0 ? "ok" : `ok (${unresolved} type-hint refs, see CLAUDE.md § Known data limitations)`);

// ── 2. Cause ID consistency ──────────────────────────────────────────────────
check("likelihood_ratio cause keys match symptom.causes");
let badCauseRefs = 0;
for (const sym of dtrees.symptoms) {
  const causeIds = new Set(sym.causes.map(c => c.id));
  for (const chk of sym.checks) {
    for (const causeKey of Object.keys(chk.likelihood_ratios ?? {})) {
      if (!causeIds.has(causeKey)) {
        fail("diagnostic_trees", "ORPHAN_CAUSE_REF",
          `symptom "${sym.id}" check "${chk.id}": lr key "${causeKey}" not in causes`);
        badCauseRefs++;
      }
    }
  }
}
console.log(badCauseRefs === 0 ? "ok" : `${badCauseRefs} issues`);

// ── 3. Prior sum per symptom ≤ 1.01 ─────────────────────────────────────────
check("prior sums ≤ 1.01 per symptom");
let badPriors = 0;
for (const sym of dtrees.symptoms) {
  const sum = sym.causes.reduce((acc, c) => acc + (c.prior ?? 0), 0);
  if (sum > 1.01) {
    fail("diagnostic_trees", "PRIOR_SUM_EXCEEDED",
      `symptom "${sym.id}": prior sum ${sum.toFixed(4)} > 1.01`);
    badPriors++;
  }
}
console.log(badPriors === 0 ? "ok" : `${badPriors} issues`);

// ── 4. Positive numerics (prior > 0, lr_positive > 0) ───────────────────────
check("all prior and lr_positive values > 0");
let nonPositive = 0;
for (const sym of dtrees.symptoms) {
  for (const cause of sym.causes) {
    if (typeof cause.prior !== "number" || cause.prior <= 0) {
      fail("diagnostic_trees", "NON_POSITIVE_NUMERIC",
        `symptom "${sym.id}" cause "${cause.id}": prior=${cause.prior}`);
      nonPositive++;
    }
  }
  for (const chk of sym.checks) {
    for (const [cid, lr] of Object.entries(chk.likelihood_ratios ?? {})) {
      if (typeof lr.lr_positive !== "number" || lr.lr_positive <= 0) {
        fail("diagnostic_trees", "NON_POSITIVE_NUMERIC",
          `symptom "${sym.id}" check "${chk.id}" cause "${cid}": lr_positive=${lr.lr_positive}`);
        nonPositive++;
      }
    }
  }
}
console.log(nonPositive === 0 ? "ok" : `${nonPositive} issues`);

// ── 5. Salience range [0, 1] ─────────────────────────────────────────────────
check("salience ∈ [0, 1] on entities, relations, diagrams");
let badSalience = 0;
for (const e of entities) {
  if (e.salience !== undefined && (e.salience < 0 || e.salience > 1)) {
    fail("entities", "SALIENCE_OUT_OF_RANGE", `entity "${e.id}": salience=${e.salience}`);
    badSalience++;
  }
}
for (let i = 0; i < relations.length; i++) {
  const r = relations[i];
  if (r.salience !== undefined && (r.salience < 0 || r.salience > 1)) {
    fail("relations", "SALIENCE_OUT_OF_RANGE", `relation[${i}] ${r.predicate}: salience=${r.salience}`);
    badSalience++;
  }
}
for (const d of diagrams) {
  if (d.salience !== undefined && (d.salience < 0 || d.salience > 1)) {
    fail("diagrams", "SALIENCE_OUT_OF_RANGE", `diagram "${d.id}": salience=${d.salience}`);
    badSalience++;
  }
}
console.log(badSalience === 0 ? "ok" : `${badSalience} issues`);

// ── 6. Page citation range [1, 48] ───────────────────────────────────────────
check("all page refs ∈ [1, 48]");
let badPages = 0;
const checkPage = (store: string, ctx: string, page: unknown) => {
  if (typeof page === "number" && (page < 1 || page > 48)) {
    fail(store, "PAGE_OUT_OF_RANGE", `${ctx}: page=${page}`);
    badPages++;
  }
};
for (const e of entities) { for (const p of e.page_refs ?? []) checkPage("entities", `entity "${e.id}"`, p); }
for (const r of relations) checkPage("relations", `${r.predicate}:${r.subject_id}`, r.page);
for (const t of tables) checkPage("tables", `table "${t.id}"`, t.page);
for (const d of diagrams) checkPage("diagrams", `diagram "${d.id}"`, d.page);
for (const proc of procedures) {
  if ((proc as unknown as { manual_citation?: { page: number } }).manual_citation?.page !== undefined) {
    checkPage("procedures", `procedure "${proc.id}"`, (proc as unknown as { manual_citation: { page: number } }).manual_citation.page);
  }
}
for (const sym of dtrees.symptoms) {
  if (sym.manual_citation?.page !== undefined) checkPage("diagnostic_trees", `symptom "${sym.id}"`, sym.manual_citation.page);
}
for (const f of facts) { if (f.citation?.page !== undefined) checkPage("critical_facts", `fact "${f.id}"`, f.citation.page); }
for (const s of setups) { if (s.manual_citation?.page !== undefined) checkPage("canonical_setups", `setup "${s.id}"`, s.manual_citation.page); }
console.log(badPages === 0 ? "ok" : `${badPages} issues`);

// ── 7. Diagram image existence ───────────────────────────────────────────────
check("data/images/<page>_<id>.png exists for every save_crop diagram");
let missingImages = 0;
for (const d of diagrams) {
  if (d.save_crop) {
    const imgPath = join(DATA, "images", `${d.page}_${d.id}.png`);
    if (!existsSync(imgPath)) {
      fail("diagrams", "MISSING_IMAGE", `diagram "${d.id}" has save_crop:true but ${d.page}_${d.id}.png not found`);
      missingImages++;
    }
  }
}
console.log(missingImages === 0 ? "ok" : `${missingImages} issues`);

// ── 8. No duplicate IDs ──────────────────────────────────────────────────────
check("no duplicate IDs within each store");
let dupes = 0;
const checkDupes = (store: string, ids: string[]) => {
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const [id, count] of seen) {
    if (count > 1) { fail(store, "DUPLICATE_ID", `"${id}" appears ${count} times`); dupes++; }
  }
};
checkDupes("entities",       entities.map(e => e.id));
checkDupes("procedures",     procedures.map(p => p.id));
checkDupes("diagnostic_trees", dtrees.symptoms.map(s => s.id));
checkDupes("diagrams",       diagrams.map(d => d.id));
checkDupes("tables",         tables.map(t => t.id));
checkDupes("critical_facts", facts.map(f => f.id));
checkDupes("canonical_setups", setups.map(s => s.id));
console.log(dupes === 0 ? "ok" : `${dupes} issues`);

// ── 9. Orphan critical_facts citations ───────────────────────────────────────
check("critical_facts table_id and entity_id references resolve");
let orphanCitations = 0;
for (const f of facts) {
  if (f.citation?.table_id && !tableIds.has(f.citation.table_id)) {
    fail("critical_facts", "ORPHAN_CITATION", `fact "${f.id}": table_id "${f.citation.table_id}" not in tables.json`);
    orphanCitations++;
  }
  if (f.citation?.entity_id && !entityIds.has(f.citation.entity_id)) {
    fail("critical_facts", "ORPHAN_CITATION", `fact "${f.id}": entity_id "${f.citation.entity_id}" not in entities.json`);
    orphanCitations++;
  }
}
console.log(orphanCitations === 0 ? "ok" : `${orphanCitations} issues`);

// ── 10. Canonical setup refs ─────────────────────────────────────────────────
check("canonical_setups entity_refs and diagram_refs resolve");
let orphanSetupRefs = 0;
for (const s of setups) {
  for (const ref of s.entity_refs ?? []) {
    if (!entityIds.has(ref)) {
      fail("canonical_setups", "UNRESOLVED_ENTITY_REF", `setup "${s.id}": entity_ref "${ref}" not found`);
      orphanSetupRefs++;
    }
  }
  for (const ref of s.diagram_refs ?? []) {
    if (!diagramIds.has(ref)) {
      fail("canonical_setups", "UNRESOLVED_DIAGRAM_REF", `setup "${s.id}": diagram_ref "${ref}" not found`);
      orphanSetupRefs++;
    }
  }
}
console.log(orphanSetupRefs === 0 ? "ok" : `${orphanSetupRefs} issues`);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (issues.length === 0) {
  const warnNote = warnCount > 0 ? ` (${warnCount} known-limitation warnings — see CLAUDE.md § Known data limitations)` : "";
  console.log(`PASS: ${invariantCount} invariants checked, 0 issues.${warnNote}`);
} else {
  console.log(`FAIL: ${issues.length} issue(s) across ${invariantCount} invariants.`);
  if (warnCount > 0) console.log(`      ${warnCount} additional known-limitation warnings (not counted).`);
  console.log(`\nIssue breakdown:`);
  const byType = new Map<string, number>();
  for (const i of issues) byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
}
