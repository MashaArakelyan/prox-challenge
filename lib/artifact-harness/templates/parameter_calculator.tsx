"use client";

import { useState, useMemo } from "react";
import type { ParameterCalculatorData, CalculatorInput } from "../types.js";

// options may be plain string|number or {label, value} objects (agent shorthand)
type RawOpt = string | number | { label: string; value: string | number };

function optLabel(o: RawOpt): string {
  return typeof o === "object" && o !== null && "label" in o ? String(o.label) : String(o);
}
function optValue(o: RawOpt): string | number {
  return typeof o === "object" && o !== null && "value" in o ? o.value : (o as string | number);
}

function defaultFor(inp: CalculatorInput): number | string {
  if (inp.default !== undefined) return inp.default;
  const opts = inp.options as RawOpt[] | undefined;
  if (opts?.length) return optValue(opts[0]);
  return inp.min ?? 0;
}

// The agent writes formulas as: stmts; ({ outA: val, outB: val })
// We find the last `({` and inject `return` so new Function can return the value.
function evalFormula(formula: string, vals: Record<string, unknown>): Record<string, number> {
  try {
    const last = formula.lastIndexOf("({");
    const body =
      last >= 0
        ? formula.slice(0, last) + "return (" + formula.slice(last + 1)
        : `return (${formula})`;
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(vals), `"use strict";\n${body}`);
    const result = fn(...Object.values(vals));
    return result && typeof result === "object" ? (result as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function evalCond(condition: string, vals: Record<string, unknown>): boolean {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(vals), `"use strict"; return !!(${condition});`);
    return Boolean(fn(...Object.values(vals)));
  } catch {
    return false;
  }
}

export default function ParameterCalculator({ data }: { data: ParameterCalculatorData }) {
  const [values, setValues] = useState<Record<string, number | string>>(
    () => Object.fromEntries(data.inputs.map((i) => [i.id, defaultFor(i)])),
  );

  const outputs = useMemo(() => evalFormula(data.formula, values), [data.formula, values]);
  const allVals = { ...values, ...outputs };

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {data.inputs.map((inp) => (
          <InputControl
            key={inp.id}
            input={inp}
            value={values[inp.id]}
            onChange={(v) => setValues((prev) => ({ ...prev, [inp.id]: v }))}
          />
        ))}
      </div>

      {data.warnings
        ?.filter((w) => evalCond(w.condition, allVals))
        .map((w, i) => (
          <div
            key={i}
            className={`text-sm px-3 py-2 rounded border ${
              w.severity === "danger"
                ? "bg-red-950/60 text-red-300 border-red-800"
                : w.severity === "warning"
                  ? "bg-amber-950/60 text-amber-300 border-amber-800"
                  : "bg-blue-950/60 text-blue-300 border-blue-800"
            }`}
          >
            {w.message}
          </div>
        ))}

      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-zinc-700">
        {data.outputs.map((out) => (
          <div key={out.id} className="bg-zinc-800/70 rounded-lg p-3">
            <div className="text-xs text-zinc-400 mb-1">{out.label}</div>
            <div className="text-2xl font-mono font-semibold text-zinc-100 tabular-nums">
              {outputs[out.id] !== undefined
                ? `${Number(outputs[out.id]).toFixed(1)}`
                : "—"}
              <span className="text-sm font-normal text-zinc-400 ml-1">{out.unit}</span>
            </div>
            {out.description && (
              <div className="text-xs text-zinc-500 mt-1">{out.description}</div>
            )}
          </div>
        ))}
      </div>

      {data.citation && (
        <p className="text-xs text-zinc-500 text-right">{data.citation}</p>
      )}
    </div>
  );
}

function InputControl({
  input,
  value,
  onChange,
}: {
  input: CalculatorInput;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  const opts = input.options as RawOpt[] | undefined;

  if (opts?.length) {
    return (
      <div>
        <label className="text-sm text-zinc-300 block mb-1.5">
          {input.label}
          {input.unit ? <span className="text-zinc-500 ml-1">({input.unit})</span> : null}
        </label>
        <select
          value={String(value)}
          onChange={(e) => {
            const opt = opts.find((o) => String(optValue(o)) === e.target.value);
            if (opt !== undefined) onChange(optValue(opt));
          }}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
        >
          {opts.map((o, i) => (
            <option key={i} value={String(optValue(o))}>
              {optLabel(o)}
            </option>
          ))}
        </select>
        {input.description && <p className="text-xs text-zinc-500 mt-1">{input.description}</p>}
      </div>
    );
  }

  const min = input.min ?? 0;
  const max = input.max ?? 100;
  const step = input.step ?? 1;
  const num = typeof value === "number" ? value : parseFloat(String(value)) || min;

  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <label className="text-zinc-300">
          {input.label}
          {input.unit ? <span className="text-zinc-500 ml-1">({input.unit})</span> : null}
        </label>
        <span className="font-mono text-zinc-100 tabular-nums font-medium">
          {Number.isInteger(step) ? num : num.toFixed(1)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={num}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-blue-500 cursor-pointer"
      />
      <div className="flex justify-between text-xs text-zinc-600 mt-0.5">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {input.description && <p className="text-xs text-zinc-500 mt-1">{input.description}</p>}
    </div>
  );
}
