'use client';
import { useState } from 'react';

export default function ImageTestPage() {
  const [prompt, setPrompt] = useState('Technical line drawing of a MIG welder wire feed mechanism showing drive rolls, spool hub, and tensioner. Clean black-and-white illustration style on white background.');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setImageUrl(null);
    try {
      const geminiKey = typeof window !== 'undefined' ? localStorage.getItem('gemini_api_key') : null;
      if (!geminiKey) {
        setError('No Gemini key in localStorage. Add one via the main app key modal, or paste this in DevTools:\nlocalStorage.setItem("gemini_api_key", "YOUR_KEY")');
        setLoading(false);
        return;
      }
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
        },
        body: JSON.stringify({ prompt }),
      });
      const data = await resp.json() as { error?: string; detail?: string; url?: string };
      if (!resp.ok) {
        setError(`Error ${resp.status}: ${data.error ?? ''}${data.detail ? '\n' + data.detail : ''}`);
      } else {
        setImageUrl(data.url ?? null);
      }
    } catch (e: unknown) {
      setError(`Fetch failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Nano-banana image test</h1>
      <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>
        Tests the /api/generate route end-to-end with Gemini. Requires <code>gemini_api_key</code> in localStorage.
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        style={{ width: '100%', padding: 8, border: '1px solid #e5e7eb', borderRadius: 6, fontFamily: 'inherit', fontSize: 14, marginBottom: 12, boxSizing: 'border-box' }}
      />
      <button
        onClick={generate}
        disabled={loading || !prompt.trim()}
        style={{ padding: '8px 16px', background: loading ? '#9ca3af' : '#111', color: '#fff', border: 'none', borderRadius: 6, cursor: loading ? 'wait' : 'pointer', fontSize: 14 }}
      >
        {loading ? 'Generating…' : 'Generate image'}
      </button>
      {error && (
        <pre style={{ marginTop: 16, padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>{error}</pre>
      )}
      {imageUrl && (
        <div style={{ marginTop: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Generated" style={{ maxWidth: '100%', border: '1px solid #e5e7eb', borderRadius: 6 }} />
        </div>
      )}
    </div>
  );
}
