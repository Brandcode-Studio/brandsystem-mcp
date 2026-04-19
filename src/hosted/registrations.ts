/**
 * Register the 8-tool hosted surface onto an McpServer scoped to a single
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
import { registerStatus } from "./tools/status.js";
import {
  registerSearchStub,
  registerCheckStub,
  registerListAssetsStub,
  registerGetAssetStub,
  registerFeedbackStub,
  registerHistoryStub,
} from "./tools/stubs.js";

export const HOSTED_TOOL_ORDER = [
  "brand_runtime",
  "brand_search",
  "brand_check",
  "brand_status",
  "list_brand_assets",
  "get_brand_asset",
  "brand_feedback",
  "brand_history",
] as const;

export function registerHostedTools(
  server: McpServer,
  context: HostedBrandContext,
) {
  // Order matches Phase 0 lock table.
  registerRuntime(server, context);
  registerSearchStub(server, context);
  registerCheckStub(server, context);
  registerStatus(server, context);
  registerListAssetsStub(server, context);
  registerGetAssetStub(server, context);
  registerFeedbackStub(server, context);
  registerHistoryStub(server, context);
}
