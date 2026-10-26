/**
 * Issue #93 — role variants flow end to end through the tools:
 * core-identity.yaml (variant role) → brand_compile → tokens.json and
 * brand-runtime.json, and brand_clarify accepts variant role names while
 * still reading "accent-color" as "accent" like it did before variants.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { copyFixture, connectWithCwd, callTool } from "../helpers.js";

const IDENTITY = [
  'schema_version: "0.1.0"',
  "colors:",
  '  - { name: "brand blue", value: "#0f62fe", role: primary, source: web, confidence: high }',
  '  - { name: "paper", value: "#ffffff", role: surface, source: web, confidence: high }',
  '  - { name: "panel", value: "#f4f4f4", role: surface-alt, source: web, confidence: high }',
  '  - { name: "ink", value: "#161616", role: text, source: web, confidence: high }',
  '  - { name: "ink soft", value: "#525252", role: text-secondary, source: web, confidence: medium }',
  '  - { name: "midnight", value: "#0f0f1a", role: surface, theme: dark, source: web, confidence: high }',
  '  - { name: "midnight raised", value: "#1c1c2e", role: surface-alt, theme: dark, source: web, confidence: high }',
  '  - { name: "mystery a", value: "#7a7a7a", role: unknown, source: web, confidence: high }',
  '  - { name: "mystery b", value: "#ffb000", role: unknown, source: web, confidence: high }',
  "typography:",
  '  - { name: "Body", family: "Inter", source: web, confidence: high }',
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

let tmpDir: string;
let client: Client;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  tmpDir = await copyFixture("brand-session1");
  await writeFile(join(tmpDir, ".brand", "core-identity.yaml"), IDENTITY, "utf-8");
  const conn = await connectWithCwd(tmpDir);
  client = conn.client;
  cleanup = conn.cleanup;
});

afterEach(async () => {
  await cleanup();
  await rm(tmpDir, { recursive: true, force: true });
});

async function readJson(file: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(tmpDir, ".brand", file), "utf-8"));
}

describe("variant roles flow through brand_compile (issue #93)", () => {
  it("emits variant tokens in tokens.json and variant keys in brand-runtime.json", async () => {
    const result = await callTool(client, "brand_compile");
    expect(result.error).toBeUndefined();

    const tokens = await readJson("tokens.json");
    const color = tokens.brand.color;
    expect(color["surface-alt"].$value).toBe("#f4f4f4");
    expect(color["surface-alt"].$extensions["com.brandsystem"].variantOf).toBe("surface");
    expect(color["text-secondary"].$value).toBe("#525252");
    expect(color.dark["surface-alt"].$value).toBe("#1c1c2e");
    expect(color.surface.$value).toBe("#ffffff");

    const runtime = await readJson("brand-runtime.json");
    expect(runtime.identity.colors["surface-alt"]).toBe("#f4f4f4");
    expect(runtime.identity.colors["text-secondary"]).toBe("#525252");
    expect(runtime.identity.colors_dark["surface-alt"]).toBe("#1c1c2e");
  });
});

describe("brand_clarify accepts variant roles (issue #93)", () => {
  async function rolesItemId(): Promise<string> {
    await callTool(client, "brand_compile");
    const raw = await readFile(join(tmpDir, ".brand", "needs-clarification.yaml"), "utf-8");
    const items = (parseYaml(raw)?.items ?? []) as Array<{ id: string; field: string }>;
    const item = items.find((i) => i.field === "colors.roles");
    expect(item).toBeDefined();
    return item!.id;
  }

  async function roleOf(value: string): Promise<string | undefined> {
    const raw = await readFile(join(tmpDir, ".brand", "core-identity.yaml"), "utf-8");
    return (parseYaml(raw).colors as Array<{ value: string; role: string }>).find((c) => c.value === value)?.role;
  }

  it("assigns a hyphenated variant role from '#hex is role'", async () => {
    const id = await rolesItemId();
    await callTool(client, "brand_clarify", { id, answer: "#7a7a7a is neutral-alt, #ffb000 is accent-alt" });
    expect(await roleOf("#7a7a7a")).toBe("neutral-alt");
    expect(await roleOf("#ffb000")).toBe("accent-alt");
  });

  it("still reads a non-role hyphenated token by its leading word", async () => {
    const id = await rolesItemId();
    await callTool(client, "brand_clarify", { id, answer: "#ffb000 is accent-color" });
    expect(await roleOf("#ffb000")).toBe("accent");
  });
});
