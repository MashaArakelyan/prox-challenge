'use client';
import { ArtifactFrame } from '../../lib/artifact-harness/v2/ArtifactFrame';

const testCode = `
function Demo() {
  const [count, setCount] = React.useState(0);
  return (
    <div style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18 }}>Iframe sandbox works</h2>
      <svg viewBox="0 0 200 100" width={200} height={100} style={{ display: 'block', marginBottom: 12 }}>
        <circle cx={50} cy={50} r={30} fill="#3b82f6" />
        <rect x={100} y={30} width={60} height={40} fill="#10b981" rx={6} />
      </svg>
      <button
        onClick={() => setCount(c => c + 1)}
        style={{ padding: '6px 12px', background: '#111', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
      >
        Clicked {count} times
      </button>
    </div>
  );
}

<Demo />
`;

export default function ArtifactTestPage() {
  return (
    <div style={{ maxWidth: 720, margin: '40px auto', padding: 20, fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Artifact harness v2 test</h1>
      <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>
        If you see an SVG with a blue circle + green rectangle and a working click counter button, the iframe sandbox + React Runner pipeline works.
      </p>
      <ArtifactFrame code={testCode} />
    </div>
  );
}
