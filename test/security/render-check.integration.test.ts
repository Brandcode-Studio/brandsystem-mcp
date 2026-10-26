/**
 * Real-Chromium rendered compliance checks (brand_preflight render=true):
 *   1. an on-brand page passes on measured computed styles;
 *   2. an off-brand page produces color / contrast / font / logo findings;
 *   3. the page under test cannot make ANY network request — a loopback
 *      listener receives zero hits and zero TCP connections;
 *   4. the MCP tool path renders a project file, inlines its local CSS/font,
 *      and saves a screenshot under .brand/checks/.
 *
 * Skips when no Chrome/Chromium is installed (mirrors findChrome()).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type net from "node:net";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "../../src/lib/visual-extractor.js";
import { inlineLocalResources, renderAndMeasure } from "../../src/lib/render-check.js";
import { evaluateRenderedCompliance, type BrandForRender } from "../../src/lib/rendered-compliance.js";
import { callTool, connectWithCwd, copyFixture } from "../helpers.js";

const chromePath = findChrome();
// Linux CI runners commonly cannot start Chromium's sandbox; these tests only
// render local fixture content.
const env: NodeJS.ProcessEnv = process.platform === "linux" ? { BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX: "1" } : {};

const FONT_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "node_modules",
  "pdfjs-dist",
  "standard_fonts",
  "LiberationSans-Regular.ttf",
);

const BRAND: BrandForRender = {
  palette: [
    { name: "Navy Blue", hex: "#2a4494" },
    { name: "Coral Red", hex: "#e8523f" },
    { name: "Gold", hex: "#f5a623" },
  ],
  fonts: ["Brand Sans"],
  clientName: "Fixture Brand",
};

const STYLES = `@font-face { font-family: "Brand Sans"; src: url("./fonts/brand.ttf") format("truetype"); }
body { margin: 0; font-family: "Brand Sans", sans-serif; color: #333333; background: #ffffff; }
header { display: flex; padding: 16px; border-bottom: 2px solid #2a4494; }
h1 { color: #2a4494; font-size: 40px; }
.cta { background: #2a4494; color: #ffffff; padding: 12px 24px; border: 0; font-family: inherit; font-size: 16px; }
.accent { color: #e8523f; font-size: 28px; font-weight: 700; }`;

const ON_BRAND = `<!doctype html><html><head><title>On brand</title><link rel="stylesheet" href="styles.css"></head>
<body>
<header><a href="/"><svg width="160" height="40" role="img" aria-label="Fixture Brand logo"><rect width="160" height="40" fill="#2a4494"/></svg></a></header>
<main><h1>Build with confidence</h1><p>Fixture Brand helps teams ship on-brand work.</p>
<p class="accent">Big accent line</p><button class="cta">Get started</button></main>
</body></html>`;

const OFF_BRAND = `<!doctype html><html><head><title>Off brand</title><style>
body { margin: 0; font-family: "Nonexistent Display Face", monospace; background: #ffffff; }
h1 { color: #00ff00; font-size: 40px; }
p.muted { color: #aaaaaa; font-size: 14px; }
.panel { background: #ff00ff; color: #000000; padding: 20px; }
</style></head><body>
<h1>Fixture Brand</h1><p class="muted">Low contrast copy</p><div class="panel">Magenta panel</div>
</body></html>`;

type Server = { server: http.Server; port: number; hits: string[]; connections: number };

async function listen(): Promise<Server> {
  const state = { hits: [] as string[], connections: 0 };
  const server = http.createServer((req, res) => {
    state.hits.push(`${req.method} ${req.url}`);
    res.end("internal");
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

describe.skipIf(!chromePath)("rendered compliance (real Chromium)", () => {
  let dir: string;
  let victim: Server;

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "render-check-")));
    await mkdir(join(dir, "fonts"));
    if (existsSync(FONT_SRC)) await copyFile(FONT_SRC, join(dir, "fonts", "brand.ttf"));
    await writeFile(join(dir, "styles.css"), STYLES);
    victim = await listen();
  });

  afterAll(async () => {
    victim?.server.closeAllConnections();
    await new Promise<void>((resolve) => (victim ? victim.server.close(() => resolve()) : resolve()));
    await rm(dir, { recursive: true, force: true });
  });

  async function check(html: string) {
    const inlined = await inlineLocalResources(html, { baseDir: dir, cwd: dir });
    const outcome = await renderAndMeasure(inlined.html, {
      viewport: { width: 1280, height: 800 },
      clientName: BRAND.clientName,
      chromePath: chromePath!,
      env,
    });
    return { outcome, result: evaluateRenderedCompliance(outcome.measurement, BRAND), inlined };
  }

  it("passes an on-brand page using the inlined local brand font", async () => {
    const { result, inlined, outcome } = await check(ON_BRAND);
    expect(inlined.report.inlined).toBeGreaterThanOrEqual(1);
    expect(outcome.blockedRequests.count).toBe(0);
    expect(result.findings.filter((f) => f.severity !== "info")).toEqual([]);
    expect(result.overall).toBe("PASS");
    expect(result.subscores.contrast).toBe(100);
    expect(result.subscores.color).toBe(100);
    expect(result.measured.logo.detected).toBe(true);
    if (existsSync(FONT_SRC)) {
      // The data:-URI brand font actually rendered (first available face)
      expect(result.measured.fonts_rendered[0]).toMatchObject({ family: "Brand Sans", brand: true });
      expect(result.score).toBe(100);
    }
    expect(result.measured.colors.background.map((c) => c.hex)).toContain("#2a4494");
  }, 60000);

  it("flags an off-brand page: off-palette colors, contrast, non-brand font, missing logo", async () => {
    const { result } = await check(OFF_BRAND);
    expect(result.overall).toBe("FAIL");

    const green = result.findings.find((f) => f.rule === "R-COLOR" && f.measured === "#00ff00");
    expect(green).toMatchObject({ severity: "error", kind: "text" });
    expect(green?.expected).toMatch(/#[0-9a-f]{6}/);
    expect(green!.delta_e).toBeGreaterThan(15);
    expect(result.findings.find((f) => f.rule === "R-COLOR" && f.measured === "#ff00ff")).toMatchObject({ kind: "background" });

    const contrast = result.findings.filter((f) => f.rule === "R-CONTRAST");
    expect(contrast.some((f) => f.measured.startsWith("#aaaaaa on #ffffff"))).toBe(true);
    expect(contrast.some((f) => f.measured.startsWith("#00ff00 on #ffffff"))).toBe(true);

    const font = result.findings.find((f) => f.rule === "R-FONT");
    expect(font).toMatchObject({ severity: "warning", measured: "monospace (generic)", expected: "Brand Sans" });

    expect(result.findings.find((f) => f.rule === "R-LOGO")).toMatchObject({ severity: "warning" });
    expect(result.score).toBeLessThan(50);
  }, 60000);

  it("the page under test cannot reach the network: a loopback listener sees zero hits", async () => {
    const v = victim.port;
    const hostile = `<!doctype html><html><head>
<link rel="stylesheet" href="http://127.0.0.1:${v}/style.css">
<link rel="prefetch" href="http://127.0.0.1:${v}/prefetch">
<link rel="icon" href="http://127.0.0.1:${v}/favicon.ico">
<style>
@font-face { font-family: X; src: url(http://127.0.0.1:${v}/font.woff2); }
@import url("http://localhost:${v}/import.css");
body { font-family: X, sans-serif; background-image: url(http://127.0.0.1:${v}/bg.png); }
</style>
<script src="http://127.0.0.1:${v}/script.js"></script>
</head><body>
<img src="http://127.0.0.1:${v}/img.png">
<img src="http://localhost:${v}/img-localhost.png">
<img src="http://[::ffff:127.0.0.1]:${v}/img-mapped.png">
<iframe src="http://127.0.0.1:${v}/frame"></iframe>
<video src="http://127.0.0.1:${v}/video.mp4" autoplay muted></video>
<p>hostile page</p>
<script>
(async () => {
  const tries = [
    () => fetch("http://127.0.0.1:${v}/fetch"),
    () => fetch("http://localhost:${v}/fetch-localhost", { mode: "no-cors" }),
    () => new Promise((res, rej) => { const ws = new WebSocket("ws://127.0.0.1:${v}/ws"); ws.onopen = res; ws.onerror = rej; }),
    () => new Promise((res) => { const es = new EventSource("http://127.0.0.1:${v}/sse"); es.onerror = () => { es.close(); res(); }; }),
    () => Promise.resolve(navigator.sendBeacon("http://127.0.0.1:${v}/beacon", "x")),
    () => Promise.resolve(window.open("http://127.0.0.1:${v}/popup")),
    () => navigator.serviceWorker.register("http://127.0.0.1:${v}/sw.js"),
  ];
  for (const t of tries) { try { await t(); } catch (e) {} }
  document.title = "done";
})();
</script>
</body></html>`;

    const { outcome } = await check(hostile);
    // Allow any straggling async attempts to settle before asserting.
    await new Promise((r) => setTimeout(r, 1500));

    expect(victim.hits).toEqual([]);
    expect(victim.connections).toBe(0);
    expect(outcome.blockedRequests.count).toBeGreaterThan(0);
    expect(outcome.blockedRequests.samples.join(" ")).toContain(`127.0.0.1:${v}`);
    // The page still rendered and was measured.
    expect(outcome.measurement.elements.some((e) => e.text === "hostile page")).toBe(true);
  }, 60000);

  describe("brand_preflight render=true (MCP tool path)", () => {
    let projectDir: string;
    const savedSandboxEnv = process.env.BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX;

    beforeAll(async () => {
      if (env.BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX) process.env.BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX = "1";
      projectDir = await realpath(await copyFixture("brand-complete"));
      await mkdir(join(projectDir, "site", "fonts"), { recursive: true });
      if (existsSync(FONT_SRC)) await copyFile(FONT_SRC, join(projectDir, "site", "fonts", "brand.ttf"));
      // The fixture brand font is Inter; serve the local font under that family.
      await writeFile(join(projectDir, "site", "styles.css"), STYLES.replace(/Brand Sans/g, "Inter"));
      await writeFile(join(projectDir, "site", "index.html"), ON_BRAND);
    });

    afterAll(async () => {
      if (savedSandboxEnv === undefined) delete process.env.BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX;
      else process.env.BRANDSYSTEM_UNSAFE_DISABLE_CHROME_SANDBOX = savedSandboxEnv;
      vi.restoreAllMocks();
      await rm(projectDir, { recursive: true, force: true });
    });

    it("renders a project file, returns findings + score, and saves a screenshot", async () => {
      const { client, cleanup } = await connectWithCwd(projectDir);
      try {
        const json = await callTool(client, "brand_preflight", {
          html: "site/index.html",
          render: true,
          screenshot: true,
          viewport: "mobile",
        });
        const meta = json._metadata as { what_happened: string; next_steps: string[] };
        expect(meta.what_happened).toMatch(/^Rendered preflight (PASS|WARN|FAIL): score \d+\/100/);
        expect(json.mode).toBe("render");
        expect(typeof json.score).toBe("number");
        expect(Array.isArray(json.findings)).toBe(true);
        const render = json.render as { viewport: string; network: string; local_resources: { inlined: number } };
        expect(render.viewport).toBe("mobile 390x844");
        expect(render.network).toBe("deny-all");
        expect(render.local_resources.inlined).toBeGreaterThanOrEqual(1);
        expect((json.static_preflight as { overall: string }).overall).toMatch(/PASS|WARN|FAIL/);
        // No contrast or off-palette problems on the on-brand page
        const findings = json.findings as Array<{ rule: string; severity: string }>;
        expect(findings.filter((f) => f.severity === "error")).toEqual([]);

        const shot = json.screenshot_path as string;
        expect(shot).toMatch(/^\.brand\/checks\/render-\d{8}-\d{6}-mobile\.png$/);
        const png = await readFile(join(projectDir, shot));
        expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(meta.next_steps.some((s) => s.includes(shot))).toBe(true);
        expect(await readdir(join(projectDir, ".brand", "checks"))).toHaveLength(1);
      } finally {
        await cleanup();
      }
    }, 90000);

    it("rejects paths outside the working directory", async () => {
      const { client, cleanup } = await connectWithCwd(projectDir);
      try {
        const json = await callTool(client, "brand_preflight", { html: "/etc/hosts.html", render: true });
        expect(json.error).toBe("path_outside_cwd");
      } finally {
        await cleanup();
      }
    });
  });
});
