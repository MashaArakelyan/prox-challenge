"use client";

import { useState, type FormEvent } from "react";

interface Props {
  onKey: (key: string) => void;
}

export default function ApiKeyModal({ onKey }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed.startsWith("sk-ant-")) {
      setError("Key must start with sk-ant-");
      return;
    }
    onKey(trimmed);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded flex items-center justify-center text-sm font-bold text-white bg-orange-600 shrink-0">
            V
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">OmniPro 220 Agent</p>
            <p className="text-xs text-zinc-500">Anthropic API key required</p>
          </div>
        </div>

        <p className="text-sm text-zinc-300 mb-1">
          Paste your Anthropic API key to get started.
        </p>
        <p className="text-xs text-zinc-500 mb-5">
          Stored only in your browser. Sent only to the official Anthropic API. Never logged.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(""); }}
            placeholder="sk-ant-..."
            autoFocus
            className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-400 transition-colors font-mono"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={!value.trim()}
            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-colors"
          >
            Save key and continue
          </button>
        </form>

        <p className="text-xs text-zinc-600 mt-4 text-center">
          No key?{" "}
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-200 underline"
          >
            Get one at console.anthropic.com
          </a>
        </p>
      </div>
    </div>
  );
}
