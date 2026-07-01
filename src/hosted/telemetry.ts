/**
 * Hosted MCP AgentRun telemetry.
 *
 * Emits one AgentRunHistoryEntry-shaped record to UCS per hosted tool call.
 * The POST body mirrors feedback-fetcher.ts's appendHostedFeedback() exactly:
 * same endpoint (`/api/brand/hosted/{slug}/agent/history`), same
 * `{ entry: <AgentRunHistoryEntry> }` envelope, same bearer auth header, same
 * AbortSignal.timeout usage.
 *
 * Fire-and-forget, fail-open: emitAgentRunRecord() intentionally does not
 * await the POST settling. The caller (the server.tool wrapper in server.ts)
 * must be able to return the tool's real MCP response without ever waiting
 * on this network call. Any failure here (network error, non-2xx) is
 * swallowed after a best-effort console.error — it must never surface as an
 * error to the MCP client or delay the response. The raw bearer token and
 * ucsServiceToken are never interpolated into a log line.
 */
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrandcodeMcpAuthInfo, HostedBrandContext } from "./types.js";

const USER_AGENT = "brandcode-mcp";
const DEFAULT_TIMEOUT_MS = 15_000;

export const HOSTED_AGENT_RUN_TELEMETRY_STATUS = "active";

export interface AgentRunRecordInput {
  ucsBaseUrl: string;
  ucsServiceToken: string;
  slug: string;
  tool: string;
  outcome: "ok" | "auth_error" | "upstream_error" | "tool_error" | "stub";
  latencyMs: number;
  auth: BrandcodeMcpAuthInfo;
  requestId: string;
  errorMessage?: string;
}

/**
 * Build the AgentRunHistoryEntry-shaped POST body for one hosted tool call.
 *
 * Mirrors the entry shape brand_feedback's buildFeedbackEntry() sends:
 * `run.surface` AND `run.context.surface`/`run.context.surfaceId` are both
 * set to "mcp-hosted" so brand_history's `?surface=mcp-hosted` filter (see
 * history-fetcher.ts) matches these entries too.
 */
function buildAgentRunEntry(input: AgentRunRecordInput): Record<string, unknown> {
  const now = new Date().toISOString();
  const runId = `mcp-run-${input.tool}-${randomUUID()}`;
  const status = input.outcome === "ok" ? "completed" : "failed";
  const resultSummary =
    input.outcome === "ok"
      ? `Hosted MCP tool ${input.tool} completed`
      : `Hosted MCP tool ${input.tool} failed (${input.outcome})`;

  return {
    run: {
      id: runId,
      status,
      startedAt: now,
      completedAt: now,
      surface: "mcp-hosted",
      taskPreset: `mcp_hosted_${input.tool}`,
      tool: input.tool,
      resultSummary,
      context: {
        brandSlug: input.slug,
        surface: "mcp-hosted",
        surfaceId: "mcp-hosted",
        surfaceLabel: "Brandcode MCP hosted tool call",
        freshnessState: "live",
        keyId: input.auth.keyId,
        environment: input.auth.environment,
        requestId: input.requestId,
      },
      telemetry: {
        outcome: input.outcome,
        durationMs: input.latencyMs,
        failureKind: input.outcome === "ok" ? null : input.outcome,
        errorMessage: input.errorMessage ?? null,
      },
      trustEnvelopeId: null,
      receiptIds: [],
      approvalState: null,
    },
    replay: null,
    trustEnvelope: null,
    approvalRequest: null,
    receipts: [],
    proposal: null,
    portableReceiptChain: null,
  };
}

/**
 * POST one AgentRun telemetry record to UCS. Fire-and-forget from the
 * caller's perspective: the returned promise resolves as soon as the POST is
 * dispatched to the event loop, not when the network call settles. Errors
 * (thrown or non-2xx) are caught inside and logged without the raw tokens.
 */
export async function emitAgentRunRecord(
  input: AgentRunRecordInput,
): Promise<void> {
  const url = new URL(
    `/api/brand/hosted/${encodeURIComponent(input.slug)}/agent/history`,
    input.ucsBaseUrl,
  );
  const entry = buildAgentRunEntry(input);

  // Intentionally not awaited by the caller: this promise chain runs on its
  // own and can never delay or throw into the tool's actual MCP response.
  void fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      authorization: `Bearer ${input.ucsServiceToken}`,
    },
    body: JSON.stringify({ entry }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  })
    .then((response) => {
      if (!response.ok) {
        console.error(
          `[brandcode-mcp] AgentRun telemetry POST failed for tool "${input.tool}" (slug "${input.slug}"): UCS returned ${response.status}`,
        );
      }
    })
    .catch((err) => {
      console.error(
        `[brandcode-mcp] AgentRun telemetry POST errored for tool "${input.tool}" (slug "${input.slug}"): ${(err as Error).message}`,
      );
    });
}

/**
 * Classify a hosted tool's result into an AgentRunRecordInput["outcome"].
 *
 * Hosted tool handlers built via buildResponse() never throw for expected
 * failure paths (auth/upstream/validation) — they encode failure as
 * `data.error: <code>` in the returned MCP content. A thrown exception means
 * the tool failed to produce a structured response at all, which is treated
 * as a tool_error at this boundary. The `insufficient_scope` code is the one
 * auth-boundary error code hosted tools return (see scope.ts); everything
 * else with an `error` key that came from a UCS/fetch failure is
 * upstream_error, and any other `error` key is a generic tool_error.
 */
const AUTH_ERROR_CODES = new Set(["insufficient_scope"]);

const UPSTREAM_ERROR_CODES = new Set([
  "fetch_failed",
  "auto_fetch_failed",
  "ucs_error",
  "ucs_auth",
  "ucs_unreachable",
  "network_error",
  "hosted_brand_not_found",
  "ucs_history_contract_error",
]);

function extractErrorCode(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    const error = parsed.error;
    return typeof error === "string" ? error : null;
  } catch {
    return null;
  }
}

export function classifyToolOutcome(
  result: unknown,
): AgentRunRecordInput["outcome"] {
  const errorCode = extractErrorCode(result);
  if (!errorCode) return "ok";
  if (AUTH_ERROR_CODES.has(errorCode)) return "auth_error";
  if (UPSTREAM_ERROR_CODES.has(errorCode)) return "upstream_error";
  return "tool_error";
}

/** Minimal shape of the two server.tool() call conventions every hosted
 *  tool file actually uses:
 *    - tool(name, description, paramsShape, callback)  (8 of 9 tools)
 *    - tool(name, description, callback)                (brand_status)
 *  Anything else is passed through untouched — telemetry simply would not
 *  wrap a call shape none of the hosted tools use. */
type AnyToolCallback = (...args: unknown[]) => unknown;

interface TelemetryToolServer {
  tool(name: string, description: string, callback: AnyToolCallback): unknown;
  tool(
    name: string,
    description: string,
    paramsShape: Record<string, unknown>,
    callback: AnyToolCallback,
  ): unknown;
}

/**
 * Wrap every `server.tool(...)` registration made through `registerFn` with
 * AgentRun telemetry timing + emission, without editing any of the 9
 * individual hosted tool files.
 *
 * This is the single choke point (KTD1): registrations.ts calls
 * `registerRuntime(server, context)` etc., and each of those calls
 * `server.tool(...)` on whatever `McpServer`-shaped object it is handed. By
 * substituting a proxy for `server` before those register functions run, we
 * intercept every one of the 9 tool.tool() calls generically — covering all
 * locked hosted tools, present and future, with one implementation.
 */
export function wrapServerWithTelemetry(
  server: McpServer,
  context: HostedBrandContext,
): McpServer {
  const target = server as unknown as TelemetryToolServer;
  const originalTool = target.tool.bind(target);

  function instrument(name: string, callback: AnyToolCallback): AnyToolCallback {
    return async (...args: unknown[]) => {
      const startedAt = Date.now();
      // The MCP SDK's RequestHandlerExtra (last callback arg) carries the
      // JSON-RPC requestId regardless of which tool.tool() overload was used.
      const extra = args[args.length - 1] as
        | { requestId?: unknown }
        | undefined;
      const requestId =
        extra && typeof extra.requestId !== "undefined"
          ? String(extra.requestId)
          : randomUUID();

      try {
        const result = await callback(...args);
        const outcome = classifyToolOutcome(result);
        void emitAgentRunRecord({
          ucsBaseUrl: context.ucsBaseUrl,
          ucsServiceToken: context.ucsServiceToken,
          slug: context.slug,
          tool: name,
          outcome,
          latencyMs: Date.now() - startedAt,
          auth: context.auth,
          requestId,
        });
        return result;
      } catch (err) {
        void emitAgentRunRecord({
          ucsBaseUrl: context.ucsBaseUrl,
          ucsServiceToken: context.ucsServiceToken,
          slug: context.slug,
          tool: name,
          outcome: "tool_error",
          latencyMs: Date.now() - startedAt,
          auth: context.auth,
          requestId,
          errorMessage: (err as Error)?.message ?? "unknown tool error",
        });
        throw err;
      }
    };
  }

  target.tool = ((...toolArgs: unknown[]) => {
    const [name, description, third, fourth] = toolArgs as [
      string,
      string,
      unknown,
      unknown,
    ];
    if (typeof third === "function") {
      // tool(name, description, callback) — the zero-arg-schema overload.
      return originalTool(name, description, instrument(name, third as AnyToolCallback));
    }
    // tool(name, description, paramsShape, callback)
    return originalTool(
      name,
      description,
      third as Record<string, unknown>,
      instrument(name, fourth as AnyToolCallback),
    );
  }) as TelemetryToolServer["tool"];

  return server;
}
