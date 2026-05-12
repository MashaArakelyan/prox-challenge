// Central config for the ingestion pipeline.
// All three extraction scripts import MODEL_* from here — never hardcode model IDs elsewhere.
//
// Model selection rationale:
//   Structural  → Sonnet 4.6  : upgraded from Haiku 4.5; table extraction quality was too low
//   Procedural  → Sonnet 4.6  : moderate reasoning (step boundaries, postcondition language)
//   Diagnostic  → Opus 4.7    : strong reasoning (prior estimation, likelihood ratio assignment)
//
// Sonnet structural adds ~$2–3 to a full run but recovers the tables the manual is judged on.

export const MODEL_STRUCTURAL  = "claude-sonnet-4-6";
export const MODEL_PROCEDURAL  = "claude-sonnet-4-6";
export const MODEL_DIAGNOSTIC  = "claude-opus-4-7";

// Schema inference reads ~10 pages and produces the ontology; reasoning quality matters.
export const MODEL_SCHEMA      = "claude-sonnet-4-6";

// Salience synthesis reads assembled JSON, not raw pages; Sonnet is sufficient.
export const MODEL_SALIENCE    = "claude-sonnet-4-6";

export const INGEST_PDF_PATH   = "files/owner-manual.pdf";
export const DATA_DIR          = "data";
