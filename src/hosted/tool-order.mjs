/**
 * Single source of truth for the locked hosted MCP tool registration order
 * (the Phase 0 lock table).
 *
 * This is a plain zero-dependency ES module (not TypeScript) so it can be
 * imported directly by both:
 *   - src/hosted/registrations.ts — compiled by tsc (allowJs: true) into
 *     dist/hosted/tool-order.mjs, with dist/hosted/tool-order.d.mts
 *     auto-generated from the @type {const} annotation below
 *   - scripts/hosted-mcp-smoke.mjs — a standalone Node script that imports
 *     this file directly by relative path, with no build step required
 *
 * Keeping this as .mjs (rather than duplicating the array, or having the
 * smoke script depend on a prior `npm run build`) is what keeps the two
 * previously-independent copies from silently drifting apart.
 */
export const HOSTED_TOOL_ORDER = /** @type {const} */ ([
  "brand_runtime",
  "brand_search",
  "brand_check",
  "brand_status",
  "list_brand_assets",
  "get_brand_asset",
  "brand_feedback",
  "capture_taste",
  "brand_history",
]);
