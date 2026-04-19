/**
 * Web Standard Request → Response router for the hosted Brandcode MCP.
 *
 * Responsibilities:
 *   1. Extract the slug from the URL path (`/{slug}` or `/{slug}/...`)
 *   2. Authorize the bearer token against that slug
 *   3. Build a per-request HostedBrandContext (with memoized brand-package load)
 *   4. Create an McpServer + WebStandardStreamableHTTPServerTransport
 *   5. Hand the Request to the transport
 *   6. Return its Response
 *
 * Errors (auth, upstream) are rendered as JSON with stable error codes before
 * the transport ever runs. No state leaks between requests — stateless mode
 * is enforced by sessionIdGenerator: undefined.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authorizeRequest, AuthError } from "./auth.js";
import { fetchHostedBrandPackage, UpstreamError } from "./brand-fetcher.js";
import { createHostedServer } from "./server.js";
import type { BrandPackagePayload } from "../connectors/brandcode/types.js";
import type {
  BrandcodeMcpAuthInfo,
  HostedBrandContext,
  HostedRuntimeOptions,
} from "./types.js";

export interface RouterOptions extends HostedRuntimeOptions {
  /** Override the brand fetcher (tests supply a stub). */
  fetchBrandPackage?: (slug: string, auth: BrandcodeMcpAuthInfo) => Promise<BrandPackagePayload | null>;
}

export function extractSlug(pathname: string): string | null {
  // Accept "/slug", "/slug/", or "/slug/anything". Reject "/" and "".
  const trimmed = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return null;
  const first = trimmed.split("/")[0];
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(first)) return null;
  return first.toLowerCase();
}

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function handleHostedRequest(
  request: Request,
  options: RouterOptions,
): Promise<Response> {
  const url = new URL(request.url);

  // Health check: GET / with no slug → quick 200 for uptime probes
  if (url.pathname === "/" || url.pathname === "") {
    return jsonError(200, {
      ok: true,
      service: "brandcode-mcp",
      environment: options.environment ?? "staging",
    });
  }

  const slug = extractSlug(url.pathname);
  if (!slug) {
    return jsonError(404, {
      error: "brand_not_found",
      message: "Expected URL shape /{slug} — slug must be lowercase alphanumeric",
    });
  }

  // Auth gate
  let auth: BrandcodeMcpAuthInfo;
  try {
    auth = await authorizeRequest(request.headers, slug, options);
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonError(err.status, {
        error: err.code,
        message: err.message,
        slug,
      });
    }
    return jsonError(500, {
      error: "auth_internal_error",
      message: (err as Error).message,
    });
  }

  // Build context with memoized upstream fetch — a single MCP request that
  // calls multiple tools (or slicing variants) should only hit UCS once.
  const fetchImpl =
    options.fetchBrandPackage ??
    ((s: string, _info: BrandcodeMcpAuthInfo) =>
      fetchHostedBrandPackage({
        ucsBaseUrl: options.ucsBaseUrl ?? "https://www.brandcode.studio",
        ucsServiceToken: options.ucsServiceToken,
        slug: s,
      }));

  let cached: Promise<BrandPackagePayload | null> | null = null;
  const context: HostedBrandContext = {
    slug,
    auth,
    loadBrandPackage: () => {
      if (!cached) cached = fetchImpl(slug, auth);
      return cached;
    },
    ucsBaseUrl: options.ucsBaseUrl ?? "https://www.brandcode.studio",
    ucsServiceToken: options.ucsServiceToken,
  };

  // Spin up per-request server + transport (stateless)
  const server = createHostedServer(context);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return jsonError(err.status, {
        error: err.code,
        message: err.message,
        slug,
      });
    }
    return jsonError(500, {
      error: "internal_error",
      message: (err as Error).message,
      slug,
    });
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
