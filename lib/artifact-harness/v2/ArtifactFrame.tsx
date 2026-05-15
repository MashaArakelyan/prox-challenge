'use client';
import { useEffect, useRef, useState } from 'react';

type Props = { code: string; minHeight?: number };

// Fetch a same-origin SVG and return a base64 data URL.
// Called from the parent page (not the sandboxed iframe) so origin is fine.
async function svgToDataUrl(path: string): Promise<string> {
  const resp = await fetch(path);
  const text = await resp.text();
  // btoa requires Latin-1; encode UTF-8 via TextEncoder then base64
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

// Replace /chassis/*.svg hrefs in code with data URLs so the sandboxed
// iframe (null origin) can load them without cross-origin issues.
async function inlineChassisAssets(code: string): Promise<string> {
  const matches = [...code.matchAll(/\/chassis\/([a-z0-9_-]+)\.svg/g)];
  if (matches.length === 0) return code;

  const seen = new Set<string>();
  const unique = matches.filter(m => { if (seen.has(m[0])) return false; seen.add(m[0]); return true; });

  const replacements = await Promise.all(
    unique.map(async ([full]) => {
      const dataUrl = await svgToDataUrl(full);
      return [full, dataUrl] as [string, string];
    })
  );

  let result = code;
  for (const [original, dataUrl] of replacements) {
    result = result.split(original).join(dataUrl);
  }
  return result;
}

export function ArtifactFrame({ code, minHeight = 120 }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ARTIFACT_READY') setReady(true);
      else if (msg.type === 'ARTIFACT_RESIZE') setHeight(Math.max(minHeight, msg.height + 8));
      else if (msg.type === 'ARTIFACT_ERROR') setError(msg.message);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [minHeight]);

  useEffect(() => {
    if (!ready) return;
    setError(null);

    inlineChassisAssets(code).then(processedCode => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'ARTIFACT_RENDER', code: processedCode }, '*');
    }).catch(err => {
      // Fallback: send original code if asset substitution fails
      console.warn('[ArtifactFrame] chassis asset inline failed:', err);
      iframeRef.current?.contentWindow?.postMessage({ type: 'ARTIFACT_RENDER', code }, '*');
    });
  }, [ready, code]);

  return (
    <div style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      {!error && (
        <iframe
          ref={iframeRef}
          src="/artifact-frame.html"
          sandbox="allow-scripts"
          style={{ width: '100%', height, border: 'none', display: 'block' }}
          title="Artifact"
        />
      )}
      {error && (
        <div style={{ padding: 12, color: '#b91c1c', background: '#fef2f2', fontSize: 13, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>
          Render error: {error}
        </div>
      )}
    </div>
  );
}
