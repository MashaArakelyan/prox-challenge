'use client';
import { ArtifactFrame } from './v2/ArtifactFrame';
import type { ArtifactSpec } from './types';

export function ArtifactRenderer({ spec }: { spec: ArtifactSpec }) {
  if (!spec || typeof spec !== 'object' || !('kind' in spec)) {
    return (
      <div style={{ padding: 12, color: '#9ca3af', fontSize: 13, fontStyle: 'italic', border: '1px dashed #e5e7eb', borderRadius: 6 }}>
        Invalid artifact spec
      </div>
    );
  }

  switch (spec.kind) {
    case 'code':
      return (
        <div style={{ marginTop: 8 }}>
          {spec.title && (
            <div style={{ fontSize: 13, fontWeight: 500, color: '#d4d4d8', marginBottom: 6 }}>{spec.title}</div>
          )}
          <ArtifactFrame code={spec.code} />
        </div>
      );

    case 'image':
      return (
        <div style={{ marginTop: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={spec.url}
            alt={spec.alt || 'Generated diagram'}
            style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #3f3f46', display: 'block' }}
          />
          {spec.caption && (
            <div style={{ fontSize: 12, color: '#71717a', marginTop: 6, fontStyle: 'italic' }}>{spec.caption}</div>
          )}
        </div>
      );

    case 'manual_page': {
      // pageRef is the resolved image URL from surface_region (e.g. /api/images/14_diagram_14_1.png)
      const src = spec.pageRef.startsWith('/') ? spec.pageRef : `/api/images/${spec.pageRef}`;
      return (
        <div style={{ marginTop: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={spec.caption || 'Manual diagram'}
            style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid #3f3f46', display: 'block' }}
          />
          {spec.caption && (
            <div style={{ fontSize: 12, color: '#71717a', marginTop: 6, fontStyle: 'italic' }}>{spec.caption}</div>
          )}
        </div>
      );
    }

    default: {
      const unknown = spec as { kind?: string };
      return (
        <div style={{ padding: 12, color: '#b91c1c', fontSize: 13, background: '#fef2f2', borderRadius: 6 }}>
          Unknown artifact kind: {unknown?.kind ?? '(none)'}
        </div>
      );
    }
  }
}

export default ArtifactRenderer;
