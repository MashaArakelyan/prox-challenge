"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from "recharts";
import type { TwoCurveChartData } from "../types.js";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2"];

export default function TwoCurveChart({ data }: { data: TwoCurveChartData }) {
  // Union all x-values across every series, sorted ascending
  const allX = new Set<number>();
  for (const s of data.series) s.points.forEach(([x]) => allX.add(x));
  const xs = [...allX].sort((a, b) => a - b);

  // Build a single recharts data array keyed by series label
  const chartData = xs.map((x) => {
    const row: Record<string, number | null> = { x };
    for (const s of data.series) {
      const pt = s.points.find(([px]) => px === x);
      row[s.label] = pt ? pt[1] : null;
    }
    return row;
  });

  const { yAxis } = data;
  const domain: [number | "auto", number | "auto"] = [yAxis.min ?? "auto", yAxis.max ?? "auto"];

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, bottom: 40, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="x"
            tick={{ fill: "#71717a", fontSize: 11 }}
            label={{
              value: `${data.xAxis.label} (${data.xAxis.unit})`,
              position: "insideBottom",
              offset: -15,
              fill: "#a1a1aa",
              fontSize: 12,
            }}
          />
          <YAxis
            domain={domain}
            tick={{ fill: "#71717a", fontSize: 11 }}
            label={{
              value: `${yAxis.label} (${yAxis.unit})`,
              angle: -90,
              position: "insideLeft",
              fill: "#a1a1aa",
              fontSize: 12,
            }}
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 6 }}
            labelStyle={{ color: "#e4e4e7" }}
            itemStyle={{ color: "#a1a1aa" }}
            formatter={(v, name) => [`${v}${yAxis.unit}`, String(name ?? "")]}
            labelFormatter={(l) => `${l} ${data.xAxis.unit}`}
          />
          <Legend verticalAlign="top" height={36} wrapperStyle={{ color: "#a1a1aa", fontSize: 12, paddingBottom: 10 }} />
          {data.series.map((s, i) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={s.color ?? COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
          {data.referenceLines?.map((rl) => (
            <ReferenceLine
              key={rl.label}
              x={rl.x}
              y={rl.y}
              stroke={rl.color ?? "#6b7280"}
              strokeDasharray="4 2"
              label={{ value: rl.label, fill: rl.color ?? "#6b7280", fontSize: 10 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {data.citation && (
        <p className="text-xs text-zinc-500 mt-1 text-right">{data.citation}</p>
      )}
    </div>
  );
}
