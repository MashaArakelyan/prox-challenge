"use client";

import type { Annotation } from "../types.js";

interface AnnotatedImageProps {
  src: string;
  title?: string;
  caption?: string;
  citation?: string;
  // Annotations disabled — manual pages already have their own labels.
  // Preserved in the type so existing history data doesn't break, but nothing is drawn.
  annotations?: Annotation[];
}

export default function AnnotatedImage({ src, title, caption, citation }: AnnotatedImageProps) {
  return (
    <div className="w-full text-zinc-100 space-y-3">
      {title && (
        <div>
          <h3 className="font-['Playfair_Display'] italic text-xl text-zinc-100 leading-tight">
            {title}
          </h3>
          <div className="h-px bg-gradient-to-r from-orange-500/40 via-zinc-700 to-transparent mt-2" />
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={title ?? "manual diagram"} className="block w-full rounded" />
      </div>

      {caption && <p className="text-sm text-zinc-400 leading-relaxed">{caption}</p>}
      {citation && <p className="text-xs text-zinc-600 text-right font-mono">{citation}</p>}
    </div>
  );
}
