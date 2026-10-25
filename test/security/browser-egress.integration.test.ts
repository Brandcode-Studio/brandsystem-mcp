/**
 * Real-Chromium proof that the egress lockdown holds: a page that tries to
 * reach a loopback "internal service" via fetch, <img>, WebSocket, localhost,
 * and a service worker produces ZERO connections to that service.
 *
 * Everything stays on 127.0.0.1. The page itself is served through the proxy
 * via a test-only host mapping (allowed.test:<port>); no real DNS is used —
 * the proxy gets an injected resolver. The URL-level request interceptor is
 * deliberately NOT installed here so this test proves the proxy layer alone.
 *
 * Skips when no Chrome/Chromium is installed (mirrors findChrome()).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type net from "node:net";
import {
  createRemoteAddressGuard,
  findChrome,
  installEgressGuards,
  withLockedDownBrowser,
} from "../../src/lib/visual-extractor.js";

const chromePath = findChrome();

type Server = { server: http.Server; port: number; hits: string[]; connections: number };

async function listen(handler: http.RequestListener): Promise<Server> {
  const state = { hits: [] as string[], connections: 0 };
  const server = http.createServer((req, res) => {
    state.hits.push(`${req.method} ${req.url}`);
    handler(req, res);
  });
  server.on("connection", () => {
    state.connections++;
  });
  server.on("upgrade", (req, socket) => {
    state.hits.push(`UPGRADE ${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return Object.assign(state, { server, port: (server.address() as net.AddressInfo).port });
}

async function shutdown(s: Server | undefined): Promise<void> {
  if (!s) return;
  s.server.closeAllConnections();
  await new Promise<void>((resolve) => s.server.close(() => resolve()));
}

describe.skipIf(!chromePath)("browser egress lockdown (real Chromium)", () => {
  let victim: Server;
  let site: Server;

  beforeAll(async () => {
    // The "internal service" an attacker page wants to reach.
    victim = await listen((_req, res) => res.end("internal secret"));

    const v = () => victim.port;
    const pageHtml = () => `<!doctype html><html><head><title>loading</title></head><body>
<h1>egress test</h1>
<script>
(async () => {
  const status = {};
  const attempt = async (name, fn) => {
    try { await fn(); status[name] = "reached"; } catch (e) { status[name] = "blocked"; }
  };
  await attempt("control", () => fetch("/ping").then((r) => { if (!r.ok) throw new Error(); }));
  await attempt("fetch_loopback", () => fetch("http://127.0.0.1:${v()}/page-fetch"));
  await attempt("fetch_localhost", () => fetch("http://localhost:${v()}/page-localhost"));
  await attempt("fetch_mapped", () => fetch("http://[::ffff:127.0.0.1]:${v()}/page-mapped"));
  await attempt("img", () => new Promise((res, rej) => {
    const img = new Image(); img.onload = res; img.onerror = rej; img.src = "http://127.0.0.1:${v()}/img";
  }));
  await attempt("websocket", () => new Promise((res, rej) => {
    const ws = new WebSocket("ws://127.0.0.1:${v()}/ws"); ws.onopen = res; ws.onerror = rej;
  }));
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    const worker = reg.installing || reg.waiting || reg.active;
    await new Promise((res) => {
      if (!worker || worker.state === "activated") return res();
      worker.addEventListener("statechange", () => { if (worker.state === "activated" || worker.state === "redundant") res(); });
      setTimeout(res, 5000);
    });
    status.sw = "registered";
  } catch (e) {
    status.sw = "register-failed: " + e.message;
  }
  document.title = "done " + JSON.stringify(status);
})();
</script></body></html>`;

    const swJs = () => `
self.addEventListener("install", (event) => {
  event.waitUntil(Promise.allSettled([
    fetch("http://127.0.0.1:${v()}/sw-install", { mode: "no-cors" }),
    fetch("http://localhost:${v()}/sw-localhost", { mode: "no-cors" }),
    fetch("http://sw-marker.test:${site.port}/sw-marker", { mode: "no-cors" }),
  ]).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(fetch("http://127.0.0.1:${v()}/sw-activate", { mode: "no-cors" }).catch(() => undefined));
});
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch("http://127.0.0.1:${v()}/sw-fetch-handler", { mode: "no-cors" }).catch(() => fetch(event.request)));
});`;

    site = await listen((req, res) => {
      if (req.url === "/sw.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(swJs());
      } else if (req.url === "/ping") {
        res.end("pong");
      } else {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(pageHtml());
      }
    });
  });

  afterAll(async () => {
    await shutdown(victim);
    await shutdown(site);
  });

  it("no page, service-worker, WebSocket, or localhost request reaches a loopback listener", async () => {
    const origin = `http://allowed.test:${site.port}`;
    const outcome = await withLockedDownBrowser(
      {
        chromePath: chromePath!,
        allowedPorts: [80, 443],
        // Linux CI runners commonly cannot start Chromium's sandbox; the test
        // only renders local fixture content.
        env: process.platform === "linux" ? { BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX: "1" } : {},
        testOnly: {
          proxy: {
            testOnlyAllowedTargets: [{ hostname: "allowed.test", port: site.port, address: "127.0.0.1" }],
            // No real DNS: localhost maps to loopback (and must be refused); all else NXDOMAIN.
            lookup: async (hostname) => (hostname === "localhost" ? [{ address: "127.0.0.1", family: 4 }] : []),
          },
          // Service workers need a secure context; treat the fixture origin as one.
          extraArgs: [`--unsafely-treat-insecure-origin-as-secure=${origin}`],
        },
      },
      async (browser, proxy) => {
        const page = await browser.newPage();
        const guard = createRemoteAddressGuard(proxy.port);
        const remotes: Array<{ url: string; ip?: string; port?: number }> = [];
        page.on("response", (r) => remotes.push({ url: r.url(), ...r.remoteAddress() }));
        await installEgressGuards(page, guard);

        await page.goto(`${origin}/`, { waitUntil: "load", timeout: 20000 });
        await page.waitForFunction(() => document.title.startsWith("done"), { timeout: 20000 });
        // Give the service worker's install/activate fetches time to settle.
        await new Promise((r) => setTimeout(r, 1500));
        const title = await page.title();
        return { title, remotes, violations: [...guard.violations], decisions: [...proxy.decisions], proxyPort: proxy.port };
      },
    );

    const status = JSON.parse(outcome.title.slice("done ".length)) as Record<string, string>;

    // Positive control: the page itself and same-origin fetches work through the proxy.
    expect(status.control).toBe("reached");
    expect(site.hits).toContain("GET /ping");
    expect(status.sw).toBe("registered");

    // The internal service saw nothing — not even a TCP connection.
    expect(victim.hits).toEqual([]);
    expect(victim.connections).toBe(0);
    for (const key of ["fetch_loopback", "fetch_localhost", "fetch_mapped", "img", "websocket"]) {
      expect(status[key], key).toBe("blocked");
    }

    // The proxy is what refused them, including service-worker-originated traffic.
    const refused = outcome.decisions.filter((d) => !d.allowed).map((d) => d.target);
    expect(refused).toContain(`127.0.0.1:${victim.port}`);
    expect(refused).toContain(`localhost:${victim.port}`);
    expect(refused).toContain(`sw-marker.test:${site.port}`); // only the service worker requests this host

    // Chromium reports the proxy as the remote for proxied responses, and the
    // backstop guard does not false-positive on it.
    const mainDoc = outcome.remotes.find((r) => r.url === `${origin}/`);
    expect(mainDoc).toMatchObject({ ip: "127.0.0.1", port: outcome.proxyPort });
    expect(outcome.violations).toEqual([]);
  }, 60000);
});
