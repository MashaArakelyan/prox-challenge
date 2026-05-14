import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const definition: Tool = {
  name: "get_chassis_metadata",
  description:
    "Returns chassis metadata AND a working SVG scaffold for a welder model. " +
    "The scaffold is ready-to-render JSX with the chassis body, socket connectors, label slot " +
    "placeholders, and leader lines already in place — you modify it to add cables and label text " +
    "for the specific question. " +
    "Use this BEFORE composing any code artifact for connection diagrams, polarity questions, " +
    "socket questions, or front-panel layouts. Never invent socket coordinates. " +
    "On success returns { found: true, metadata, scaffoldCode }. " +
    "On failure returns { found: false, error }.",
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

interface SocketDef  { x: number; y: number; label: string }
interface SlotDef    { x: number; y: number; width: number; height: number; side: "left" | "right" }
interface ChassisMetadata {
  id: string; name: string; viewBox: string;
  sockets:      Record<string, SocketDef>;
  labelSlots:   Record<string, SlotDef>;
  defaultColors: Record<string, string>;
}

function buildScaffold(metadata: ChassisMetadata, chassisInner: string): string {
  const { viewBox, sockets, labelSlots, defaultColors } = metadata;

  // Socket connectors — drawn on top of the chassis body
  const socketElems = Object.entries(sockets).map(([key, s]) => {
    const color = defaultColors[key] ?? "#374151";
    return (
      `      <circle cx={${s.x}} cy={${s.y}} r={20} fill="${color}" stroke="#1a1614" strokeWidth="2.5" />\n` +
      `      <circle cx={${s.x}} cy={${s.y}} r={12} fill="${color}" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />\n` +
      `      <text x={${s.x}} y={${s.y + 5}} textAnchor="middle" fontSize="10" fill="#fff" fontWeight="700">${s.label}</text>`
    );
  }).join("\n");

  // Label slot placeholder cards
  const slotElems = Object.entries(labelSlots).map(([key, slot]) => {
    const socketX = sockets[key]?.x ?? 0;
    const socketY = sockets[key]?.y ?? 0;
    // Leader line: from nearest edge of label card to socket rim (r=20)
    const cardEdgeX = slot.side === "left" ? slot.x + slot.width : slot.x;
    const cardEdgeY = slot.y + slot.height / 2;
    const dx = socketX - cardEdgeX;
    const dy = socketY - cardEdgeY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const socketRimX = socketX - (dx / dist) * 21;
    const socketRimY = socketY - (dy / dist) * 21;
    return (
      `      {/* ${key} label card */}\n` +
      `      <rect x={${slot.x}} y={${slot.y}} width={${slot.width}} height={${slot.height}} rx={4} fill="white" fillOpacity="0.92" stroke="#c9b99a" strokeWidth="1" />\n` +
      `      <text x={${slot.x + slot.width / 2}} y={${slot.y + 22}} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1a1614">LABEL HERE</text>\n` +
      `      <text x={${slot.x + slot.width / 2}} y={${slot.y + 40}} textAnchor="middle" fontSize="10" fill="#6b7280">description</text>\n` +
      `      <line x1={${cardEdgeX}} y1={${cardEdgeY}} x2={${socketRimX.toFixed(0)}} y2={${socketRimY.toFixed(0)}} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4,3" />`
    );
  }).join("\n");

  // Cable color reference comment
  const colorRef = Object.entries(defaultColors)
    .map(([k, v]) => `${k}="${v}"`)
    .join(", ");

  return `function ConnectionDiagram() {
  // Chassis body — pre-rendered, do not modify
  const chassisBody = ${JSON.stringify(chassisInner)};

  return (
    <svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 'auto', background: '#FAF6EC', borderRadius: 8 }}>
      {/* ── Chassis body ─────────────────────────────────────────────── */}
      <g dangerouslySetInnerHTML={{ __html: chassisBody }} />

      {/* ── Socket connectors (colors: ${colorRef}) ── */}
${socketElems}

      {/* ── Label cards + leader lines ────────────────────────────────── */}
${slotElems}

      {/* ── Cables — add bezier paths for the relevant connections ─────
          Pattern: <path d="M {socketX} {socketY} C {cp1x} {cp1y} {cp2x} {cp2y} {endX} {endY}"
                        stroke="{color}" strokeWidth="7" strokeLinecap="round" fill="none"
                        opacity="0.85" />
          Colors: positive="${defaultColors.positive}", negative="${defaultColors.negative}",
                  gas="${defaultColors.gas}", wire_feeder="${defaultColors.wire_feeder}"
          Replace LABEL HERE / description above with the actual part names.
          Remove label cards for sockets not involved in this diagram.         ── */}

    </svg>
  );
}

<ConnectionDiagram />`;
}

export function handle(input: { chassisId: string }): string {
  const id = (input.chassisId ?? "omnipro_220").trim();
  if (!/^[a-z0-9_-]+$/.test(id)) {
    return JSON.stringify({ found: false, error: `invalid chassis id: ${id}` });
  }

  try {
    const dataDir = join(process.cwd(), "data", "chassis");
    const metaRaw  = readFileSync(join(dataDir, `${id}.json`), "utf-8");
    const svgRaw   = readFileSync(join(dataDir, `${id}.svg`),  "utf-8");

    const metadata  = JSON.parse(metaRaw) as ChassisMetadata;
    const chassisInner = svgRaw
      .replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .trim();

    const scaffoldCode = buildScaffold(metadata, chassisInner);
    return JSON.stringify({ found: true, metadata, scaffoldCode });
  } catch (e: unknown) {
    return JSON.stringify({ found: false, error: `chassis '${id}' not found: ${(e as Error).message}` });
  }
}
