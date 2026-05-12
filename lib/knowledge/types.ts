// Typed interfaces for the five JSON stores + salience overlay + synthesis outputs.
// These mirror the shapes written by the ingestion scripts exactly — no transformation.

export type BBox = { x: number; y: number; width: number; height: number };

export type DiagramRegion = { label: string; bbox: BBox };

export type Entity = {
  id: string;
  name: string;
  type: string;
  description: string;
  page_refs: number[];
  is_new: boolean;
  salience: number;
};

export type Relation = {
  predicate: string;
  subject_id: string;
  object_id: string;
  page: number;
  salience: number;
};

export type Table = {
  id: string;
  name: string;
  page: number;
  columns: string[];
  rows: Record<string, string | number | null>[];
};

export type StepBranch = { condition: string; goto_step: number; note?: string };

export type Step = {
  step: number;
  instruction: string;
  postcondition: string | null;
  expected_image: string | null;
  entity_refs: string[];
  branches: StepBranch[];
};

export type Procedure = {
  id: string;
  name: string;
  description: string;
  applies_to_process: string | null;
  manual_citation: { page: number; section: string };
  steps: Step[];
};

export type LREntry = { lr_positive: number; source: string; note?: string };

export type Check = {
  id: string;
  question: string;
  modality: "self_report" | "user_photo" | "numeric_measurement";
  positive_meaning: string;
  likelihood_ratios: Record<string, LREntry>;
  recommended_action_if_positive: string;
};

export type Cause = {
  id: string;
  label: string;
  prior: number;
  prior_source: "manual_derived" | "manual_order_heuristic" | "llm_estimated";
  prior_note?: string;
};

export type Symptom = {
  id: string;
  label: string;
  description: string;
  process_scope: string | string[];
  causes: Cause[];
  checks: Check[];
  manual_citation: { page: number; section: string };
};

export type Diagram = {
  id: string;
  page: number;
  caption: string;
  save_crop: boolean;
  regions: DiagramRegion[];
  salience: number;
};

export type CriticalFact = {
  id: string;
  claim: string;
  process_scope: string | null;
  citation: {
    page?: number;
    table_id?: string | null;
    entity_id?: string | null;
    section?: string | null;
  };
};

export type CanonicalSetup = {
  id: string;
  label: string;
  process: string;
  material: string;
  thickness_in: number | null;
  input_voltage: string | null;
  settings: {
    voltage_v: number | null;
    wire_feed_speed_ipm: number | null;
    amperage_a: number | null;
    wire_type: string | null;
    wire_diameter_in: string | null;
    shielding_gas: string | null;
    polarity: string | null;
    electrode_class: string | null;
  };
  entity_refs: string[];
  diagram_refs: string[];
  manual_citation: { page: number };
};
