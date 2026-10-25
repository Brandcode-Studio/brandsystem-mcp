import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  parseAbsoluteTarget,
  parseConnectAuthority,
  startEgressProxy,
  type EgressProxy,
  type EgressProxyOptions,
} from "../../src/lib/browser-egress-proxy.js";
import { isBlockedIpAddress, resolveValidatedHostAddresses } from "../../src/lib/url-validator.js";

// All traffic in this file stays on 127.0.0.1. No real DNS: every hostname
// lookup goes through an injected resolver.

type Listener = { port: number; hits: string[]; close(): Promise<void> };

async function startOrigin(): Promise<Listener> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url} host=${req.headers.host ?? ""}`);
    res.setHeader("x-origin", "1");
    res.end(`origin saw ${req.url}`);
  });
  server.on("upgrade", (req, socket) => {
    hits.push(`UPGRADE ${req.url} upgrade=${req.headers.upgrade ?? ""}`);
    socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    port: (server.address() as net.AddressInfo).port,
    hits,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** Raw TCP echo server — stands in for any upstream reached via a tunnel. */
async function startEcho(): Promise<Listener & { sockets: Set<net.Socket> }> {
  const hits: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    hits.push("connection");
    socket.on("data", (d) => socket.write(`echo:${d.toString()}`));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    port: (server.address() as net.AddressInfo).port,
    hits,
    sockets,
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}

/** Send raw bytes to the proxy; resolve with everything received until close or `waitMs`. */
function rawExchange(
  proxyPort: number,
  text: string,
  opts: { waitMs?: number; then?: (socket: net.Socket, received: () => string) => void } = {},
): Promise<{ data: string; closed: boolean }> {
  return new Promise((resolve) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => socket.write(text));
    let data = "";
    let closed = false;
    let thenFired = false;
    socket.on("data", (d) => {
      data += d.toString();
      if (opts.then && !thenFired && data.includes("\r\n\r\n")) {
        thenFired = true;
        opts.then(socket, () => data);
      }
    });
    socket.on("error", () => undefined);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ data, closed });
    }, opts.waitMs ?? 400);
    socket.on("close", () => {
      closed = true;
      clearTimeout(timer);
      resolve({ data, closed });
    });
  });
}

const statusOf = (data: string) => Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0);

describe("browser egress proxy", () => {
  let proxy: EgressProxy | null = null;
  let origin: Listener;

  const start = async (opts: EgressProxyOptions = {}) => {
    proxy = await startEgressProxy(opts);
    return proxy;
  };

  beforeEach(async () => {
    origin = await startOrigin();
  });

  afterEach(async () => {
    await proxy?.close();
    proxy = null;
    await origin.close();
  });

  it("listens only on IPv4 loopback with an ephemeral port", async () => {
    const p = await start();
    expect(p.host).toBe("127.0.0.1");
    expect(p.port).toBeGreaterThan(0);
    expect(p.url).toBe(`http://127.0.0.1:${p.port}`);
  });

  describe("refuses internal destinations", () => {
    it("refuses a plain HTTP proxy request to http://127.0.0.1:PORT/", async () => {
      // Allow the port explicitly so the refusal is the address check, not the port check.
      const p = await start({ allowedPorts: [80, 443, origin.port] });
      const { data } = await rawExchange(
        p.port,
        `GET http://127.0.0.1:${origin.port}/secret HTTP/1.1\r\nHost: 127.0.0.1:${origin.port}\r\n\r\n`,
      );
      expect(statusOf(data)).toBe(403);
      expect(data).toContain("SSRF blocked");
      expect(origin.hits).toEqual([]);
      expect(p.decisions.at(-1)).toMatchObject({ kind: "http", allowed: false });
    });

    it("refuses http://[::ffff:127.0.0.1]/ (IPv4-mapped loopback)", async () => {
      const p = await start({ allowedPorts: [80, 443, origin.port] });
      const { data } = await rawExchange(
        p.port,
        `GET http://[::ffff:127.0.0.1]:${origin.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`,
      );
      expect(statusOf(data)).toBe(403);
      expect(origin.hits).toEqual([]);
    });

    it("refuses CONNECT to [::ffff:127.0.0.1] and to IPv6 loopback", async () => {
      const p = await start({ allowedPorts: [443, origin.port] });
      for (const host of ["[::ffff:127.0.0.1]", "[::1]", "[::ffff:7f00:1]"]) {
        const { data } = await rawExchange(p.port, `CONNECT ${host}:${origin.port} HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
        expect(statusOf(data)).toBe(403);
      }
      expect(origin.hits).toEqual([]);
    });

    it("refuses CONNECT to a hostname that resolves to 127.0.0.1", async () => {
      const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
      const connect = vi.fn();
      const p = await start({ lookup, connect, allowedPorts: [443, origin.port] });
      const { data } = await rawExchange(
        p.port,
        `CONNECT rebind.attacker.example:${origin.port} HTTP/1.1\r\nHost: rebind.attacker.example\r\n\r\n`,
      );
      expect(statusOf(data)).toBe(403);
      expect(data).toContain("resolves to private IP 127.0.0.1");
      expect(lookup).toHaveBeenCalledWith("rebind.attacker.example");
      expect(connect).not.toHaveBeenCalled();
      expect(origin.hits).toEqual([]);
    });

    it("refuses hostnames resolving to metadata, RFC 1918, or mixed public+private sets", async () => {
      const answers: Record<string, Array<{ address: string; family: number }>> = {
        "metadata.example": [{ address: "169.254.169.254", family: 4 }],
        "lan.example": [{ address: "192.168.1.10", family: 4 }],
        "mixed.example": [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ],
        "v6mapped.example": [{ address: "::ffff:10.0.0.1", family: 6 }],
        "junk.example": [{ address: "not-an-ip", family: 0 }],
      };
      const connect = vi.fn();
      const p = await start({ lookup: async (h) => answers[h] ?? [], connect });
      for (const host of Object.keys(answers)) {
        const connectResult = await rawExchange(p.port, `CONNECT ${host}:443 HTTP/1.1\r\n\r\n`);
        expect(statusOf(connectResult.data), host).toBe(403);
        const httpResult = await rawExchange(p.port, `GET http://${host}/ HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
        expect(statusOf(httpResult.data), host).toBe(403);
      }
      // A name that does not resolve is refused too.
      const nx = await rawExchange(p.port, `CONNECT nx.example:443 HTTP/1.1\r\n\r\n`);
      expect(statusOf(nx.data)).toBe(403);
      expect(connect).not.toHaveBeenCalled();
    });

    it("refuses localhost and numeric IPv4 encodings after WHATWG normalization", async () => {
      const lookup = vi.fn(async (h: string) =>
        h === "localhost" ? [{ address: "127.0.0.1", family: 4 }] : [],
      );
      const p = await start({ lookup, allowedPorts: [80, 443, origin.port] });
      for (const host of ["localhost", "2130706433", "0x7f.0.0.1", "127.1"]) {
        const { data } = await rawExchange(
          p.port,
          `GET http://${host}:${origin.port}/ HTTP/1.1\r\nHost: ${host}\r\n\r\n`,
        );
        expect(statusOf(data), host).toBe(403);
      }
      expect(origin.hits).toEqual([]);
    });

    it("refuses absolute-form WebSocket upgrades to loopback", async () => {
      const p = await start({ allowedPorts: [80, origin.port] });
      const { data } = await rawExchange(
        p.port,
        `GET http://127.0.0.1:${origin.port}/ws HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      expect(statusOf(data)).toBe(403);
      expect(origin.hits).toEqual([]);
    });

    it("refuses non-allowed ports before resolving", async () => {
      const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
      const connect = vi.fn();
      const p = await start({ lookup, connect });
      const { data } = await rawExchange(p.port, `CONNECT public.example:22 HTTP/1.1\r\n\r\n`);
      expect(statusOf(data)).toBe(403);
      expect(data).toContain("port 22 is not allowed");
      expect(lookup).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    });

    it("rejects origin-form requests to the proxy itself and malformed CONNECT targets", async () => {
      const p = await start();
      const direct = await rawExchange(p.port, `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`);
      expect(statusOf(direct.data)).toBe(400);
      const ftp = await rawExchange(p.port, `GET ftp://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n`);
      expect(statusOf(ftp.data)).toBe(400);
      const malformed = await rawExchange(p.port, `CONNECT user@host:443 HTTP/1.1\r\n\r\n`);
      expect(statusOf(malformed.data)).toBe(400);
    });
  });

  describe("allow path", () => {
    it("connects to the validated IP exactly once-resolved (never re-resolves)", async () => {
      const echo = await startEcho();
      try {
        // A rebinding resolver: first answer public, every later answer loopback.
        let calls = 0;
        const lookup = vi.fn(async () => {
          calls++;
          return calls === 1
            ? [{ address: "93.184.216.34", family: 4 }]
            : [{ address: "127.0.0.1", family: 4 }];
        });
        // Production uses net.connect to the validated IP. Here the upstream
        // factory records the pinned target and dials a local echo server in
        // place of the public address, so no real network is touched.
        const targets: unknown[] = [];
        const connect = vi.fn((target: { address: string; family: 4 | 6; port: number }) => {
          targets.push(target);
          return net.connect(echo.port, "127.0.0.1");
        });
        const p = await start({ lookup, connect });

        const { data } = await rawExchange(p.port, `CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n`, {
          then: (socket) => socket.write("ping"),
        });
        expect(data).toContain("HTTP/1.1 200 Connection Established");
        expect(data).toContain("echo:ping");
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(targets).toEqual([{ address: "93.184.216.34", family: 4, port: 443 }]);
        expect(p.decisions.at(-1)).toMatchObject({ kind: "connect", allowed: true, address: "93.184.216.34" });
      } finally {
        await echo.close();
      }
    });

    it("forwards plain HTTP via a test-only target, stripping proxy headers", async () => {
      const p = await start({
        testOnlyAllowedTargets: [{ hostname: "allowed.test", port: origin.port, address: "127.0.0.1" }],
      });
      const { data } = await rawExchange(
        p.port,
        `GET http://allowed.test:${origin.port}/ok?q=1 HTTP/1.1\r\nHost: allowed.test:${origin.port}\r\n` +
          "Proxy-Connection: keep-alive\r\nProxy-Authorization: Basic Zm9vOmJhcg==\r\nConnection: close\r\n\r\n",
        { waitMs: 1000 },
      );
      expect(statusOf(data)).toBe(200);
      expect(data).toContain("origin saw /ok?q=1");
      expect(data.toLowerCase()).toContain("x-origin: 1");
      expect(origin.hits).toEqual([`GET /ok?q=1 host=allowed.test:${origin.port}`]);
    });

    it("test-only targets are exact host:port matches; other ports on the same host are still validated", async () => {
      const lookup = vi.fn(async () => [] as Array<{ address: string; family: number }>);
      const p = await start({
        lookup,
        allowedPorts: [80, 443, origin.port + 1],
        testOnlyAllowedTargets: [{ hostname: "allowed.test", port: origin.port, address: "127.0.0.1" }],
      });
      const { data } = await rawExchange(p.port, `CONNECT allowed.test:${origin.port + 1} HTTP/1.1\r\n\r\n`);
      expect(statusOf(data)).toBe(403);
      const loop = await rawExchange(p.port, `GET http://127.0.0.1:${origin.port}/ HTTP/1.1\r\nHost: x\r\n\r\n`);
      expect(statusOf(loop.data)).toBe(403);
      expect(origin.hits).toEqual([]);
    });

    it("tunnels CONNECT and forwards absolute-form WebSocket upgrades for allowed targets", async () => {
      const p = await start({
        testOnlyAllowedTargets: [{ hostname: "allowed.test", port: origin.port, address: "127.0.0.1" }],
      });
      const tunnel = await rawExchange(p.port, `CONNECT allowed.test:${origin.port} HTTP/1.1\r\n\r\n`, {
        waitMs: 1000,
        then: (socket) => socket.write(`GET /tunneled HTTP/1.1\r\nHost: allowed.test\r\nConnection: close\r\n\r\n`),
      });
      expect(tunnel.data).toContain("200 Connection Established");
      expect(tunnel.data).toContain("origin saw /tunneled");

      const upgrade = await rawExchange(
        p.port,
        `GET http://allowed.test:${origin.port}/socket HTTP/1.1\r\nHost: allowed.test\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
          "Proxy-Connection: keep-alive\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
        { waitMs: 1000 },
      );
      expect(statusOf(upgrade.data)).toBe(101);
      expect(origin.hits).toContain("UPGRADE /socket upgrade=websocket");
    });
  });

  describe("limits and lifecycle", () => {
    const tunnelOpts = (port: number): EgressProxyOptions => ({
      testOnlyAllowedTargets: [{ hostname: "allowed.test", port, address: "127.0.0.1" }],
    });

    it("caps concurrent upstream connections", async () => {
      const echo = await startEcho();
      try {
        const p = await start({ ...tunnelOpts(echo.port), maxUpstreamConnections: 1 });
        const first = net.connect(p.port, "127.0.0.1");
        first.on("error", () => undefined);
        first.write(`CONNECT allowed.test:${echo.port} HTTP/1.1\r\n\r\n`);
        await new Promise<void>((resolve) => first.once("data", () => resolve()));

        const second = await rawExchange(p.port, `CONNECT allowed.test:${echo.port} HTTP/1.1\r\n\r\n`);
        expect(statusOf(second.data)).toBe(503);
        first.destroy();
      } finally {
        await echo.close();
      }
    });

    it("tears down idle tunnels", async () => {
      const echo = await startEcho();
      try {
        const p = await start({ ...tunnelOpts(echo.port), idleTimeoutMs: 150 });
        const result = await rawExchange(p.port, `CONNECT allowed.test:${echo.port} HTTP/1.1\r\n\r\n`, { waitMs: 2000 });
        expect(result.data).toContain("200 Connection Established");
        expect(result.closed).toBe(true);
      } finally {
        await echo.close();
      }
    });

    it("close() destroys open tunnels and stops listening", async () => {
      const echo = await startEcho();
      try {
        const p = await start(tunnelOpts(echo.port));
        const client = net.connect(p.port, "127.0.0.1");
        client.on("error", () => undefined);
        client.write(`CONNECT allowed.test:${echo.port} HTTP/1.1\r\n\r\n`);
        await new Promise<void>((resolve) => client.once("data", () => resolve()));
        expect(echo.sockets.size).toBe(1);

        const clientClosed = new Promise<void>((resolve) => client.once("close", () => resolve()));
        await p.close();
        await clientClosed;
        await new Promise((r) => setTimeout(r, 50));
        expect(echo.sockets.size).toBe(0);

        await expect(
          new Promise((resolve, reject) => {
            const s = net.connect(p.port, "127.0.0.1", () => {
              s.destroy();
              resolve("connected");
            });
            s.on("error", reject);
          }),
        ).rejects.toThrow(/ECONNREFUSED/);
        proxy = null;
      } finally {
        await echo.close();
      }
    });
  });
});

describe("egress proxy target parsing", () => {
  it("parses CONNECT authorities and normalizes hosts", () => {
    expect(parseConnectAuthority("Example.COM:443")).toEqual({ hostname: "example.com", port: 443 });
    expect(parseConnectAuthority("[::1]:443")).toEqual({ hostname: "[::1]", port: 443 });
    expect(parseConnectAuthority("2130706433:80")).toEqual({ hostname: "127.0.0.1", port: 80 });
    expect(parseConnectAuthority("example.com")).toBeNull();
    expect(parseConnectAuthority("example.com:0")).toBeNull();
    expect(parseConnectAuthority("example.com:70000")).toBeNull();
    expect(parseConnectAuthority("a@b:443")).toBeNull();
  });

  it("parses absolute-form targets only for http/ws", () => {
    expect(parseAbsoluteTarget("http://example.com/a?b=1")).toEqual({ hostname: "example.com", port: 80, path: "/a?b=1" });
    expect(parseAbsoluteTarget("ws://example.com:8080/s")).toEqual({ hostname: "example.com", port: 8080, path: "/s" });
    expect(parseAbsoluteTarget("/relative")).toBeNull();
    expect(parseAbsoluteTarget("https://example.com/")).toBeNull();
    expect(parseAbsoluteTarget("http://user:pw@example.com/")).toBeNull();
  });
});

describe("shared validator exports", () => {
  it("isBlockedIpAddress fails closed and covers v4, v6, and mapped forms", () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("169.254.169.254")).toBe(true);
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("[::ffff:127.0.0.1]")).toBe(true);
    expect(isBlockedIpAddress("not-an-ip")).toBe(true);
    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
    expect(isBlockedIpAddress("2606:4700::1111")).toBe(false);
  });

  it("resolveValidatedHostAddresses validates every record from an injected resolver", async () => {
    await expect(
      resolveValidatedHostAddresses("x.example", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "fd00::1", family: 6 },
      ]),
    ).rejects.toThrow("SSRF blocked: x.example resolves to private IP fd00::1");
    await expect(
      resolveValidatedHostAddresses("x.example", async () => [{ address: "93.184.216.34", family: 4 }]),
    ).resolves.toEqual([{ address: "93.184.216.34", family: 4, hostname: "x.example" }]);
  });
});

describe("production callers never enable test-only egress hooks", () => {
  const srcRoot = join(__dirname, "..", "..", "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) files.push(full);
    }
  };
  walk(srcRoot);

  it("no src file sets testOnly / testOnlyAllowedTargets (only optional type declarations exist)", () => {
    const offenders = files.filter((file) => /\btestOnly(?:AllowedTargets)?\s*:/.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("startEgressProxy is only started from the locked-down browser launcher", () => {
    const callers = files.filter((file) => /\bstartEgressProxy\s*\(/.test(readFileSync(file, "utf-8")));
    expect(callers.map((f) => f.replace(srcRoot, "src"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/browser-egress-proxy\.ts$/), expect.stringMatching(/visual-extractor\.ts$/)]),
    );
    expect(callers).toHaveLength(2);
    const extractor = readFileSync(join(srcRoot, "lib", "visual-extractor.ts"), "utf-8");
    const call = extractor.slice(extractor.indexOf("startEgressProxy({"), extractor.indexOf("});", extractor.indexOf("startEgressProxy({")));
    expect(call).not.toMatch(/lookup|connect\b|testOnlyAllowedTargets\s*:/);
  });
});
