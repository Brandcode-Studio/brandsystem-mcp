import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPdfBrandData } from "../../src/lib/pdf-extractor.js";

async function createSimplePdf(lines: string[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 760;
  for (const line of lines) {
    page.drawText(line, { x: 72, y, size: 12, font });
    y -= 18;
  }
  return pdf.save({ useObjectStreams: false });
}

describe("extractPdfBrandData", () => {
  it("extracts colors, typography, spacing, and rules from a PDF file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brandsystem-pdf-"));
    const file = join(dir, "guidelines.pdf");
    const pdf = await createSimplePdf([
      "Primary Color #00A3E0",
      "Secondary Color #00749A",
      "Heading font Inter Bold 48px",
      "Body font Inter Regular 16px",
      "Base unit 8px spacing system",
      "Do keep 24px clear space around the logo",
      "Don't stretch the logo",
    ]);
    await writeFile(file, pdf);

    const result = await extractPdfBrandData(file);
    expect(result.colors.some((color) => color.value === "#00a3e0" && color.role === "primary")).toBe(true);
    expect(result.typography.some((entry) => entry.family === "Inter")).toBe(true);
    expect(result.spacing?.base_unit).toBe("8px");
    expect(result.rules.dos.some((line) => line.includes("Do keep"))).toBe(true);
    expect(result.rules.donts.some((line) => line.includes("Don't stretch"))).toBe(true);
  });
});
