/**
 * Node HTTP entry for the hosted Brandcode MCP.
 *
 * Reads config from environment (staging/production, UCS base URL, service
 * token) and binds the router to a Node http.Server. Used by:
 *   - `bin/brandcode-mcp.mjs` for local dev
 *   - CI smoke harness
 *
 * Vercel deployments use `api/[slug].ts` instead — it calls the
 * same router directly, no Node server adapter required.
 */
import http from "node:http";
import { Readable } from "node:stream";
import {
  BRANDCODE_MCP_SERVICE_TOKEN_ENV,
  readAllowedHosts,
  readBrandcodeMcpServiceToken,
  resolveHostedEnvironment,
} from "./hosted/env.js";
import { handleHostedRequest } from "./hosted/router.js";
import type { RouterOptions } from "./hosted/router.js";

function readEnv(): RouterOptions {
  // Local/dev entry: an unset BRANDCODE_MCP_ENV still means staging here
  // (bin/brandcode-mcp.mjs documents that default), but an invalid value or
  // a VERCEL_ENV=production mismatch is refused, same as the Vercel entry.
  const resolved = resolveHostedEnvironment({
    ...process.env,
    BRANDCODE_MCP_ENV: process.env.BRANDCODE_MCP_ENV?.trim() || "staging",
  });
  if (!resolved.ok) {
    throw new Error(`Hosted MCP misconfigured: ${resolved.reason}`);
  }
  const ucsServiceToken = readBrandcodeMcpServiceToken();
  if (!ucsServiceToken) {
    throw new Error(
      `${BRANDCODE_MCP_SERVICE_TOKEN_ENV} is required for hosted MCP to call UCS`,
    );
  }
  return {
    environment: resolved.environment,
    ucsBaseUrl: process.env.UCS_API_BASE_URL ?? "https://www.brandcode.studio",
    ucsServiceToken,
    // Local dev serves on localhost; production hostnames are the default
    // only when deployed. Override with BRANDCODE_MCP_ALLOWED_HOSTS.
    allowedHosts: readAllowedHosts() ?? [
      `localhost:${process.env.PORT ?? 3030}`,
      `127.0.0.1:${process.env.PORT ?? 3030}`,
    ],
  };
}

async function nodeToWebRequest(
  req: http.IncomingMessage,
): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const protocol = "http";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  // The router's per-IP limiter trusts x-real-ip (Vercel sets it at the
  // edge). Here there is no edge, so overwrite any client-supplied value with
  // the socket peer address and drop x-forwarded-for.
  headers.delete("x-forwarded-for");
  headers.set("x-real-ip", req.socket.remoteAddress ?? "unknown");

  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? (Readable.toWeb(req) as unknown as BodyInit) : null;

  return new Request(url, {
    method,
    headers,
    body,
    // Required by Node's undici when passing a streaming body
    // @ts-expect-error — `duplex` exists on Node's Request polyfill
    duplex: "half",
  });
}

async function writeWebResponse(
  response: Response,
  res: http.ServerResponse,
): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

export function createHttpServer(options: RouterOptions) {
  return http.createServer(async (req, res) => {
    try {
      const webRequest = await nodeToWebRequest(req);
      const webResponse = await handleHostedRequest(webRequest, options);
      await writeWebResponse(webResponse, res);
    } catch (err) {
      console.error(
        `[brandcode-mcp] http adapter error: ${(err as Error)?.message ?? "unknown"}`,
      );
      if (res.headersSent) {
        res.end();
        return;
      }
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.setHeader("cache-control", "no-store");
      res.end(
        JSON.stringify({
          error: "internal_error",
          message: "The request could not be completed. Retry later.",
        }),
      );
    }
  });
}

export function startServer(options?: RouterOptions): http.Server {
  const resolved = options ?? readEnv();
  const port = Number(process.env.PORT ?? 3030);
  const server = createHttpServer(resolved);
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `brandcode-mcp listening on :${port} (${resolved.environment}, UCS ${resolved.ucsBaseUrl})`,
    );
  });
  return server;
}

// When invoked as a CLI entry — handled by bin/brandcode-mcp.mjs via dynamic import.
