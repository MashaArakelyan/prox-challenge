import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { surfaceRegion } from "../../knowledge/index.js";

export const definition: Tool = {
  name: "surface_region",
  description:
    "Retrieve a diagram from the manual by its ID. Returns the diagram's metadata, " +
    "caption, and the image path at data/images/<page>_<id>.png. " +
    "Optionally filter to a specific labeled region within the diagram (e.g. 'Negative Socket'). " +
    "Use this when the user's question is best answered by showing a diagram — polarity setup, " +
    "cable routing, front panel layout, duty cycle charts. " +
    "High-salience diagrams to know: diagram_8_1 (Front Panel Controls, p.8), " +
    "diagram_13_3 (DCEN Flux-Cored setup, p.13), diagram_14_1 (DCEP setup, p.14), " +
    "diagram_19_1/19_2 (duty cycle charts, p.19), diagram_24_1 (TIG cable setup, p.24), " +
    "diagram_27_1 (Stick cable setup, p.27).",
  input_schema: {
    type: "object" as const,
    properties: {
      diagramId: {
        type: "string",
        description: "Diagram ID, e.g. 'diagram_8_1' or 'diagram_14_1'.",
      },
      regionLabel: {
        type: "string",
        description:
          "Optional label substring to highlight a specific region within the diagram " +
          "(case-insensitive). Omit to return the full diagram.",
      },
    },
    required: ["diagramId"],
  },
};

export function handle(input: { diagramId: string; regionLabel?: string }): string {
  const result = surfaceRegion(input.diagramId, input.regionLabel);
  if (!result) return JSON.stringify({ found: false, diagramId: input.diagramId });

  const { diagram, region } = result;
  const imagePath = `data/images/${diagram.page}_${diagram.id}.png`;

  // allRegions lets the agent derive annotation coordinates from bbox centers:
  // annotation x = bbox.x + bbox.width/2, y = bbox.y + bbox.height/2 (all normalized 0-1)
  const allRegions = diagram.regions.map((r, i) => ({
    number: i + 1,
    label: r.label,
    bbox: r.bbox,
    annotationX: r.bbox.x + r.bbox.width / 2,
    annotationY: r.bbox.y + r.bbox.height / 2,
  }));

  return JSON.stringify({
    found: true,
    diagram: {
      id: diagram.id,
      page: diagram.page,
      caption: diagram.caption,
      salience: diagram.salience,
    },
    region: region
      ? { label: region.label, bbox: region.bbox }
      : null,
    allRegions,
    imagePath,
    imageUrl: imagePath.replace("data/images/", "/api/images/"),
    note: "After surfacing an image, call render_artifact with kind='image', the imageUrl as src, and an annotations array built from allRegions (pick the regions relevant to the user's question).",
  });
}
