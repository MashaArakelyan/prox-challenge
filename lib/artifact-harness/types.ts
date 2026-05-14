// v2 artifact spec types — code-gen and image-gen primary, manual page as fallback.
// This file is the authoritative TypeScript interface; CONTRACT.md is the human-readable spec.

export interface Annotation {
  number: number;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  label: string;
}

export type CodeArtifactSpec = {
  kind: 'code';
  // React/JSX function expression returning a React element, followed by a render expression.
  // See /artifact-frame.html for evaluation context (React, Babel in scope, no imports).
  code: string;
  title?: string;
};

export type ImageArtifactSpec = {
  kind: 'image';
  url: string; // URL or data URL of the generated/surfaced image
  alt?: string;
  caption?: string;
};

export type ManualPageArtifactSpec = {
  kind: 'manual_page';
  // Resolved image URL from surface_region (e.g. /api/images/14_diagram_14_1.png)
  // or diagram_id as fallback. Pass the imageUrl from surface_region result directly.
  pageRef: string;
  caption?: string;
};

export type ArtifactSpec = CodeArtifactSpec | ImageArtifactSpec | ManualPageArtifactSpec;

export const ARTIFACT_KINDS = ['code', 'image', 'manual_page'] as const;
export type ArtifactKind = typeof ARTIFACT_KINDS[number];
