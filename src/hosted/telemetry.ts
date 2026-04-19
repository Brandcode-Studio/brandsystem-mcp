/**
 * Emit AgentRunRecord to UCS for A-5 activity surfacing.
 *
 * Fire-and-forget: emissions never block the tool response; failures log but
 * do not propagate. Phase 1 scope is the essentials (provider, surface, tool,
 * outcome, latency). Follow-ups may add token counts, reasoning samples, etc.
 */
import type { BrandcodeMcpAuthInfo } from "./types.js";

const USER_AGENT = "brandcode-mcp";
const TIMEOUT_MS = 5_000;

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

export async function emitAgentRunRecord(
  input: AgentRunRecordInput,
): Promise<void> {
  const url = `${input.ucsBaseUrl}/api/brand/hosted/${encodeURIComponent(input.slug)}/agent/history`;
  const payload = {
    provider: "mcp" as const,
    surface: "mcp-hosted" as const,
    requestId: input.requestId,
    tool: input.tool,
    outcome: input.outcome,
    latencyMs: input.latencyMs,
    environment: input.auth.environment,
    scopes: input.auth.scopes,
    keyId: input.auth.keyId,
    errorMessage: input.errorMessage,
    emittedAt: new Date().toISOString(),
  };

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": USER_AGENT,
        authorization: `Bearer ${input.ucsServiceToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // Observability is a non-blocking concern. Surface via console.error so
    // platform logs can pick it up without breaking tool responses.
    console.error(
      `[brandcode-mcp] telemetry emit failed for ${input.slug}/${input.tool}: ${(err as Error).message}`,
    );
  }
}
