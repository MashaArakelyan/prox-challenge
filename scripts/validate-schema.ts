// Validates the JSON output from schema inference against the structural rules in
// prompts/schema-inference.md. Returns an array of error strings; empty = valid.

const VALID_META_ROLES = [
  "operator_concept", "physical_interface", "control_element", "parameter",
  "procedure", "consumable_input", "workpiece_material", "failure_mode",
  "specification", "reference_artifact", "other",
] as const;

const REQUIRED_META_ROLES = [
  "failure_mode", "procedure", "physical_interface", "operator_concept",
];

const VALID_SALIENCE = ["high", "medium", "low"];
const VALID_ATTR_TYPES = ["string", "number", "boolean", "enum", "range"];

function trigramSimilarity(a: string, b: string): number {
  const trigrams = (s: string): Set<string> => {
    const padded = `  ${s.toLowerCase()}  `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const ta = trigrams(a);
  const tb = trigrams(b);
  const intersection = [...ta].filter(t => tb.has(t)).length;
  return intersection / Math.max(ta.size, tb.size, 1);
}

export function validateSchema(schema: unknown): string[] {
  const errors: string[] = [];

  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return ["Schema must be a JSON object"];
  }

  const s = schema as Record<string, unknown>;

  // 1. domain_summary
  if (!s.domain_summary || typeof s.domain_summary !== "string" || !s.domain_summary.trim()) {
    errors.push("MISSING_DOMAIN_SUMMARY: domain_summary must be a non-empty string");
  }

  // 2. entity_types
  if (!Array.isArray(s.entity_types)) {
    errors.push("MISSING_FIELD: entity_types must be an array");
    return errors;
  }

  const types = s.entity_types as Record<string, unknown>[];

  if (types.length < 5)  errors.push(`TOO_FEW_ENTITY_TYPES: got ${types.length}, minimum is 5`);
  if (types.length > 15) errors.push(`TOO_MANY_ENTITY_TYPES: got ${types.length}, maximum is 15`);

  const seenNames = new Set<string>();
  const metaRolesSeen = new Set<string>();

  for (const t of types) {
    const name = typeof t.name === "string" ? t.name : "(unnamed)";

    if (!t.name || typeof t.name !== "string") {
      errors.push(`MISSING_FIELD: entity type missing 'name'`);
      continue;
    }

    const lower = name.toLowerCase();
    if (seenNames.has(lower)) {
      errors.push(`DUPLICATE_ENTITY_TYPE: '${name}' appears more than once (case-insensitive)`);
    }
    seenNames.add(lower);

    if (!t.description || typeof t.description !== "string") {
      errors.push(`MISSING_FIELD: '${name}' missing 'description'`);
    }

    if (!VALID_META_ROLES.includes(t.meta_role as (typeof VALID_META_ROLES)[number])) {
      errors.push(`INVALID_META_ROLE: '${name}' has unknown meta_role '${t.meta_role}'`);
    } else {
      metaRolesSeen.add(t.meta_role as string);
    }

    if (!VALID_SALIENCE.includes(t.salience_hint as string)) {
      errors.push(`MISSING_FIELD: '${name}' has invalid salience_hint '${t.salience_hint}'`);
    }

    if (Array.isArray(t.attributes)) {
      for (const attr of t.attributes as Record<string, unknown>[]) {
        const attrName = typeof attr.name === "string" ? attr.name : "(unnamed)";
        if (!attr.name || !attr.type || attr.required === undefined) {
          errors.push(`MISSING_FIELD: '${name}.${attrName}' missing name/type/required`);
        }
        if (!VALID_ATTR_TYPES.includes(attr.type as string)) {
          errors.push(`MISSING_FIELD: '${name}.${attrName}' has invalid type '${attr.type}'`);
        }
        if (attr.type === "enum" &&
            (!Array.isArray(attr.sample_values) || (attr.sample_values as unknown[]).length === 0)) {
          errors.push(`MISSING_FIELD: '${name}.${attrName}' enum missing sample_values`);
        }
        if (attr.type === "range" &&
            (!attr.expected_unit || typeof attr.expected_unit !== "string")) {
          errors.push(`MISSING_FIELD: '${name}.${attrName}' range missing expected_unit`);
        }
      }
    }
  }

  // Required meta_role coverage
  for (const required of REQUIRED_META_ROLES) {
    if (!metaRolesSeen.has(required)) {
      errors.push(`MISSING_REQUIRED_META_ROLES: no entity type has meta_role '${required}'`);
    }
  }

  // Trigram overlap between descriptions
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const a = types[i], b = types[j];
      if (typeof a.description === "string" && typeof b.description === "string") {
        const sim = trigramSimilarity(a.description, b.description);
        if (sim > 0.6) {
          errors.push(
            `OVERLAPPING_TYPES: '${a.name}' and '${b.name}' description similarity ${sim.toFixed(2)} — merge or clarify boundary`
          );
        }
      }
    }
  }

  // 3. relation_predicates
  if (!Array.isArray(s.relation_predicates)) {
    errors.push("MISSING_FIELD: relation_predicates must be an array");
    return errors;
  }

  const definedNames = new Set(types.map(t => (t.name as string).toLowerCase()));
  const predicates = s.relation_predicates as Record<string, unknown>[];

  for (const p of predicates) {
    const pred = typeof p.predicate === "string" ? p.predicate : "(unnamed)";
    if (typeof p.predicate !== "string" || !/^[a-z][a-z_]+$/.test(p.predicate)) {
      errors.push(`INVALID_PREDICATE_FORMAT: '${pred}' must match /^[a-z][a-z_]+$/`);
    }
    if (!p.subject_type || !definedNames.has((p.subject_type as string).toLowerCase())) {
      errors.push(`UNKNOWN_TYPE_REFERENCE: predicate '${pred}' subject_type '${p.subject_type}' not defined`);
    }
    if (!p.object_type || !definedNames.has((p.object_type as string).toLowerCase())) {
      errors.push(`UNKNOWN_TYPE_REFERENCE: predicate '${pred}' object_type '${p.object_type}' not defined`);
    }
    if (!p.description || typeof p.description !== "string") {
      errors.push(`MISSING_FIELD: predicate '${pred}' missing 'description'`);
    }
  }

  return errors;
}
