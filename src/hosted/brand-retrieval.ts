/**
 * Hosted brand retrieval — consumes the prebuilt `brandKnowledgeCorpus` +
 * `retrievalManifest` that UCS ships inside the compiled pull package and
 * returns a provenance-grade `BrandRetrievalResult` (scored hits with
 * citations, confidence, coverage, and blind spots).
 *
 * This is a faithful port of the UCS query engine
 * (app/tools/lib/brand-retrieval-runtime.ts → queryBrandKnowledgeCorpus). The
 * MCP only CONSUMES a corpus/manifest it received over the wire; it never
 * builds one (that stays UCS-side, the single source of compilation truth).
 * Keeping the ranking identical means hosted MCP search matches what the
 * Brand Console and other UCS surfaces return for the same query.
 */
import type {
  BrandKnowledgeCorpus,
  BrandKnowledgeDocument,
  BrandKnowledgeSourceKind,
  BrandKnowledgeTransportProfile,
  BrandProvenanceConfidence,
  BrandRetrievalConfidenceBreakdown,
  BrandRetrievalHit,
  BrandRetrievalManifest,
  BrandRetrievalQuery,
  BrandRetrievalQueryMode,
  BrandRetrievalSourceClass,
} from "../connectors/brandcode/knowledge-types.js";

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueTokens(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .flatMap((value) =>
          typeof value === "string"
            ? value
                .split(/\s+/)
                .map((token) => token.trim())
                .filter(Boolean)
            : [],
        )
        .filter(Boolean),
    ),
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => normalizeText(value)).filter(Boolean)),
  );
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "if",
  "in", "into", "is", "it", "of", "on", "or", "so", "the", "to", "too", "with",
]);

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function excerptAround(text: string, queryTokens: string[], radius = 120): string {
  const source = String(text ?? "");
  if (!source) return "";
  const lower = source.toLowerCase();
  const firstToken = queryTokens.find((token) => lower.includes(token.toLowerCase()));
  if (!firstToken) {
    return source.length <= radius * 2 ? source : `${source.slice(0, radius * 2)}...`;
  }
  const startIndex = lower.indexOf(firstToken.toLowerCase());
  const start = Math.max(0, startIndex - radius);
  const end = Math.min(source.length, startIndex + firstToken.length + radius);
  return `${start > 0 ? "..." : ""}${source.slice(start, end)}${end < source.length ? "..." : ""}`;
}

function buildReasonList(input: {
  directMatches: string[];
  tagMatches?: string[];
  extra?: string[];
}): string[] {
  return [
    ...(input.directMatches.length > 0
      ? [`Direct token overlap: ${input.directMatches.join(", ")}`]
      : []),
    ...((input.tagMatches?.length ?? 0) > 0
      ? [`Tag overlap: ${input.tagMatches?.join(", ")}`]
      : []),
    ...(input.extra ?? []),
  ];
}

function queryModeSourceKinds(
  mode: BrandRetrievalQueryMode,
): BrandKnowledgeSourceKind[] | null {
  switch (mode) {
    case "fact_lookup":
      return ["graph_overview", "graph_node_summary", "proof_point", "stat", "application_rule"];
    case "doctrine_retrieval":
      return ["graph_overview", "graph_node_summary", "narrative", "brand_phrase", "application_rule"];
    case "asset_retrieval":
      return ["asset_metadata", "graph_node_summary"];
    case "evidence_retrieval":
      return ["review_evidence", "graph_node_summary", "proof_point"];
    case "coverage_discovery":
      return null;
    default:
      return null;
  }
}

const DEFAULT_TRANSPORT_PROFILE: BrandKnowledgeTransportProfile = "portable_balanced";

function getKnowledgeSourceKindsForTransportProfile(
  profile: BrandKnowledgeTransportProfile,
): BrandKnowledgeSourceKind[] {
  switch (profile) {
    case "portable_minimal":
      return ["graph_overview", "graph_node_summary", "narrative", "proof_point", "application_rule", "brand_phrase"];
    case DEFAULT_TRANSPORT_PROFILE:
      return ["graph_overview", "graph_node_summary", "narrative", "proof_point", "application_rule", "brand_phrase", "stat", "asset_metadata"];
    case "hosted_full":
    default:
      return [
        "graph_overview", "graph_node_summary", "narrative", "proof_point",
        "application_rule", "brand_phrase", "stat", "asset_metadata",
        "ocr_chunk", "transcript_chunk", "review_evidence", "adapter_note",
      ];
  }
}

const CONFIDENCE_RANK: Record<BrandProvenanceConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function confidenceMeets(
  actual: BrandProvenanceConfidence | null | undefined,
  minimum: BrandProvenanceConfidence,
): boolean {
  if (!actual) return minimum === "low";
  return CONFIDENCE_RANK[actual] >= CONFIDENCE_RANK[minimum];
}

function buildCitation(document: BrandKnowledgeDocument): string | null {
  const { sourcePath, sourceId, sourceType } = document.lineage;
  if (sourcePath && sourceId) return `${sourcePath}#${sourceId}`;
  if (sourcePath) return sourcePath;
  if (sourceType && sourceId) return `${sourceType}:${sourceId}`;
  if (sourceId) return sourceId;
  return null;
}

function scoreKnowledgeDocument(options: {
  document: BrandKnowledgeDocument;
  tokens: string[];
  mode: BrandRetrievalQueryMode;
  requestedTags: string[];
}): BrandRetrievalHit {
  const { document } = options;
  const haystackTokens = uniqueTokens([
    document.title,
    document.text,
    document.tags.join(" "),
  ]).map((token) => token.toLowerCase());
  const tokenSet = new Set(options.tokens);
  const directMatches = haystackTokens.filter((token) => tokenSet.has(token));
  const tagMatches = document.tags.filter((tag) =>
    options.requestedTags.includes(tag.toLowerCase()),
  );
  const modeBoost = queryModeSourceKinds(options.mode)?.includes(document.sourceKind) ? 4 : 0;
  const approvalState = document.facets.approvalState ?? "n/a";
  const approvalBoost = approvalState === "approved" ? 2 : approvalState === "rejected" ? -1 : 0;
  const confidence = document.lineage.confidence ?? null;
  const confidenceBoost = confidence === "high" ? 3 : confidence === "medium" ? 1 : 0;
  const score =
    directMatches.length * 5 + tagMatches.length * 3 + modeBoost + approvalBoost + confidenceBoost;

  const extra = [
    `Source class: ${document.facets.sourceClass}`,
    `Approval: ${approvalState}`,
  ];
  if (confidence) extra.push(`Confidence: ${confidence}`);

  return {
    id: document.id,
    sourceKind: document.sourceKind,
    title: document.title,
    score,
    excerpt: excerptAround(document.text, options.tokens),
    reasons: buildReasonList({
      directMatches: directMatches.slice(0, 4),
      tagMatches: tagMatches.slice(0, 3),
      extra,
    }),
    tags: document.tags,
    sourceClass: document.facets.sourceClass,
    approvalState,
    confidence,
    citation: buildCitation(document),
  };
}

function zeroConfidenceBreakdown(): BrandRetrievalConfidenceBreakdown {
  return { high: 0, medium: 0, low: 0 };
}

/**
 * Run a query against a prebuilt corpus + manifest. Mirrors the UCS engine so
 * hosted MCP search ranks identically to Brand Console retrieval.
 */
export function queryBrandKnowledgeCorpus(input: {
  corpus: BrandKnowledgeCorpus;
  manifest?: BrandRetrievalManifest | null;
  query: BrandRetrievalQuery;
}): import("../connectors/brandcode/knowledge-types.js").BrandRetrievalResult {
  const mode = input.query.mode ?? "fact_lookup";
  const topK = Math.max(1, input.query.topK ?? 5);
  const tokens = tokenize(input.query.text);
  const transportProfile = input.query.transportProfile ?? null;
  const requestedKinds =
    input.query.sourceKinds ??
    queryModeSourceKinds(mode) ??
    getKnowledgeSourceKindsForTransportProfile("hosted_full");
  const allowedKinds = new Set(requestedKinds);
  const allowedClasses = input.query.sourceClasses ? new Set(input.query.sourceClasses) : null;
  const requestedTags = (input.query.tags ?? []).map((tag) => tag.toLowerCase());
  const transportAllowedKinds = transportProfile
    ? new Set(getKnowledgeSourceKindsForTransportProfile(transportProfile))
    : null;
  const minConfidence = input.query.minConfidence ?? null;

  const scopedDocuments = input.corpus.documents.filter((document) => {
    if (transportAllowedKinds && !transportAllowedKinds.has(document.sourceKind)) return false;
    if (!allowedKinds.has(document.sourceKind)) return false;
    if (allowedClasses && !allowedClasses.has(document.facets.sourceClass)) return false;
    if (minConfidence && !confidenceMeets(document.lineage.confidence, minConfidence)) return false;
    return true;
  });

  const hits = scopedDocuments
    .map((document) => scoreKnowledgeDocument({ document, tokens, mode, requestedTags }))
    .filter((hit) => hit.score > 0 || mode === "coverage_discovery")
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);

  const transportExcludedKinds = transportAllowedKinds
    ? requestedKinds.filter((kind) => !transportAllowedKinds.has(kind))
    : [];
  const unavailableSourceClasses =
    allowedClasses && input.manifest
      ? input.manifest.sourceCoverage
          .filter(
            (entry) =>
              allowedClasses.has(entry.sourceClass) &&
              entry.status !== "indexed" &&
              entry.status !== "partial",
          )
          .map((entry) => entry.sourceClass)
      : [];
  const warnings = uniqueStrings([
    ...(input.manifest?.warnings ?? []),
    ...(transportExcludedKinds.length > 0 && transportProfile
      ? [`Transport profile ${transportProfile} excludes requested source kinds: ${transportExcludedKinds.join(", ")}.`]
      : []),
    ...(unavailableSourceClasses.length > 0
      ? [`Requested source classes are not fully indexed: ${unavailableSourceClasses.join(", ")}.`]
      : []),
    ...(hits.length === 0 ? ["No retrieval hits matched the current query scope."] : []),
    ...(mode === "coverage_discovery" || hits.length === 0
      ? (input.manifest?.knownBlindSpots ?? [])
      : []),
  ]);

  const confidenceSummary = zeroConfidenceBreakdown();
  for (const hit of hits) {
    if (hit.confidence === "high" || hit.confidence === "medium" || hit.confidence === "low") {
      confidenceSummary[hit.confidence] += 1;
    }
  }

  return {
    brandSlug: input.corpus.brandSlug,
    runtimeVersion: input.corpus.runtimeVersion,
    query: {
      text: input.query.text,
      mode,
      topK,
      tokens,
      transportProfile,
      minConfidence,
    },
    hits,
    confidenceSummary,
    blindSpots: input.manifest?.knownBlindSpots ?? [],
    warnings,
    coverage:
      input.manifest?.sourceCoverage.map((entry) => ({
        sourceClass: entry.sourceClass,
        status: entry.status,
        documentCount: entry.documentCount,
      })) ?? [],
  };
}
