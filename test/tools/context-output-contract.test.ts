import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rm } from "node:fs/promises";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { copyFixture, connectWithCwd, callTool } from "../helpers.js";

// ---------------------------------------------------------------------------
// brand_context output_contract: deterministic per-task_type delivery rules
// served WITH the context so they sit adjacent to the brand data in a
// consuming agent's prompt (measured benchmark failure: markup wrapped in
// prose / requested structure skipped).
// ---------------------------------------------------------------------------

describe("brand_context output_contract", () => {
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

  it("markup task_types get the single-fenced-block contract", async () => {
    for (const taskType of ["code-ui", "landing-page"]) {
      const json = await callTool(client, "brand_context", { task_type: taskType });
      const contract = json.output_contract as { format: string; rules: string[] };
      expect(contract.format).toBe("single_fenced_code_block");
      expect(contract.rules.some((r) => r.includes("exactly one fenced code block"))).toBe(true);
    }
  });

  it("text task_types get the content-only contract", async () => {
    for (const taskType of ["social-post", "email", "blog-article"]) {
      const json = await callTool(client, "brand_context", { task_type: taskType });
      const contract = json.output_contract as { format: string; rules: string[] };
      expect(contract.format).toBe("content_only");
      expect(contract.rules.some((r) => r.includes("no preamble"))).toBe(true);
    }
  });

  it("next_steps direct the agent to the contract", async () => {
    const json = await callTool(client, "brand_context", { task_type: "code-ui" });
    const meta = json._metadata as { next_steps: string[] };
    expect(meta.next_steps.some((s) => s.includes("output_contract"))).toBe(true);
  });

  it("contract is present on the compact budget too", async () => {
    const json = await callTool(client, "brand_context", {
      task_type: "code-ui",
      budget: "compact",
    });
    const contract = json.output_contract as { format: string };
    expect(contract.format).toBe("single_fenced_code_block");
  });
});
