'use client';
// ARCHIVED: original template dispatcher. Kept for reference during v2 rebuild.
// To restore, uncomment the block below and remove the stub export.

/*
"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtifactSpec, GeneratedImageData, ImageArtifact } from "./types.js";
import TwoCurveChart from "./templates/two_curve_chart.js";
import ComparisonTable from "./templates/comparison_table.js";
import ParameterCalculator from "./templates/parameter_calculator.js";
import ConnectionDiagram from "./templates/connection_diagram.js";
import InteractivePanel from "./templates/interactive_panel.js";
import TroubleshootingFlowchart from "./templates/troubleshooting_flowchart.js";
import GeneratedImage from "./templates/generated_image.js";
import AnnotatedImage from "./templates/annotated_image.js";

export default function ArtifactRenderer({ spec }: { spec: ArtifactSpec }) {
  switch (spec.kind) {
    case "template":
      return <TemplateRenderer spec={spec} />;
    case "image": {
      const img = spec as ImageArtifact;
      return <AnnotatedImage src={img.src} title={img.title} caption={img.caption} citation={img.citation} annotations={img.annotations} />;
    }
    case "react":
      return <ReactArtifact code={spec.code} />;
    case "html":
      return <HtmlArtifact content={spec.content} />;
    case "svg":
      return <SvgArtifact content={spec.content} caption={spec.caption} />;
    case "mermaid":
      return <MermaidArtifact diagram={spec.diagram} caption={spec.caption} />;
  }
}

function TemplateRenderer({ spec }: { spec: Extract<ArtifactSpec, { kind: "template" }> }) {
  switch (spec.template) {
    case "two_curve_chart":         return <TwoCurveChart data={spec.data} />;
    case "comparison_table":        return <ComparisonTable data={spec.data} />;
    case "parameter_calculator":    return <ParameterCalculator data={spec.data} />;
    case "connection_diagram":      return <ConnectionDiagram data={spec.data} />;
    case "interactive_panel":       return <InteractivePanel data={spec.data} />;
    case "troubleshooting_flowchart": return <TroubleshootingFlowchart data={spec.data} />;
    case "generated_image":         return <GeneratedImage data={spec.data as GeneratedImageData} />;
  }
}

// ── React artifact — Babel + React Runner in sandboxed iframe ─────────────────

function ReactArtifact({ code }: { code: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(300);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "ready") setReady(true);
      if (e.data?.type === "resize") setHeight(Math.max(120, (e.data.height as number) + 24));
      if (e.data?.type === "error") setError(e.data.message as string);
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    if (ready) {
      iframeRef.current?.contentWindow?.postMessage({ type: "render", code }, "*");
    }
  }, [ready, code]);

  return (
    <div>
      {error && (
        <div className="text-red-400 text-xs p-2 bg-red-950/40 rounded mb-2 border border-red-900">
          Render error: {error}
        </div>
      )}
      <iframe
        ref={iframeRef}
        src="/artifact-frame.html"
        sandbox="allow-scripts"
        className="w-full border-0 rounded block"
        style={{ height }}
        title="React artifact"
      />
    </div>
  );
}

// ── HTML artifact — DOMPurify sanitised, sandboxed iframe ─────────────────────

function HtmlArtifact({ content }: { content: string }) {
  const [srcdoc, setSrcdoc] = useState<string | null>(null);

  useEffect(() => {
    import("dompurify").then(({ default: DOMPurify }) => {
      setSrcdoc(DOMPurify.sanitize(content, { FORCE_BODY: true }));
    });
  }, [content]);

  if (!srcdoc) return <LoadingPlaceholder />;

  return (
    <iframe
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      className="w-full min-h-[400px] border-0 rounded block"
      title="HTML artifact"
    />
  );
}

// ── SVG artifact — inline, DOMPurify sanitised ────────────────────────────────

function SvgArtifact({ content, caption }: { content: string; caption?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    import("dompurify").then(({ default: DOMPurify }) => {
      setHtml(DOMPurify.sanitize(content, { USE_PROFILES: { svg: true, svgFilters: true } }));
    });
  }, [content]);

  return (
    <div>
      {html ? (
        <div
          className="w-full overflow-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <LoadingPlaceholder />
      )}
      {caption && <p className="text-xs text-zinc-500 mt-2">{caption}</p>}
    </div>
  );
}

// ── Mermaid artifact ──────────────────────────────────────────────────────────

function MermaidArtifact({ diagram, caption }: { diagram: string; caption?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({ startOnLoad: false, theme: "dark" });
      const id = `mmd-${Math.random().toString(36).slice(2)}`;
      mermaid
        .render(id, diagram)
        .then(({ svg }) => {
          if (!cancelled && ref.current) ref.current.innerHTML = svg;
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        });
    });
    return () => { cancelled = true; };
  }, [diagram]);

  return (
    <div>
      {error ? (
        <div className="text-red-400 text-xs p-2">{error}</div>
      ) : (
        <div ref={ref} className="w-full overflow-auto" />
      )}
      {caption && <p className="text-xs text-zinc-500 mt-2">{caption}</p>}
    </div>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="text-zinc-500 text-sm p-4 text-center">Loading…</div>
  );
}
*/

import type { ArtifactSpec } from './types';

export default function ArtifactRenderer({ spec: _spec }: { spec: ArtifactSpec }) {
  // v2 rebuild in progress. Old templates archived above.
  // New renderer lives in lib/artifact-harness/v2/.
  return (
    <div style={{ padding: 12, color: '#9ca3af', fontSize: 13, fontStyle: 'italic', border: '1px dashed #e5e7eb', borderRadius: 6 }}>
      Artifact renderer offline during rebuild — spec received, no render path yet.
    </div>
  );
}
