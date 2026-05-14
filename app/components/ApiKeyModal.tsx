"use client";

import { useState, type FormEvent } from "react";

interface Props {
  onKey: (key: string) => void;
}

export default function ApiKeyModal({ onKey }: Props) {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = anthropicKey.trim();
    if (!trimmed.startsWith("sk-ant-")) {
      setError("Anthropic key must start with sk-ant-");
      return;
    }
    const geminiTrimmed = geminiKey.trim();
    if (geminiTrimmed) {
      localStorage.setItem("gemini_api_key", geminiTrimmed);
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
            <p className="text-xs text-zinc-500">API keys required</p>
          </div>
        </div>

        <p className="text-sm text-zinc-300 mb-1">
          Paste your API keys to get started.
        </p>
        <p className="text-xs text-zinc-500 mb-5">
          Stored only in your browser. Never logged server-side.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
              Anthropic API Key <span className="text-orange-500">*</span>
            </label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => { setAnthropicKey(e.target.value); setError(""); }}
              placeholder="sk-ant-..."
              autoFocus
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-400 transition-colors font-mono"
            />
            <p className="text-xs text-zinc-600">
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-zinc-300 underline"
              >
                Get one at console.anthropic.com
              </a>
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
              Gemini API Key <span className="text-zinc-600">(optional — enables image generation)</span>
            </label>
            <input
              type="password"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder="AIza..."
              className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-400 transition-colors font-mono"
            />
            <p className="text-xs text-zinc-600">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-zinc-300 underline"
              >
                Get a free Gemini API key →
              </a>
            </p>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={!anthropicKey.trim()}
            className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white transition-colors"
          >
            Save keys and continue
          </button>
        </form>
      </div>
    </div>
  );
}
