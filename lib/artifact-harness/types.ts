// Machine-readable version of lib/artifact-harness/CONTRACT.md.
// This file is the authoritative TypeScript interface; CONTRACT.md is the human-readable spec.

// ── Import allowlist (for react and custom kinds) ─────────────────────────────

export type AllowedModule = "react" | "recharts" | "lucide-react";

export interface ImportRef {
  module: AllowedModule;
  names: string[];  // named exports to destructure
}

// ── Template data shapes ──────────────────────────────────────────────────────

/** A single data point as [x, y]. */
export type DataPoint = [number, number];

export interface DataSeries {
  label: string;
  color?: string;         // hex or CSS color; renderer picks default if omitted
  points: DataPoint[];    // sorted by x ascending
}

export interface TwoCurveChartData {
  title: string;
  description?: string;
  xAxis: { label: string; unit: string };
  yAxis: { label: string; unit: string; min?: number; max?: number };
  series: [DataSeries, DataSeries, ...DataSeries[]];  // 2 or more series
  referenceLines?: Array<{ x?: number; y?: number; label: string; color?: string }>;
  citation?: string;
}

export interface ComparisonTableColumn {
  key: string;
  label: string;
  unit?: string;
  align?: "left" | "right" | "center";
}

export interface ComparisonTableRow {
  cells: Record<string, string | number>;
  highlight?: boolean;  // visually emphasize this row
  note?: string;
}

export interface ComparisonTableData {
  title: string;
  description?: string;
  columns: ComparisonTableColumn[];
  rows: ComparisonTableRow[];
  citation?: string;
}

export interface CalculatorInput {
  id: string;
  label: string;
  unit: string;
  /** For range/slider inputs. Omit when providing options (select input). */
  min?: number;
  max?: number;
  default?: number;
  step?: number;
  /** For select inputs: list of allowed values (string or number). */
  options?: Array<string | number>;
  description?: string;
}

export interface CalculatorOutput {
  id: string;
  label: string;
  unit: string;
  description?: string;
}

export interface CalculatorWarning {
  /** JS expression referencing input ids; truthy → show message */
  condition: string;
  message: string;
  severity: "info" | "warning" | "danger";
}

export interface ParameterCalculatorData {
  title: string;
  description?: string;
  inputs: CalculatorInput[];
  /**
   * JS expression evaluated with input ids in scope → output values as object.
   * Example: "{ rest_minutes: 10 - (duty_pct / 100) * 10 }"
   */
  formula: string;
  outputs: CalculatorOutput[];
  warnings?: CalculatorWarning[];
  citation?: string;
}

export interface ConnectionDiagramCable {
  fromSocket: "positive" | "negative" | "gas" | "wire_feeder";
  toLabel: string;
  color?: string;
}

export interface ConnectionDiagramData {
  title: string;
  subtitle?: string;
  chassisRef?: string;   // chassis id to load (defaults to "omnipro_220")
  cables: ConnectionDiagramCable[];
  notes?: string[];
  citation?: string;
}

export interface ConfiguratorControl {
  id: string;
  label: string;
  options: string[];
  defaultIndex?: number;
}

export interface InteractivePanelData {
  title: string;
  subtitle?: string;
  wireOrElectrode: string;
  controls: ConfiguratorControl[];
  setupNotes?: string[];
  citation?: string;
}

export interface FlowNode {
  id: string;
  label: string;
  type: "start" | "check" | "action" | "end";
  detail?: string;        // expanded text shown on click
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;         // e.g. "yes" | "no" | "proceed"
}

export interface TroubleshootingFlowchartData {
  title: string;
  description?: string;
  symptom?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  citation?: string;
}

export interface Annotation {
  number: number;
  x: number;      // normalized 0-1 (anchor point on the image)
  y: number;      // normalized 0-1
  label: string;  // 1-4 words, pulled from manual's actual phrasing
}

/** Manual page image with optional annotation overlay (orange badges + leader lines). */
export interface ImageArtifact {
  kind: "image";
  title: string;
  src: string;         // URL, e.g. /api/images/8_diagram_8_1.png
  caption?: string;
  citation?: string;
  annotations?: Annotation[];
}

// ── Top-level artifact discriminated union ────────────────────────────────────

/** Template artifacts — preferred; bounded and safe. */
export type TemplateArtifact =
  | { kind: "template"; template: "two_curve_chart";          title: string; data: TwoCurveChartData }
  | { kind: "template"; template: "comparison_table";         title: string; data: ComparisonTableData }
  | { kind: "template"; template: "parameter_calculator";     title: string; data: ParameterCalculatorData }
  | { kind: "template"; template: "connection_diagram";       title: string; data: ConnectionDiagramData }
  | { kind: "template"; template: "interactive_panel";        title: string; data: InteractivePanelData }
  | { kind: "template"; template: "troubleshooting_flowchart"; title: string; data: TroubleshootingFlowchartData };

/** React artifact — genuinely interactive widgets not covered by templates. */
export interface ReactArtifact {
  kind: "react";
  title: string;
  /** JSX string; must have `export default function Widget() { ... }` */
  code: string;
  imports?: ImportRef[];
}

/** HTML artifact — layout-heavy content that isn't a React component. */
export interface HtmlArtifact {
  kind: "html";
  title: string;
  /** Full HTML document or fragment string. */
  content: string;
}

/** SVG artifact — custom diagrams not available as pre-extracted diagram images. */
export interface SvgArtifact {
  kind: "svg";
  title: string;
  /** Complete SVG markup string including <svg> root element. */
  content: string;
  caption?: string;
}

/** Mermaid artifact — flowcharts, decision trees, state machines. */
export interface MermaidArtifact {
  kind: "mermaid";
  title: string;
  /** Mermaid DSL string (without surrounding ```mermaid fences). */
  diagram: string;
  caption?: string;
}

export type ArtifactSpec =
  | TemplateArtifact
  | ImageArtifact
  | ReactArtifact
  | HtmlArtifact
  | SvgArtifact
  | MermaidArtifact;

export const ARTIFACT_KINDS = ["template", "image", "react", "html", "svg", "mermaid"] as const;
export const TEMPLATE_NAMES = [
  "two_curve_chart",
  "comparison_table",
  "parameter_calculator",
  "connection_diagram",
  "interactive_panel",
  "troubleshooting_flowchart",
] as const;

export type ArtifactKind   = typeof ARTIFACT_KINDS[number];
export type TemplateName   = typeof TEMPLATE_NAMES[number];
