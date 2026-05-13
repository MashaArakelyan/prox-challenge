import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { validateArtifactSpec, ARTIFACT_KINDS, TEMPLATE_NAMES } from "../artifact-spec.js";

export const definition: Tool = {
  name: "render_artifact",
  description:
    "Emit a visual artifact — a chart, table, diagram, calculator, or interactive widget. " +
    "Call this BEFORE your prose response so the panel loads while the text streams in. " +
    "The artifact appears in the right-side panel; your text response is the narration. " +
    "\n\n" +
    "KIND SELECTION — prefer in this order:\n" +
    "1. template (PREFERRED — safe, bounded, renders reliably):\n" +
    "   • two_curve_chart — any two numeric series over a shared x-axis (duty cycle curves, current ranges)\n" +
    "   • comparison_table — tabular spec comparison across modes, voltages, wire types\n" +
    "   • parameter_calculator — live calculator where user adjusts inputs and sees updated output\n" +
    "   • connection_diagram — cable/socket routing diagram with highlighted regions\n" +
    "   • interactive_panel — machine control surface with highlighted recommended settings\n" +
    "   • troubleshooting_flowchart — yes/no decision tree for diagnosing a symptom\n" +
    "2. image — manual page diagram with annotation overlay (orange numbered badges + leader lines). " +
    "   Use after calling surface_region to show the image with annotations. " +
    "   Required: src (use imageUrl from surface_region result). " +
    "   Optional: annotations array [{number, x, y, label}] using annotationX/annotationY from allRegions.\n" +
    "3. svg — custom vector diagram when no pre-extracted diagram covers the question\n" +
    "4. react — genuinely interactive widget not covered by any template (custom calculators, configurators)\n" +
    "5. html — layout-heavy content that is not a React component\n" +
    "6. mermaid — flowcharts, state machines, decision trees (text-based; simpler than troubleshooting_flowchart)\n" +
    "\n" +
    "DISCIPLINE: Do NOT emit artifacts for simple factual answers, socket lookups, or anything " +
    "surface_region already handles well. An artifact is warranted when the answer is a relationship " +
    "between variables, an interactive comparison, or a decision process.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: [...ARTIFACT_KINDS],
        description: "Top-level artifact kind.",
      },
      title: {
        type: "string",
        description: "Short title displayed above the artifact in the panel.",
      },
      template: {
        type: "string",
        enum: [...TEMPLATE_NAMES],
        description: "Required when kind='template'. Which template to render.",
      },
      data: {
        type: "object",
        description: "Required when kind='template'. Template-specific data payload. Shape depends on template.",
      },
      code: {
        type: "string",
        description: "Required when kind='react'. JSX string with 'export default function Widget() { ... }'.",
      },
      content: {
        type: "string",
        description: "Required when kind='html' or kind='svg'. Full HTML/SVG markup string.",
      },
      diagram: {
        type: "string",
        description: "Required when kind='mermaid'. Mermaid DSL (no surrounding fences).",
      },
      src: {
        type: "string",
        description: "Required when kind='image'. URL to the image (use imageUrl from surface_region result).",
      },
      annotations: {
        type: "array",
        description: "Optional for kind='image'. Array of {number, x, y, label} annotations to overlay on the image. Use annotationX/annotationY values from surface_region allRegions.",
        items: {
          type: "object",
          properties: {
            number: { type: "number" },
            x: { type: "number", description: "Normalized 0-1 horizontal position" },
            y: { type: "number", description: "Normalized 0-1 vertical position" },
            label: { type: "string", description: "1-4 words" },
          },
          required: ["number", "x", "y", "label"],
        },
      },
      caption: {
        type: "string",
        description: "Optional caption shown below svg, mermaid, or image artifacts.",
      },
      imports: {
        type: "array",
        description: "Optional import declarations for kind='react'. Allowed modules: react, recharts, lucide-react.",
        items: {
          type: "object",
          properties: {
            module: { type: "string", enum: ["react", "recharts", "lucide-react"] },
            names: { type: "array", items: { type: "string" } },
          },
          required: ["module", "names"],
        },
      },
    },
    required: ["kind", "title"],
  },
};

export function handle(input: unknown): string {
  const result = validateArtifactSpec(input);
  if (!result.ok) {
    return JSON.stringify({
      accepted: false,
      error: result.error,
      hint: "Fix the spec and retry. Check that 'kind' is one of: template, react, html, svg, mermaid. " +
            "For template kind, 'template' must name one of the six templates and 'data' must match its schema.",
    });
  }

  // Accepted — return the validated spec so the UI can render it.
  // In Stage 4 this goes to the ArtifactPanel via server-sent event.
  return JSON.stringify({ accepted: true, spec: result.spec });
}
