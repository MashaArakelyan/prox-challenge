"use client";

import type { ComparisonTableData, ComparisonTableColumn, ComparisonTableRow } from "../types.js";

type AnyCol = ComparisonTableColumn | string;
type AnyRow = ComparisonTableRow | (string | number)[];

function normalizeColumn(c: AnyCol, i: number): ComparisonTableColumn {
  if (typeof c === "string") return { key: `c${i}`, label: c };
  return c as ComparisonTableColumn;
}

function normalizeRow(r: AnyRow, cols: ComparisonTableColumn[]): ComparisonTableRow {
  if (Array.isArray(r)) {
    const cells: Record<string, string | number> = {};
    cols.forEach((col, i) => { cells[col.key] = r[i] ?? ""; });
    return { cells };
  }
  return r as ComparisonTableRow;
}

export default function ComparisonTable({ data }: { data: ComparisonTableData }) {
  const cols = (data.columns as AnyCol[]).map(normalizeColumn);
  const rows = (data.rows as AnyRow[]).map((r) => normalizeRow(r, cols));

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-zinc-700">
            {cols.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2.5 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wide whitespace-nowrap"
              >
                {col.label}
                {col.unit ? <span className="font-normal text-zinc-500 ml-1">({col.unit})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className={`border-b border-zinc-800/60 ${
                row.highlight ? "bg-zinc-800 font-semibold" : "hover:bg-zinc-900/50"
              }`}
            >
              {cols.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-zinc-200 ${col.align === "right" ? "text-right tabular-nums" : ""}`}
                >
                  {String(row.cells[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.citation && (
        <p className="text-xs text-zinc-500 mt-2 text-right">{data.citation}</p>
      )}
    </div>
  );
}
