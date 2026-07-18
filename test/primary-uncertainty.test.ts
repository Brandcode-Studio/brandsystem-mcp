/**
 * Primary-color uncertainty loop (issue #41).
 *
 * A real field run (colovore.com) showed static-CSS extraction crowning an
 * achromatic near-grey (#f0f0f0) as primary via CSS-variable name inference
 * while the true chromatic brand color sat unconfirmed. Every downstream
 * check then failed the brand's own true colors, and no clarification item
 * existed to fix it.
 *
 * These tests pin the full loop:
 *   compile  → uncertain primary generates the stable "clarify-primary" item
 *   clarify  → answering with a candidate hex re-roles it to primary
 *   checks   → while clarify-primary is open, color verdicts soften from
 *              fail to advisory warning; hard verdicts return after resolve
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { copyFixture, connectWithCwd, callTool } from "./helpers.js";
import { invalidateCheckCache } from "../src/lib/brand-check-engine.js";

// ── Fixture identities ──────────────────────────────────────────

/** Colovore-shaped failure: achromatic grey crowned primary (not low
 * confidence — the crowning itself was confident) while true chromatic
 * brand colors sit in non-primary roles. */
const ACHROMATIC_PRIMARY_IDENTITY = [
  'schema_version: "0.1.0"',
  "colors:",
  '  - name: "light grey"',
  '    value: "#f0f0f0"',
  "    role: primary",
  "    source: web",
  "    confidence: high",
  '  - name: "brand green"',
  '    value: "#00a050"',
  "    role: secondary",
  "    source: web",
  "    confidence: high",
  '  - name: "deep blue"',
  '    value: "#123a8f"',
  "    role: accent",
  "    source: web",
  "    confidence: medium",
  "typography:",
  '  - name: "Body"',
  '    family: "Inter"',
  "    weight: 400",
  '    size: "16px"',
  "    source: web",
  "    confidence: high",
  "logo:",
  "  - type: wordmark",
  "    source: web",
  "    confidence: high",
  "    variants:",
  "      - name: default",
  "        file: logo/logo-wordmark.svg",
  "spacing: null",
  "",
].join("\n");

/** Medium-confidence chromatic primary with another chromatic candidate —
 * condition (c). */
const MEDIUM_CONFIDENCE_PRIMARY_IDENTITY = ACHROMATIC_PRIMARY_IDENTITY.replace(
  '  - name: "light grey"\n    value: "#f0f0f0"\n    role: primary\n    source: web\n    confidence: high',
  '  - name: "washed teal"\n    value: "#4fa3a0"\n    role: primary\n    source: web\n    confidence: medium'
);

let tmpDir: string;
let client: Client;
let cleanup: () => Promise<void>;

async function writeIdentity(yaml: string): Promise<void> {
  await writeFile(join(tmpDir, ".brand", "core-identity.yaml"), yaml, "utf-8");
}

async function readClarifications(): Promise<Array<{ id: string; field: string; question: string; priority: string }>> {
  const raw = await readFile(join(tmpDir, ".brand", "needs-clarification.yaml"), "utf-8");
  return (parseYaml(raw)?.items ?? []) as Array<{ id: string; field: string; question: string; priority: string }>;
}

async function readIdentityColors(): Promise<Array<{ name: string; value: string; role: string; confidence: string }>> {
  const raw = await readFile(join(tmpDir, ".brand", "core-identity.yaml"), "utf-8");
  return parseYaml(raw).colors;
}

beforeEach(async () => {
  // brand-session1: session-1 brand with config + identity + logo asset.
  tmpDir = await copyFixture("brand-session1");
  const conn = await connectWithCwd(tmpDir);
  client = conn.client;
  cleanup = conn.cleanup;
  invalidateCheckCache();
});

afterEach(async () => {
  await cleanup();
  await rm(tmpDir, { recursive: true, force: true });
  invalidateCheckCache();
});

// ── (a) + (b): clarify-primary generation ───────────────────────

describe("brand_compile primary-uncertainty clarification", () => {
  it("achromatic primary + chromatic alternates → clarify-primary, high priority, candidates listed", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    const items = await readClarifications();
    const primaryItems = items.filter((i) => i.id === "clarify-primary");
    expect(primaryItems).toHaveLength(1);

    const item = primaryItems[0];
    expect(item.field).toBe("colors.primary");
    expect(item.priority).toBe("high");
    // Current primary value + fenced name are in the question
    expect(item.question).toContain("#f0f0f0");
    expect(item.question).toContain('"light grey"');
    // Chromatic candidate values are listed
    expect(item.question).toContain("#00a050");
    expect(item.question).toContain("#123a8f");
  });

  it("does not queue a duplicate medium item for an uncertain primary (condition c)", async () => {
    // Low-confidence primary would previously get its own medium item too.
    await writeIdentity(
      ACHROMATIC_PRIMARY_IDENTITY.replace(
        '    role: primary\n    source: web\n    confidence: high',
        "    role: primary\n    source: web\n    confidence: low"
      )
    );
    await callTool(client, "brand_compile");

    const items = await readClarifications();
    const primaryFieldItems = items.filter((i) => i.field === "colors.primary");
    expect(primaryFieldItems).toHaveLength(1);
    expect(primaryFieldItems[0].id).toBe("clarify-primary");
  });

  it("medium-confidence primary with chromatic alternates → clarify-primary fires (condition c)", async () => {
    await writeIdentity(MEDIUM_CONFIDENCE_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    const items = await readClarifications();
    expect(items.some((i) => i.id === "clarify-primary")).toBe(true);
  });

  it("missing primary role → clarify-primary fires (condition a)", async () => {
    await writeIdentity(
      ACHROMATIC_PRIMARY_IDENTITY.replace("role: primary", "role: surface")
    );
    await callTool(client, "brand_compile");

    const items = await readClarifications();
    const item = items.find((i) => i.id === "clarify-primary");
    expect(item).toBeDefined();
    expect(item!.priority).toBe("high");
    expect(item!.question).toContain("#00a050");
  });

  // (b) no duplicate on recompile
  it("recompile does not duplicate clarify-primary", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");
    await callTool(client, "brand_compile");

    const items = await readClarifications();
    expect(items.filter((i) => i.id === "clarify-primary")).toHaveLength(1);
  });

  // (c) confident chromatic primary → no item
  it("confident chromatic primary → no clarify-primary", async () => {
    // brand-session1 default: #2a4494 primary, confirmed, chromatic
    await callTool(client, "brand_compile");

    const items = await readClarifications();
    expect(items.some((i) => i.id === "clarify-primary")).toBe(false);
    expect(items.some((i) => i.field === "colors.primary")).toBe(false);
  });

  it("achromatic primary with NO chromatic alternates → no clarify-primary", async () => {
    const monochrome = ACHROMATIC_PRIMARY_IDENTITY
      .replace('value: "#00a050"', 'value: "#d8d8d8"')
      .replace('value: "#123a8f"', 'value: "#3c3c3c"');
    await writeIdentity(monochrome);
    await callTool(client, "brand_compile");

    const items = await readClarifications();
    expect(items.some((i) => i.id === "clarify-primary")).toBe(false);
  });
});

// ── (d) clarify resolution ──────────────────────────────────────

describe("brand_clarify resolves clarify-primary", () => {
  it("re-roles the chosen candidate to primary (confirmed), demotes the old primary, and the next compile clears the item", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    // Answer with a bare hex inside free text
    const result = await callTool(client, "brand_clarify", {
      id: "clarify-primary",
      answer: "the true primary is #00a050",
    });
    expect(result.error).toBeUndefined();

    const colors = await readIdentityColors();
    const green = colors.find((c) => c.value === "#00a050");
    expect(green?.role).toBe("primary");
    expect(green?.confidence).toBe("confirmed");

    // Previous primary demoted to its inferred role (achromatic grey → neutral)
    const grey = colors.find((c) => c.value === "#f0f0f0");
    expect(grey?.role).toBe("neutral");

    // Recompile: item cleared, runtime carries the new primary
    await callTool(client, "brand_compile");
    const items = await readClarifications();
    expect(items.some((i) => i.id === "clarify-primary")).toBe(false);

    const runtime = JSON.parse(
      await readFile(join(tmpDir, ".brand", "brand-runtime.json"), "utf-8")
    );
    expect(runtime.identity.colors.primary).toBe("#00a050");
  });

  it("accepts a plain hex answer ({color: '#...'}-style)", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    await callTool(client, "brand_clarify", {
      id: "clarify-primary",
      answer: "#123a8f",
    });

    const colors = await readIdentityColors();
    expect(colors.find((c) => c.value === "#123a8f")?.role).toBe("primary");
    expect(colors.find((c) => c.value === "#123a8f")?.confidence).toBe("confirmed");
  });

  it("keeps the current primary when the user confirms it by hex", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    await callTool(client, "brand_clarify", {
      id: "clarify-primary",
      answer: "#f0f0f0",
    });

    const colors = await readIdentityColors();
    const grey = colors.find((c) => c.value === "#f0f0f0");
    expect(grey?.role).toBe("primary");
    expect(grey?.confidence).toBe("confirmed");

    // Confirmed achromatic primary must NOT re-fire the item (no loop)
    await callTool(client, "brand_compile");
    const items = await readClarifications();
    expect(items.some((i) => i.id === "clarify-primary")).toBe(false);
  });
});

// ── (e) check softening ─────────────────────────────────────────

describe("color verdict softening while clarify-primary is open", () => {
  const OFF_PALETTE_HTML =
    '<html><body><div style="color: #ff00aa">hello</div></body></html>';

  it("brand_check: off-palette color yields advisory warning, not fail", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    const result = await callTool(client, "brand_check", { color: "#ff00aa" });
    expect(result.pass).toBe(true);
    const flags = result.flags as Array<{ severity: string; message: string; advisory?: boolean }>;
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) {
      expect(f.severity).toBe("warning");
      expect(f.advisory).toBe(true);
      expect(f.message).toContain("resolve clarify-primary");
    }
  });

  it("brand_check: text/font checks are unaffected by the gate", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    const result = await callTool(client, "brand_check", { font: "Comic Sans MS" });
    expect(result.pass).toBe(false);
    const flags = result.flags as Array<{ severity: string; advisory?: boolean }>;
    expect(flags.some((f) => f.advisory)).toBe(false);
  });

  it("brand_check_compliance: color failure becomes advisory: gate does not FAIL but withholds publish approval", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    const result = await callTool(client, "brand_check_compliance", {
      content: OFF_PALETTE_HTML,
    });
    expect(result.result).toBe("pass_with_advisories");
    const checks = result.checks as Array<{ id: string; status: string; message: string }>;
    const colorCheck = checks.find((c) => c.id === "CRT-COLOR");
    expect(colorCheck?.status).toBe("warn");
    expect(colorCheck?.message).toContain("resolve clarify-primary");
    // rules_checked still counts the softened rule
    expect(result.rules_checked as number).toBeGreaterThanOrEqual(1);
  });

  it("hard verdicts return after clarify-primary is resolved and recompiled", async () => {
    await writeIdentity(ACHROMATIC_PRIMARY_IDENTITY);
    await callTool(client, "brand_compile");

    await callTool(client, "brand_clarify", {
      id: "clarify-primary",
      answer: "#00a050",
    });
    await callTool(client, "brand_compile");

    const check = await callTool(client, "brand_check", { color: "#ff00aa" });
    expect(check.pass).toBe(false);
    const flags = check.flags as Array<{ severity: string; advisory?: boolean }>;
    expect(flags.some((f) => f.severity === "error")).toBe(true);
    expect(flags.some((f) => f.advisory)).toBe(false);

    const compliance = await callTool(client, "brand_check_compliance", {
      content: OFF_PALETTE_HTML,
    });
    expect(compliance.result).toBe("fail");
    const checks = compliance.checks as Array<{ id: string; status: string }>;
    expect(checks.find((c) => c.id === "CRT-COLOR")?.status).toBe("fail");
  });
});
