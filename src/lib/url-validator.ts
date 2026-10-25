import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { RequestOptions as NodeRequestOptions } from "node:http";

/**
 * IPv4 ranges that must never be reached by outbound fetches: everything
 * IANA marks non-global (RFC 6890 special-purpose registry) plus multicast
 * and reserved space.
 */
const BLOCKED_RANGES_V4: ReadonlyArray<readonly [string, number, string]> = [
  ["0.0.0.0", 8, "this network / unspecified"],
  ["10.0.0.0", 8, "private (RFC 1918)"],
  ["100.64.0.0", 10, "shared address space / CGNAT (RFC 6598)"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local / cloud metadata"],
  ["172.16.0.0", 12, "private (RFC 1918)"],
  ["192.0.0.0", 24, "IETF protocol assignments"],
  ["192.0.2.0", 24, "documentation (TEST-NET-1)"],
  ["192.88.99.0", 24, "6to4 relay anycast"],
  ["192.168.0.0", 16, "private (RFC 1918)"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation (TEST-NET-2)"],
  ["203.0.113.0", 24, "documentation (TEST-NET-3)"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved / broadcast"],
];

const PRIVATE_RANGES_V4 = BLOCKED_RANGES_V4.map(([base, prefix]) => ({
  base: ip4ToInt(base),
  mask: prefixToMask(prefix),
}));

function ip4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
}

function isCanonicalDottedQuad(ip: string): boolean {
  const parts = ip.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)
  );
}

/**
 * True when an IPv4 address is private, reserved, or otherwise non-global.
 * Fails closed: anything that is not a canonical dotted quad is treated as
 * private, so a parser disagreement can never become an allow.
 */
export function isPrivateIPv4(ip: string): boolean {
  if (!isCanonicalDottedQuad(ip)) return true;
  const int = ip4ToInt(ip);
  return PRIVATE_RANGES_V4.some((r) => ((int & r.mask) >>> 0) === r.base);
}

/**
 * Parse an IPv6 literal (optionally bracketed, optionally with a trailing
 * dotted-quad) into eight 16-bit groups. Returns null for anything Node's
 * own parser rejects or that this expansion cannot represent exactly.
 */
function parseIPv6(input: string): number[] | null {
  let ip = input.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip.includes("%")) return null; // zone ids never appear in fetchable URLs
  if (!isIP(ip) || isIP(ip) !== 6) return null;

  // Fold a trailing embedded IPv4 (e.g. ::ffff:1.2.3.4) into two hex groups.
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isCanonicalDottedQuad(tail)) return null;
    const v4 = ip4ToInt(tail);
    ip = `${ip.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest].map(
    (g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN),
  );
  return groups.length === 8 && groups.every((g) => Number.isInteger(g)) ? groups : null;
}

function v4FromGroups(hi: number, lo: number): string {
  return [hi >>> 8, hi & 0xff, lo >>> 8, lo & 0xff].join(".");
}

/**
 * True when an IPv6 address is private, reserved, or can reach an IPv4
 * address that is. Covers every transition format that embeds an IPv4
 * address (IPv4-mapped, IPv4-compatible, IPv4-translated, NAT64, 6to4) by
 * re-checking the embedded address with isPrivateIPv4, so a blocked IPv4
 * destination cannot be reached by rewriting it as IPv6 (GHSA-j3rv-rv99-hg74).
 * Fails closed on anything unparseable.
 */
export function isPrivateIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true;

  const zeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);

  // ::/128 unspecified, ::1/128 loopback
  if (zeroPrefix(7) && (g[7] === 0 || g[7] === 1)) return true;
  // ::ffff:0:0/96 IPv4-mapped
  if (zeroPrefix(5) && g[5] === 0xffff) return isPrivateIPv4(v4FromGroups(g[6], g[7]));
  // ::ffff:0:0:0/96 IPv4-translated (SIIT)
  if (zeroPrefix(4) && g[4] === 0xffff && g[5] === 0) return isPrivateIPv4(v4FromGroups(g[6], g[7]));
  // NAT64 prefixes sit inside ::/8, so they are checked before that blanket rule.
  // 64:ff9b::/96 NAT64 well-known prefix — reaches the embedded IPv4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateIPv4(v4FromGroups(g[6], g[7]));
  }
  // 64:ff9b:1::/48 NAT64 local-use
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;
  // ::/96 IPv4-compatible (deprecated) and the rest of ::/8 (after NAT64 above) — never global
  if (g[0] >>> 8 === 0) return true;
  // 100::/64 discard-only
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return true;
  // 2001::/32 Teredo — embeds an obfuscated client IPv4; never needed here
  if (g[0] === 0x2001 && g[1] === 0) return true;
  // 2001:db8::/32 documentation
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true;
  // 2002::/16 6to4 — reaches the IPv4 in groups 1-2
  if (g[0] === 0x2002) return isPrivateIPv4(v4FromGroups(g[1], g[2]));
  // fc00::/7 unique local
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 link-local, fec0::/10 deprecated site-local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true;
  // ff00::/8 multicast
  if (g[0] >>> 8 === 0xff) return true;

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

export type SafeFetchOptions = RequestInit & {
  /** Hard socket-stream limit. Defaults to MAX_HTML_BYTES. */
  maxResponseBytes?: number;
};

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
  options?: SafeFetchOptions,
): Promise<Response> {
  let currentUrl = url;
  let hops = 0;
  const maxResponseBytes = options?.maxResponseBytes ?? MAX_HTML_BYTES;

  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
    throw new Error("safeFetch maxResponseBytes must be a non-negative safe integer");
  }

  while (true) {
    const response = await pinnedRequest(currentUrl, options, maxResponseBytes);

    if (![301, 302, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response; // redirect with no Location — return as-is
    }

    // Redirect bodies are never consumed. Cancel immediately so a hostile
    // redirect cannot keep streaming bytes while the next hop is validated.
    await response.body?.cancel().catch(() => undefined);

    hops++;
    if (hops > MAX_REDIRECTS) {
      throw new Error(`SSRF blocked: too many redirects (>${MAX_REDIRECTS})`);
    }

    // Resolve relative redirects
    currentUrl = new URL(location, currentUrl).href;
  }
}

async function pinnedRequest(
  url: string,
  options: SafeFetchOptions | undefined,
  maxResponseBytes: number,
): Promise<Response> {
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
        const responseHeaders = new Headers();

        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) {
            for (const entry of value) responseHeaders.append(key, entry);
          } else if (typeof value === "string") {
            responseHeaders.set(key, value);
          }
        }

        const declaredLength = Number(responseHeaders.get("content-length"));
        if (method !== "HEAD" && Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
          res.destroy();
          reject(new Error(`Response exceeded ${maxResponseBytes} byte limit`));
          return;
        }

        const status = res.statusCode ?? 200;
        const statusForbidsBody = status === 101 || status === 204 || status === 205 || status === 304;
        const body = method === "HEAD" || statusForbidsBody
          ? null
          : new ReadableStream<Uint8Array>({
              start(controller) {
                let totalBytes = 0;
                let closed = false;

                const fail = (error: Error) => {
                  if (closed) return;
                  closed = true;
                  controller.error(error);
                  res.destroy();
                };

                res.on("data", (chunk: Buffer | string) => {
                  if (closed) return;
                  const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
                  totalBytes += bytes.byteLength;
                  if (totalBytes > maxResponseBytes) {
                    fail(new Error(`Response exceeded ${maxResponseBytes} byte limit`));
                    return;
                  }
                  controller.enqueue(bytes);
                });
                res.on("end", () => {
                  if (closed) return;
                  closed = true;
                  controller.close();
                });
                res.on("error", (error) => fail(error));
              },
              cancel() {
                res.destroy();
              },
            });

        resolve(new Response(body, {
          status,
          statusText: res.statusMessage,
          headers: responseHeaders,
        }));
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
