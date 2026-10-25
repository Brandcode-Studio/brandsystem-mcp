/**
 * Deployment entry logic for the hosted Brandcode MCP (Vercel function).
 *
 * Kept out of api/[slug].ts so it is unit-testable with an injected env.
 * Fails closed on misconfiguration: an unset/invalid BRANDCODE_MCP_ENV, a
 * Vercel production deployment not declared as production, or a missing
 * service token all yield a generic 503. The specific reason is logged
 * server-side; client bodies never name env vars.
 */
import {
  readAllowedHosts,
  readBrandcodeMcpServiceToken,
  resolveHostedEnvironment,
  BRANDCODE_MCP_SERVICE_TOKEN_ENV,
} from "./env.js";
import { HOSTED_SUPPORT_POINTER } from "./rate-limit.js";
import { handleHostedRequest, type RouterOptions } from "./router.js";

type Env = Record<string, string | undefined>;

export function misconfiguredResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "service_misconfigured",
      message: `This Brandcode MCP deployment is not configured correctly. ${HOSTED_SUPPORT_POINTER}.`,
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    },
  );
}

/** Vercel rewrites /{slug} to /api/{slug}; restore the public shape. */
export function publicUrl(originalUrl: string): string {
  const url = new URL(originalUrl);
  if (url.pathname.startsWith("/api/")) {
    url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  }
  return url.toString();
}

export function createHostedFetchHandler(
  env: Env = process.env,
  overrides: Partial<RouterOptions> = {},
) {
  return async function fetchHandler(request: Request): Promise<Response> {
    const resolved = resolveHostedEnvironment(env);
    if (!resolved.ok) {
      console.error(`[brandcode-mcp] refusing requests: ${resolved.reason}`);
      return misconfiguredResponse();
    }

    const ucsServiceToken = readBrandcodeMcpServiceToken(env);
    if (!ucsServiceToken) {
      console.error(
        `[brandcode-mcp] refusing requests: ${BRANDCODE_MCP_SERVICE_TOKEN_ENV} is not set`,
      );
      return misconfiguredResponse();
    }

    const rewritten = new Request(publicUrl(request.url), request);
    return handleHostedRequest(rewritten, {
      environment: resolved.environment,
      ucsBaseUrl: env.UCS_API_BASE_URL ?? "https://www.brandcode.studio",
      ucsServiceToken,
      allowedHosts: readAllowedHosts(env) ?? undefined,
      ...overrides,
    });
  };
}
