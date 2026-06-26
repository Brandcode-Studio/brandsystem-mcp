/**
 * Hosted `brand_search` tool.
 *
 * Searches governed read-only knowledge from the live UCS Brand package. This
 * is intentionally local to package reads: it does not call asset delivery,
 * selected-kit artifacts, check, feedback, history, or telemetry paths.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../../lib/response.js";
import type { BrandPackagePayload } from "../../connectors/brandcode/types.js";
import { queryBrandKnowledgeCorpus } from "../brand-retrieval.js";
import { enforceToolScope } from "../scope.js";
import type { HostedBrandContext } from "../types.js";

const paramsShape = {
  query: z
    .string()
    .describe("Natural-language query over hosted brand knowledge."),
  mode: z
    .enum([
      "fact_lookup",
      "doctrine_retrieval",
      "asset_retrieval",
      "evidence_retrieval",
      "coverage_discovery",
    ])
    .optional()
    .describe(
      "Retrieval intent (matches UCS query modes). 'fact_lookup' (default) for proof points/stats/rules; 'doctrine_retrieval' for narratives/phrases/voice; 'asset_retrieval' for asset metadata; 'evidence_retrieval' for review evidence; 'coverage_discovery' to inspect what is and isn't indexed.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum ranked hits to return."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

type SourceType =
  | "narrative"
  | "proof_point"
  | "application_rule"
  | "brand_phrase"
  | "readiness"
  | "capability";

interface SearchDoc {
  id: string;
  title: string;
  source_type: SourceType;
  excerpt: string;
  status?: string;
  provenance?: Record<string, unknown>;
  confidence?: number;
  searchText: string;
  sourceRank: number;
  index: number;
}

interface RankedHit {
  id: string;
  title: string;
  source_type: SourceType;
  excerpt: string;
  score: number;
  confidence?: number;
  provenance: Record<string, unknown>;
  status?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asArray(value: unknown, nestedKey?: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (nestedKey && isRecord(value) && Array.isArray(value[nestedKey])) {
    return value[nestedKey] as unknown[];
  }
  return [];
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function joinText(...values: unknown[]): string {
  return values
    .flatMap((value) => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) {
        return value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim());
      }
      return [];
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

function excerptFrom(text: string): string {
  const compact = stripUrls(text).replace(/\s+/g, " ").trim();
  if (compact.length <= 280) return compact;
  return `${compact.slice(0, 277).trimEnd()}...`;
}

function provenanceFrom(
  item: Record<string, unknown>,
  fallback: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { source: fallback };
  for (const key of [
    "source",
    "sourceLabel",
    "source_label",
    "sourceName",
    "source_name",
    "provenance",
    "evidenceLabel",
    "evidence_label",
  ]) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) {
      out[toSnake(key)] = stripUrls(value.trim());
    } else if (isRecord(value)) {
      const label = pickString(
        value.label,
        value.name,
        value.title,
        value.id,
      );
      if (label) out[toSnake(key)] = stripUrls(label);
    }
  }
  return out;
}

function toSnake(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function addDoc(
  docs: SearchDoc[],
  doc: Omit<SearchDoc, "searchText" | "index">,
) {
  const title = excerptFrom(doc.title);
  const excerpt = excerptFrom(doc.excerpt);
  if (!title && !excerpt) return;
  docs.push({
    ...doc,
    title: title || doc.id,
    excerpt,
    searchText: [
      doc.id,
      doc.title,
      doc.excerpt,
      doc.status,
      JSON.stringify(doc.provenance ?? {}),
    ]
      .join(" ")
      .toLowerCase(),
    index: docs.length,
  });
}

function collectDocs(pkg: BrandPackagePayload | null): SearchDoc[] {
  if (!pkg || typeof pkg !== "object") return [];
  const record = pkg as Record<string, unknown>;
  const instance = isRecord(record.brandInstance)
    ? record.brandInstance
    : {};
  const docs: SearchDoc[] = [];

  for (const item of asArray(instance.narratives, "entries")) {
    if (!isRecord(item)) continue;
    const id = pickString(item.id, item.key) || `narrative-${docs.length + 1}`;
    const title = pickString(item.name, item.title, item.type, id);
    const excerpt = joinText(
      item.canonical_text,
      item.canonicalText,
      item.text,
      item.summary,
      item.description,
      item.usage_notes,
      item.usageNotes,
    );
    addDoc(docs, {
      id,
      title,
      source_type: "narrative",
      excerpt,
      status: pickString(item.status),
      provenance: provenanceFrom(item, "brandInstance.narratives"),
      confidence: pickNumber(item.confidence),
      sourceRank: 1,
    });
  }

  for (const item of asArray(instance.proofPoints, "claims")) {
    if (!isRecord(item)) continue;
    const id = pickString(item.id, item.key) || `proof-${docs.length + 1}`;
    const title = pickString(item.title, item.claim, item.name, id);
    const excerpt = joinText(
      item.title,
      item.claim,
      item.text,
      item.summary,
      item.description,
      item.evidence,
      item.notes,
      item.salience,
    );
    addDoc(docs, {
      id,
      title,
      source_type: "proof_point",
      excerpt,
      status: pickString(item.status),
      provenance: provenanceFrom(item, "brandInstance.proofPoints"),
      confidence: pickNumber(item.confidence),
      sourceRank: 2,
    });
  }

  for (const item of asArray(instance.applicationRules, "rules")) {
    if (!isRecord(item)) continue;
    const id = pickString(item.id, item.key) || `rule-${docs.length + 1}`;
    const title = pickString(item.name, item.title, item.rule, item.framework, id);
    const excerpt = joinText(
      item.rule,
      item.description,
      item.framework,
      item.required_elements,
      item.requiredElements,
      item.notes,
    );
    addDoc(docs, {
      id,
      title,
      source_type: "application_rule",
      excerpt,
      status: pickString(item.status),
      provenance: provenanceFrom(item, "brandInstance.applicationRules"),
      confidence: pickNumber(item.confidence),
      sourceRank: 3,
    });
  }

  for (const item of asArray(instance.brandPhrases, "entries")) {
    if (!isRecord(item)) continue;
    const id = pickString(item.id, item.key) || `phrase-${docs.length + 1}`;
    const title = pickString(item.name, item.title, item.phrase, item.type, id);
    const excerpt = joinText(
      item.phrase,
      item.canonical_text,
      item.canonicalText,
      item.text,
      item.usage_notes,
      item.usageNotes,
    );
    addDoc(docs, {
      id,
      title,
      source_type: "brand_phrase",
      excerpt,
      status: pickString(item.status),
      provenance: provenanceFrom(item, "brandInstance.brandPhrases"),
      confidence: pickNumber(item.confidence),
      sourceRank: 4,
    });
  }

  const readiness = isRecord(instance.readiness) ? instance.readiness : null;
  if (readiness) {
    const stage = pickString(readiness.stage, readiness.status);
    const nextUnlock = pickString(readiness.nextUnlock, readiness.next_unlock);
    const concern = pickString(readiness.primaryConcern, readiness.primary_concern);
    addDoc(docs, {
      id: "readiness",
      title: stage ? `Readiness: ${stage}` : "Readiness",
      source_type: "readiness",
      excerpt: joinText(stage, concern, nextUnlock),
      status: stage || undefined,
      provenance: { source: "brandInstance.readiness" },
      sourceRank: 5,
    });
  }

  const capabilities = isRecord(instance.capabilities)
    ? instance.capabilities
    : null;
  const enabled = Array.isArray(capabilities?.enabled)
    ? capabilities.enabled.filter((v): v is string => typeof v === "string")
    : [];
  if (enabled.length > 0) {
    addDoc(docs, {
      id: "capabilities-enabled",
      title: "Enabled capabilities",
      source_type: "capability",
      excerpt: enabled.join(", "),
      provenance: { source: "brandInstance.capabilities" },
      sourceRank: 6,
    });
  }

  return docs;
}

function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

function scoreDoc(doc: SearchDoc, tokens: string[]): number {
  let score = 0;
  const title = doc.title.toLowerCase();
  const excerpt = doc.excerpt.toLowerCase();
  const id = doc.id.toLowerCase();
  const status = (doc.status ?? "").toLowerCase();
  for (const token of tokens) {
    if (id === token || id.includes(token)) score += 5;
    if (title.includes(token)) score += 8;
    if (excerpt.includes(token)) score += 4;
    if (status.includes(token)) score += 2;
    if (doc.searchText.includes(token)) score += 1;
  }
  if (score > 0 && /^active$/i.test(doc.status ?? "")) score += 0.25;
  return score;
}

function rankDocs(
  docs: SearchDoc[],
  query: string,
  limit: number,
): RankedHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  return docs
    .map((doc) => ({ doc, score: scoreDoc(doc, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.doc.sourceRank !== b.doc.sourceRank) {
        return a.doc.sourceRank - b.doc.sourceRank;
      }
      return a.doc.index - b.doc.index;
    })
    .slice(0, limit)
    .map(({ doc, score }) => ({
      id: doc.id,
      title: doc.title,
      source_type: doc.source_type,
      excerpt: doc.excerpt,
      score,
      confidence: doc.confidence,
      provenance: doc.provenance ?? {},
      status: doc.status,
    }));
}

export function registerSearch(server: McpServer, context: HostedBrandContext) {
  server.tool(
    "brand_search",
    "Search the connected hosted brand's governed knowledge — narratives, proof points, application rules, brand phrases, stats, assets, and runtime-graph summaries — with provenance. Read-only. Ranks UCS's compiled knowledge corpus (same engine as Brand Console) and returns hits with citation, source_class, and confidence, plus coverage and blind_spots so answers can be hedged. Optional mode targets intent: fact_lookup, doctrine_retrieval, asset_retrieval, evidence_retrieval, coverage_discovery.",
    paramsShape,
    async (args) => {
      const scopeError = enforceToolScope("brand_search", context);
      if (scopeError) return scopeError;

      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;

      let pkg: BrandPackagePayload | null;
      try {
        pkg = await context.loadBrandPackage();
      } catch (err) {
        return buildResponse({
          what_happened: `Failed to load hosted brand "${context.slug}": ${(err as Error).message}`,
          next_steps: [
            "Retry in a moment — the hosted brand service may be temporarily unavailable",
          ],
          data: {
            error: "fetch_failed",
            slug: context.slug,
          },
        });
      }

      const trimmedQuery = parsed.data.query.trim();
      const corpus = pkg?.brandKnowledgeCorpus;

      // Primary path: rank UCS's prebuilt knowledge corpus with the same engine
      // Brand Console uses — real provenance, confidence, coverage, blind spots.
      if (corpus && Array.isArray(corpus.documents) && corpus.documents.length > 0) {
        const result = queryBrandKnowledgeCorpus({
          corpus,
          manifest: pkg?.retrievalManifest ?? null,
          query: {
            text: trimmedQuery,
            mode: parsed.data.mode,
            topK: parsed.data.limit,
          },
        });
        const hits = result.hits.map((hit) => ({
          id: hit.id,
          title: excerptFrom(hit.title),
          source_kind: hit.sourceKind,
          source_class: hit.sourceClass,
          excerpt: excerptFrom(hit.excerpt),
          score: hit.score,
          confidence: hit.confidence,
          approval_state: hit.approvalState,
          citation: hit.citation ? stripUrls(hit.citation) : null,
          reasons: hit.reasons,
        }));

        return buildResponse({
          what_happened:
            hits.length > 0
              ? `Found ${hits.length} hosted brand knowledge hit${hits.length === 1 ? "" : "s"} for "${trimmedQuery}" (${result.query.mode})`
              : trimmedQuery
                ? `No hosted brand knowledge matched "${trimmedQuery}" (${result.query.mode})`
                : "No hosted brand search query was provided",
          next_steps:
            hits.length > 0
              ? [
                  "Cite the citation, source_class, and confidence fields when applying this guidance",
                  "Hedge low-confidence hits; check blind_spots for known gaps in coverage",
                ]
              : [
                  "Try a different mode (doctrine_retrieval for voice/narratives, evidence_retrieval for proof)",
                  "Check coverage and blind_spots — the gap may be unindexed rather than absent",
                  "Call brand_runtime for compact runtime context when search has no match",
                ],
          data: {
            query: trimmedQuery,
            retrieval_engine: "knowledge_corpus",
            retrieval_mode: result.query.mode,
            hits,
            total_hits: hits.length,
            confidence_summary: result.confidenceSummary,
            coverage: result.coverage,
            blind_spots: result.blindSpots,
            warnings: result.warnings,
            searched_documents: corpus.documents.length,
            custody_safe: true,
            slug: context.slug,
            environment: context.auth.environment,
          },
        });
      }

      // Fallback path: older/sparser packages with no prebuilt corpus. Keyword
      // scan over whatever structured arrays the brandInstance carries.
      const docs = collectDocs(pkg);
      const hits = rankDocs(docs, trimmedQuery, parsed.data.limit);

      return buildResponse({
        what_happened:
          hits.length > 0
            ? `Found ${hits.length} hosted brand knowledge hit${hits.length === 1 ? "" : "s"} for "${trimmedQuery}"`
            : trimmedQuery
              ? `No hosted brand knowledge matched "${trimmedQuery}"`
              : "No hosted brand search query was provided",
        next_steps:
          hits.length > 0
            ? [
                "Use the cited source_type, status, and provenance fields when applying this brand guidance",
              ]
            : [
                "Try a more specific query about narratives, proof points, application rules, or brand phrases",
                "Call brand_runtime for compact runtime context when search has no match",
              ],
        data: {
          query: trimmedQuery,
          retrieval_engine: "keyword_fallback",
          hits,
          total_hits: hits.length,
          searched_documents: docs.length,
          searched_sources: [
            "brandInstance.narratives",
            "brandInstance.proofPoints",
            "brandInstance.applicationRules",
            "brandInstance.brandPhrases",
            "brandInstance.readiness",
            "brandInstance.capabilities",
          ],
          custody_safe: true,
          selected_kit_artifact_support: "not_implemented_in_v1",
          slug: context.slug,
          environment: context.auth.environment,
        },
      });
    },
  );
}
