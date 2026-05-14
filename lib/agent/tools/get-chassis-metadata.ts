import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const definition: Tool = {
  name: "get_chassis_metadata",
  description:
    "Returns the exact socket coordinates, label positions, viewBox, and cable color hints " +
    "for a welder chassis. Use this BEFORE composing any SVG connection diagram so the geometry " +
    "is accurate. Pass the returned coordinates directly into your SVG code string.",
  input_schema: {
    type: "object" as const,
    properties: {
      chassisId: {
        type: "string",
        description: "Chassis identifier. Use 'omnipro_220' for the Vulcan OmniPro 220.",
      },
    },
    required: ["chassisId"],
  },
};

export function handle(input: { chassisId: string }): string {
  const id = input.chassisId ?? "omnipro_220";

  // Whitelist check — prevent path traversal
  if (!/^[a-z0-9_-]+$/.test(id)) {
    return JSON.stringify({ error: `invalid chassis id: ${id}` });
  }

  try {
    const dataDir = join(process.cwd(), "data", "chassis");
    const metaJson = readFileSync(join(dataDir, `${id}.json`), "utf-8");
    const metadata = JSON.parse(metaJson) as unknown;
    return JSON.stringify({ found: true, metadata });
  } catch {
    return JSON.stringify({ found: false, error: `chassis '${id}' not found in data/chassis/` });
  }
}
