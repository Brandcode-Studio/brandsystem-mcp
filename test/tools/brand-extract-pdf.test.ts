import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createServer } from "../../src/server.js";
import { BrandDir } from "../../src/lib/brand-dir.js";

async function pdf(line: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText(line, { x: 72, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save({ useObjectStreams: false });
}

async function call(client: Client, args: Record<string, unknown>) {
  const result = await client.callTool({ name: "brand_extract_pdf", arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("brand_extract_pdf path containment", () => {
  let root: string;
  let cwd: string;
  let prevCwd: string;
  let client: Client;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "extract-pdf-tool-")));
    cwd = join(root, "project");
    await new BrandDir(cwd).initBrand({
      schema_version: "0.1.0",
      session: 1,
      client_name: "Acme",
      created_at: "2026-10-01T00:00:00Z",
    });
    prevCwd = process.cwd();
    process.chdir(cwd);
    const server = createServer({ profile: "full" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "pdf-test", version: "1.0.0" });
    await server.connect(b);
    await client.connect(a);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(root, { recursive: true, force: true });
  });

  it("refuses a PDF outside the working directory without an existence oracle", async () => {
    await writeFile(join(root, "outside.pdf"), await pdf("Primary Color #123456"));
    const existing = await call(client, { file_path: join(root, "outside.pdf") });
    const missing = await call(client, { file_path: join(root, "missing.pdf") });
    expect(existing.error).toBe("invalid_path");
    expect(existing.details).toBe(missing.details);
    expect(existing.extracted).toBeUndefined();
  }, 30_000);

  it("extracts a PDF inside the working directory", async () => {
    await writeFile(join(cwd, "guide.pdf"), await pdf("Primary Color #00A3E0"));
    const res = await call(client, { file_path: "./guide.pdf" });
    expect(res.success).toBe(true);
    expect(res.pages_processed).toBe(1);
  }, 30_000);
});
