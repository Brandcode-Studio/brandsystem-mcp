/**
 * Real stdio-transport test: spawns `node dist/index.js` as a child process
 * via the SDK's StdioClientTransport and connects a real Client over it.
 * Catches transport-level bugs (stdout pollution, framing, startup crashes,
 * lifecycle leaks) that the in-memory client used elsewhere cannot see.
 *
 * Skips gracefully when dist/index.js has not been built.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DIST_ENTRY = join(process.cwd(), "dist", "index.js");
const hasDist = existsSync(DIST_ENTRY);

// The 12-tool Core surface served by default over stdio (matches
// scripts/agent-eval.mjs CORE_TOOL_ARGS and test/tool-profile.test.ts).
const CORE_TOOLS = [
  "brand_start",
  "brand_status",
  "brand_runtime",
  "brand_context",
  "brand_check",
  "brand_preflight",
  "brand_report",
  "brand_export",
  "brand_brandcode_auth",
  "brand_brandcode_connect",
  "brand_clarify",
  "brand_compile",
];

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("stdio transport (real spawned dist/index.js)", () => {
  it.skipIf(!hasDist)(
    "serves the core tool surface, returns a well-formed brand_status envelope, and exits cleanly on close",
    async () => {
      // Run the server in an empty temp cwd so brand_status exercises the
      // getting-started path without touching the repository.
      const cwd = mkdtempSync(join(tmpdir(), "stdio-transport-test-"));
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [DIST_ENTRY],
        cwd,
        stderr: "pipe",
      });
      const client = new Client({ name: "stdio-transport-test", version: "0.0.0" });

      let pid: number | null = null;
      try {
        await client.connect(transport);
        pid = transport.pid;
        expect(pid).not.toBeNull();
        expect(processAlive(pid!)).toBe(true);

        // 1. listTools over the real transport returns exactly the 12 core tools.
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual([...CORE_TOOLS].sort());

        // 2. A real brand_status call returns a well-formed envelope with
        //    structuredContent mirrored by the text payload.
        const result = await client.callTool({ name: "brand_status", arguments: {} });
        expect(result.isError ?? false).toBe(false);

        const sc = result.structuredContent as {
          _metadata?: { what_happened?: unknown; next_steps?: unknown };
        };
        expect(sc).toBeTruthy();
        expect(typeof sc._metadata?.what_happened).toBe("string");
        expect((sc._metadata?.what_happened as string).length).toBeGreaterThan(0);
        expect(Array.isArray(sc._metadata?.next_steps)).toBe(true);

        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0]?.type).toBe("text");
        const parsed = JSON.parse(content[0].text);
        expect(parsed._metadata.what_happened).toBe(sc._metadata?.what_happened);
      } finally {
        await client.close();
        rmSync(cwd, { recursive: true, force: true });
      }

      // 3. The child process exits cleanly after close (no orphaned server).
      expect(pid).not.toBeNull();
      await expect
        .poll(() => processAlive(pid!), { timeout: 5_000, interval: 100 })
        .toBe(false);
    },
    20_000
  );
});
