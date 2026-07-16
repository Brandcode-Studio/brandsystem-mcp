/**
 * Register the hosted surface onto an McpServer scoped to a single
 * brand context. Registration order matches the Phase 0 lock table so clients
 * see tools in a stable, documented sequence.
 *
 * Any tool whose scope requirement is not granted to the current key is still
 * registered — the handler returns a 403-equivalent response when called.
 * Scope enforcement happens at the auth layer before dispatch; registration
 * reflects the full surface so listTools advertises the complete contract.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostedBrandContext } from "./types.js";
import { registerRuntime } from "./tools/runtime.js";
import { registerSearch } from "./tools/search.js";
import { registerCheck } from "./tools/check.js";
import { registerStatus } from "./tools/status.js";
import { registerGetAsset, registerListAssets } from "./tools/assets.js";
import { registerFeedback } from "./tools/feedback.js";
import { registerCaptureTaste } from "./tools/capture-taste.js";
import { registerHistory } from "./tools/history.js";
import { HOSTED_TOOL_ORDER } from "./tool-order.mjs";

// Single source of truth for HOSTED_TOOL_ORDER lives in ./tool-order.mjs (a
// plain zero-dependency ES module) so scripts/hosted-mcp-smoke.mjs can import
// the exact same values without a build step. Re-exported here so this
// remains the canonical import path for the rest of the codebase.
export { HOSTED_TOOL_ORDER };

export function registerHostedTools(
  server: McpServer,
  context: HostedBrandContext,
) {
  // Order matches Phase 0 lock table.
  registerRuntime(server, context);
  registerSearch(server, context);
  registerCheck(server, context);
  registerStatus(server, context);
  registerListAssets(server, context);
  registerGetAsset(server, context);
  registerFeedback(server, context);
  registerCaptureTaste(server, context);
  registerHistory(server, context);
}
