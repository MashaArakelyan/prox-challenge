// Central config for the ingestion pipeline.
// All three extraction scripts import MODEL_* from here — never hardcode model IDs elsewhere.
//
// Model selection rationale:
//   Structural  → Haiku 4.5   : transcription-heavy (table rows, entity names, bbox labels)
//   Procedural  → Sonnet 4.6  : moderate reasoning (step boundaries, postcondition language)
//   Diagnostic  → Opus 4.7    : strong reasoning (prior estimation, likelihood ratio assignment)
//
// This split drops a full ingestion run from ~$25 to ~$5–8, making prompt iteration cheap.

export const MODEL_STRUCTURAL  = "claude-haiku-4-5-20251001";
export const MODEL_PROCEDURAL  = "claude-sonnet-4-6";
export const MODEL_DIAGNOSTIC  = "claude-opus-4-7";

// Schema inference reads ~10 pages and produces the ontology; reasoning quality matters.
export const MODEL_SCHEMA      = "claude-sonnet-4-6";

// Salience synthesis reads assembled JSON, not raw pages; Sonnet is sufficient.
export const MODEL_SALIENCE    = "claude-sonnet-4-6";

export const INGEST_PDF_PATH   = "files/owner-manual.pdf";
export const DATA_DIR          = "data";
