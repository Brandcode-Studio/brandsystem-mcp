import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectWithCwd } from "../helpers.js";

// ---------------------------------------------------------------------------
// Tool-boundary error fencing (#45): a handler throw (e.g. the yaml package's
// alias-bomb rejection while reading a hostile .brand/ file) must NOT surface
// as a raw SDK isError text dump. It keeps isError: true — generic MCP
// clients must still classify the execution as failed — but the body is the
// structured envelope with a templated summary, and the parser's message
// appears only fenced.
// ---------------------------------------------------------------------------

const ALIAS_BOMB = [
  "client_name: Fence Test",
  "a: &a [x, x, x, x, x, x, x, x]",
  "b: &b [*a, *a, *a, *a, *a, *a, *a, *a]",
  "c: &c [*b, *b, *b, *b, *b, *b, *b, *b]",
  "d: &d [*c, *c, *c, *c, *c, *c, *c, *c]",
  "e: &e [*d, *d, *d, *d, *d, *d, *d, *d]",
  "f: &f [*e, *e, *e, *e, *e, *e, *e, *e]",
  "g: &g [*f, *f, *f, *f, *f, *f, *f, *f]",
].join("\n");

describe("tool-boundary error fencing", () => {
  let tmpDir: string;
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "brand-fence-"));
    await mkdir(join(tmpDir, ".brand"), { recursive: true });
    await writeFile(join(tmpDir, ".brand", "brand.config.yaml"), ALIAS_BOMB);
    await writeFile(join(tmpDir, ".brand", "core-identity.yaml"), ALIAS_BOMB);
    const conn = await connectWithCwd(tmpDir);
    client = conn.client;
    cleanup = conn.cleanup;
  });

  afterAll(async () => {
    await cleanup();
    await rm(tmpDir, { recursive: true });
  });

  it("returns isError:true with the structured envelope for a YAML alias bomb", async () => {
    const result = await client.callTool({ name: "brand_status", arguments: {} });
    // MCP error semantics preserved: generic clients see a failed execution
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const json = JSON.parse(content[0].text);
    const meta = json._metadata as { what_happened: string };
    expect(meta.what_happened).toContain("could not be parsed or read");
    expect(json.error).toBe("tool_execution_failed");
    // The parser message is present only fenced (quoted, flattened, capped)
    if (typeof json.detail_fenced === "string") {
      expect(json.detail_fenced.startsWith('"')).toBe(true);
      expect(json.detail_fenced.length).toBeLessThanOrEqual(200);
    }
  });

  it("keeps structuredContent envelope-valid on the fenced error path", async () => {
    const result = await client.callTool({ name: "brand_status", arguments: {} });
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toBeDefined();
    expect(structured._metadata).toBeDefined();
  });
});
