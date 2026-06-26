/**
 * Hosted `brand_feedback` tool.
 *
 * Append-only feedback capture over the UCS AgentRun history POST contract.
 * This records an MCP feedback receipt for review; it does not approve, apply,
 * or mutate canonical governance.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../../lib/response.js";
import {
  appendHostedFeedback,
  FeedbackUpstreamError,
} from "../feedback-fetcher.js";
import { enforceToolScope } from "../scope.js";
import type { HostedBrandContext } from "../types.js";

const paramsShape = {
  kind: z
    .enum(["observation", "proposal"])
    .default("observation")
    .describe("'observation' records a note. 'proposal' records a review suggestion without mutating canon."),
  summary: z.string().min(1).max(240).describe("One-line feedback summary."),
  detail: z.string().max(4000).optional().describe("Optional longer feedback context."),
  source_tool: z
    .string()
    .max(80)
    .optional()
    .describe("Optional hosted MCP tool this feedback relates to."),
  related_run_id: z
    .string()
    .max(160)
    .optional()
    .describe("Optional existing AgentRun id this feedback relates to."),
  evidence_refs: z
    .array(z.string().max(500))
    .max(10)
    .optional()
    .describe("Optional short evidence labels or package-safe references."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

function cleanString(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = stripUrls(value).replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function cleanDetail(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = stripUrls(value).trim();
  return trimmed || null;
}

function hashFor(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildTargetLocator(params: Params, context: HostedBrandContext) {
  const evidence = (params.evidence_refs ?? [])
    .map((ref) => cleanString(ref))
    .filter((ref): ref is string => Boolean(ref));
  return {
    brandSlug: context.slug,
    keyId: context.auth.keyId,
    feedbackKind: params.kind,
    sourceTool: cleanString(params.source_tool),
    relatedRunId: cleanString(params.related_run_id),
    evidenceRefs: evidence.length > 0 ? evidence.join(" | ") : null,
  };
}

function buildFeedbackEntry(params: Params, context: HostedBrandContext) {
  const now = new Date().toISOString();
  const summary = cleanString(params.summary) ?? "Hosted MCP feedback";
  const detail = cleanDetail(params.detail);
  const feedbackId = `mcp-feedback-${params.kind}-${randomUUID()}`;
  const receiptId = `${feedbackId}-receipt`;
  const runtimeVersion = "hosted";
  const runtimeSyncToken = null;
  const taskPreset = `mcp_feedback_${params.kind}`;
  const targetLocator = buildTargetLocator(params, context);
  const receiptSummary = detail ? `${summary}\n\n${detail}` : summary;
  const receiptHash = hashFor({
    feedbackId,
    kind: params.kind,
    summary,
    detail,
    targetLocator,
  });

  return {
    feedbackId,
    receiptId,
    entry: {
      run: {
        id: feedbackId,
        status: "completed",
        startedAt: now,
        completedAt: now,
        surface: "mcp-hosted",
        taskPreset,
        resultSummary: summary,
        context: {
          brandSlug: context.slug,
          runtimeVersion,
          runtimeSyncToken,
          surface: "mcp-hosted",
          surfaceId: "mcp-hosted",
          surfaceLabel: "Brandcode MCP hosted feedback",
          freshnessState: "live",
          contextNote:
            "Append-only hosted MCP feedback recorded to UCS history; no canonical governance mutation.",
        },
        runtimeVersion,
        runtimeSyncToken,
        trustEnvelopeId: null,
        receiptIds: [receiptId],
        approvalState: params.kind === "proposal" ? "proposed" : null,
        telemetry: null,
      },
      replay: null,
      trustEnvelope: null,
      approvalRequest: null,
      receipts: [
        {
          id: receiptId,
          runId: feedbackId,
          approvalRequestId: null,
          kind: "review_guidance_note",
          appliedAt: now,
          recordedAt: now,
          destinationHome: "runtime",
          actionKind: params.kind === "proposal" ? "write_proposal" : "review",
          runtimeVersion,
          runtimeSyncToken,
          summary: receiptSummary,
          targetLocator,
          receiptHash,
          destination: {
            home: "runtime",
            kind: "review_guidance_note",
            targetId: cleanString(params.related_run_id),
            targetLabel: cleanString(params.source_tool) ?? "Hosted MCP feedback",
            applyMode: "ephemeral",
          },
        },
      ],
      proposal: null,
      portableReceiptChain: null,
    },
  };
}

function errorResponse(err: FeedbackUpstreamError, context: HostedBrandContext) {
  return buildResponse({
    what_happened: `Failed to append hosted feedback for "${context.slug}": ${err.message}`,
    next_steps:
      err.code === "hosted_brand_not_found"
        ? ["Confirm the hosted brand slug before calling brand_feedback again"]
        : err.code === "ucs_auth"
          ? ["Check the hosted MCP UCS service token configuration"]
          : err.code === "ucs_history_contract_error"
            ? ["Update the feedback entry builder to match the UCS AgentRunHistoryEntry contract before retrying"]
            : ["Retry in a moment or inspect UCS hosted history availability"],
    data: {
      error: err.code,
      status: err.status,
      upstream_status: err.upstreamStatus ?? null,
      slug: context.slug,
      history_origin: "ucs",
      canonical_mutation: false,
    },
  });
}

export function registerFeedback(server: McpServer, context: HostedBrandContext) {
  server.tool(
    "brand_feedback",
    "Append observation or proposal feedback to UCS AgentRun history for review. Append-only; does not mutate canonical governance. Returns feedback id, append status, and review posture.",
    paramsShape,
    async (args) => {
      const scopeError = enforceToolScope("brand_feedback", context);
      if (scopeError) return scopeError;

      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;

      const built = buildFeedbackEntry(parsed.data, context);
      let body: unknown;
      try {
        body = await appendHostedFeedback({
          ucsBaseUrl: context.ucsBaseUrl,
          ucsServiceToken: context.ucsServiceToken,
          slug: context.slug,
          entry: built.entry,
        });
      } catch (err) {
        if (err instanceof FeedbackUpstreamError) {
          return errorResponse(err, context);
        }
        return errorResponse(
          new FeedbackUpstreamError(
            502,
            "ucs_error",
            (err as Error).message,
          ),
          context,
        );
      }

      return buildResponse({
        what_happened: `Recorded hosted MCP ${parsed.data.kind} feedback for "${context.slug}"`,
        next_steps: [
          "Use UCS history/review surfaces to inspect this append-only feedback record",
          "Review in UCS before making any canonical governance change",
        ],
        data: {
          feedback_id: built.feedbackId,
          receipt_id: built.receiptId,
          kind: parsed.data.kind,
          append_status: "recorded",
          history_origin: "ucs",
          canonical_mutation: false,
          review_posture:
            parsed.data.kind === "proposal"
              ? "Recorded as a review proposal in UCS history; not approved governance and not applied to canon"
              : "Recorded as an observation in UCS history; not approved governance and not applied to canon",
          history_filter_note:
            "Feedback entries use the UCS AgentRun runtime surface because mcp-hosted is not an allowed AgentSupportSurface value",
          stored: body && typeof body === "object",
          telemetry: {
            general_post_active: false,
            status: "deferred",
            detail:
              "brand_feedback appends this explicit feedback entry only; general hosted AgentRun telemetry POST remains deferred",
          },
          slug: context.slug,
          environment: context.auth.environment,
        },
      });
    },
  );
}
