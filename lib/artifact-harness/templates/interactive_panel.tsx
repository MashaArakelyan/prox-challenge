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
    <div className="w-full text-zinc-100 space-y-4">
      <div>
        <div className="text-base font-bold tracking-wide">{data.title}</div>
        {data.subtitle && <div className="text-xs text-zinc-400 mt-1">{data.subtitle}</div>}
      </div>

      {/* Wire / Electrode */}
      <div className="bg-zinc-900/50 rounded border border-zinc-800 p-4">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-2">
          Wire / Electrode
        </div>
        <div className="text-sm font-medium text-zinc-100">{data.wireOrElectrode}</div>
      </div>

      {/* Machine settings */}
      <div className="bg-zinc-900/50 rounded border border-zinc-800 p-4 space-y-4">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
          Machine Settings
        </div>

        {data.controls.map((control) => (
          <div key={control.id}>
            <div className="text-xs text-zinc-400 mb-2">{control.label}</div>
            <div className="flex flex-wrap gap-2">
              {control.options.map((opt, i) => {
                const selected = selections[control.id] === i;
                return (
                  <button
                    key={i}
                    onClick={() => setSelections((s) => ({ ...s, [control.id]: i }))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      selected
                        ? "bg-orange-500 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Selected summary */}
        <div className="pt-3 border-t border-zinc-800 space-y-1">
          <div className="text-xs text-zinc-500 mb-2">Selected</div>
          {data.controls.map((control) => (
            <div key={control.id} className="text-sm">
              <span className="text-zinc-400">{control.label}:</span>{" "}
              <span className="text-orange-400 font-medium">
                {control.options[selections[control.id]]}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs text-zinc-500 leading-relaxed">
          The machine auto-configures synergic settings based on your selections. Fine-tune with
          the Left and Right knobs after the arc is established.
        </p>
      </div>

      {/* Setup notes */}
      {data.setupNotes && data.setupNotes.length > 0 && (
        <div className="bg-orange-500/5 rounded border border-orange-500/20 p-4">
          <div className="text-[10px] uppercase tracking-widest text-orange-400 font-semibold mb-3">
            Setup Notes
          </div>
          <ul className="space-y-2 text-xs text-zinc-300">
            {data.setupNotes.map((note, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-orange-500/70 shrink-0">—</span>
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
