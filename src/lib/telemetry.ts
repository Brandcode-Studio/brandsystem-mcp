/**
 * Opt-in anonymous telemetry for @brandsystem/mcp.
 *
 * Disabled by default. Enable with: BRANDSYSTEM_TELEMETRY=true
 *
 * What's tracked (anonymous, no content, no PII):
 * - Tool name + success/error status
 * - Session progression (which session, how many tools called)
 * - Extraction quality scores
 * - Tool call duration
 * - MCP client hint (from env, not fingerprinting)
 * - Package version
 *
 * What's NOT tracked:
 * - Brand names, colors, fonts, or any extracted content
 * - File paths, URLs, or user data
 * - IP addresses (Vercel logs capture these but telemetry doesn't send them)
 */

import { getVersion } from "./version.js";

const TELEMETRY_ENDPOINT = "https://www.brandcode.studio/api/telemetry";

let _enabled: boolean | null = null;
let _sessionId: string | null = null;
let _toolCallCount = 0;

function isEnabled(): boolean {
  if (_enabled === null) {
    const env = process.env.BRANDSYSTEM_TELEMETRY?.toLowerCase();
    _enabled = env === "true" || env === "1" || env === "yes";
  }
  return _enabled;
}

function getSessionId(): string {
  if (!_sessionId) {
    // Simple session ID: random hex, no crypto dependency
    _sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  return _sessionId;
}

export interface TelemetryEvent {
  tool: string;
  success: boolean;
  error_code?: string;
  duration_ms?: number;
  extraction_quality?: string;
  session?: number;
}

/**
 * Send a telemetry event. Fire-and-forget, never blocks, never throws.
 * No-op when BRANDSYSTEM_TELEMETRY is not set.
 */
export function trackToolCall(event: TelemetryEvent): void {
  if (!isEnabled()) return;

  _toolCallCount++;

  const payload = {
    type: "tool_call",
    v: getVersion(),
    sid: getSessionId(),
    seq: _toolCallCount,
    ts: new Date().toISOString(),
    tool: event.tool,
    ok: event.success,
    ...(event.error_code && { err: event.error_code }),
    ...(event.duration_ms && { ms: event.duration_ms }),
    ...(event.extraction_quality && { quality: event.extraction_quality }),
    ...(event.session !== undefined && { session: event.session }),
    client: process.env.MCP_CLIENT || "unknown",
  };

  // Fire and forget — never block, never throw
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    fetch(TELEMETRY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then(() => clearTimeout(timeout))
      .catch(() => clearTimeout(timeout));
  } catch {
    // Silently ignore — telemetry must never affect tool behavior
  }
}

/**
 * Track a tool call with automatic duration measurement.
 * Returns a function to call when the tool completes.
 */
export function startToolTimer(toolName: string): (result: { success: boolean; error_code?: string; extraction_quality?: string; session?: number }) => void {
  const start = Date.now();
  return (result) => {
    trackToolCall({
      tool: toolName,
      ...result,
      duration_ms: Date.now() - start,
    });
  };
}
