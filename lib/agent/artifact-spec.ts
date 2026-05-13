// Re-exports the canonical types and provides runtime validation guards.
// Import types from here in agent code; import from lib/artifact-harness/types.ts in UI code.

export type {
  ArtifactSpec, ArtifactKind, TemplateName, TemplateArtifact,
  ImageArtifact, Annotation,
  ReactArtifact, HtmlArtifact, SvgArtifact, MermaidArtifact,
  TwoCurveChartData, ComparisonTableData, ParameterCalculatorData,
  ConnectionDiagramData, InteractivePanelData, TroubleshootingFlowchartData,
  DataSeries, DataPoint, ImportRef,
} from "../artifact-harness/types.js";

export { ARTIFACT_KINDS, TEMPLATE_NAMES } from "../artifact-harness/types.js";
import { ARTIFACT_KINDS, TEMPLATE_NAMES } from "../artifact-harness/types.js";
import type { ArtifactSpec, ArtifactKind, TemplateName } from "../artifact-harness/types.js";

// ── Validation guards ─────────────────────────────────────────────────────────

function isString(v: unknown): v is string { return typeof v === "string"; }
function isNumber(v: unknown): v is number { return typeof v === "number" && isFinite(v); }
function isArray(v: unknown): v is unknown[] { return Array.isArray(v); }
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string | null {
  return isString(obj[key]) ? obj[key] : null;
}

function err(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function ok(spec: ArtifactSpec): { ok: true; spec: ArtifactSpec } { return { ok: true, spec }; }

// ── Template data validators ──────────────────────────────────────────────────

function validateTwoCurveChart(data: unknown): string | null {
  if (!isObject(data)) return "two_curve_chart data must be an object";
  // data.title is optional — the outer artifact title serves as the panel header.
  if (!isObject(data.xAxis) || !isString((data.xAxis as Record<string,unknown>).label))
    return "two_curve_chart data.xAxis.label is required";
  if (!isObject(data.yAxis) || !isString((data.yAxis as Record<string,unknown>).label))
    return "two_curve_chart data.yAxis.label is required";
  if (!isArray(data.series) || data.series.length < 2)
    return "two_curve_chart data.series must be an array of at least 2 series";
  for (const s of data.series as unknown[]) {
    if (!isObject(s) || !isString((s as Record<string,unknown>).label))
      return "each series must have a label";
    if (!isArray((s as Record<string,unknown>).points))
      return "each series must have a points array";
  }
  return null;
}

function validateComparisonTable(data: unknown): string | null {
  if (!isObject(data)) return "comparison_table data must be an object";
  // data.title is optional — the outer artifact title is used as the panel title.
  // columns: accept string[] (agent shorthand) or ComparisonTableColumn[] ({key, label}).
  if (!isArray(data.columns) || data.columns.length === 0) return "comparison_table data.columns is required";
  // rows: accept string[][] (agent shorthand) or ComparisonTableRow[] ({cells: {}, highlight?}).
  if (!isArray(data.rows)) return "comparison_table data.rows is required";
  return null;
}

function validateParameterCalculator(data: unknown): string | null {
  if (!isObject(data)) return "parameter_calculator data must be an object";
  // data.title is optional.
  if (!isArray(data.inputs) || data.inputs.length === 0)
    return "parameter_calculator data.inputs is required and must be non-empty";
  if (!isString(data.formula)) return "parameter_calculator data.formula is required";
  if (!isArray(data.outputs) || data.outputs.length === 0)
    return "parameter_calculator data.outputs is required and must be non-empty";
  for (const inp of data.inputs as unknown[]) {
    if (!isObject(inp)) return "each input must be an object";
    const i = inp as Record<string, unknown>;
    if (!isString(i.id) || !isString(i.label))
      return "each input requires id and label";
    // Range inputs require min/max/default; select inputs provide options instead.
    const hasRange = isNumber(i.min) && isNumber(i.max);
    const hasOptions = isArray(i.options) && (i.options as unknown[]).length > 0;
    if (!hasRange && !hasOptions)
      return `input "${String(i.id)}" must have either numeric min+max or an options array`;
  }
  return null;
}

const VALID_SOCKETS = ["positive", "negative", "gas", "wire_feeder"] as const;

function validateConnectionDiagram(data: unknown): string | null {
  if (!isObject(data)) return "connection_diagram data must be an object";
  if (!isString(data.title)) return "connection_diagram data.title is required";
  if (data.chassisRef !== undefined && !isString(data.chassisRef))
    return "connection_diagram data.chassisRef must be a string if present";
  if (!isArray(data.cables) || data.cables.length === 0)
    return "connection_diagram data.cables is required and non-empty";
  for (const c of data.cables as unknown[]) {
    if (!isObject(c)) return "each cable must be an object";
    const cable = c as Record<string, unknown>;
    if (!isString(cable.fromSocket))
      return "cable.fromSocket is required";
    if (!(VALID_SOCKETS as readonly string[]).includes(cable.fromSocket))
      return `cable.fromSocket must be one of: ${VALID_SOCKETS.join(", ")}`;
    if (!isString(cable.toLabel))
      return "cable.toLabel is required";
  }
  return null;
}

function validateInteractivePanel(data: unknown): string | null {
  if (!isObject(data)) return "interactive_panel data must be an object";
  if (!isString(data.title)) return "interactive_panel data.title is required";
  if (!isString(data.wireOrElectrode))
    return "interactive_panel data.wireOrElectrode is required";
  if (!isArray(data.controls) || data.controls.length === 0)
    return "interactive_panel data.controls is required and non-empty";
  for (const c of data.controls as unknown[]) {
    if (!isObject(c)) return "each control must be an object";
    const ctrl = c as Record<string, unknown>;
    if (!isString(ctrl.id) || !isString(ctrl.label))
      return "each control must have id and label";
    if (!isArray(ctrl.options) || (ctrl.options as unknown[]).length === 0)
      return "each control must have a non-empty options array";
  }
  return null;
}

function validateTroubleshootingFlowchart(data: unknown): string | null {
  if (!isObject(data)) return "troubleshooting_flowchart data must be an object";
  if (!isString(data.title)) return "troubleshooting_flowchart data.title is required";
  if (!isArray(data.nodes) || data.nodes.length === 0)
    return "troubleshooting_flowchart data.nodes is required";
  if (!isArray(data.edges)) return "troubleshooting_flowchart data.edges must be an array";
  return null;
}

function validateAnnotations(annotations: unknown): string | null {
  if (annotations === undefined) return null;
  if (!isArray(annotations)) return "annotations must be an array if present";
  for (const a of annotations as unknown[]) {
    if (!isObject(a)) return "each annotation must be an object";
    const ann = a as Record<string, unknown>;
    if (typeof ann.number !== "number") return "annotation.number must be a number";
    if (typeof ann.x !== "number" || ann.x < 0 || ann.x > 1) return "annotation.x must be 0–1";
    if (typeof ann.y !== "number" || ann.y < 0 || ann.y > 1) return "annotation.y must be 0–1";
    if (!isString(ann.label)) return "annotation.label must be a string";
  }
  return null;
}

function validateImage(raw: Record<string, unknown>): string | null {
  if (!isString(raw.src)) return "image artifact requires src: string (URL to the image)";
  if (raw.annotations !== undefined) {
    const err = validateAnnotations(raw.annotations);
    if (err) return err;
  }
  return null;
}

const templateValidators: Record<TemplateName, (d: unknown) => string | null> = {
  two_curve_chart:           validateTwoCurveChart,
  comparison_table:          validateComparisonTable,
  parameter_calculator:      validateParameterCalculator,
  connection_diagram:        validateConnectionDiagram,
  interactive_panel:         validateInteractivePanel,
  troubleshooting_flowchart: validateTroubleshootingFlowchart,
};

// ── Top-level validation entry point ─────────────────────────────────────────

type ValidationResult = { ok: true; spec: ArtifactSpec } | { ok: false; error: string };

export function validateArtifactSpec(raw: unknown): ValidationResult {
  if (!isObject(raw)) return err("artifact spec must be an object");

  const kind = raw.kind;
  if (!ARTIFACT_KINDS.includes(kind as ArtifactKind))
    return err(`kind must be one of: ${ARTIFACT_KINDS.join(", ")}; got "${String(kind)}"`);

  const title = requireString(raw, "title");
  if (!title) return err("title is required");

  switch (kind as ArtifactKind) {
    case "template": {
      const template = raw.template;
      if (!TEMPLATE_NAMES.includes(template as TemplateName))
        return err(`template must be one of: ${TEMPLATE_NAMES.join(", ")}; got "${String(template)}"`);
      const dataErr = templateValidators[template as TemplateName](raw.data);
      if (dataErr) return err(dataErr);
      return ok(raw as unknown as ArtifactSpec);
    }

    case "image": {
      const imageErr = validateImage(raw);
      if (imageErr) return err(imageErr);
      return ok(raw as unknown as ArtifactSpec);
    }

    case "react": {
      if (!isString(raw.code)) return err("react artifact requires code: string (JSX with default export)");
      return ok(raw as unknown as ArtifactSpec);
    }

    case "html": {
      if (!isString(raw.content)) return err("html artifact requires content: string");
      return ok(raw as unknown as ArtifactSpec);
    }

    case "svg": {
      if (!isString(raw.content)) return err("svg artifact requires content: string (SVG markup)");
      return ok(raw as unknown as ArtifactSpec);
    }

    case "mermaid": {
      if (!isString(raw.diagram)) return err("mermaid artifact requires diagram: string (Mermaid DSL)");
      return ok(raw as unknown as ArtifactSpec);
    }
  }
}
