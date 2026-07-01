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

export function createHostedServer(context: HostedBrandContext): McpServer {
  const server = new McpServer({
    name: "brandcode-mcp",
    version: getVersion(),
  });
  // Single choke point for AgentRun telemetry: every tool registered below
  // goes through the wrapped `server.tool`, so each of the 9 locked hosted
  // tools gets timed + emits a telemetry record without any of the 9
  // individual tool files knowing telemetry exists.
  wrapServerWithTelemetry(server, context);
  registerHostedTools(server, context);
  return server;
}
