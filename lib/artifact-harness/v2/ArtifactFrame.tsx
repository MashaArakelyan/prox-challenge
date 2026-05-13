'use client';
import { useEffect, useRef, useState } from 'react';

type Props = { code: string; minHeight?: number };

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
    iframeRef.current?.contentWindow?.postMessage({ type: 'ARTIFACT_RENDER', code }, '*');
  }, [ready, code]);

  return (
    <div style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <iframe
        ref={iframeRef}
        src="/artifact-frame-v2.html"
        sandbox="allow-scripts"
        style={{ width: '100%', height, border: 'none', display: 'block' }}
        title="Artifact"
      />
      {error && (
        <div style={{ padding: 12, color: '#b91c1c', background: '#fef2f2', fontSize: 13, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', borderTop: '1px solid #fecaca' }}>
          {error}
        </div>
      )}
    </div>
  );
}
