"use client";

import { useEffect, useState } from "react";
import type { GeneratedImageData } from "../types.js";

const urlCache = new Map<string, string>();

export default function GeneratedImage({ data }: { data: GeneratedImageData }) {
  const cached = urlCache.get(data.prompt);
  const [url, setUrl] = useState<string | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    if (urlCache.has(data.prompt)) {
      setUrl(urlCache.get(data.prompt)!);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: data.prompt }),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const errBody = await r.json().catch(() => ({ error: r.statusText }));
          throw new Error((errBody as { error?: string }).error ?? `HTTP ${r.status}`);
        }
        return r.json() as Promise<{ url: string }>;
      })
      .then(({ url: generatedUrl }) => {
        urlCache.set(data.prompt, generatedUrl);
        setUrl(generatedUrl);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => controller.abort();
  }, [data.prompt]);

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

      <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 p-4 min-h-[400px] flex items-center justify-center">
        {loading && (
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-400">Generating illustration…</span>
            <span className="text-xs text-zinc-600">~5–10 seconds</span>
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <span className="text-sm text-orange-400">Image generation failed</span>
            <span className="text-xs text-zinc-500 max-w-md break-words">{error}</span>
          </div>
        )}
        {url && !loading && (
          <img
            src={url}
            alt={data.title}
            className="w-full h-auto rounded-md max-h-[600px] object-contain"
          />
        )}
      </div>

      {data.caption && (
        <p className="text-sm text-zinc-400 leading-relaxed">{data.caption}</p>
      )}
      {data.citation && (
        <p className="text-xs text-zinc-600 text-right font-mono">{data.citation}</p>
      )}
    </div>
  );
}
