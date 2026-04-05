import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { copyFixture, connectWithCwd, callTool } from "../helpers.js";

// ---------------------------------------------------------------------------
// brand_status
// ---------------------------------------------------------------------------

describe("brand_status", () => {
  describe("with complete fixture", () => {
    let tmpDir: string;
    let client: Client;
    let cleanup: () => Promise<void>;
    let status: string;

    beforeAll(async () => {
      tmpDir = await copyFixture("brand-complete");
      const conn = await connectWithCwd(tmpDir);
      client = conn.client;
      cleanup = conn.cleanup;
      const result = await callTool(client, "brand_status");
      status = result.status as string;
    });

    afterAll(async () => {
      await cleanup();
      await rm(tmpDir, { recursive: true });
    });

    it("reports the brand name and session", () => {
      expect(status).toContain("Fixture Brand");
      expect(status).toContain("Session: 2");
    });

    it("reports correct identity counts", () => {
      expect(status).toMatch(/Colors:\s+3 entries/);
      expect(status).toMatch(/Typography:\s+2 entries/);
      expect(status).toMatch(/Logo:\s+1 asset/);
    });

    it("shows Sessions 1 and 2 as complete", () => {
      expect(status).toContain("Session 1: Core Identity        ✓ Complete");
      expect(status).toContain("Session 2: Full Visual Identity ✓ Complete");
    });
  });

  describe("with session-1-only fixture", () => {
    let tmpDir: string;
    let cleanup: () => Promise<void>;
    let status: string;

    beforeAll(async () => {
      tmpDir = await copyFixture("brand-session1");
      const conn = await connectWithCwd(tmpDir);
      cleanup = conn.cleanup;
      const result = await callTool(conn.client, "brand_status");
      status = result.status as string;
    });

    afterAll(async () => {
      await cleanup();
      await rm(tmpDir, { recursive: true });
    });

    it("reports session 1 with Session 2 ready", () => {
      expect(status).toContain("Session: 1");
      expect(status).toContain("Session 2: Full Visual Identity → Ready");
    });
  });
});

// ---------------------------------------------------------------------------
// brand_audit
// ---------------------------------------------------------------------------

describe("brand_audit", () => {
  describe("with complete fixture", () => {
    let tmpDir: string;
    let cleanup: () => Promise<void>;
    let result: Record<string, unknown>;

    beforeAll(async () => {
      tmpDir = await copyFixture("brand-complete");
      const conn = await connectWithCwd(tmpDir);
      cleanup = conn.cleanup;
      result = await callTool(conn.client, "brand_audit");
    });

    afterAll(async () => {
      await cleanup();
      await rm(tmpDir, { recursive: true });
    });

    it("passes all checks", () => {
      expect(result.overall).toBe("PASS");
      const summary = result.summary as { pass: number; warn: number; fail: number };
      expect(summary.fail).toBe(0);
      expect(summary.warn).toBe(0);
      expect(summary.pass).toBeGreaterThan(0);
    });
  });

  describe("with session-1-only fixture", () => {
    let tmpDir: string;
    let cleanup: () => Promise<void>;
    let result: Record<string, unknown>;

    beforeAll(async () => {
      tmpDir = await copyFixture("brand-session1");
      const conn = await connectWithCwd(tmpDir);
      cleanup = conn.cleanup;
      result = await callTool(conn.client, "brand_audit");
    });

    afterAll(async () => {
      await cleanup();
      await rm(tmpDir, { recursive: true });
    });

    it("warns about missing tokens.json", () => {
      expect(result.overall).toBe("WARN");
      expect(result.report).toContain("tokens.json");
      expect(result.report).toContain("missing");
    });
  });
});

// ---------------------------------------------------------------------------
// brand_compile (writes files — uses session-1-only fixture in tmpdir)
// ---------------------------------------------------------------------------

describe("brand_compile", () => {
  let tmpDir: string;
  let client: Client;
  let cleanup: () => Promise<void>;
  let compileResult: Record<string, unknown>;

  beforeAll(async () => {
    tmpDir = await copyFixture("brand-session1");
    const conn = await connectWithCwd(tmpDir);
    client = conn.client;
    cleanup = conn.cleanup;
    compileResult = await callTool(client, "brand_compile");
  });

  afterAll(async () => {
    await cleanup();
    await rm(tmpDir, { recursive: true });
  });

  it("produces tokens.json with correct color values", async () => {
    const raw = await readFile(join(tmpDir, ".brand", "tokens.json"), "utf-8");
    const tokens = JSON.parse(raw);
    const colors = tokens.brand.color;
    expect(Object.keys(colors)).toHaveLength(3);
    expect(colors.primary.$value).toBe("#2a4494");
    expect(colors.secondary.$value).toBe("#e8523f");
    expect(colors.accent.$value).toBe("#f5a623");
  });

  it("returns correct token counts", () => {
    const tokens = compileResult.tokens as Record<string, number>;
    expect(tokens.colors).toBe(3);
    expect(tokens.typography).toBe(2);
  });

  it("produces brand-runtime.json with sessions_completed: 1", async () => {
    const raw = await readFile(
      join(tmpDir, ".brand", "brand-runtime.json"),
      "utf-8",
    );
    const runtime = JSON.parse(raw);
    expect(runtime.sessions_completed).toBe(1);
    expect(runtime.client_name).toBe("Fixture Brand");
    expect(runtime.identity.colors.primary).toBe("#2a4494");
  });

  it("produces valid interaction-policy.json", async () => {
    const raw = await readFile(
      join(tmpDir, ".brand", "interaction-policy.json"),
      "utf-8",
    );
    const policy = JSON.parse(raw);
    expect(policy.version).toBeDefined();
    expect(Array.isArray(policy.visual_rules)).toBe(true);
    // Session-1-only has no visual identity → empty visual_rules
    expect(policy.visual_rules).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// brand_write (read-only — uses complete fixture)
// ---------------------------------------------------------------------------

describe("brand_write", () => {
  let tmpDir: string;
  let cleanup: () => Promise<void>;
  let result: Record<string, unknown>;

  beforeAll(async () => {
    tmpDir = await copyFixture("brand-complete");
    const conn = await connectWithCwd(tmpDir);
    cleanup = conn.cleanup;
    result = await callTool(conn.client, "brand_write", {
      content_type: "general",
    });
  });

  afterAll(async () => {
    await cleanup();
    await rm(tmpDir, { recursive: true });
  });

  it("returns brand context with colors, typography, and visual identity", () => {
    expect(result.client_name).toBe("Fixture Brand");
    const layers = result.brand_layers_available as string[];
    expect(layers).toContain("core_identity");
    expect(layers).toContain("visual_identity");

    const brief = result.creation_brief as Record<string, unknown>;
    const visual = brief.visual as Record<string, unknown>;
    const colors = visual.colors as Array<{ hex: string; role: string }>;
    expect(colors).toHaveLength(3);
    expect(colors.find((c) => c.role === "primary")?.hex).toBe("#2a4494");

    const typography = visual.typography as Array<{ family: string }>;
    expect(typography).toHaveLength(2);
    expect(typography[0].family).toBe("Inter");
  });
});

// ---------------------------------------------------------------------------
// brand_audit_content (read-only — uses complete fixture)
// ---------------------------------------------------------------------------

describe("brand_audit_content", () => {
  let tmpDir: string;
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tmpDir = await copyFixture("brand-complete");
    const conn = await connectWithCwd(tmpDir);
    client = conn.client;
    cleanup = conn.cleanup;
  });

  afterAll(async () => {
    await cleanup();
    await rm(tmpDir, { recursive: true });
  });

  it("scores on-brand HTML with a positive score", async () => {
    const result = await callTool(client, "brand_audit_content", {
      content:
        '<div style="color: #2a4494; font-family: Inter;">Fixture Brand delivers structured clarity.</div>',
    });
    expect(result.overall_score).toBeGreaterThan(0);
    const dims = result.dimensions_available as string[];
    expect(dims).toContain("token_compliance");
  });

  it("flags off-brand HTML with visual violations", async () => {
    const result = await callTool(client, "brand_audit_content", {
      content:
        '<div style="color: #ff0000; font-family: Comic Sans MS; box-shadow: 2px 2px 5px #000;">Bad content</div>',
    });
    const issues = result.issues as Array<{ dimension: string; message: string }>;
    // Should flag off-palette colors or non-brand fonts or anti-pattern violations
    expect(issues.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// brand_report (writes file — uses session-1-only fixture in tmpdir)
// ---------------------------------------------------------------------------

describe("brand_report", () => {
  let tmpDir: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tmpDir = await copyFixture("brand-session1");
    const conn = await connectWithCwd(tmpDir);
    cleanup = conn.cleanup;
    await callTool(conn.client, "brand_report");
  });

  afterAll(async () => {
    await cleanup();
    await rm(tmpDir, { recursive: true });
  });

  it("produces HTML report containing the brand name and colors", async () => {
    const html = await readFile(
      join(tmpDir, ".brand", "brand-report.html"),
      "utf-8",
    );
    expect(html).toContain("Fixture Brand");
    expect(html).toContain("#2a4494");
    expect(html.toLowerCase()).toContain("<html");
  });
});

// ---------------------------------------------------------------------------
// brand_export (writes file — uses complete fixture in tmpdir)
// ---------------------------------------------------------------------------

describe("brand_export", () => {
  let tmpDir: string;
  let cleanup: () => Promise<void>;
  let result: Record<string, unknown>;

  beforeAll(async () => {
    tmpDir = await copyFixture("brand-complete");
    const conn = await connectWithCwd(tmpDir);
    cleanup = conn.cleanup;
    result = await callTool(conn.client, "brand_export", {
      target: "chat",
      include_logo: true,
    });
  });

  afterAll(async () => {
    await cleanup();
    await rm(tmpDir, { recursive: true });
  });

  it("produces chat export containing the brand name and colors", () => {
    const content = result.content as string;
    expect(content).toContain("Fixture Brand");
    expect(content).toContain("#2a4494");
    expect(result.target).toBe("chat");
    const layers = result.brand_layers_included as string[];
    expect(layers).toContain("core_identity");
    expect(layers).toContain("visual_identity");
  });
});
