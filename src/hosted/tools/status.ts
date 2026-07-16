/**
 * Hosted `brand_status` tool — connection-level health for the hosted MCP.
 *
 * Returns: slug, environment, scopes granted to this key, whether a compiled
 * runtime is available, brand package summary (asset/narrative counts when
 * present). No local reads — fully hosted-sourced.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse } from "../../lib/response.js";
import {
  TOOL_SCOPE_REQUIREMENTS,
  toolHasScope,
} from "../auth.js";
import { enforceToolScope } from "../scope.js";
import { HOSTED_AGENT_RUN_TELEMETRY_STATUS } from "../telemetry.js";
import type {
  BrandcodeMcpScope,
  HostedBrandContext,
  HostedRateLimitSnapshot,
} from "../types.js";

interface ToolImplementationEntry {
  tool: string;
  implementation: "real" | "stub";
  write_behavior: "read-only" | "append-only" | "review-queue";
}

const TOOL_IMPLEMENTATION_MATRIX: ToolImplementationEntry[] = [
  { tool: "brand_runtime", implementation: "real", write_behavior: "read-only" },
  { tool: "brand_search", implementation: "real", write_behavior: "read-only" },
  { tool: "brand_check", implementation: "real", write_behavior: "read-only" },
  { tool: "brand_status", implementation: "real", write_behavior: "read-only" },
  { tool: "list_brand_assets", implementation: "real", write_behavior: "read-only" },
  { tool: "get_brand_asset", implementation: "real", write_behavior: "read-only" },
  { tool: "brand_feedback", implementation: "real", write_behavior: "append-only" },
  { tool: "capture_taste", implementation: "real", write_behavior: "review-queue" },
  { tool: "brand_history", implementation: "real", write_behavior: "read-only" },
];

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

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return stripUrls(value.trim());
    }
  }
  return null;
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

function runtimeSource(record: Record<string, unknown>): string | null {
  const instance = isRecord(record.brandInstance) ? record.brandInstance : null;
  if (isRecord(record.runtime)) return "runtime";
  if (isRecord(instance?.runtime)) return "brandInstance.runtime";
  if (isRecord(record.identity)) return "identity";
  if (
    isRecord(instance?.tokens) ||
    isRecord(instance?.fonts) ||
    Array.isArray(instance?.assets)
  ) {
    return "brandInstance";
  }
  return null;
}

function searchCounts(instance: Record<string, unknown>) {
  const narratives = asArray(instance.narratives, "entries").length;
  const proofPoints = asArray(instance.proofPoints, "claims").length;
  const applicationRules = asArray(instance.applicationRules, "rules").length;
  const brandPhrases = asArray(instance.brandPhrases, "entries").length;
  const readiness = isRecord(instance.readiness) ? 1 : 0;
  const capabilities = isRecord(instance.capabilities) ? 1 : 0;
  const total =
    narratives +
    proofPoints +
    applicationRules +
    brandPhrases +
    readiness +
    capabilities;
  return {
    total,
    sources: {
      narratives,
      proof_points: proofPoints,
      application_rules: applicationRules,
      brand_phrases: brandPhrases,
      readiness,
      capabilities,
    },
  };
}

function assetCounts(
  instance: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  const brandInstanceAssets = asArray(instance.assets).length;
  const brandDataAssets = asArray(data.assets).length;
  return {
    total: brandInstanceAssets + brandDataAssets,
    sources: {
      brandInstance_assets: brandInstanceAssets,
      brandData_assets: brandDataAssets,
    },
  };
}

function findRuntimeArtifactRecord(record: Record<string, unknown>) {
  const instance = isRecord(record.brandInstance) ? record.brandInstance : {};
  const candidates = [
    record.fullBrandRuntime,
    record.full_brand_runtime,
    record.fullBrandRuntimeArtifact,
    record.full_brand_runtime_artifact,
    record.runtimePackage,
    record.runtime_package,
    record.runtimePackageArtifact,
    record.runtime_package_artifact,
    record.latestRuntimePackage,
    record.latest_runtime_package,
    record.packageArtifact,
    record.package_artifact,
    instance.fullBrandRuntime,
    instance.full_brand_runtime,
    instance.runtimePackage,
    instance.runtime_package,
    instance.runtimePackageArtifact,
    instance.runtime_package_artifact,
  ];
  return candidates.find(isRecord) ?? null;
}

function runtimeArtifactPosture(pkg: unknown) {
  if (!isRecord(pkg)) {
    return {
      status: "not_reported_by_package",
      present: false,
      message: "Full Brand Runtime artifact metadata is not reported by the hosted package",
    };
  }

  const artifact = findRuntimeArtifactRecord(pkg);
  const packagePath = pickString(
    artifact?.packagePath,
    artifact?.package_path,
    artifact?.zipPath,
    artifact?.zip_path,
    pkg.runtimePackagePath,
    pkg.runtime_package_path,
  );
  const receiptPath = pickString(
    artifact?.receiptPath,
    artifact?.receipt_path,
    artifact?.receipt,
    pkg.runtimePackageReceiptPath,
    pkg.runtime_package_receipt_path,
  );
  const latestPath = pickString(
    artifact?.latestPath,
    artifact?.latest_path,
    pkg.runtimePackageLatestPath,
    pkg.runtime_package_latest_path,
  );
  const versionHash = pickString(
    artifact?.versionHash,
    artifact?.version_hash,
    artifact?.hash,
    pkg.runtimePackageHash,
    pkg.runtime_package_hash,
  );
  const updatedAt = pickString(
    artifact?.updatedAt,
    artifact?.updated_at,
    artifact?.createdAt,
    artifact?.created_at,
  );

  if (artifact || packagePath || receiptPath || latestPath || versionHash) {
    return {
      status: "reported_by_package",
      present: true,
      package_path: packagePath,
      receipt_path: receiptPath,
      latest_path: latestPath,
      version_hash: versionHash,
      updated_at: updatedAt,
      custody: "package-safe metadata only",
    };
  }

  return {
    status: "not_reported_by_package",
    present: false,
    message: "Full Brand Runtime artifact metadata is not reported by the hosted package",
  };
}

function summarizePackage(pkg: unknown): Record<string, unknown> {
  if (!pkg || typeof pkg !== "object") {
    return {
      runtime: { available: false, source: null },
      search: { available: false, document_count: 0, sources: {} },
      assets: { available: false, total_count: 0, sources: {} },
      full_brand_runtime_artifact: runtimeArtifactPosture(pkg),
      readiness_stage: null,
      capabilities_enabled: null,
    };
  }
  const record = pkg as Record<string, unknown>;
  const instance = isRecord(record.brandInstance) ? record.brandInstance : {};
  const data = isRecord(record.brandData) ? record.brandData : {};
  const readiness = isRecord(instance.readiness) ? instance.readiness : {};
  const capabilities = isRecord(instance.capabilities)
    ? instance.capabilities
    : {};
  const runtime = runtimeSource(record);
  const search = searchCounts(instance);
  const assets = assetCounts(instance, data);
  return {
    runtime: {
      available: Boolean(runtime),
      source: runtime,
    },
    search: {
      available: search.total > 0,
      document_count: search.total,
      sources: search.sources,
    },
    assets: {
      available: assets.total > 0,
      total_count: assets.total,
      sources: assets.sources,
    },
    full_brand_runtime_artifact: runtimeArtifactPosture(pkg),
    readiness_stage: readiness.stage ?? null,
    capabilities_enabled: Array.isArray(capabilities?.enabled)
      ? (capabilities?.enabled as unknown[]).length
      : null,
  };
}

function implementationMatrix() {
  return TOOL_IMPLEMENTATION_MATRIX.map((entry) => ({ ...entry }));
}

function scopeMatrix(scopes: BrandcodeMcpScope[]) {
  return TOOL_IMPLEMENTATION_MATRIX.map((entry) => {
    const requiredScope = TOOL_SCOPE_REQUIREMENTS[entry.tool];
    const granted = toolHasScope(entry.tool, scopes);
    return {
      tool: entry.tool,
      required_scope: requiredScope,
      granted,
      status: granted ? "granted" : "missing",
    };
  });
}

function rateLimitPosture(snapshot?: HostedRateLimitSnapshot) {
  return snapshot ?? {
    status: "disabled",
    enforced: false,
    enforcement: "none",
    scope: "per_key_per_brand",
    limit: null,
    remaining: null,
    window_ms: null,
    reset_at: null,
    retry_after_seconds: null,
    release_gate: "blocked",
    blocker_owner:
      "Jason Lankow / Brandcode Studio Ops <jlankow@columnfive.com>",
    required_before_public_release:
      "Route brand_status through the hosted HTTP boundary and implement durable shared hosted rate-limit enforcement before broad public release",
    source: "not available outside hosted HTTP router",
  };
}

export function registerStatus(server: McpServer, context: HostedBrandContext) {
  server.tool(
    "brand_status",
    "Return hosted MCP capability status: implemented tools, scopes, runtime/search/assets availability, artifact posture, telemetry posture, and remaining stubs.",
    async () => {
      const scopeError = enforceToolScope("brand_status", context);
      if (scopeError) return scopeError;

      const pkg = await context.loadBrandPackage().catch(() => null);
      const summary = summarizePackage(pkg);
      const runtime = summary.runtime as Record<string, unknown>;
      const search = summary.search as Record<string, unknown>;
      const assets = summary.assets as Record<string, unknown>;
      const artifact = summary.full_brand_runtime_artifact as Record<
        string,
        unknown
      >;
      const implementations = implementationMatrix();
      const scopes = scopeMatrix(context.auth.scopes);
      const realTools = implementations.filter(
        (tool) => tool.implementation === "real",
      );
      const stubTools = implementations.filter(
        (tool) => tool.implementation === "stub",
      );
      const rateLimits = rateLimitPosture(context.rateLimit);

      const lines = [
        "── Brandcode MCP (hosted) ────────────",
        `Slug:         ${context.slug}`,
        `Environment:  ${context.auth.environment}`,
        `Key:          ${context.auth.keyId}…`,
        `Scopes:       ${context.auth.scopes.join(", ") || "(none)"}`,
        `Real tools:   ${realTools.map((tool) => tool.tool).join(", ")}`,
        `Stubs:        ${stubTools.map((tool) => tool.tool).join(", ")}`,
        `Runtime:      ${runtime.available ? `available (${runtime.source})` : "not available"}`,
        `Search:       ${search.available ? `${search.document_count} docs` : "no hosted knowledge docs"}`,
        `Assets:       ${assets.available ? `${assets.total_count} assets` : "no hosted assets"}`,
        `Full runtime: ${artifact.present ? "reported by package" : "not reported by package"}`,
        `Telemetry:    ${HOSTED_AGENT_RUN_TELEMETRY_STATUS}`,
        `Rate limits:  ${rateLimits.status}`,
        summary.readiness_stage
          ? `Readiness:    ${summary.readiness_stage}`
          : `Readiness:    unknown`,
      ];

      return buildResponse({
        what_happened: `Hosted capability status for "${context.slug}" (${context.auth.environment})`,
        next_steps: [
          runtime.available
            ? "brand_runtime returns the current governed runtime"
            : "Compile the brand via @brandsystem/mcp or Brand Console before calling brand_runtime",
          search.available
            ? "brand_search queries hosted narratives, proof points, rules, phrases, readiness, and capabilities"
            : "Add hosted brand knowledge before expecting brand_search results",
          assets.available
            ? "list_brand_assets and get_brand_asset return package-safe asset metadata"
            : "Publish package-safe runtime assets before expecting asset tool results",
          "Remaining stubs: none",
        ],
        data: {
          status: lines.join("\n"),
          slug: context.slug,
          environment: context.auth.environment,
          scopes: context.auth.scopes,
          runtime_available: runtime.available,
          implemented_tools: implementations,
          scope_matrix: scopes,
          capability_availability: {
            runtime,
            search,
            assets,
          },
          full_brand_runtime_artifact: artifact,
          remaining_stubs: stubTools.map((tool) => tool.tool),
          telemetry: {
            active: HOSTED_AGENT_RUN_TELEMETRY_STATUS === "active",
            status: HOSTED_AGENT_RUN_TELEMETRY_STATUS,
            detail:
              "Hosted AgentRun telemetry POSTs a record to UCS for every hosted tool call, in addition to brand_feedback's explicit append-only feedback entries",
          },
          rate_limits: rateLimits,
          brand_summary: {
            readiness_stage: summary.readiness_stage,
            capabilities_enabled: summary.capabilities_enabled,
            runtime_available: runtime.available,
            search_document_count: search.document_count,
            asset_count: assets.total_count,
          },
        },
      });
    },
  );
}
