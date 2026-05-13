"use client";

import type { TroubleshootingFlowchartData } from "../types.js";

export default function TroubleshootingFlowchart({ data }: { data: TroubleshootingFlowchartData }) {
  return (
    <div className="border border-zinc-700 rounded-lg p-5 text-center space-y-2">
      <div className="text-sm font-medium text-zinc-300">{data.title}</div>
      <div className="text-xs text-zinc-500">
        Flowchart renderer coming soon — spec validated ✓
      </div>
      {data.symptom && (
        <div className="text-xs text-zinc-400">Symptom: {data.symptom}</div>
      )}
    </div>
  );
}
