/**
 * Factory for a per-request hosted McpServer.
 *
 * Each HTTP request spins up a fresh server bound to one brand context. This
 * matches the stateless Streamable HTTP model (WebStandardStreamableHTTPServerTransport
 * with sessionIdGenerator undefined) and keeps brand-scoped state from leaking
 * across tenants.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getVersion } from "../lib/version.js";
import { registerHostedTools } from "./registrations.js";
import { wrapServerWithTelemetry } from "./telemetry.js";
import type { HostedBrandContext } from "./types.js";

/**
 * Largest combined count of array elements + object members one hosted
 * `tools/call` may carry (GHSA-46jr-4wx8-v453). The widest hosted input is a
 * 500-item array, so 5,000 leaves headroom for nested objects while keeping a
 * single request far from heap exhaustion.
 */
export const HOSTED_MAX_TOOL_INPUT_ELEMENTS = 5_000;

export function createHostedServer(context: HostedBrandContext): McpServer {
  const server = new McpServer(
    {
      name: "brandcode-mcp",
      version: getVersion(),
    },
    { maxToolInputElements: HOSTED_MAX_TOOL_INPUT_ELEMENTS },
  );
  // Single choke point for AgentRun telemetry: every tool registered below
  // goes through the wrapped `server.tool`, so each of the 9 locked hosted
  // tools gets timed + emits a telemetry record without any of the 9
  // individual tool files knowing telemetry exists.
  wrapServerWithTelemetry(server, context);
  registerHostedTools(server, context);
  return server;
}
