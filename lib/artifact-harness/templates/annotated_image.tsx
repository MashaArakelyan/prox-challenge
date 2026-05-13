"use client";

import { useEffect, useRef } from "react";
import type { Annotation } from "../types.js";

interface AnnotatedImageProps {
  src: string;
  title?: string;
  caption?: string;
  citation?: string;
  annotations?: Annotation[];
}

export default function AnnotatedImage({ src, title, caption, citation, annotations = [] }: AnnotatedImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || annotations.length === 0) return;

    function draw() {
      if (!img || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = img.offsetWidth;
      const h = img.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      for (const ann of annotations) {
        const tx = ann.x * w;
        const ty = ann.y * h;
        const r = 14;
        const offset = 56;
        const pushRight = ann.x < 0.5;
        const pushDown = ann.y < 0.5;
        const bx = tx + (pushRight ? offset : -offset);
        const by = ty + (pushDown ? offset : -offset);

        // Crosshair dot at anchor
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 1.5;
        const ch = 6;
        ctx.beginPath();
        ctx.moveTo(tx - ch, ty); ctx.lineTo(tx + ch, ty);
        ctx.moveTo(tx, ty - ch); ctx.lineTo(tx, ty + ch);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#f97316";
        ctx.fill();

        // Leader line
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.55;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Badge circle
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = "#f97316";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "white";
        ctx.font = "bold 13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(ann.number), bx, by);

        // Label pill
        if (ann.label) {
          ctx.font = "11.5px system-ui, sans-serif";
          const m = ctx.measureText(ann.label);
          const pad = 7;
          const boxW = m.width + pad * 2;
          const boxH = 24;
          const boxX = pushRight ? bx + r + 8 : bx - r - 8 - boxW;
          const boxY = by - boxH / 2;

          ctx.fillStyle = "rgba(10,10,10,0.9)";
          ctx.strokeStyle = "rgba(249,115,22,0.6)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(boxX, boxY, boxW, boxH, 5);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "white";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(ann.label, boxX + pad, by);
        }
      }
    }

    if (img.complete && img.naturalWidth > 0) draw();
    else img.addEventListener("load", draw);
    window.addEventListener("resize", draw);
    return () => {
      img.removeEventListener("load", draw);
      window.removeEventListener("resize", draw);
    };
  }, [annotations, src]);

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
        <div className="relative inline-block w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={src} alt={title ?? "manual diagram"} className="block w-full rounded" />
          <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
        </div>
      </div>

      {caption && <p className="text-sm text-zinc-400 leading-relaxed">{caption}</p>}
      {citation && <p className="text-xs text-zinc-600 text-right font-mono">{citation}</p>}
    </div>
  );
}
