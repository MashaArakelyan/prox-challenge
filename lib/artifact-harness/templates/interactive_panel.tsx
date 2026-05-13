"use client";

import { useState } from "react";
import type { InteractivePanelData } from "../types.js";

export default function InteractivePanel({ data }: { data: InteractivePanelData }) {
  const [selections, setSelections] = useState<Record<string, number>>(() =>
    data.controls.reduce(
      (acc, c) => ({ ...acc, [c.id]: c.defaultIndex ?? 0 }),
      {} as Record<string, number>,
    ),
  );

  return (
    <div className="w-full text-zinc-100 space-y-6">
      {/* Header */}
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

      {/* Wire / Electrode — hero block */}
      <div className="bg-gradient-to-br from-zinc-900 to-zinc-900/40 rounded-lg border border-zinc-800 p-5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-2">
          Wire / Electrode
        </div>
        <div className="text-base font-medium text-zinc-100 leading-relaxed">
          {data.wireOrElectrode}
        </div>
      </div>

      {/* Machine settings */}
      <div className="bg-zinc-900/40 rounded-lg border border-zinc-800 p-5 space-y-5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-semibold">
          Machine Settings
        </div>

        {data.controls.map((control) => (
          <div key={control.id}>
            <div className="text-xs text-zinc-400 mb-2.5 font-medium">{control.label}</div>
            <div className="flex flex-wrap gap-2">
              {control.options.map((opt, i) => {
                const selected = selections[control.id] === i;
                return (
                  <button
                    key={i}
                    onClick={() => setSelections((s) => ({ ...s, [control.id]: i }))}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 ${
                      selected
                        ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20 scale-[1.02]"
                        : "bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 border border-zinc-700/50"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <p className="text-xs text-zinc-500 leading-relaxed pt-2 border-t border-zinc-800/60">
          The machine auto-configures synergic settings based on your selections. Fine-tune with
          the Left and Right knobs after the arc is established.
        </p>
      </div>

      {/* Setup notes */}
      {data.setupNotes && data.setupNotes.length > 0 && (
        <div className="rounded-lg border border-orange-500/20 bg-gradient-to-br from-orange-500/[0.04] to-transparent p-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-orange-400 font-semibold mb-3">
            Setup Notes
          </div>
          <ul className="space-y-2.5 text-sm text-zinc-300 leading-relaxed">
            {data.setupNotes.map((note, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-orange-500/60 font-bold shrink-0">›</span>
                <span>{note}</span>
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
