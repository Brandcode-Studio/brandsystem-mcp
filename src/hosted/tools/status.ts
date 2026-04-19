/**
 * Hosted `brand_status` tool — connection-level health for the hosted MCP.
 *
 * Returns: slug, environment, scopes granted to this key, whether a compiled
 * runtime is available, brand package summary (asset/narrative counts when
 * present). No local reads — fully hosted-sourced.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse } from "../../lib/response.js";
import type { HostedBrandContext } from "../types.js";

function summarizePackage(pkg: unknown): Record<string, unknown> {
  if (!pkg || typeof pkg !== "object") return {};
  const record = pkg as Record<string, unknown>;
  const instance = record.brandInstance as Record<string, unknown> | undefined;
  const data = record.brandData as Record<string, unknown> | undefined;
  const narratives = data?.narratives as unknown[] | undefined;
  const proofPoints = data?.proofPoints as unknown[] | undefined;
  const assets = data?.assets as unknown[] | undefined;
  const readiness = instance?.readiness as Record<string, unknown> | undefined;
  const capabilities = instance?.capabilities as
    | Record<string, unknown>
    | undefined;
  return {
    readiness_stage: readiness?.stage ?? null,
    capabilities_enabled: Array.isArray(capabilities?.enabled)
      ? (capabilities?.enabled as unknown[]).length
      : null,
    narrative_count: narratives?.length ?? null,
    proof_point_count: proofPoints?.length ?? null,
    asset_count: assets?.length ?? null,
  };
}

export function registerStatus(server: McpServer, context: HostedBrandContext) {
  server.tool(
    "brand_status",
    "Return hosted MCP connection metadata: slug, environment, granted scopes, runtime availability, and brand package summary. Use when an agent wants to know what it can do with the current key/brand.",
    async () => {
      const pkg = await context.loadBrandPackage().catch(() => null);
      const summary = summarizePackage(pkg);
      const hasRuntime =
        !!(pkg && typeof pkg === "object" &&
          ((pkg as Record<string, unknown>).runtime ||
            ((pkg as Record<string, unknown>).brandInstance as Record<string, unknown> | undefined)?.runtime));

      const lines = [
        "── Brandcode MCP (hosted) ────────────",
        `Slug:         ${context.slug}`,
        `Environment:  ${context.auth.environment}`,
        `Key:          ${context.auth.keyId}…`,
        `Scopes:       ${context.auth.scopes.join(", ") || "(none)"}`,
        `Runtime:      ${hasRuntime ? "available" : "not compiled"}`,
        summary.readiness_stage
          ? `Readiness:    ${summary.readiness_stage}`
          : `Readiness:    unknown`,
        summary.narrative_count != null
          ? `Narratives:   ${summary.narrative_count}`
          : "Narratives:   —",
        summary.asset_count != null
          ? `Assets:       ${summary.asset_count}`
          : "Assets:       —",
      ];

      return buildResponse({
        what_happened: `Hosted status for "${context.slug}" (${context.auth.environment})`,
        next_steps: [
          hasRuntime
            ? "brand_runtime returns the current governed runtime"
            : "Compile the brand via @brandsystem/mcp or Brand Console before calling brand_runtime",
          context.auth.scopes.includes("check")
            ? "brand_check validates draft text/colors/fonts against this brand"
            : "Key lacks `check` scope — brand_check calls will 403",
        ],
        data: {
          status: lines.join("\n"),
          slug: context.slug,
          environment: context.auth.environment,
          scopes: context.auth.scopes,
          runtime_available: hasRuntime,
          brand_summary: summary,
        },
      });
    },
  );
}
