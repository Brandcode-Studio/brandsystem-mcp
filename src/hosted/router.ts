/**
 * Web Standard Request → Response router for the hosted Brandcode MCP.
 *
 * Request pipeline (each step runs only if the previous one passed):
 *   1. Extract the slug from the URL path (`/{slug}` or `/{slug}/...`)
 *   2. Per-client-IP rate limit (pre-auth, so unauthenticated traffic cannot
 *      drive unbounded UCS key-validation calls)
 *   3. Authorize the bearer token against that slug (strict key format →
 *      in-process validation cache → UCS)
 *   4. Read + parse the JSON-RPC body under the 1 MiB cap; reject batches
 *   5. Per-key rate limits (per slug and across all slugs)
 *   6. Build a per-request HostedBrandContext (memoized brand-package load)
 *   7. Create an McpServer + WebStandardStreamableHTTPServerTransport and hand
 *      it the already-parsed body
 *
 * Batching: MCP 2025-06-18 removed JSON-RPC batching, and a batch would let
 * one HTTP request (one rate-limit unit) fan out into up to 100 tool calls
 * and 100 telemetry POSTs. Arrays are rejected with -32600 before the
 * rate-limit counter or any tool code runs.
 *
 * Errors (auth, upstream) are rendered as JSON with stable error codes before
 * the transport ever runs. Client-facing bodies never carry raw exception
 * text; details are logged server-side. Every response is `no-store`. No
 * state leaks between requests — stateless mode is enforced by
 * sessionIdGenerator: undefined.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authorizeRequest, AuthError } from "./auth.js";
import { fetchHostedBrandPackage, UpstreamError } from "./brand-fetcher.js";
import {
  checkHostedIpRateLimit,
  checkHostedRateLimit,
  clientIpFromHeaders,
  HOSTED_SUPPORT_POINTER,
  hostedRateLimitHeaders,
} from "./rate-limit.js";
import { createHostedServer } from "./server.js";
import type { BrandPackagePayload } from "../connectors/brandcode/types.js";
import {
  fetchTasteGuidance,
  type TasteGuidanceProjection,
} from "../connectors/brandcode/taste-guidance.js";
import type {
  BrandcodeMcpAuthInfo,
  HostedBrandContext,
  HostedRateLimitSnapshot,
  HostedRuntimeOptions,
} from "./types.js";

/** Max JSON-RPC request body accepted by the hosted router (single source). */
export const HOSTED_MAX_REQUEST_BODY_BYTES = 1024 * 1024; // 1 MiB

/**
 * Hostnames the hosted MCP answers on, per environment. Requests whose Host
 * header is not listed are refused by the SDK's DNS-rebinding protection.
 * Override with BRANDCODE_MCP_ALLOWED_HOSTS (see env.ts) for preview hosts.
 */
export const DEFAULT_HOSTED_ALLOWED_HOSTS: Record<
  "staging" | "production",
  readonly string[]
> = {
  production: ["mcp.brandcode.studio"],
  staging: ["mcp.staging.brandcode.studio"],
};

export interface RouterOptions extends HostedRuntimeOptions {
  /** Override the brand fetcher (tests supply a stub). */
  fetchBrandPackage?: (
    slug: string,
    auth: BrandcodeMcpAuthInfo,
  ) => Promise<BrandPackagePayload | null>;
  /** Override approved Taste Guidance fetcher (tests supply a stub). */
  fetchTasteGuidance?: (
    slug: string,
    auth: BrandcodeMcpAuthInfo,
  ) => Promise<TasteGuidanceProjection | null>;
  /**
   * Host header values accepted by the transport (DNS-rebinding protection).
   * Defaults to DEFAULT_HOSTED_ALLOWED_HOSTS for the configured environment.
   */
  allowedHosts?: string[];
}

export function extractSlug(pathname: string): string | null {
  // Accept "/slug", "/slug/", or "/slug/anything". Reject "/" and "".
  const trimmed = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return null;
  const first = trimmed.split("/")[0];
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(first)) return null;
  return first.toLowerCase();
}

function applyHeaders(target: Headers, extra: HeadersInit): void {
  new Headers(extra).forEach((value, key) => {
    target.set(key, value);
  });
}

function jsonError(
  status: number,
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers({
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  applyHeaders(responseHeaders, headers);
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers: HeadersInit = {},
): Response {
  return jsonError(
    status,
    { jsonrpc: "2.0", error: { code, message }, id: null },
    headers,
  );
}

/**
 * Single choke point for transport responses: rate-limit headers plus
 * `cache-control: no-store` (MCP responses carry per-key brand data).
 */
function finalizeResponse(
  response: Response,
  snapshot: HostedRateLimitSnapshot,
): Response {
  const headers = new Headers(response.headers);
  applyHeaders(headers, hostedRateLimitHeaders(snapshot));
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function rateLimitUnavailable(slug: string, extra: Record<string, unknown> = {}) {
  return jsonError(503, {
    error: "rate_limit_unavailable",
    message: `Brandcode MCP is temporarily unavailable. ${HOSTED_SUPPORT_POINTER} if this persists.`,
    slug,
    ...extra,
  });
}

type BodyReadResult =
  | { kind: "ok"; text: string }
  | { kind: "too_large" };

/** Read a request body with a hard byte cap (never buffers past the cap). */
async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<BodyReadResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { kind: "too_large" };
  }
  if (!request.body) return { kind: "ok", text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { kind: "too_large" };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", text: new TextDecoder().decode(merged) };
}

export async function handleHostedRequest(
  request: Request,
  options: RouterOptions,
): Promise<Response> {
  const url = new URL(request.url);
  const environment = options.environment ?? "staging";

  // Health check: GET / with no slug → quick 200 for uptime probes
  if (url.pathname === "/" || url.pathname === "") {
    return jsonError(200, {
      ok: true,
      service: "brandcode-mcp",
      environment,
    });
  }

  const slug = extractSlug(url.pathname);
  if (!slug) {
    return jsonError(404, {
      error: "brand_not_found",
      message:
        "Expected URL shape /{slug} — slug must be lowercase alphanumeric",
    });
  }

  // Pre-auth per-IP budget: bounds how much UCS validation work any single
  // source can trigger, regardless of how many distinct tokens it tries.
  const ipLimit = await checkHostedIpRateLimit({
    ip: clientIpFromHeaders(request.headers),
    environment,
    options: options.rateLimit,
  });
  if (ipLimit.error) return rateLimitUnavailable(slug);
  if (!ipLimit.allowed) {
    return jsonError(
      429,
      {
        error: "rate_limited",
        message: "Too many requests from this client. Retry later.",
        slug,
      },
      ipLimit.retryAfterSeconds
        ? { "retry-after": String(ipLimit.retryAfterSeconds) }
        : {},
    );
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
    console.error(
      `[brandcode-mcp] auth internal error (slug "${slug}"): ${(err as Error)?.message ?? "unknown"}`,
    );
    return jsonError(500, {
      error: "auth_internal_error",
      message: "Authorization could not be completed. Retry later.",
    });
  }

  // Read and parse the body here (not in the SDK) so batches are refused
  // before they consume a rate-limit unit or reach any tool / telemetry code.
  let parsedBody: unknown = undefined;
  if (request.method === "POST") {
    let read: BodyReadResult;
    try {
      read = await readBodyCapped(request, HOSTED_MAX_REQUEST_BODY_BYTES);
    } catch {
      return jsonRpcError(400, -32700, "Parse error: unreadable request body");
    }
    if (read.kind === "too_large") {
      return jsonRpcError(
        413,
        -32000,
        `Payload too large: request body exceeds ${HOSTED_MAX_REQUEST_BODY_BYTES} bytes`,
      );
    }
    try {
      parsedBody = JSON.parse(read.text);
    } catch {
      return jsonRpcError(400, -32700, "Parse error: Invalid JSON");
    }
    if (Array.isArray(parsedBody)) {
      return jsonRpcError(
        400,
        -32600,
        "Invalid Request: JSON-RPC batching is not supported",
      );
    }
  }

  const rateLimit = await checkHostedRateLimit({
    slug,
    auth,
    options: options.rateLimit,
  });
  if (rateLimit.error) {
    return rateLimitUnavailable(slug, { rate_limits: rateLimit.snapshot });
  }
  if (!rateLimit.allowed) {
    return jsonError(
      429,
      {
        error: "rate_limited",
        message: "Brandcode MCP request rate limit exceeded",
        slug,
        rate_limits: rateLimit.snapshot,
      },
      hostedRateLimitHeaders(rateLimit.snapshot),
    );
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
  const fetchTasteImpl =
    options.fetchTasteGuidance ??
    ((s: string, _info: BrandcodeMcpAuthInfo) =>
      fetchTasteGuidance({
        baseUrl: options.ucsBaseUrl ?? "https://www.brandcode.studio",
        authToken: options.ucsServiceToken,
        slug: s,
      }));
  let cachedTasteGuidance: Promise<TasteGuidanceProjection | null> | null =
    null;
  const context: HostedBrandContext = {
    slug,
    auth,
    loadBrandPackage: () => {
      if (!cached) cached = fetchImpl(slug, auth);
      return cached;
    },
    loadTasteGuidance: () => {
      if (!cachedTasteGuidance)
        cachedTasteGuidance = fetchTasteImpl(slug, auth);
      return cachedTasteGuidance;
    },
    ucsBaseUrl: options.ucsBaseUrl ?? "https://www.brandcode.studio",
    ucsServiceToken: options.ucsServiceToken,
    rateLimit: rateLimit.snapshot,
  };

  // The body was consumed above; hand the transport a body-less copy. A
  // missing Host header (synthetic requests) falls back to the URL host,
  // which the platform derives from Host — so DNS-rebinding checks still see
  // the real public hostname.
  const transportHeaders = new Headers(request.headers);
  if (!transportHeaders.get("host")) transportHeaders.set("host", url.host);
  const transportRequest = new Request(request.url, {
    method: request.method,
    headers: transportHeaders,
  });

  // Spin up per-request server + transport (stateless). Both are
  // constructed *inside* the try block: createHostedServer() runs
  // wrapServerWithTelemetry(), which can throw at registration time (an
  // unrecognized server.tool() calling convention, or a double-wrap guard)
  // -- that throw must degrade to a scoped internal_error response like any
  // other request-time failure, not escape as an unhandled exception that
  // would take down every brand's requests.
  let server: ReturnType<typeof createHostedServer> | undefined;
  let transport: WebStandardStreamableHTTPServerTransport | undefined;

  try {
    server = createHostedServer(context);
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      // The router already enforced this cap while reading the body; kept on
      // the transport as defense in depth (GHSA-46jr-4wx8-v453).
      maxRequestBodySize: HOSTED_MAX_REQUEST_BODY_BYTES,
      enableDnsRebindingProtection: true,
      allowedHosts: options.allowedHosts ?? [
        ...DEFAULT_HOSTED_ALLOWED_HOSTS[environment],
      ],
    });
    await server.connect(transport);
    const response = await transport.handleRequest(
      transportRequest,
      parsedBody === undefined ? undefined : { parsedBody },
    );
    return finalizeResponse(response, rateLimit.snapshot);
  } catch (err) {
    if (err instanceof UpstreamError) {
      console.error(
        `[brandcode-mcp] upstream error (slug "${slug}", ${err.code}): ${err.message}`,
      );
      return jsonError(
        err.status,
        {
          error: err.code,
          message: "Brand data could not be loaded from Brandcode Studio. Retry later.",
          slug,
        },
        hostedRateLimitHeaders(rateLimit.snapshot),
      );
    }
    console.error(
      `[brandcode-mcp] internal error (slug "${slug}"): ${(err as Error)?.message ?? "unknown"}`,
    );
    return jsonError(
      500,
      {
        error: "internal_error",
        message: "The request could not be completed. Retry later.",
        slug,
      },
      hostedRateLimitHeaders(rateLimit.snapshot),
    );
  } finally {
    await transport?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
}
