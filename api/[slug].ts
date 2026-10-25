/**
 * Vercel Function entry for the hosted Brandcode MCP (Fluid Compute, Node runtime).
 *
 * Web Standard fetch handler — matches the Vercel Functions "other framework"
 * convention (https://vercel.com/docs/functions/runtimes/node-js).
 *
 * URL shape at the edge: `https://mcp.staging.brandcode.studio/{slug}` and
 * `https://mcp.brandcode.studio/{slug}`. vercel.json rewrites `/:slug` to
 * `/api/:slug` so the filesystem function at this path serves that traffic.
 *
 * All logic lives in src/hosted/entry.ts (unit-tested): it fails closed with
 * a generic 503 unless BRANDCODE_MCP_ENV is explicitly "production" or
 * "staging" (and "production" on a VERCEL_ENV=production deployment) and the
 * service token is set, then restores the public `/{slug}` URL and hands the
 * request to the router.
 */
import { createHostedFetchHandler } from "../src/hosted/entry.js";

const fetchHandler = createHostedFetchHandler();

export default {
  async fetch(request: Request): Promise<Response> {
    return fetchHandler(request);
  },
};
