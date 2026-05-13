"use client";

import type { ConnectionDiagramData, ConnectionDiagramCable } from "../types.js";

const W = 800;
const H = 580;

const SOCKETS: Record<string, { x: number; y: number; label: string }> = {
  gas:         { x: 245, y: 485, label: "GAS"  },
  wire_feeder: { x: 335, y: 485, label: "FEED" },
  negative:    { x: 445, y: 485, label: "−"    },
  positive:    { x: 555, y: 485, label: "+"    },
};

const LABEL_SLOTS: Record<string, { x: number; y: number; width: number; height: number; side: "left" | "right" }> = {
  gas:         { x: 15,  y: 220, width: 155, height: 64, side: "left"  },
  wire_feeder: { x: 15,  y: 400, width: 155, height: 64, side: "left"  },
  negative:    { x: 630, y: 400, width: 155, height: 64, side: "right" },
  positive:    { x: 630, y: 220, width: 155, height: 64, side: "right" },
};

const DEFAULT_COLORS: Record<string, string> = {
  positive:    "#c43d2b",
  negative:    "#2154a8",
  gas:         "#3b8a3f",
  wire_feeder: "#9a6a23",
};

function cableColor(c: ConnectionDiagramCable): string {
  return c.color ?? DEFAULT_COLORS[c.fromSocket] ?? "#5a5450";
}

function processFromSubtitle(subtitle: string | undefined): string {
  if (!subtitle) return "OMNIPRO 220";
  const parts = subtitle.split(/[·•:]/);
  const last = parts[parts.length - 1].trim();
  const beforeParen = last.split("(")[0].trim();
  return beforeParen.substring(0, 18).toUpperCase() || "OMNIPRO 220";
}

function wrapLabel(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const split = text.lastIndexOf(" ", maxLen);
  if (split <= 0) return [text.substring(0, maxLen), text.substring(maxLen)];
  return [text.substring(0, split), text.substring(split + 1)];
}

export default function ConnectionDiagram({ data }: { data: ConnectionDiagramData }) {
  const processLabel = processFromSubtitle(data.subtitle);

  return (
    <div className="w-full text-zinc-100 space-y-4">
      <div>
        <h3 className="font-['Playfair_Display'] italic text-2xl text-zinc-100 leading-tight">
          {data.title}
        </h3>
        {data.subtitle && (
          <div className="text-xs uppercase tracking-widest text-orange-400/80 mt-2 font-medium">
            {data.subtitle}
          </div>
        )}
        <div className="h-px bg-gradient-to-r from-orange-500/40 via-zinc-700 to-transparent mt-3" />
      </div>

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="cdBody" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e0d9cb" />
              <stop offset="55%" stopColor="#c2bbac" />
              <stop offset="100%" stopColor="#9d9586" />
            </linearGradient>
            <linearGradient id="cdBodyHi" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,250,0.45)" />
              <stop offset="100%" stopColor="rgba(255,255,250,0)" />
            </linearGradient>
            <radialGradient id="cdKnob" cx="32%" cy="28%" r="70%">
              <stop offset="0%" stopColor="#5a5450" />
              <stop offset="60%" stopColor="#262220" />
              <stop offset="100%" stopColor="#0e0c0a" />
            </radialGradient>
            <radialGradient id="cdSocket" cx="50%" cy="40%" r="55%">
              <stop offset="0%" stopColor="#1a1614" />
              <stop offset="100%" stopColor="#000" />
            </radialGradient>
            <filter id="cdShadow" x="-10%" y="-10%" width="120%" height="125%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="4" />
              <feOffset dx="2" dy="8" result="off" />
              <feComponentTransfer><feFuncA type="linear" slope="0.22" /></feComponentTransfer>
              <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="cdLabel" x="-15%" y="-15%" width="130%" height="130%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="2.5" />
              <feOffset dx="1" dy="3" result="off" />
              <feComponentTransfer><feFuncA type="linear" slope="0.15" /></feComponentTransfer>
              <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="cdPaper" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" />
              <feColorMatrix values="0 0 0 0 0.95  0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 0.06 0" />
              <feComposite in2="SourceGraphic" operator="in" />
            </filter>
          </defs>

          {/* Paper background */}
          <rect width={W} height={H} fill="#FAF6EC" />
          <rect width={W} height={H} fill="#FAF6EC" filter="url(#cdPaper)" opacity="0.6" />

          {/* ===== WELDER BODY ===== */}
          <g filter="url(#cdShadow)">
            {/* Carry handle */}
            <path d="M 320 75 Q 320 55 340 55 L 460 55 Q 480 55 480 75 L 480 95 L 320 95 Z" fill="#4a4540" />
            <ellipse cx="400" cy="75" rx="78" ry="5" fill="#2d2826" />
            <rect x="330" y="90" width="140" height="8" fill="#3a3530" />

            {/* Main body */}
            <path
              d="M 200 95 L 600 95 Q 625 95 625 120 L 625 415 Q 625 440 600 440 L 200 440 Q 175 440 175 415 L 175 120 Q 175 95 200 95 Z"
              fill="url(#cdBody)"
              stroke="#5a5450"
              strokeWidth="2"
            />
            <path
              d="M 200 95 L 600 95 Q 625 95 625 120 L 625 260 L 175 260 L 175 120 Q 175 95 200 95 Z"
              fill="url(#cdBodyHi)"
              pointerEvents="none"
            />

            {/* Vents — left */}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <line key={`vl-${i}`} x1="195" y1={290 + i * 14} x2="248" y2={290 + i * 14} stroke="#5a554e" strokeWidth="2" strokeLinecap="round" />
            ))}
            {/* Vents — right */}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <line key={`vr-${i}`} x1="552" y1={290 + i * 14} x2="605" y2={290 + i * 14} stroke="#5a554e" strokeWidth="2" strokeLinecap="round" />
            ))}

            {/* Display screen */}
            <rect x="290" y="145" width="220" height="105" rx="6" fill="#1a1614" stroke="#2d2826" strokeWidth="2" />
            <rect x="296" y="151" width="208" height="93" rx="3" fill="#080705" />
            <text x="400" y="175" textAnchor="middle" fill="#dac8aa" fontSize="11" fontFamily="monospace" letterSpacing="3" opacity="0.6">VULCAN</text>
            <text x="400" y="205" textAnchor="middle" fill="#f97316" fontSize="17" fontFamily="monospace" fontWeight="bold" letterSpacing="3">{processLabel}</text>
            <text x="400" y="232" textAnchor="middle" fill="#dac8aa" fontSize="9" fontFamily="monospace" letterSpacing="2" opacity="0.45">OMNIPRO 220</text>

            {/* Left knob */}
            <circle cx="245" cy="180" r="28" fill="url(#cdKnob)" stroke="#0a0a0a" strokeWidth="1.5" />
            <circle cx="245" cy="180" r="17" fill="#3a3530" opacity="0.6" />
            <circle cx="245" cy="180" r="5" fill="#7a7570" />
            <line x1="245" y1="158" x2="245" y2="170" stroke="#dac8aa" strokeWidth="3" strokeLinecap="round" />
            <text x="245" y="230" textAnchor="middle" fill="#3a342f" fontSize="9" fontWeight="700" letterSpacing="2">LEFT</text>

            {/* Right knob */}
            <circle cx="555" cy="180" r="28" fill="url(#cdKnob)" stroke="#0a0a0a" strokeWidth="1.5" />
            <circle cx="555" cy="180" r="17" fill="#3a3530" opacity="0.6" />
            <circle cx="555" cy="180" r="5" fill="#7a7570" />
            <line x1="555" y1="158" x2="555" y2="170" stroke="#dac8aa" strokeWidth="3" strokeLinecap="round" />
            <text x="555" y="230" textAnchor="middle" fill="#3a342f" fontSize="9" fontWeight="700" letterSpacing="2">RIGHT</text>

            {/* Main knob */}
            <circle cx="400" cy="325" r="36" fill="url(#cdKnob)" stroke="#0a0a0a" strokeWidth="1.5" />
            <circle cx="400" cy="325" r="23" fill="#3a3530" opacity="0.6" />
            <circle cx="400" cy="325" r="6" fill="#7a7570" />
            <line x1="400" y1="297" x2="400" y2="313" stroke="#dac8aa" strokeWidth="3.5" strokeLinecap="round" />
            <text x="400" y="383" textAnchor="middle" fill="#3a342f" fontSize="11" fontWeight="700" letterSpacing="3">MAIN</text>

            {/* Brand badge */}
            <rect x="318" y="400" width="164" height="34" rx="3" fill="#15110f" stroke="#000" />
            <text x="400" y="424" textAnchor="middle" fill="#dac8aa" fontSize="20" fontFamily="serif" fontWeight="700" letterSpacing="6">VULCAN</text>
          </g>

          {/* Lower socket panel */}
          <g filter="url(#cdShadow)">
            <rect x="175" y="450" width="450" height="78" fill="#2a2622" stroke="#15110f" strokeWidth="2" />
            <text x="195" y="470" fill="#6a655e" fontSize="9" letterSpacing="2">SOCKETS</text>
          </g>

          {/* Sockets — colored halo when active */}
          {Object.entries(SOCKETS).map(([key, s]) => {
            const inUse = data.cables.find((c) => c.fromSocket === key);
            const color = inUse ? cableColor(inUse) : "#3a342f";
            return (
              <g key={key}>
                {inUse && (
                  <>
                    <circle cx={s.x} cy={s.y} r="34" fill={color} opacity="0.1" />
                    <circle cx={s.x} cy={s.y} r="28" fill={color} opacity="0.15" />
                  </>
                )}
                <circle cx={s.x} cy={s.y} r="22" fill="#0a0805" stroke={inUse ? color : "#0a0805"} strokeWidth="2" />
                <circle cx={s.x} cy={s.y} r="18" fill="url(#cdSocket)" />
                <circle cx={s.x} cy={s.y} r="12" fill="#000" />
                <text x={s.x} y={s.y + 5} textAnchor="middle" fill={inUse ? color : "#6a655e"} fontSize="13" fontWeight="bold">
                  {s.label}
                </text>
              </g>
            );
          })}

          {/* Cables — bezier from socket to corner label */}
          {data.cables.map((cable, i) => {
            const sock = SOCKETS[cable.fromSocket];
            const slot = LABEL_SLOTS[cable.fromSocket];
            if (!sock || !slot) return null;
            const color = cableColor(cable);

            const isLeft = slot.side === "left";
            const labelEdgeX = isLeft ? slot.x + slot.width : slot.x;
            const labelEdgeY = slot.y + slot.height / 2;

            const cpX1 = sock.x + (isLeft ? -80 : 80);
            const cpY1 = sock.y + 30;
            const cpX2 = labelEdgeX + (isLeft ? 50 : -50);
            const cpY2 = labelEdgeY;

            const lines = wrapLabel(cable.toLabel, 24);

            return (
              <g key={i}>
                {/* Cable curve */}
                <path
                  d={`M ${sock.x} ${sock.y + 22} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${labelEdgeX} ${labelEdgeY}`}
                  stroke={color}
                  strokeWidth="2.8"
                  fill="none"
                  strokeLinecap="round"
                  opacity="0.88"
                />
                {/* Terminal at socket */}
                <circle cx={sock.x} cy={sock.y + 22} r="4.5" fill={color} stroke="#fff" strokeWidth="1" />
                {/* Terminal at label */}
                <circle cx={labelEdgeX} cy={labelEdgeY} r="4.5" fill={color} stroke="#fff" strokeWidth="1" />

                {/* Label card */}
                <g filter="url(#cdLabel)">
                  <rect
                    x={slot.x}
                    y={slot.y}
                    width={slot.width}
                    height={slot.height}
                    rx="5"
                    fill="#fffdf9"
                    stroke={color}
                    strokeWidth="2"
                  />
                  {/* Color accent stripe on socket-facing edge */}
                  <rect
                    x={isLeft ? slot.x + slot.width - 5 : slot.x}
                    y={slot.y + 2}
                    width="5"
                    height={slot.height - 4}
                    fill={color}
                    rx="2"
                  />
                </g>

                {/* Label text — one or two lines */}
                {lines.length === 1 ? (
                  <text
                    x={slot.x + slot.width / 2}
                    y={slot.y + slot.height / 2 + 5}
                    textAnchor="middle"
                    fill="#1a1614"
                    fontSize="12"
                    fontWeight="600"
                  >
                    {lines[0]}
                  </text>
                ) : (
                  <>
                    <text
                      x={slot.x + slot.width / 2}
                      y={slot.y + slot.height / 2 - 4}
                      textAnchor="middle"
                      fill="#1a1614"
                      fontSize="11.5"
                      fontWeight="600"
                    >
                      {lines[0]}
                    </text>
                    <text
                      x={slot.x + slot.width / 2}
                      y={slot.y + slot.height / 2 + 13}
                      textAnchor="middle"
                      fill="#1a1614"
                      fontSize="11.5"
                      fontWeight="600"
                    >
                      {lines[1]}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {data.notes && data.notes.length > 0 && (
        <div className="rounded-lg border border-orange-500/20 bg-gradient-to-br from-orange-500/[0.04] to-transparent p-4">
          <ul className="space-y-2 text-sm text-zinc-300">
            {data.notes.map((n, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-orange-500/60 font-bold shrink-0">›</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.citation && (
        <p className="text-xs text-zinc-600 text-right font-mono">{data.citation}</p>
      )}
    </div>
  );
}
