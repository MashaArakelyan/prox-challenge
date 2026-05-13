"use client";

import type { InteractivePanelData } from "../types.js";

export default function InteractivePanel({ data }: { data: InteractivePanelData }) {
  return (
    <div className="border border-zinc-700 rounded-lg p-5 text-center space-y-2">
      <div className="text-sm font-medium text-zinc-300">{data.title}</div>
      <div className="text-xs text-zinc-500">
        Interactive panel renderer coming soon — spec validated ✓
      </div>
      {data.description && (
        <div className="text-xs text-zinc-400">{data.description}</div>
      )}
    </div>
  );
}
