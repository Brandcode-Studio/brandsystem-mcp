/**
 * Vercel Function entry for the hosted Brandcode MCP (Fluid Compute, Node runtime).
 *
 * Web Standard fetch handler — matches the Vercel Functions "other framework"
 * convention (https://vercel.com/docs/functions/runtimes/node-js).
 *
 * URL shape at the edge: `https://mcp.staging.brandcode.studio/{slug}` and
 * `https://mcp.brandcode.studio/{slug}`. vercel.ts rewrites `/:slug` to
 * `/api/:slug` so the filesystem function at this path serves that traffic.
 *
 * The router reconstructs the public URL (strip the `/api` prefix) before
 * dispatching so the MCP transport and downstream tools see the slug-only
 * path the Phase 0 lock specifies.
 */
import { handleHostedRequest } from "../src/hosted/router.js";

function publicUrl(originalUrl: string): string {
  const url = new URL(originalUrl);
  // Vercel rewrite sends us /api/{slug}; strip /api to restore the public shape.
  if (url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  }
  return url.toString();
}

export default {
  async fetch(request: Request): Promise<Response> {
    const ucsServiceToken = process.env.UCS_SERVICE_TOKEN;
    if (!ucsServiceToken) {
      return new Response(
        JSON.stringify({
          error: "misconfigured",
          message: "UCS_SERVICE_TOKEN is not set on this deployment",
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }

    const environment =
      process.env.BRANDCODE_MCP_ENV === "production" ? "production" : "staging";

    const rewritten = new Request(publicUrl(request.url), request);
    return handleHostedRequest(rewritten, {
      environment,
      ucsBaseUrl:
        process.env.UCS_API_BASE_URL ?? "https://www.brandcode.studio",
      ucsServiceToken,
    });
  },
};
