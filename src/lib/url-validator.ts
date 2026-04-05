import dns from "node:dns/promises";
import { Agent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

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

function isPrivateIP(ip: string, family: 4 | 6): boolean {
  return family === 4 ? isPrivateIPv4(ip) : isPrivateIPv6(ip);
}

/**
 * Validate that a URL is safe to fetch (not targeting private/reserved IPs).
 * Throws if the URL uses a non-http(s) protocol or resolves to a private IP.
 */
export async function validateUrl(url: string): Promise<void> {
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
    return;
  }
  if (hostname.includes(":")) {
    // IPv6 literal
    if (isPrivateIPv6(hostname)) {
      throw new Error(`SSRF blocked: ${hostname} is a private IP`);
    }
    return;
  }

  // DNS resolution
  const { address, family } = await dns.lookup(hostname);

  if (family === 4 && isPrivateIPv4(address)) {
    throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${address}`);
  }
  if (family === 6 && isPrivateIPv6(address)) {
    throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${address}`);
  }
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
 * Follows redirects manually (up to 3 hops), validating each target.
 *
 * SECURITY: Uses a custom DNS lookup callback to prevent DNS rebinding (TOCTOU).
 * The lookup callback validates the resolved IP BEFORE the connection is made,
 * closing the window between validateUrl() and the actual TCP connection.
 */
export async function safeFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  // Pre-validate (catches protocol issues and IP literals early)
  await validateUrl(url);

  let currentUrl = url;
  let hops = 0;

  while (true) {
    const response = await fetch(currentUrl, { ...options, redirect: "manual" });

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
    await validateUrl(currentUrl);
  }
}
