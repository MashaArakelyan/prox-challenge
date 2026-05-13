"use client";

import type { ConnectionDiagramData, ConnectionDiagramCable } from "../types.js";

const SOCKETS = {
  gas:         { x: 140, y: 320, label: "GAS" },
  wire_feeder: { x: 220, y: 320, label: "FEED" },
  negative:    { x: 340, y: 320, label: "−" },
  positive:    { x: 440, y: 320, label: "+" },
} as const;

const DEFAULT_COLORS: Record<string, string> = {
  positive:    "#dc2626",
  negative:    "#2563eb",
  gas:         "#16a34a",
  wire_feeder: "#a16207",
};

function cableColor(cable: ConnectionDiagramCable): string {
  return cable.color ?? DEFAULT_COLORS[cable.fromSocket] ?? "#a1a1aa";
}

export default function ConnectionDiagram({ data }: { data: ConnectionDiagramData }) {
  return (
    <div className="w-full text-zinc-100">
      <div className="mb-4">
        <div className="text-base font-bold tracking-wide">{data.title}</div>
        {data.subtitle && <div className="text-xs text-zinc-400 mt-1">{data.subtitle}</div>}
      </div>

      <svg viewBox="0 0 600 480" className="w-full bg-zinc-950 rounded border border-zinc-800">
        {/* Welder body */}
        <rect x="60" y="60" width="480" height="280" rx="12" fill="#1f1f23" stroke="#3f3f46" strokeWidth="2" />
        <rect x="220" y="100" width="160" height="60" rx="4" fill="#0a0a0a" stroke="#52525b" />
        <text x="300" y="135" textAnchor="middle" fill="#a1a1aa" fontSize="10" fontFamily="monospace">VULCAN OmniPro 220</text>

        {/* Knobs */}
        <circle cx="120" cy="140" r="22" fill="#27272a" stroke="#52525b" strokeWidth="2" />
        <circle cx="120" cy="140" r="6" fill="#52525b" />
        <text x="120" y="180" textAnchor="middle" fill="#71717a" fontSize="9">LEFT KNOB</text>
        <circle cx="480" cy="140" r="22" fill="#27272a" stroke="#52525b" strokeWidth="2" />
        <circle cx="480" cy="140" r="6" fill="#52525b" />
        <text x="480" y="180" textAnchor="middle" fill="#71717a" fontSize="9">RIGHT KNOB</text>
        <circle cx="300" cy="225" r="20" fill="#27272a" stroke="#52525b" strokeWidth="2" />
        <circle cx="300" cy="225" r="6" fill="#52525b" />
        <text x="300" y="265" textAnchor="middle" fill="#71717a" fontSize="9">MAIN</text>

        {/* Sockets — highlighted when a cable uses them */}
        {(Object.entries(SOCKETS) as [keyof typeof SOCKETS, { x: number; y: number; label: string }][]).map(([key, s]) => {
          const inUse = data.cables.find((c) => c.fromSocket === key);
          return (
            <g key={key}>
              <circle cx={s.x} cy={s.y} r="16" fill={inUse ? cableColor(inUse) : "#27272a"} stroke="#52525b" strokeWidth="2" />
              <text x={s.x} y={s.y + 5} textAnchor="middle" fill="#fafafa" fontSize="13" fontWeight="bold">{s.label}</text>
            </g>
          );
        })}

        {/* Cables */}
        {data.cables.map((cable, i) => {
          const sock = SOCKETS[cable.fromSocket];
          if (!sock) return null;
          const isLeft = i % 2 === 0;
          const endX = isLeft ? 80 : 520;
          const endY = 400 + Math.floor(i / 2) * 32;
          const labelX = isLeft ? 96 : 504;
          const labelAnchor: "start" | "end" = isLeft ? "start" : "end";
          const color = cableColor(cable);
          return (
            <g key={i}>
              <path
                d={`M ${sock.x} ${sock.y + 16} Q ${sock.x} ${sock.y + 60}, ${endX} ${endY}`}
                stroke={color}
                strokeWidth="3"
                fill="none"
              />
              <circle cx={endX} cy={endY} r="5" fill={color} />
              <text x={labelX} y={endY + 4} textAnchor={labelAnchor} fill={color} fontSize="11" fontWeight="500">
                {cable.toLabel}
              </text>
            </g>
          );
        })}
      </svg>

      {data.notes && data.notes.length > 0 && (
        <div className="mt-4 p-3 bg-zinc-900/50 rounded border border-zinc-800">
          <ul className="space-y-1.5 text-xs text-zinc-300">
            {data.notes.map((n, i) => <li key={i}>• {n}</li>)}
          </ul>
        </div>
      )}

      {data.citation && (
        <p className="text-xs text-zinc-600 mt-2 text-right font-mono">{data.citation}</p>
      )}
    </div>
  );
}
