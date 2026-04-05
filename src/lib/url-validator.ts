import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { RequestOptions as NodeRequestOptions } from "node:http";

/** CIDR ranges that must never be reached by outbound fetches. */
const PRIVATE_RANGES_V4: Array<{ base: number; mask: number }> = [
  { base: ip4ToInt("127.0.0.0"), mask: prefixToMask(8) },   // loopback
  { base: ip4ToInt("10.0.0.0"), mask: prefixToMask(8) },    // private
  { base: ip4ToInt("172.16.0.0"), mask: prefixToMask(12) },  // private
  { base: ip4ToInt("192.168.0.0"), mask: prefixToMask(16) }, // private
  { base: ip4ToInt("169.254.0.0"), mask: prefixToMask(16) }, // link-local / cloud metadata
  { base: ip4ToInt("0.0.0.0"), mask: prefixToMask(8) },     // unspecified
];

function ip4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function prefixToMask(prefix: number): number {
  return (~0 << (32 - prefix)) >>> 0;
}

export function isPrivateIPv4(ip: string): boolean {
  const int = ip4ToInt(ip);
  return PRIVATE_RANGES_V4.some((r) => ((int & r.mask) >>> 0) === r.base);
}

export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;          // loopback
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // fe80::/10
  return false;
}

/**
 * Validate that a URL is safe to fetch (not targeting private/reserved IPs).
 * Throws if the URL uses a non-http(s) protocol or resolves to a private IP.
 */
export async function validateUrl(url: string): Promise<void> {
  await resolveValidatedAddress(url);
}

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
  hostname: string;
};

async function resolveValidatedAddress(url: string): Promise<ResolvedAddress> {
  const parsed = new URL(url); // throws on malformed URLs

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`SSRF blocked: unsupported protocol "${parsed.protocol}"`);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // Direct IP literal check (skip DNS)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      throw new Error(`SSRF blocked: ${hostname} is a private IP`);
    }
    return { address: hostname, family: 4, hostname };
  }
  if (hostname.includes(":")) {
    // IPv6 literal
    if (isPrivateIPv6(hostname)) {
      throw new Error(`SSRF blocked: ${hostname} is a private IP`);
    }
    return { address: hostname, family: 6, hostname };
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new Error(`SSRF blocked: ${hostname} did not resolve to any IP`);
  }

  for (const { address, family } of records) {
    if (family === 4 && isPrivateIPv4(address)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${address}`);
    }
    if (family === 6 && isPrivateIPv6(address)) {
      throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${address}`);
    }
  }

  const selected = records[0];
  return {
    address: selected.address,
    family: selected.family as 4 | 6,
    hostname,
  };
}

const MAX_REDIRECTS = 3;

/** Max bytes for fetched HTML pages */
export const MAX_HTML_BYTES = 5 * 1024 * 1024; // 5 MB
/** Max bytes for fetched CSS stylesheets */
export const MAX_CSS_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Read a response body with a byte limit. Throws if limit exceeded.
 */
export async function readResponseWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      reader.cancel();
      throw new Error(`Response exceeded ${(maxBytes / 1024 / 1024).toFixed(1)}MB limit`);
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/**
 * Fetch a URL after validating it is not a private/reserved IP.
 * Follows redirects manually (up to 3 hops), validating and pinning each target.
 *
 * SECURITY: Each request resolves DNS up front, rejects private/reserved
 * addresses, and then passes a fixed lookup callback into the underlying
 * HTTP(S) client so the socket connects to that vetted IP. Redirects repeat
 * the same validation and pinning on every hop.
 */
export async function safeFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  let currentUrl = url;
  let hops = 0;

  while (true) {
    const response = await pinnedRequest(currentUrl, options);

    if (![301, 302, 307, 308].includes(response.status)) {
      return response;
    }

    hops++;
    if (hops > MAX_REDIRECTS) {
      throw new Error(`SSRF blocked: too many redirects (>${MAX_REDIRECTS})`);
    }

    const location = response.headers.get("location");
    if (!location) {
      return response; // redirect with no Location — return as-is
    }

    // Resolve relative redirects
    currentUrl = new URL(location, currentUrl).href;
  }
}

async function pinnedRequest(url: string, options?: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  const resolved = await resolveValidatedAddress(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const method = options?.method ?? "GET";
  const headers = new Headers(options?.headers);

  return await new Promise<Response>((resolve, reject) => {
    const requestOptions: NodeRequestOptions & { servername?: string } = {
      protocol: parsed.protocol,
      hostname: resolved.hostname,
      port: parsed.port || undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: Object.fromEntries(headers.entries()),
      lookup(_hostname, requestOptions, callback) {
        if (typeof requestOptions === "object" && requestOptions?.all) {
          callback(null, [{ address: resolved.address, family: resolved.family }]);
          return;
        }

        callback(null, resolved.address, resolved.family);
      },
      signal: options?.signal ?? undefined,
    };

    if (parsed.protocol === "https:") {
      requestOptions.servername = resolved.hostname;
    }

    const req = transport.request(
      requestOptions,
      (res) => {
        const chunks: Uint8Array[] = [];

        res.on("data", (chunk) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseHeaders = new Headers();

          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              for (const entry of value) responseHeaders.append(key, entry);
            } else if (typeof value === "string") {
              responseHeaders.set(key, value);
            }
          }

          resolve(new Response(body, {
            status: res.statusCode ?? 200,
            statusText: res.statusMessage,
            headers: responseHeaders,
          }));
        });
      },
    );

    req.on("error", reject);

    if (options?.body == null) {
      req.end();
      return;
    }

    if (typeof options.body === "string" || options.body instanceof Uint8Array) {
      req.end(options.body);
      return;
    }

    reject(new Error("safeFetch only supports string or Uint8Array request bodies"));
  });
}
