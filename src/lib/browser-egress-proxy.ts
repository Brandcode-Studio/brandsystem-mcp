/**
 * Browser Egress Proxy — the only network path headless Chromium is given.
 *
 * Request interception and `validateUrl()` can only check a URL. They cannot
 * stop Chromium from resolving the hostname a second time (DNS rebinding), and
 * they never see service-worker, WebSocket, QUIC, or WebRTC traffic. This
 * module closes that gap: Chromium is launched with this proxy as its sole
 * egress and with its own resolver disabled, so every connection the browser
 * makes is resolved HERE, every resolved address is validated with the same
 * blocklist `safeFetch` uses (`resolveValidatedHostAddresses`), and the
 * upstream socket is connected to that validated IP. The name is never
 * re-resolved after validation.
 *
 * Supported proxy traffic:
 *   - CONNECT host:port tunnels (HTTPS, WSS)
 *   - absolute-URI plain HTTP requests (`GET http://host/path`)
 *   - absolute-URI `Upgrade:` requests (plain ws:// handshakes)
 *
 * Everything else is refused with 403 (policy) / 400 (malformed) / 503 (limits).
 */

import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";
import {
  isBlockedIpAddress,
  resolveValidatedHostAddresses,
  type LookupAllFn,
} from "./url-validator.js";

/** The proxy only ever listens on IPv4 loopback. */
export const EGRESS_PROXY_HOST = "127.0.0.1";

export const DEFAULT_EGRESS_ALLOWED_PORTS: readonly number[] = [80, 443];

const DEFAULT_MAX_UPSTREAM_CONNECTIONS = 64;
const DEFAULT_MAX_CLIENT_CONNECTIONS = 128;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_LOOKUP_TIMEOUT_MS = 5_000;
const MAX_LOG_ENTRIES = 500;

/** A validated upstream target: always an IP literal plus port. */
export interface EgressTarget {
  address: string;
  family: 4 | 6;
  port: number;
}

/**
 * TEST ONLY. Maps an exact hostname:port to a fixed address and skips address
 * validation for that one pair. Production callers must never set this.
 */
export interface EgressProxyTestOnlyTarget {
  hostname: string;
  port: number;
  address: string;
}

export interface EgressProxyOptions {
  /** Destination ports that may be reached. Defaults to 80 and 443. */
  allowedPorts?: readonly number[];
  /** Max simultaneously open upstream connections (tunnels + forwards). */
  maxUpstreamConnections?: number;
  /** Max simultaneously open client (browser -> proxy) sockets. */
  maxClientConnections?: number;
  /** Idle timeout applied to both legs of every connection. */
  idleTimeoutMs?: number;
  /** Timeout for establishing the upstream TCP connection. */
  connectTimeoutMs?: number;
  /** Timeout for hostname resolution. */
  lookupTimeoutMs?: number;
  /**
   * Resolver override (defaults to the system resolver via url-validator).
   * Results are still validated by `resolveValidatedHostAddresses`.
   */
  lookup?: LookupAllFn;
  /**
   * Upstream socket factory override. Receives the already-validated IP target.
   * Defaults to `net.connect` pinned to that IP.
   */
  connect?: (target: EgressTarget) => net.Socket;
  /**
   * TEST ONLY — see EgressProxyTestOnlyTarget. Never set by production code;
   * a test asserts that no production module references this option.
   */
  testOnlyAllowedTargets?: readonly EgressProxyTestOnlyTarget[];
}

export interface EgressDecision {
  kind: "connect" | "http" | "upgrade";
  target: string;
  allowed: boolean;
  address?: string;
  reason?: string;
}

export interface EgressProxy {
  readonly host: string;
  readonly port: number;
  /** `http://127.0.0.1:<port>` — the value for Chromium's --proxy-server. */
  readonly url: string;
  /** Recent allow/deny decisions (bounded), newest last. */
  readonly decisions: readonly EgressDecision[];
  close(): Promise<void>;
}

class EgressBlockedError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = "EgressBlockedError";
  }
}

// ── Target parsing ─────────────────────────────────────────────────────────

/** Normalize a host the same way WHATWG URL does (numeric IPv4 forms, case, IDNA). */
function normalizeHostname(host: string): string | null {
  try {
    const hostname = new URL(`http://${host}/`).hostname;
    return hostname || null;
  } catch {
    return null;
  }
}

function parsePort(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Parse a CONNECT authority (`host:port`, `[v6]:port`). */
export function parseConnectAuthority(authority: string | undefined): { hostname: string; port: number } | null {
  if (!authority) return null;
  const match = /^(\[[0-9a-fA-F:.]+\]|[^\s:/?#@[\]]+):(\d{1,5})$/.exec(authority);
  if (!match) return null;
  const hostname = normalizeHostname(match[1]);
  const port = parsePort(match[2]);
  if (!hostname || port === null) return null;
  return { hostname, port };
}

/** Parse an absolute-form proxy request target (`http://host[:port]/path`). */
export function parseAbsoluteTarget(
  rawUrl: string | undefined,
): { hostname: string; port: number; path: string } | null {
  if (!rawUrl || !/^(?:http|ws):\/\//i.test(rawUrl)) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "ws:") return null;
  if (url.username || url.password) return null;
  const port = url.port ? parsePort(url.port) : 80;
  if (!url.hostname || port === null) return null;
  return { hostname: url.hostname, port, path: `${url.pathname}${url.search}` || "/" };
}

function formatTarget(hostname: string, port: number): string {
  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return `${host}:${port}`;
}

// ── Header handling ────────────────────────────────────────────────────────

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "upgrade",
]);

const PROXY_ONLY = new Set(["proxy-connection", "proxy-authorization", "proxy-authenticate"]);

function connectionTokens(rawHeaders: string[]): Set<string> {
  const tokens = new Set<string>();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i].toLowerCase() === "connection") {
      for (const token of rawHeaders[i + 1].split(",")) {
        const t = token.trim().toLowerCase();
        if (t) tokens.add(t);
      }
    }
  }
  return tokens;
}

/** Drop hop-by-hop headers (and anything named in Connection) from a flat raw header list. */
function stripHopByHop(rawHeaders: string[], extraDrop: readonly string[] = []): string[] {
  const listed = connectionTokens(rawHeaders);
  const out: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    if (HOP_BY_HOP.has(name) || listed.has(name) || extraDrop.includes(name)) continue;
    out.push(rawHeaders[i], rawHeaders[i + 1]);
  }
  return out;
}

/** For upgrade handshakes keep Connection/Upgrade, drop only proxy credentials. */
function stripProxyHeaders(rawHeaders: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (PROXY_ONLY.has(rawHeaders[i].toLowerCase())) continue;
    out.push(rawHeaders[i], rawHeaders[i + 1]);
  }
  return out;
}

function refuseSocket(socket: Duplex, status: number, reason: string): void {
  const text = status === 403 ? "Forbidden" : status === 503 ? "Service Unavailable" : status === 502 ? "Bad Gateway" : "Bad Request";
  const body = `Blocked by brandsystem browser egress policy: ${reason}`.replace(/[\r\n]/g, " ");
  if (!socket.destroyed && socket.writable) {
    socket.end(
      `HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
  }
  setTimeout(() => socket.destroy(), 1000).unref();
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new EgressBlockedError(message, 502)), ms);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

// ── Proxy ──────────────────────────────────────────────────────────────────

export async function startEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const allowedPorts = new Set(options.allowedPorts ?? DEFAULT_EGRESS_ALLOWED_PORTS);
  const maxUpstream = options.maxUpstreamConnections ?? DEFAULT_MAX_UPSTREAM_CONNECTIONS;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const lookupTimeoutMs = options.lookupTimeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS;
  const testTargets = (options.testOnlyAllowedTargets ?? []).map((t) => ({
    hostname: normalizeHostname(t.hostname) ?? t.hostname.toLowerCase(),
    port: t.port,
    address: t.address,
  }));

  const decisions: EgressDecision[] = [];
  const clientSockets = new Set<Duplex>();
  const upstreamSockets = new Set<net.Socket>();
  let activeUpstream = 0;
  let closed = false;

  const record = (decision: EgressDecision) => {
    decisions.push(decision);
    if (decisions.length > MAX_LOG_ENTRIES) decisions.splice(0, decisions.length - MAX_LOG_ENTRIES);
  };

  /** Reserve an upstream slot; the returned function releases it exactly once. */
  const acquire = (): (() => void) | null => {
    if (closed || activeUpstream >= maxUpstream) return null;
    activeUpstream++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeUpstream--;
    };
  };

  /** Resolve + validate a destination. Never returns a blocked address. */
  const decide = async (hostname: string, port: number): Promise<EgressTarget> => {
    const testTarget = testTargets.find((t) => t.hostname === hostname && t.port === port);
    if (testTarget) {
      const family = net.isIP(testTarget.address);
      if (family !== 4 && family !== 6) throw new EgressBlockedError("invalid test-only target address");
      return { address: testTarget.address, family, port };
    }

    if (!allowedPorts.has(port)) {
      throw new EgressBlockedError(`port ${port} is not allowed`);
    }

    let addresses;
    try {
      addresses = await withTimeout(
        resolveValidatedHostAddresses(hostname, options.lookup),
        lookupTimeoutMs,
        `lookup of ${hostname} timed out`,
      );
    } catch (err) {
      if (err instanceof EgressBlockedError) throw err;
      throw new EgressBlockedError((err as Error).message || `could not resolve ${hostname}`);
    }

    // Belt and braces: re-check every address with a family-agnostic check so
    // an unexpected resolver result (unknown family, junk string) fails closed.
    for (const { address } of addresses) {
      if (isBlockedIpAddress(address)) {
        throw new EgressBlockedError(`SSRF blocked: ${hostname} resolves to private IP ${address}`);
      }
    }
    const selected = addresses[0];
    return { address: selected.address, family: selected.family, port };
  };

  const openUpstream = (target: EgressTarget): net.Socket => {
    const socket = options.connect
      ? options.connect(target)
      : net.connect({
          host: target.address,
          port: target.port,
          family: target.family,
          // The host is already an IP literal; this pinned lookup guarantees no
          // resolver is ever consulted for the upstream connection.
          lookup: (_hostname, _opts, callback) => {
            (callback as (err: Error | null, address: string, family: number) => void)(
              null,
              target.address,
              target.family,
            );
          },
        });
    upstreamSockets.add(socket);
    socket.once("close", () => upstreamSockets.delete(socket));
    socket.on("error", () => undefined);
    if (closed) socket.destroy();
    return socket;
  };

  /** Connect upstream with a connect timeout; resolves once the TCP connection is up. */
  const connectUpstream = (target: EgressTarget): Promise<net.Socket> =>
    new Promise((resolve, reject) => {
      const socket = openUpstream(target);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new EgressBlockedError("upstream connect timed out", 502));
      }, connectTimeoutMs);
      timer.unref();
      const onError = (err: Error) => {
        clearTimeout(timer);
        reject(new EgressBlockedError(`upstream connect failed: ${err.message}`, 502));
      };
      socket.once("error", onError);
      socket.once("close", () => onError(new Error("closed")));
      socket.once("connect", () => {
        clearTimeout(timer);
        socket.removeListener("error", onError);
        socket.removeAllListeners("close");
        socket.once("close", () => upstreamSockets.delete(socket));
        resolve(socket);
      });
    });

  /** Pipe two sockets together with idle timeouts; destroying either destroys both. */
  const splice = (client: Duplex, upstream: net.Socket, release: () => void) => {
    const teardown = () => {
      release();
      client.destroy();
      upstream.destroy();
    };
    upstream.setTimeout(idleTimeoutMs, teardown);
    if (client instanceof net.Socket) client.setTimeout(idleTimeoutMs, teardown);
    client.on("error", teardown);
    upstream.on("error", teardown);
    client.once("close", teardown);
    upstream.once("close", teardown);
    upstream.pipe(client);
    client.pipe(upstream);
  };

  const server = http.createServer();
  server.maxConnections = options.maxClientConnections ?? DEFAULT_MAX_CLIENT_CONNECTIONS;
  server.headersTimeout = 15_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;
  server.timeout = idleTimeoutMs;

  server.on("connection", (socket: net.Socket) => {
    clientSockets.add(socket);
    socket.once("close", () => clientSockets.delete(socket));
    socket.on("error", () => undefined);
    if (closed) socket.destroy();
  });

  server.on("clientError", (_err, socket) => {
    refuseSocket(socket, 400, "malformed request");
  });

  // CONNECT tunnels (HTTPS / WSS).
  server.on("connect", (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    clientSockets.add(client);
    client.once("close", () => clientSockets.delete(client));
    client.on("error", () => undefined);

    const parsed = parseConnectAuthority(req.url);
    if (!parsed) {
      record({ kind: "connect", target: String(req.url), allowed: false, reason: "malformed CONNECT target" });
      refuseSocket(client, 400, "malformed CONNECT target");
      return;
    }
    const target = formatTarget(parsed.hostname, parsed.port);
    const release = acquire();
    if (!release) {
      record({ kind: "connect", target, allowed: false, reason: "too many connections" });
      refuseSocket(client, 503, "too many connections");
      return;
    }
    client.once("close", release);

    void (async () => {
      let pinned: EgressTarget;
      try {
        pinned = await decide(parsed.hostname, parsed.port);
      } catch (err) {
        const e = err as EgressBlockedError;
        record({ kind: "connect", target, allowed: false, reason: e.message });
        release();
        refuseSocket(client, e.status ?? 403, e.message);
        return;
      }
      record({ kind: "connect", target, allowed: true, address: pinned.address });
      if (client.destroyed || closed) {
        release();
        return;
      }
      let upstream: net.Socket;
      try {
        upstream = await connectUpstream(pinned);
      } catch (err) {
        release();
        refuseSocket(client, 502, (err as Error).message);
        return;
      }
      if (client.destroyed || closed) {
        release();
        upstream.destroy();
        return;
      }
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      splice(client, upstream, release);
    })();
  });

  // Absolute-URI Upgrade requests (plain ws:// handshakes sent in absolute form).
  server.on("upgrade", (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    clientSockets.add(client);
    client.once("close", () => clientSockets.delete(client));
    client.on("error", () => undefined);

    const parsed = parseAbsoluteTarget(req.url);
    if (!parsed) {
      record({ kind: "upgrade", target: String(req.url), allowed: false, reason: "not an absolute-form proxy request" });
      refuseSocket(client, 400, "not an absolute-form proxy request");
      return;
    }
    const target = formatTarget(parsed.hostname, parsed.port);
    const release = acquire();
    if (!release) {
      record({ kind: "upgrade", target, allowed: false, reason: "too many connections" });
      refuseSocket(client, 503, "too many connections");
      return;
    }
    client.once("close", release);

    void (async () => {
      let pinned: EgressTarget;
      try {
        pinned = await decide(parsed.hostname, parsed.port);
      } catch (err) {
        const e = err as EgressBlockedError;
        record({ kind: "upgrade", target, allowed: false, reason: e.message });
        release();
        refuseSocket(client, e.status ?? 403, e.message);
        return;
      }
      record({ kind: "upgrade", target, allowed: true, address: pinned.address });
      let upstream: net.Socket;
      try {
        upstream = await connectUpstream(pinned);
      } catch (err) {
        release();
        refuseSocket(client, 502, (err as Error).message);
        return;
      }
      if (client.destroyed || closed) {
        release();
        upstream.destroy();
        return;
      }
      const headers = stripProxyHeaders(req.rawHeaders);
      let preamble = `${req.method ?? "GET"} ${parsed.path} HTTP/1.1\r\n`;
      for (let i = 0; i < headers.length; i += 2) preamble += `${headers[i]}: ${headers[i + 1]}\r\n`;
      preamble += "\r\n";
      upstream.write(preamble);
      if (head.length > 0) upstream.write(head);
      splice(client, upstream, release);
    })();
  });

  // Absolute-URI plain HTTP requests.
  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    const parsed = parseAbsoluteTarget(req.url);
    if (!parsed) {
      record({ kind: "http", target: String(req.url), allowed: false, reason: "not an absolute-form proxy request" });
      res.writeHead(400, { "content-type": "text/plain", connection: "close" });
      res.end("Blocked by brandsystem browser egress policy: not an absolute-form proxy request");
      return;
    }
    const target = formatTarget(parsed.hostname, parsed.port);
    const release = acquire();
    if (!release) {
      record({ kind: "http", target, allowed: false, reason: "too many connections" });
      res.writeHead(503, { "content-type": "text/plain", connection: "close" });
      res.end("Blocked by brandsystem browser egress policy: too many connections");
      return;
    }
    res.once("close", release);

    void (async () => {
      let pinned: EgressTarget;
      try {
        pinned = await decide(parsed.hostname, parsed.port);
      } catch (err) {
        const e = err as EgressBlockedError;
        record({ kind: "http", target, allowed: false, reason: e.message });
        if (!res.headersSent) {
          res.writeHead(e.status ?? 403, { "content-type": "text/plain", connection: "close" });
        }
        res.end(`Blocked by brandsystem browser egress policy: ${e.message}`.replace(/[\r\n]/g, " "));
        return;
      }
      record({ kind: "http", target, allowed: true, address: pinned.address });
      if (res.destroyed || closed) return;

      const upstreamReq = http.request({
        method: req.method,
        host: pinned.address,
        port: pinned.port,
        path: parsed.path,
        headers: stripHopByHop(req.rawHeaders) as unknown as http.OutgoingHttpHeaders,
        setHost: false,
        createConnection: () => openUpstream(pinned),
        timeout: connectTimeoutMs,
      });
      upstreamReq.on("timeout", () => upstreamReq.destroy(new Error("upstream timed out")));
      upstreamReq.on("socket", (socket) => {
        socket.setTimeout(idleTimeoutMs, () => upstreamReq.destroy(new Error("upstream idle")));
      });
      upstreamReq.on("response", (upstreamRes) => {
        const headers = stripHopByHop(upstreamRes.rawHeaders, ["transfer-encoding"]);
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, headers);
        upstreamRes.pipe(res);
        upstreamRes.on("error", () => res.destroy());
      });
      upstreamReq.on("error", (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "text/plain", connection: "close" });
          res.end(`Upstream error: ${err.message}`.replace(/[\r\n]/g, " "));
        } else {
          res.destroy();
        }
      });
      res.once("close", () => {
        if (!res.writableFinished) upstreamReq.destroy();
      });
      req.pipe(upstreamReq);
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, EGRESS_PROXY_HOST, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  server.on("error", () => undefined);

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Egress proxy failed to bind a TCP port");
  }
  const port = address.port;

  let closePromise: Promise<void> | null = null;
  return {
    host: EGRESS_PROXY_HOST,
    port,
    url: `http://${EGRESS_PROXY_HOST}:${port}`,
    get decisions() {
      return decisions;
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of upstreamSockets) socket.destroy();
        for (const socket of clientSockets) socket.destroy();
        server.closeAllConnections();
      });
      return closePromise;
    },
  };
}
