import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

type ToolInfo = {
  name: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

async function listTools(): Promise<ToolInfo[]> {
  const server = createServer({ profile: "full" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "annotations-test", version: "0.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  return tools as ToolInfo[];
}

describe("tool annotations", () => {
  it("every tool declares complete annotations", async () => {
    const tools = await listTools();
    expect(tools.length).toBeGreaterThan(0);

    for (const tool of tools) {
      const a = tool.annotations;
      expect(a, `${tool.name} is missing annotations`).toBeDefined();
      expect(typeof a!.title, `${tool.name} annotations.title must be a string`).toBe("string");
      expect(a!.title!.length, `${tool.name} annotations.title must be non-empty`).toBeGreaterThan(0);
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof a![hint], `${tool.name} annotations.${hint} must be a boolean`).toBe("boolean");
      }
    }
  });

  it("spot-checks known classifications", async () => {
    const tools = await listTools();
    const byName = new Map(tools.map((t) => [t.name, t.annotations!]));

    expect(byName.get("brand_status")?.readOnlyHint).toBe(true);
    expect(byName.get("brand_extract_web")?.openWorldHint).toBe(true);
    expect(byName.get("brand_compile")?.readOnlyHint).toBe(false);
    expect(byName.get("brand_extract_figma")?.openWorldHint).toBe(false);

    // Additional invariants worth pinning:
    // brand_brandcode_auth is the only tool that deletes user data (logout).
    expect(byName.get("brand_brandcode_auth")?.destructiveHint).toBe(true);
    const destructive = tools.filter((t) => t.annotations?.destructiveHint === true);
    expect(destructive.map((t) => t.name)).toEqual(["brand_brandcode_auth"]);

    // Read-only tools must never be marked destructive.
    for (const tool of tools) {
      if (tool.annotations?.readOnlyHint === true) {
        expect(
          tool.annotations.destructiveHint,
          `${tool.name} is readOnly but marked destructive`,
        ).toBe(false);
      }
    }
  });
});
