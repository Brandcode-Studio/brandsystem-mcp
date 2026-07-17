import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

describe("published stdio boundary", () => {
  it("initializes dist/index.js with instructions and the Core tool profile", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(process.cwd(), "dist", "index.js")],
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-boundary-test", version: "0.0.0" });

    try {
      await client.connect(transport);
      expect(client.getInstructions()).toContain("Use brand_start");
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(12);
      expect(tools[0].name).toBe("brand_start");
    } finally {
      await client.close();
    }
  }, 15_000);
});
