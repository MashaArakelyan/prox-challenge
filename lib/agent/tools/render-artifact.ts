import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { validateArtifactSpec } from "../artifact-spec.js";

export const definition: Tool = {
  name: "render_artifact",
  description:
    "Emit a visual artifact into the right-side panel. Call this BEFORE your prose response " +
    "so the panel loads while text streams in. Three kinds:\n\n" +
    "• kind='code' — JSX function expression rendered in an iframe sandbox. Use for structured " +
    "diagrams (connection diagrams, SVG layouts, calculators). Always call get_chassis_metadata " +
    "first for socket/polarity diagrams so geometry is accurate.\n" +
    "• kind='image' — rendered image from generate_image tool. Pass the url returned by that tool. " +
    "Use for internal mechanisms, defect reference photos, isometric scenes.\n" +
    "• kind='manual_page' — manual diagram surfaced by surface_region. Pass the imageUrl from " +
    "that tool result as pageRef. Use when the manual itself has the exact diagram needed.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: ["code", "image", "manual_page"],
        description: "Artifact kind — code, image, or manual_page.",
      },
      code: {
        type: "string",
        description:
          "Required when kind='code'. JSX function expression returning a React element, " +
          "followed by a render expression like <MyComponent />. React is in scope. No imports.",
      },
      title: {
        type: "string",
        description: "Optional short title shown above the artifact (code kind only).",
      },
      url: {
        type: "string",
        description: "Required when kind='image'. The data URL or image URL from generate_image.",
      },
      alt: {
        type: "string",
        description: "Optional alt text for image kind.",
      },
      caption: {
        type: "string",
        description: "Optional caption shown below image or manual_page artifacts.",
      },
      pageRef: {
        type: "string",
        description:
          "Required when kind='manual_page'. Pass the imageUrl from surface_region result " +
          "(e.g. /api/images/14_diagram_14_1.png).",
      },
    },
    required: ["kind"],
  },
};

export function handle(input: unknown): string {
  const result = validateArtifactSpec(input);
  if (!result.ok) {
    return JSON.stringify({
      accepted: false,
      error: result.error,
      hint: `Fix the spec and retry. kind must be one of: code, image, manual_page. ` +
            `code requires 'code' string; image requires 'url' string; manual_page requires 'pageRef' string.`,
    });
  }

  return JSON.stringify({ accepted: true, spec: result.spec });
}
