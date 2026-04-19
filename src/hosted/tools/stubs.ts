/**
 * Stub registrations for the 6 hosted tools whose full implementations land
 * after the sprint gate. Each stub:
 *   - uses the final description from the Phase 0 lock
 *   - returns a structured "not_implemented_in_staging" response
 *   - keeps the tool list at 8 so clients can probe the full surface now
 *
 * Removing a stub and replacing it with a real implementation should not
 * require touching registrations.ts — just the per-tool module.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../../lib/response.js";
import type { HostedBrandContext } from "../types.js";

type StubReason = "not_implemented_in_staging";

function stubResponse(tool: string, slug: string, note: string) {
  return buildResponse({
    what_happened: `${tool} is not yet wired in Phase 1 staging`,
    next_steps: [note],
    data: {
      error: "not_implemented_in_staging" as StubReason,
      tool,
      slug,
      phase: "phase_1_staging_prototype",
    },
  });
}

export function registerSearchStub(
  server: McpServer,
  context: HostedBrandContext,
) {
  const shape = {
    query: z.string().describe("Natural-language query over brand knowledge."),
    limit: z.number().int().min(1).max(50).default(10).describe("Max results."),
  };
  const schema = z.object(shape);
  server.tool(
    "brand_search",
    "Query narratives, proof points, application rules, and governed brand knowledge with provenance. Read-only. Returns hits with source, confidence, and canonical text. Phase 1 staging: stub.",
    shape,
    async (args) => {
      const parsed = safeParseParams(schema, args);
      if (!parsed.success) return parsed.response;
      return stubResponse(
        "brand_search",
        context.slug,
        "Brand search lands with the full Phase 1 release after the sprint gate",
      );
    },
  );
}

export function registerCheckStub(
  server: McpServer,
  context: HostedBrandContext,
) {
  const shape = {
    text: z.string().optional().describe("Copy to check for voice violations."),
    color: z.string().optional().describe("Hex color to check against palette."),
    font: z.string().optional().describe("Font family to check against typography."),
    css: z.string().optional().describe("CSS snippet to check for anti-patterns."),
  };
  const schema = z.object(shape);
  server.tool(
    "brand_check",
    "Validate draft text, color, font, and CSS against live governance. Pass/fail plus specific fixes. Mirrors @brandsystem/mcp's brand_check. Phase 1 staging: stub.",
    shape,
    async (args) => {
      const parsed = safeParseParams(schema, args);
      if (!parsed.success) return parsed.response;
      return stubResponse(
        "brand_check",
        context.slug,
        "brand_check wires to hosted runtime rules in the next Phase 1 increment",
      );
    },
  );
}

export function registerListAssetsStub(
  server: McpServer,
  context: HostedBrandContext,
) {
  const shape = {
    category: z.string().optional().describe("Filter by asset category."),
    lifecycle: z.string().optional().describe("Filter by lifecycle status."),
    cursor: z.string().optional().describe("Pagination cursor."),
    limit: z.number().int().min(1).max(100).default(25).describe("Page size."),
  };
  const schema = z.object(shape);
  server.tool(
    "list_brand_assets",
    "Paginated catalog of brand assets for the connected hosted brand. Filter by category and lifecycle. Read-only. Phase 1 staging: stub.",
    shape,
    async (args) => {
      const parsed = safeParseParams(schema, args);
      if (!parsed.success) return parsed.response;
      return stubResponse(
        "list_brand_assets",
        context.slug,
        "Asset catalog pagination lands alongside get_brand_asset",
      );
    },
  );
}

export function registerGetAssetStub(
  server: McpServer,
  context: HostedBrandContext,
) {
  const shape = {
    asset_id: z.string().describe("Asset identifier from list_brand_assets."),
  };
  const schema = z.object(shape);
  server.tool(
    "get_brand_asset",
    "Fetch a specific asset URL plus metadata (format, dimensions, lifecycle). Read-only. Phase 1 staging: stub.",
    shape,
    async (args) => {
      const parsed = safeParseParams(schema, args);
      if (!parsed.success) return parsed.response;
      return stubResponse(
        "get_brand_asset",
        context.slug,
        "Single-asset fetch lands alongside list_brand_assets",
      );
    },
  );
}

export function registerFeedbackStub(
  server: McpServer,
  context: HostedBrandContext,
) {
  const shape = {
    kind: z
      .enum(["observation", "proposal"])
      .default("observation")
      .describe(
        "'observation' logs a note. 'proposal' adds to the governance review queue.",
      ),
    summary: z.string().describe("One-line summary of the feedback."),
    detail: z.string().optional().describe("Optional longer context."),
  };
  const schema = z.object(shape);
  server.tool(
    "brand_feedback",
    "Append an observation or proposal to the governance review queue for the connected hosted brand. Append-only. Phase 1 staging: stub.",
    shape,
    async (args) => {
      const parsed = safeParseParams(schema, args);
      if (!parsed.success) return parsed.response;
      return stubResponse(
        "brand_feedback",
        context.slug,
        "Feedback append lands once the UCS governance queue endpoint is wired",
      );
    },
  );
}

export function registerHistoryStub(
  server: McpServer,
  context: HostedBrandContext,
) {
  const shape = {
    limit: z.number().int().min(1).max(100).default(25).describe("Page size."),
    cursor: z.string().optional().describe("Pagination cursor."),
  };
  const schema = z.object(shape);
  server.tool(
    "brand_history",
    "Return recent MCP runs scoped by this API key and brand permissions. Read-only. Phase 1 staging: stub.",
    shape,
    async (args) => {
      const parsed = safeParseParams(schema, args);
      if (!parsed.success) return parsed.response;
      return stubResponse(
        "brand_history",
        context.slug,
        "Run history lands after UCS exposes a GET endpoint over AgentRunRecord",
      );
    },
  );
}
