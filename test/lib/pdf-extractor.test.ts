import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfBrandData, PdfInputError } from "../../src/lib/pdf-extractor.js";

async function createSimplePdf(lines: string[], pageCount = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pageCount; p++) {
    const page = pdf.addPage([612, 792]);
    let y = 760;
    for (const line of lines) {
      page.drawText(line, { x: 72, y, size: 12, font });
      y -= 18;
    }
  }
  return pdf.save({ useObjectStreams: false });
}

const GUIDELINES = [
  "Primary Color #00A3E0",
  "Secondary Color #00749A",
  "Heading font Inter Bold 48px",
  "Body font Inter Regular 16px",
  "Base unit 8px spacing system",
  "Do keep 24px clear space around the logo",
  "Don't stretch the logo",
];

const isWindows = process.platform === "win32";
const T = 30_000;

let root: string;
let cwd: string;
let outside: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "brandsystem-pdf-")));
  cwd = join(root, "project");
  outside = join(root, "elsewhere");
  await mkdir(cwd, { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("extractPdfBrandData", () => {
  it("extracts colors, typography, spacing, and rules from a PDF inside the base dir", async () => {
    const file = join(cwd, "guidelines.pdf");
    await writeFile(file, await createSimplePdf(GUIDELINES));

    const result = await extractPdfBrandData("guidelines.pdf", "all", { baseDir: cwd });

    expect(result.filePath).toBe(file);
    expect(result.pagesProcessed).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.colors.some((color) => color.value === "#00a3e0" && color.role === "primary")).toBe(true);
    expect(result.typography.some((entry) => entry.family === "Inter")).toBe(true);
    expect(result.spacing?.base_unit).toBe("8px");
    expect(result.rules.dos.some((line) => line.includes("Do keep"))).toBe(true);
    expect(result.rules.donts.some((line) => line.includes("Don't stretch"))).toBe(true);
  }, T);

  it("refuses a path outside the base dir with the same message as a missing file", async () => {
    const file = join(outside, "secret.pdf");
    await writeFile(file, await createSimplePdf(["Primary Color #123456"]));

    const outsideErr = await extractPdfBrandData(file, "all", { baseDir: cwd }).catch((e) => e);
    const traversalErr = await extractPdfBrandData("../elsewhere/secret.pdf", "all", { baseDir: cwd }).catch((e) => e);
    const missingErr = await extractPdfBrandData("nope.pdf", "all", { baseDir: cwd }).catch((e) => e);
    const missingOutsideErr = await extractPdfBrandData(join(outside, "nope.pdf"), "all", { baseDir: cwd }).catch((e) => e);

    for (const err of [outsideErr, traversalErr, missingErr, missingOutsideErr]) {
      expect(err).toBeInstanceOf(PdfInputError);
      expect(err.message).toBe("PDF not found or outside the working directory");
    }
  }, T);

  it.skipIf(isWindows)("refuses a symlink inside the base dir that points outside", async () => {
    const target = join(outside, "secret.pdf");
    await writeFile(target, await createSimplePdf(["Primary Color #123456"]));
    await symlink(target, join(cwd, "linked.pdf"));

    const err = await extractPdfBrandData("linked.pdf", "all", { baseDir: cwd }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfInputError);
    expect(err.message).toBe("PDF not found or outside the working directory");
  }, T);

  it.skipIf(isWindows)("refuses a symlinked directory component that escapes", async () => {
    await writeFile(join(outside, "secret.pdf"), await createSimplePdf(["x"]));
    await symlink(outside, join(cwd, "docs"));
    const err = await extractPdfBrandData("docs/secret.pdf", "all", { baseDir: cwd }).catch((e) => e);
    expect(err.message).toBe("PDF not found or outside the working directory");
  }, T);

  it("refuses a directory", async () => {
    await mkdir(join(cwd, "folder.pdf"));
    const err = await extractPdfBrandData("folder.pdf", "all", { baseDir: cwd }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfInputError);
    expect(err.message).toMatch(/not a regular file/);
  }, T);

  it.skipIf(isWindows)("refuses a FIFO without hanging", async () => {
    const fifo = join(cwd, "pipe.pdf");
    execFileSync("mkfifo", [fifo]);
    const started = Date.now();
    const err = await extractPdfBrandData("pipe.pdf", "all", { baseDir: cwd }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfInputError);
    expect(err.message).toMatch(/not a regular file/);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, T);

  it("refuses an oversize file before parsing", async () => {
    await writeFile(join(cwd, "big.pdf"), Buffer.alloc(2048, 0x20));
    const err = await extractPdfBrandData("big.pdf", "all", { baseDir: cwd, maxBytes: 1024 }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfInputError);
    expect(err.message).toMatch(/exceeding the .* MB limit/);
  }, T);

  it("caps the number of pages processed", async () => {
    await writeFile(join(cwd, "long.pdf"), await createSimplePdf(["Primary Color #00A3E0"], 5));
    const result = await extractPdfBrandData("long.pdf", "all", { baseDir: cwd, maxPages: 2 });
    expect(result.pageCount).toBe(5);
    expect(result.pagesProcessed).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.nextPage).toBe(3);

    const ranged = await extractPdfBrandData("long.pdf", "4-5", { baseDir: cwd, maxPages: 2 });
    expect(ranged.pagesProcessed).toBe(2);
    expect(ranged.truncated).toBe(false);
  }, T);

  it("kills the parser when the timeout elapses", async () => {
    await writeFile(join(cwd, "guidelines.pdf"), await createSimplePdf(GUIDELINES));
    const err = await extractPdfBrandData("guidelines.pdf", "all", { baseDir: cwd, timeoutMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(PdfInputError);
    expect(err.message).toMatch(/timed out/);
  }, T);

  it("reports garbage input as a parse failure without leaking file contents", async () => {
    await writeFile(join(cwd, "fake.pdf"), "not a pdf — SECRET-TOKEN-123");
    const err = await extractPdfBrandData("fake.pdf", "all", { baseDir: cwd }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain("SECRET-TOKEN-123");
  }, T);
});
