import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { CORE_TOOL_NAMES, resolveProfile } from "../src/lib/tool-profile.js";

async function listToolNames(profile: "core" | "full"): Promise<string[]> {
  const server = createServer({ profile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "profile-test", version: "0.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools.map((t) => t.name).sort();
}

describe("tool profiles", () => {
  it("core profile registers exactly the core tool set", async () => {
    const names = await listToolNames("core");
    expect(names).toEqual([...CORE_TOOL_NAMES].sort());
  });

  it("full profile is a strict superset of core and preserves all tool names", async () => {
    const full = await listToolNames("full");
    const core = await listToolNames("core");
    for (const name of core) {
      expect(full, `core tool ${name} missing from full profile`).toContain(name);
    }
    expect(full.length).toBeGreaterThan(core.length);
    // The full surface is the pre-0.10 surface — no tool may silently vanish.
    for (const legacy of [
      "brand_extract_web",
      "brand_extract_visual",
      "brand_extract_site",
      "brand_extract_figma",
      "brand_extract_pdf",
      "brand_deepen_identity",
      "brand_compile_messaging",
      "brand_build_personas",
      "brand_audit_drift",
      "brand_write",
      "brand_enrich_skill",
      "brand_feedback",
      "brand_brandcode_sync",
      "brand_brandcode_status",
      "brand_brandcode_live",
    ]) {
      expect(full, `legacy tool ${legacy} missing from full profile`).toContain(legacy);
    }
  });

  it("resolveProfile defaults to core and honors explicit/env values", () => {
    expect(resolveProfile(undefined)).toBe("core");
    expect(resolveProfile("full")).toBe("full");
    expect(resolveProfile("FULL")).toBe("full");
    expect(resolveProfile("core")).toBe("core");
    // Unknown values preserve the small, agent-friendly default surface.
    expect(resolveProfile("everything")).toBe("core");
  });
});
