/**
 * Hosted `brand_history` tool.
 *
 * Reads scoped AgentRun history from UCS. The response is intentionally
 * compact and receipt-aware: portable receipt chains are summarized rather
 * than returned as large nested blobs.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../../lib/response.js";
import {
  fetchHostedAgentHistory,
  HistoryUpstreamError,
} from "../history-fetcher.js";
import { enforceToolScope } from "../scope.js";
import { HOSTED_AGENT_RUN_TELEMETRY_STATUS } from "../telemetry.js";
import type { HostedBrandContext } from "../types.js";

const paramsShape = {
  limit: z.number().int().min(1).max(100).default(25).describe("Page size."),
  cursor: z
    .string()
    .optional()
    .describe("Pagination cursor. Accepted for compatibility; UCS history GET does not report cursor support yet."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return stripUrls(value.trim());
    }
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return stripUrls(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value ?? null;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (!isRecord(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = sanitize(item, depth + 1);
  }
  return out;
}

function receiptChainSummary(value: unknown): Record<string, unknown> | null {
  const receipts = asArray(value).filter(isRecord);
  if (receipts.length === 0) return null;

  const ids = receipts
    .map((receipt) => pickString(receipt.receiptId, receipt.id))
    .filter((id): id is string => Boolean(id));
  const types = Array.from(
    new Set(
      receipts
        .map((receipt) => pickString(receipt.receiptType, receipt.type))
        .filter((type): type is string => Boolean(type)),
    ),
  );
  const createdTimes = receipts
    .map((receipt) => pickString(receipt.createdAt, receipt.recordedAt))
    .filter((value): value is string => Boolean(value))
    .sort();
  const overallResults = Array.from(
    new Set(
      receipts
        .map((receipt) => {
          const verification = isRecord(receipt.verification)
            ? receipt.verification
            : {};
          return pickString(
            verification.overallResult,
            receipt.overallResult,
            receipt.status,
          );
        })
        .filter((result): result is string => Boolean(result)),
    ),
  );

  return {
    count: receipts.length,
    receipt_ids: ids.slice(0, 8),
    has_more_receipts: ids.length > 8,
    receipt_types: types,
    latest_created_at: createdTimes.at(-1) ?? null,
    parent_receipt_ids: receipts
      .map((receipt) => pickString(receipt.parentReceiptId, receipt.parent_receipt_id))
      .filter((id): id is string => Boolean(id))
      .slice(0, 8),
    overall_results: overallResults,
  };
}

function summarizeEntry(entry: unknown): Record<string, unknown> | null {
  if (!isRecord(entry)) return null;
  const run = isRecord(entry.run) ? entry.run : {};
  const context = isRecord(run.context) ? run.context : {};
  const approvalRequest = isRecord(entry.approvalRequest)
    ? entry.approvalRequest
    : {};
  const proposal = isRecord(entry.proposal) ? entry.proposal : {};
  const receipts = asArray(entry.receipts);

  const portableReceiptChain = receiptChainSummary(entry.portableReceiptChain);
  const trustEnvelope = isRecord(entry.trustEnvelope) ? entry.trustEnvelope : {};
  const confidence = isRecord(trustEnvelope.confidence)
    ? trustEnvelope.confidence
    : {};
  const grounding = isRecord(trustEnvelope.grounding)
    ? trustEnvelope.grounding
    : {};
  const telemetry = isRecord(run.telemetry) ? run.telemetry : {};

  const runId = pickString(run.id, entry.id);
  if (!runId) return null;

  return {
    id: runId,
    started_at: pickString(run.startedAt, entry.startedAt),
    finished_at: pickString(run.completedAt, run.finishedAt, entry.completedAt),
    provider: pickString(run.provider, context.provider),
    surface: pickString(context.surface, run.surface),
    surface_id: pickString(context.surfaceId, run.surfaceId),
    tool: pickString(run.tool, run.action, run.taskPreset),
    action_label: pickString(
      approvalRequest.actionLabel,
      proposal.actionLabel,
      run.actionLabel,
    ),
    task_label: pickString(run.taskLabel, run.taskPreset),
    task_preset: pickString(run.taskPreset),
    outcome: pickString(run.status, run.outcome, entry.status),
    summary: pickString(run.resultSummary, run.summary, entry.summary),
    receipt_count: receipts.length,
    receipt_ids: receipts
      .filter(isRecord)
      .map((receipt) => pickString(receipt.id, receipt.receiptId))
      .filter((id): id is string => Boolean(id))
      .slice(0, 8),
    portable_receipt_chain: portableReceiptChain,
    trust: {
      confidence_level: pickString(confidence.level),
      confidence_summary: pickString(confidence.summary),
      used_source_count: pickNumber(grounding.usedSourceCount),
    },
    telemetry: {
      duration_ms: pickNumber(telemetry.durationMs),
      failure_kind: pickString(telemetry.failureKind),
    },
  };
}

function historyFromBody(body: unknown): {
  history: Array<Record<string, unknown>>;
  telemetrySummary: unknown;
  malformed: boolean;
} {
  if (!isRecord(body)) {
    return { history: [], telemetrySummary: null, malformed: true };
  }
  const rawHistory = body.history;
  if (!Array.isArray(rawHistory)) {
    return {
      history: [],
      telemetrySummary: sanitize(body.telemetry ?? body.telemetry_summary),
      malformed: true,
    };
  }
  return {
    history: rawHistory
      .map(summarizeEntry)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry)),
    telemetrySummary: sanitize(body.telemetry ?? body.telemetry_summary),
    malformed: false,
  };
}

function errorResponse(err: HistoryUpstreamError, context: HostedBrandContext) {
  return buildResponse({
    what_happened: `Failed to load hosted brand history for "${context.slug}": ${err.message}`,
    next_steps:
      err.code === "hosted_brand_not_found"
        ? ["Confirm the hosted brand slug before calling brand_history again"]
        : err.code === "ucs_auth"
          ? ["Check the hosted MCP UCS service token configuration"]
          : ["Retry in a moment or inspect UCS hosted history availability"],
    data: {
      error: err.code,
      status: err.status,
      upstream_status: err.upstreamStatus ?? null,
      slug: context.slug,
      history_origin: "ucs",
    },
  });
}

export function registerHistory(server: McpServer, context: HostedBrandContext) {
  server.tool(
    "brand_history",
    "Return recent hosted MCP runs from UCS AgentRun history. Read-only. Returns compact run summaries, telemetry summary, receipt-chain summaries, and next_cursor truth.",
    paramsShape,
    async (args) => {
      const scopeError = enforceToolScope("brand_history", context);
      if (scopeError) return scopeError;

      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      const params: Params = parsed.data;

      let body: unknown;
      try {
        body = await fetchHostedAgentHistory({
          ucsBaseUrl: context.ucsBaseUrl,
          ucsServiceToken: context.ucsServiceToken,
          slug: context.slug,
          limit: params.limit,
          cursor: params.cursor,
        });
      } catch (err) {
        if (err instanceof HistoryUpstreamError) {
          return errorResponse(err, context);
        }
        return errorResponse(
          new HistoryUpstreamError(
            502,
            "ucs_error",
            (err as Error).message,
          ),
          context,
        );
      }

      const projected = historyFromBody(body);
      return buildResponse({
        what_happened: projected.malformed
          ? `UCS history for "${context.slug}" did not include a usable history array`
          : `Loaded ${projected.history.length} hosted MCP history entr${projected.history.length === 1 ? "y" : "ies"} for "${context.slug}"`,
        next_steps: [
          "Use history entries as read-only run/receipt context; hosted AgentRun telemetry writes are active",
          params.cursor
            ? "UCS history GET does not report cursor support yet, so next_cursor is null"
            : "Call brand_status for implementation and telemetry posture",
        ],
        data: {
          history: projected.history,
          telemetry_summary: projected.telemetrySummary,
          next_cursor: null,
          cursor_requested: params.cursor ?? null,
          cursor_support: "not_reported_by_ucs",
          history_origin: "ucs",
          provider: "mcp",
          surface: "mcp-hosted",
          limit: params.limit,
          malformed_history: projected.malformed,
          // A malformed body is a 200 OK with a UCS contract violation, not
          // an HTTP failure -- surfaced as `error` (rather than thrown) so
          // AgentRun telemetry classifies it as upstream_error instead of
          // silently recording a degraded response as outcome "ok".
          ...(projected.malformed
            ? { error: "ucs_history_contract_error" }
            : {}),
          telemetry: {
            write_active: HOSTED_AGENT_RUN_TELEMETRY_STATUS === "active",
            status: HOSTED_AGENT_RUN_TELEMETRY_STATUS,
            detail:
              "brand_history reads UCS AgentRun history; hosted telemetry POST now writes a record for every hosted tool call",
          },
          slug: context.slug,
          environment: context.auth.environment,
        },
      });
    },
  );
}
