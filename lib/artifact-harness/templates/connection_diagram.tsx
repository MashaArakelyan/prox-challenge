"use client";

import { useEffect, useState } from "react";
import type { ConnectionDiagramData, ConnectionDiagramCable } from "../types.js";

interface ChassisMeta {
  id: string;
  name: string;
  viewBox: string;
  screen: { x: number; labelY: number; valueY: number; modelY: number; modelText: string };
  sockets: Record<string, { x: number; y: number; label: string }>;
  labelSlots: Record<string, { x: number; y: number; width: number; height: number; side: "left" | "right" }>;
  defaultColors: Record<string, string>;
}

interface ChassisSpec {
  metadata: ChassisMeta;
  svgInner: string;
}

const chassisCache = new Map<string, ChassisSpec>();

function processFromSubtitle(subtitle: string | undefined): string {
  if (!subtitle) return "";
  const parts = subtitle.split(/[·•:]/);
  const last = parts[parts.length - 1].trim();
  return last.split("(")[0].trim().substring(0, 18).toUpperCase();
}

function wrapLabel(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const split = text.lastIndexOf(" ", maxLen);
  if (split <= 0) return [text.substring(0, maxLen), text.substring(maxLen)];
  return [text.substring(0, split), text.substring(split + 1)];
}

function cableColor(cable: ConnectionDiagramCable, defaultColors: Record<string, string>): string {
  return cable.color ?? defaultColors[cable.fromSocket] ?? "#5a5450";
}

export default function ConnectionDiagram({ data }: { data: ConnectionDiagramData }) {
  const chassisId = data.chassisRef ?? "omnipro_220";
  const [chassis, setChassis] = useState<ChassisSpec | null>(() => chassisCache.get(chassisId) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (chassisCache.has(chassisId)) {
      setChassis(chassisCache.get(chassisId)!);
      return;
    }
    let cancelled = false;
    fetch(`/api/chassis/${chassisId}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({ error: r.statusText }));
          throw new Error((body as { error?: string }).error ?? r.statusText);
        }
        return r.json() as Promise<ChassisSpec>;
      })
      .then((spec) => {
        if (cancelled) return;
        chassisCache.set(chassisId, spec);
        setChassis(spec);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [chassisId]);

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

      <div className="rounded-lg border border-zinc-800 overflow-hidden bg-[#FAF6EC] min-h-[300px] flex items-center justify-center">
        {error ? (
          <p className="text-sm text-orange-400 p-6">Chassis load failed: {error}</p>
        ) : !chassis ? (
          <div className="flex flex-col items-center gap-3 p-6">
            <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-500">Loading chassis…</span>
          </div>
        ) : (
          <svg viewBox={chassis.metadata.viewBox} className="w-full" xmlns="http://www.w3.org/2000/svg">
            {/* Static chassis visual from data file */}
            <g dangerouslySetInnerHTML={{ __html: chassis.svgInner }} />

            {/* Dynamic screen text overlay */}
            <text x={chassis.metadata.screen.x} y={chassis.metadata.screen.labelY} textAnchor="middle" fill="#dac8aa" fontSize="11" fontFamily="monospace" letterSpacing="3" opacity="0.6">VULCAN</text>
            <text x={chassis.metadata.screen.x} y={chassis.metadata.screen.valueY} textAnchor="middle" fill="#f97316" fontSize="17" fontFamily="monospace" fontWeight="bold" letterSpacing="3">
              {processLabel || chassis.metadata.screen.modelText}
            </text>
            <text x={chassis.metadata.screen.x} y={chassis.metadata.screen.modelY} textAnchor="middle" fill="#dac8aa" fontSize="9" fontFamily="monospace" letterSpacing="2" opacity="0.45">
              {chassis.metadata.screen.modelText}
            </text>

            {/* Sockets — highlighted when a cable uses them */}
            {Object.entries(chassis.metadata.sockets).map(([key, s]) => {
              const inUse = data.cables.find((c) => c.fromSocket === key);
              const color = inUse ? cableColor(inUse, chassis.metadata.defaultColors) : "#3a342f";
              return (
                <g key={key}>
                  {inUse && (
                    <>
                      <circle cx={s.x} cy={s.y} r="34" fill={color} opacity="0.1" />
                      <circle cx={s.x} cy={s.y} r="28" fill={color} opacity="0.15" />
                    </>
                  )}
                  <circle cx={s.x} cy={s.y} r="22" fill="#0a0805" stroke={inUse ? color : "#0a0805"} strokeWidth="2" />
                  <circle cx={s.x} cy={s.y} r="18" fill="#15110f" />
                  <circle cx={s.x} cy={s.y} r="12" fill="#000" />
                  <text x={s.x} y={s.y + 5} textAnchor="middle" fill={inUse ? color : "#6a655e"} fontSize="13" fontWeight="bold">
                    {s.label}
                  </text>
                </g>
              );
            })}

            {/* Cables and labels — agent-composed */}
            {data.cables.map((cable, i) => {
              const sock = chassis.metadata.sockets[cable.fromSocket];
              const slot = chassis.metadata.labelSlots[cable.fromSocket];
              if (!sock || !slot) return null;
              const color = cableColor(cable, chassis.metadata.defaultColors);

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
                  {/* Terminals */}
                  <circle cx={sock.x} cy={sock.y + 22} r="4.5" fill={color} stroke="#fff" strokeWidth="1" />
                  <circle cx={labelEdgeX} cy={labelEdgeY} r="4.5" fill={color} stroke="#fff" strokeWidth="1" />

                  {/* Label card */}
                  <rect x={slot.x} y={slot.y} width={slot.width} height={slot.height} rx="5" fill="#fffdf9" stroke={color} strokeWidth="2" />
                  <rect
                    x={isLeft ? slot.x + slot.width - 5 : slot.x}
                    y={slot.y + 2}
                    width="5"
                    height={slot.height - 4}
                    fill={color}
                    rx="2"
                  />

                  {/* Label text */}
                  {lines.length === 1 ? (
                    <text x={slot.x + slot.width / 2} y={slot.y + slot.height / 2 + 5} textAnchor="middle" fill="#1a1614" fontSize="12" fontWeight="600">
                      {lines[0]}
                    </text>
                  ) : (
                    <>
                      <text x={slot.x + slot.width / 2} y={slot.y + slot.height / 2 - 4} textAnchor="middle" fill="#1a1614" fontSize="11.5" fontWeight="600">{lines[0]}</text>
                      <text x={slot.x + slot.width / 2} y={slot.y + slot.height / 2 + 13} textAnchor="middle" fill="#1a1614" fontSize="11.5" fontWeight="600">{lines[1]}</text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}
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
