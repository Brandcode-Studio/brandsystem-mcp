/**
 * Brand knowledge + retrieval contract — the subset of the UCS
 * BrandAdapterPayload that the hosted MCP consumes for `brand_search` and the
 * `brand_runtime` voice/strategy slices.
 *
 * Mirrors the canonical source in UCS
 * (app/tools/lib/brand-instance-types.ts). Kept as a typed-but-tolerant
 * subset: every consuming tool treats these as best-effort and falls back when
 * fields are absent, so a UCS shape change degrades softly rather than
 * crashing. The compiled pull package carries `brandKnowledgeCorpus` and
 * `retrievalManifest` (built by UCS buildBrandRetrievalArtifacts), which is
 * what makes provenance-grade search possible without re-deriving a corpus.
 */

export type BrandProvenanceConfidence = "low" | "medium" | "high";

export type BrandKnowledgeSourceKind =
  | "graph_overview"
  | "graph_node_summary"
  | "narrative"
  | "proof_point"
  | "application_rule"
  | "brand_phrase"
  | "stat"
  | "asset_metadata"
  | "ocr_chunk"
  | "transcript_chunk"
  | "review_evidence"
  | "adapter_note";

export type BrandRetrievalSourceClass =
  | "runtime_graph"
  | "doctrine"
  | "governance"
  | "asset_metadata"
  | "ocr"
  | "transcript"
  | "review_evidence"
  | "adapter_notes";

export type BrandRetrievalQueryMode =
  | "fact_lookup"
  | "doctrine_retrieval"
  | "asset_retrieval"
  | "evidence_retrieval"
  | "coverage_discovery";

export type BrandKnowledgeTransportProfile =
  | "portable_minimal"
  | "portable_balanced"
  | "hosted_full";

export type BrandRetrievalCoverageStatus =
  | "indexed"
  | "partial"
  | "missing"
  | "stale"
  | "blocked";

export type BrandRetrievalApprovalState =
  | "approved"
  | "rejected"
  | "provisional"
  | "n/a";

export interface BrandKnowledgeDocument {
  id: string;
  corpusId?: string;
  sourceKind: BrandKnowledgeSourceKind;
  title: string;
  text: string;
  embeddingText?: string;
  tags: string[];
  facets: {
    brandSlug?: string;
    surface?: string | null;
    assetCategory?: string | null;
    sourceClass: BrandRetrievalSourceClass;
    approvalState?: BrandRetrievalApprovalState;
    language?: string | null;
  };
  lineage: {
    graphNodeId?: string | null;
    sourcePath?: string | null;
    sourceId?: string | null;
    sourceType?: string | null;
    confidence?: BrandProvenanceConfidence | null;
    derivedFrom?: string[];
  };
  freshness: {
    runtimeVersion?: string;
    syncToken?: string | null;
    generatedAt?: string;
  };
}

export interface BrandKnowledgeCorpus {
  brandSlug: string;
  runtimeVersion: string;
  generatedAt?: string;
  syncToken?: string | null;
  documents: BrandKnowledgeDocument[];
  summary?: {
    documentCount: number;
    bySourceKind: Partial<Record<BrandKnowledgeSourceKind, number>>;
  };
}

export interface BrandRetrievalConfidenceBreakdown {
  high: number;
  medium: number;
  low: number;
}

export interface BrandRetrievalCoverageEntry {
  sourceClass: BrandRetrievalSourceClass;
  status: BrandRetrievalCoverageStatus;
  documentCount: number;
  confidence?: BrandRetrievalConfidenceBreakdown;
  notes?: string[];
}

export interface BrandRetrievalManifest {
  brandSlug: string;
  runtimeVersion: string;
  syncToken?: string | null;
  generatedAt?: string;
  sourceCoverage: BrandRetrievalCoverageEntry[];
  confidenceSummary: BrandRetrievalConfidenceBreakdown;
  governancePaths?: Array<{ path: string; documentCount: number }>;
  freshness?: {
    oldestGeneratedAt: string | null;
    newestGeneratedAt: string | null;
  };
  knownBlindSpots: string[];
  warnings: string[];
}

export interface BrandRetrievalQuery {
  text: string;
  mode?: BrandRetrievalQueryMode;
  topK?: number;
  transportProfile?: BrandKnowledgeTransportProfile | null;
  sourceKinds?: BrandKnowledgeSourceKind[];
  sourceClasses?: BrandRetrievalSourceClass[];
  tags?: string[];
  minConfidence?: BrandProvenanceConfidence;
}

export interface BrandRetrievalHit {
  id: string;
  sourceKind: BrandKnowledgeSourceKind;
  title: string;
  score: number;
  excerpt: string;
  reasons: string[];
  tags: string[];
  sourceClass: BrandRetrievalSourceClass;
  approvalState: BrandRetrievalApprovalState;
  confidence: BrandProvenanceConfidence | null;
  citation: string | null;
}

export interface BrandRetrievalResult {
  brandSlug: string;
  runtimeVersion: string;
  query: {
    text: string;
    mode: BrandRetrievalQueryMode;
    topK: number;
    tokens: string[];
    transportProfile: BrandKnowledgeTransportProfile | null;
    minConfidence: BrandProvenanceConfidence | null;
  };
  hits: BrandRetrievalHit[];
  confidenceSummary: BrandRetrievalConfidenceBreakdown;
  blindSpots: string[];
  warnings: string[];
  coverage: Array<{
    sourceClass: BrandRetrievalSourceClass;
    status: BrandRetrievalCoverageStatus;
    documentCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Structured governance arrays carried on brandInstance.
// Trimmed to the fields the hosted tools read; every field optional so older
// or sparser payloads degrade rather than throw.
// ---------------------------------------------------------------------------

export interface BrandInstanceProofPoint {
  id: string;
  claim: string;
  type?: string;
  status?: string;
  tier?: string;
  narrative?: string;
  notes?: string;
}

export interface BrandInstanceNarrative {
  id: string;
  name: string;
  status?: string;
  type?: string;
  description?: string;
  key_messages?: string[];
  content_types?: string[];
  target_personas?: string[];
}

export interface BrandInstancePhrase {
  phrase: string;
  arc_position?: string;
  usage?: string;
  deploy_verbatim?: boolean;
}

export interface BrandInstanceStat {
  stat: string;
  explainer?: string;
  tier?: string;
  proof_point?: string;
}

export interface BrandInstanceApplicationRule {
  id: string;
  content_type: string;
  touchpoint?: string;
  framework?: string;
  required_elements?: string[];
  tone?: string;
  guidance?: string;
  journey_stage?: string;
}

export interface BrandInstanceStrategyMove {
  move: number;
  name: string;
  status?: string;
  timeline?: string;
  rules?: string[];
}

/**
 * The structured brand instance UCS serves in the pull package. Every field is
 * optional: the MCP consumes best-effort and tolerates older/sparser shapes.
 * The index signature keeps it compatible with the loose Record reads the
 * tools still use for tokens/fonts/assets.
 */
export interface BrandInstancePayload {
  manifest?: Record<string, unknown>;
  perspective?: string;
  verbalIdentity?: string;
  proofPoints?: BrandInstanceProofPoint[];
  narratives?: BrandInstanceNarrative[];
  brandPhrases?: BrandInstancePhrase[];
  stats?: BrandInstanceStat[];
  applicationRules?: BrandInstanceApplicationRule[];
  strategyMoves?: BrandInstanceStrategyMove[];
  tokens?: Record<string, unknown>;
  fonts?: Record<string, unknown>;
  assets?: unknown[];
  libraryAssets?: unknown[];
  readiness?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  [key: string]: unknown;
}
