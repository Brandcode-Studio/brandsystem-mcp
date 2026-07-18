import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { copyFixture, connectWithCwd, callTool } from "../helpers.js";

// ---------------------------------------------------------------------------
// Theme signal end-to-end through brand_extract_web (issue #35 gap 1):
//   dark CSS → extracted ColorEntry → source catalog → MCP response.
// The safeFetch SSRF boundary is mocked (not bypassed): the tool still calls
// safeFetch for the page, stylesheets, and logo probes; everything except the
// page URL gets a 404, which is exactly the degradation path the tool handles.
// ---------------------------------------------------------------------------

const { DUAL_THEME_HTML } = vi.hoisted(() => ({
  DUAL_THEME_HTML: `<!doctype html><html><head><style>
:root { --brand-primary: #e63946; --brand-surface: #f1faee; }
body { color: #1d3557; background-color: #f1faee; }
@media (prefers-color-scheme: dark) {
  :root { --brand-surface: #0a141e; }
  body { background-color: #0a141e; }
}
h1 { color: #e63946; }
</style></head><body><h1>Dual Theme Co</h1></body></html>`,
}));

vi.mock("../../src/lib/url-validator.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/url-validator.js")>();
  return {
    ...actual,
    safeFetch: vi.fn(async (url: string) => {
      if (url === "https://dual-theme.example/") {
        return new Response(DUAL_THEME_HTML, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("not found", { status: 404 });
    }),
  };
});

describe("brand_extract_web theme threading", () => {
  let tmpDir: string;
  let client: Client;
  let cleanup: () => Promise<void>;
  let json: Record<string, unknown>;
  let savedFirecrawlKey: string | undefined;

  beforeAll(async () => {
    savedFirecrawlKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY; // force the safeFetch path
    tmpDir = await copyFixture("brand-session1");
    const conn = await connectWithCwd(tmpDir);
    client = conn.client;
    cleanup = conn.cleanup;
    json = await callTool(client, "brand_extract_web", {
      url: "https://dual-theme.example/",
    });
  });

  afterAll(async () => {
    if (savedFirecrawlKey !== undefined) process.env.FIRECRAWL_API_KEY = savedFirecrawlKey;
    await cleanup();
    await rm(tmpDir, { recursive: true });
  });

  it("carries theme on data.all_colors entries", () => {
    const allColors = json.all_colors as Array<Record<string, unknown>>;
    expect(allColors.length).toBeGreaterThan(0);
    const dark = allColors.filter((c) => c.theme === "dark");
    expect(dark.length).toBeGreaterThan(0);
    expect(dark.map((c) => c.hex)).toContain("#0a141e");
    // Colors seen outside a dark scope stay theme-agnostic (no theme key)
    const themeAgnostic = allColors.filter((c) => !("theme" in c));
    expect(themeAgnostic.length).toBeGreaterThan(0);
    for (const c of allColors) {
      if ("theme" in c) expect(c.theme).toBe("dark");
    }
  });

  it("carries theme on confirmation_needed.colors.all_extracted entries", () => {
    const confirmation = json.confirmation_needed as {
      colors: { all_extracted: Array<Record<string, unknown>> };
    };
    const dark = confirmation.colors.all_extracted.filter((c) => c.theme === "dark");
    expect(dark.map((c) => c.hex)).toContain("#0a141e");
  });

  it("persists the dark entry with its theme in core-identity.yaml", async () => {
    const identityYaml = await readFile(
      join(tmpDir, ".brand", "core-identity.yaml"),
      "utf-8",
    );
    expect(identityYaml).toContain("#0a141e");
    expect(identityYaml).toContain("theme: dark");
  });

  it("gives the dark entry its own source-catalog field with theme metadata", async () => {
    const catalog = JSON.parse(
      await readFile(join(tmpDir, ".brand", "source-catalog.json"), "utf-8"),
    ) as { fields: Record<string, Array<{ value: unknown; metadata?: Record<string, unknown> }>> };
    const darkFields = Object.entries(catalog.fields).filter(([field]) =>
      field.startsWith("colors.") && field.endsWith(".dark"),
    );
    expect(darkFields.length).toBeGreaterThan(0);
    const darkValues = darkFields.flatMap(([, records]) => records.map((r) => r.value));
    expect(darkValues).toContain("#0a141e");
    for (const [, records] of darkFields) {
      for (const record of records) {
        expect(record.metadata?.theme).toBe("dark");
      }
    }
  });
});
