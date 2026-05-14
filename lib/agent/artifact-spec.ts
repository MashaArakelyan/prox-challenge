// Re-exports canonical types and provides runtime validation guards.

export type {
  ArtifactSpec, ArtifactKind,
  CodeArtifactSpec, ImageArtifactSpec, ManualPageArtifactSpec,
  Annotation,
} from "../artifact-harness/types.js";

export { ARTIFACT_KINDS } from "../artifact-harness/types.js";
import { ARTIFACT_KINDS } from "../artifact-harness/types.js";
import type { ArtifactSpec } from "../artifact-harness/types.js";

type ValidationResult = { ok: true; spec: ArtifactSpec } | { ok: false; error: string };

export function validateArtifactSpec(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'spec must be an object' };
  const s = input as Record<string, unknown>;
  if (typeof s.kind !== 'string') return { ok: false, error: 'spec.kind is required' };
  if (!(ARTIFACT_KINDS as readonly string[]).includes(s.kind)) {
    return { ok: false, error: `spec.kind must be one of: ${ARTIFACT_KINDS.join(', ')}; got "${s.kind}"` };
  }

  switch (s.kind) {
    case 'code':
      if (typeof s.code !== 'string' || !s.code.trim())
        return { ok: false, error: 'code spec requires a non-empty code string' };
      return { ok: true, spec: { kind: 'code', code: s.code as string, title: s.title as string | undefined } };

    case 'image':
      if (typeof s.url !== 'string' || !s.url.trim())
        return { ok: false, error: 'image spec requires a non-empty url string' };
      return { ok: true, spec: { kind: 'image', url: s.url as string, alt: s.alt as string | undefined, caption: s.caption as string | undefined } };

    case 'manual_page':
      if (typeof s.pageRef !== 'string')
        return { ok: false, error: 'manual_page spec requires pageRef string' };
      return { ok: true, spec: { kind: 'manual_page', pageRef: s.pageRef as string, caption: s.caption as string | undefined } };

    default:
      return { ok: false, error: `unknown artifact kind: ${s.kind}` };
  }
}
