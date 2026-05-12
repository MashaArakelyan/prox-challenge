# Artifact Harness Contract

## Stage 0c — Lock the render_artifact interface

This document defines the contract between the agent's `render_artifact(spec)` tool call
and the iframe renderer in the UI. It is the authoritative spec; the TypeScript interfaces
in `lib/artifact-harness/types.ts` are the machine-readable version.

---

## The core decision: constrained descriptors, not freeform JSX

The agent emits a typed descriptor object. The UI maps descriptor types to pre-built React
components. This is deliberately more constrained than letting the agent generate JSX directly.

**Why constrained templates:**
- Freeform JSX generation is unreliable under token pressure; templates are deterministic.
- Templates can be reviewed and tested offline; arbitrary JSX cannot.
- Templates enforce visual consistency across all artifacts.
- The six templates cover 95%+ of the educational content in a technical manual.

**Why we still include a freeform escape hatch:**
- Edge cases exist (e.g., a specialized chart type the templates don't cover).
- The escape hatch is gated behind a runtime flag and is the explicit fallback of last resort.
- Freeform output is sandboxed in an iframe with no access to parent state.

---

## Widget types

### 1. `parameter_calculator`
A multi-input calculator where the agent supplies inputs, a formula derived from a manual
table, and output annotation (e.g., thermal headroom, recommended range). The user can
adjust inputs and see the output update live.

**When to use:** Any question where the answer is a number computed from user inputs and
a table or formula in the manual. "How long can I run at X amps?" "What's the correct
wire speed for this thickness?" → this widget.

**Agent supplies:** input field labels + units, formula or lookup table as row data,
output label + unit, optional warning thresholds.

### 2. `two_curve_chart`
A Recharts line chart with two series. X-axis is numeric. Y-axis is any numeric measure.
The agent supplies axis labels, units, and both data series as `[x, y]` arrays.

**When to use:** Any relationship between two numeric settings across a range of values.
"Show me the duty cycle curve at 120V vs 240V" → this widget.

### 3. `connection_diagram`
An SVG of a connection panel or interface with labeled regions. The agent supplies
the SVG source (extracted from `data/diagrams.json`) and a highlight spec — which
regions to color, with what color and label, for the current scenario.

**When to use:** Any question about physical connection routing — which port, socket, valve,
or terminal gets which cable or hose, and in what configuration. The agent resolves the
content (e.g., "MIG = gun to positive socket") and the template renders it visually.

### 4. `troubleshooting_flowchart`
A directed graph rendered as a vertical flowchart. Nodes are checks or decisions,
edges are yes/no answers, leaf nodes are recommended actions.

**When to use:** Diagnosing a problem that has a structured decision tree in the manual.
Used when the agent wants to show the full tree overview, not advance one step at a time.

### 5. `interactive_panel`
An SVG of any machine control surface with elements that can be highlighted or animated.
The agent supplies the SVG source (from `data/diagrams.json`), a list of element IDs to
highlight (mapped to recommended settings), and optional animation spec (e.g., "dial
rotates to 140A position"). User can click elements to get narration from the agent.

**When to use:** Configure mode, or any question whose answer is a physical setting on the
machine's control surface. The agent pre-fills the recommended configuration visually.

### 6. `comparison_table`
A styled HTML table with sortable columns and optional row highlighting.
Rows can carry a `highlight: boolean` to visually emphasize specific cells.

**When to use:** Comparing specs across modes, material compatibility, wire selection,
any tabular data from the manual.

---

## Descriptor shape (summary)

```typescript
type ArtifactSpec =
  | ParameterCalculatorSpec
  | TwoCurveChartSpec
  | ConnectionDiagramSpec
  | TroubleshootingFlowchartSpec
  | InteractivePanelSpec
  | ComparisonTableSpec
  | CustomSpec
```

Full TypeScript interfaces are in `lib/artifact-harness/types.ts`.

The agent always emits the `type` field first so the renderer can fail fast on unknown types.
All six template type names are product-agnostic. The agent is responsible for supplying
product-specific content (SVG sources from diagrams.json, table data from tables.json);
the templates are responsible for rendering it.

---

## Freeform escape hatch

```typescript
interface CustomSpec {
  type: "custom"
  jsx: string           // valid JSX string; must have a default export
  imports: ImportRef[]  // limited to the allowlist below
}

interface ImportRef {
  module: "react" | "recharts" | "lucide-react"
  names: string[]       // named exports to destructure
}
```

**Allowlist rationale:**
- `react` — required for JSX compilation
- `recharts` — covers all charting needs; already a project dependency
- `lucide-react` — icon set; already a project dependency

Anything outside this list (e.g., `d3`, `three`, custom hooks) is rejected by the renderer
with error code `IMPORT_NOT_ALLOWED`.

**Compilation:** Babel standalone compiles the JSX string in the browser.
The component is mounted inside a sandboxed iframe with `sandbox="allow-scripts"` and
no access to the parent page's DOM, cookies, or localStorage.

---

## Self-correction protocol

If the iframe renderer encounters a compile or runtime error, it posts a message to the parent:

```typescript
{
  type: "ARTIFACT_ERROR",
  artifactId: string,
  error: {
    code: "COMPILE_ERROR" | "RUNTIME_ERROR" | "IMPORT_NOT_ALLOWED" | "UNKNOWN_TYPE",
    message: string
  }
}
```

The parent chat component catches this and appends it to the agent's next tool result as:

```
[Artifact render failed: <error.code> — <error.message>. Retry with a corrected spec.]
```

The agent retries once. If it fails twice, the chat falls back to a plain text response
and logs the failure for debugging. The user sees: "I couldn't render the interactive view —
here's the information in text form instead."

---

## Agent instructions for render_artifact

The agent's system prompt instructs it:

1. Always prefer a constrained template over the custom escape hatch.
2. For `custom`, start the JSX with `export default function Widget() {` and end with `}`.
3. Never import from modules outside the allowlist.
4. If you're unsure which template fits, prefer `comparison_table` — it degrades gracefully.
5. Emit `render_artifact` early in the response (before prose), so the panel loads while
   the chat response streams in.

---

## Rendering pipeline (implementation notes for Stage 4)

```
agent emits render_artifact(spec)
  → API route validates spec shape against ArtifactSpec union
  → passes spec to <ArtifactPanel> via server-sent event
  → ArtifactPanel dispatches to the matching widget component
      (for "custom": compiles with Babel, mounts in sandboxed iframe)
  → iframe posts ARTIFACT_READY or ARTIFACT_ERROR
  → on error: chat appends error message for agent retry
```

The ArtifactPanel is always rendered; it shows a spinner until the first spec arrives.
Multiple artifacts can be emitted in one conversation turn; the panel stacks them vertically.
