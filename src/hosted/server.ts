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
import type { HostedBrandContext } from "./types.js";

export function createHostedServer(context: HostedBrandContext): McpServer {
  const server = new McpServer({
    name: "brandcode-mcp",
    version: getVersion(),
  });
  registerHostedTools(server, context);
  return server;
}
