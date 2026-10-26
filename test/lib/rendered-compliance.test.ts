import { describe, expect, it } from "vitest";
import {
  classifyColor,
  classifyFont,
  evaluateRenderedCompliance,
  isGenericFamily,
  matchBrandFont,
  parseFontStack,
  type BrandForRender,
  type RenderMeasurement,
  type RenderedElement,
} from "../../src/lib/rendered-compliance.js";
import { parseHex } from "../../src/lib/color-metrics.js";

const BRAND: BrandForRender = {
  palette: [
    { name: "Navy Blue", hex: "#2a4494" },
    { name: "Coral Red", hex: "#e8523f" },
    { name: "Gold", hex: "#f5a623" },
  ],
  fonts: ["Inter"],
  clientName: "Fixture Brand",
};

const WHITE = "rgb(255, 255, 255)";

function el(overrides: Partial<RenderedElement> = {}): RenderedElement {
  return {
    locator: "main > p",
    tag: "p",
    text: "Hello",
    textLength: 5,
    color: "rgb(42, 68, 148)",
    bgLayers: ["rgba(0, 0, 0, 0)", WHITE],
    bgImage: false,
    borderColors: [],
    fontFamily: "Inter, sans-serif",
    renderedFamily: "Inter",
    fontSize: 16,
    fontWeight: 400,
    ...overrides,
  };
}

function page(elements: RenderedElement[], logo = true): RenderMeasurement {
  return {
    viewport: { width: 1280, height: 800 },
    elements,
    truncated: false,
    logo: { detected: logo, evidence: logo ? "svg labelled as logo/brand" : undefined, failedToLoad: 0 },
    brandNameVisible: true,
  };
}

describe("font matching", () => {
  it("parses quoted font stacks", () => {
    expect(parseFontStack(`"Founders Grotesk", 'Inter Variable', sans-serif`)).toEqual([
      "Founders Grotesk",
      "Inter Variable",
      "sans-serif",
    ]);
  });

  it("matches packaging variants of the brand face but not different typefaces", () => {
    expect(matchBrandFont("Inter", ["Inter"])).toBe("Inter");
    expect(matchBrandFont("inter", ["Inter"])).toBe("Inter");
    expect(matchBrandFont("Inter Variable", ["Inter"])).toBe("Inter");
    expect(matchBrandFont("FoundersGrotesk", ["Founders Grotesk"])).toBe("Founders Grotesk");
    expect(matchBrandFont("Interstate", ["Inter"])).toBeNull();
    expect(matchBrandFont("Inter Tight", ["Inter"])).toBeNull();
  });

  it("recognizes generic families", () => {
    expect(isGenericFamily("sans-serif")).toBe(true);
    expect(isGenericFamily("system-ui")).toBe(true);
    expect(isGenericFamily("Inter")).toBe(false);
  });

  it("classifies by the face that actually renders, respecting fallbacks", () => {
    // Brand font renders; fallbacks after it are irrelevant
    expect(classifyFont("Inter, Arial, sans-serif", "Inter", ["Inter"]).status).toBe("brand");
    // Brand font declared first but not available → fell back
    expect(classifyFont("Inter, sans-serif", "sans-serif", ["Inter"]).status).toBe("unavailable");
    // A non-brand family ahead of the brand font wins
    expect(classifyFont("Arial, Inter, sans-serif", "Arial", ["Inter"]).status).toBe("shadowed");
    // Non-brand family ahead of the brand font but itself unavailable → brand intent
    expect(classifyFont("Missing Font, Inter, sans-serif", "sans-serif", ["Inter"]).status).toBe("unavailable");
    // No brand font anywhere
    expect(classifyFont("Comic Sans MS, cursive", "cursive", ["Inter"]).status).toBe("off");
  });
});

describe("color classification", () => {
  it("treats exact and JND-close colors as brand", () => {
    expect(classifyColor(parseHex("#2a4494")!, BRAND.palette).status).toBe("brand");
    expect(classifyColor(parseHex("#2b4595")!, BRAND.palette).status).toBe("brand");
  });

  it("treats near-gray colors as neutral", () => {
    expect(classifyColor(parseHex("#333333")!, BRAND.palette).status).toBe("neutral");
    expect(classifyColor(parseHex("#fafafa")!, BRAND.palette).status).toBe("neutral");
  });

  it("flags near and off-palette colors with the nearest brand value", () => {
    const near = classifyColor(parseHex("#33509f")!, BRAND.palette);
    expect(near.status).toBe("near");
    expect(near.nearest?.name).toBe("Navy Blue");

    const off = classifyColor(parseHex("#00ff00")!, BRAND.palette);
    expect(off.status).toBe("off");
    expect(off.deltaE).toBeGreaterThan(15);
  });
});

describe("evaluateRenderedCompliance", () => {
  it("passes an on-brand page", () => {
    const result = evaluateRenderedCompliance(
      page([
        el({ locator: "body", tag: "body", textLength: 0, text: undefined, bgLayers: [WHITE] }),
        el({ locator: "h1", tag: "h1", fontSize: 32, fontWeight: 700 }),
        el({ locator: "a.cta", color: WHITE, bgLayers: ["rgb(42, 68, 148)"], borderColors: ["rgb(42, 68, 148)"] }),
        el({ color: "rgb(51, 51, 51)" }),
      ]),
      BRAND,
    );
    expect(result.overall).toBe("PASS");
    expect(result.score).toBe(100);
    expect(result.findings).toEqual([]);
    expect(result.measured.fonts_rendered[0]).toMatchObject({ family: "Inter", brand: true });
    expect(result.measured.colors.background.map((c) => c.hex)).toContain("#2a4494");
  });

  it("flags off-palette colors with nearest brand value and aggregates repeats", () => {
    const result = evaluateRenderedCompliance(
      page([
        el({ locator: "h2:nth-of-type(1)", color: "rgb(0, 100, 0)" }),
        el({ locator: "h2:nth-of-type(2)", color: "rgb(0, 100, 0)" }),
        el({ locator: "div.box", textLength: 0, text: undefined, bgLayers: ["rgb(51, 80, 159)"] }),
      ]),
      BRAND,
    );
    const off = result.findings.find((f) => f.rule === "R-COLOR" && f.kind === "text");
    expect(off).toMatchObject({ severity: "error", measured: "#006400", occurrences: 2, locator: "h2:nth-of-type(1)" });
    expect(off?.expected).toMatch(/#/);
    const near = result.findings.find((f) => f.rule === "R-COLOR" && f.kind === "background");
    expect(near).toMatchObject({ severity: "info", measured: "#33509f", expected: "Navy Blue #2a4494" });
    expect(result.overall).toBe("FAIL");
    expect(result.subscores.color).toBeLessThan(100);
  });

  it("demotes far off-palette errors to advisory warnings while the primary is unconfirmed", () => {
    const result = evaluateRenderedCompliance(page([el({ color: "rgb(0, 100, 0)" })]), {
      ...BRAND,
      colorAdvisory: true,
    });
    const off = result.findings.find((f) => f.rule === "R-COLOR");
    expect(off).toMatchObject({ severity: "warning", advisory: true });
    expect(result.overall).toBe("WARN");
  });

  it("measures contrast on composited fg/bg and applies the large-text threshold", () => {
    const result = evaluateRenderedCompliance(
      page([
        // #777 on white — 4.48:1, fails AA for body text
        el({ locator: "p.muted", color: "rgb(119, 119, 119)" }),
        // Same color at 32px passes the 3:1 large-text threshold
        el({ locator: "h1", color: "rgb(119, 119, 119)", fontSize: 32 }),
        // Translucent white text over a light parent → fails
        el({ locator: "span.ghost", color: "rgba(255, 255, 255, 0.9)", bgLayers: ["rgba(0,0,0,0)", "rgb(245, 166, 35)"] }),
        // Text over a background image → indeterminate, not judged
        el({ locator: "div.hero", color: WHITE, bgImage: true, bgLayers: [WHITE] }),
      ]),
      BRAND,
    );
    const contrast = result.findings.filter((f) => f.rule === "R-CONTRAST");
    expect(contrast.map((f) => f.locator).sort()).toEqual(["p.muted", "span.ghost"]);
    expect(contrast.find((f) => f.locator === "p.muted")).toMatchObject({
      severity: "error",
      measured: "#777777 on #ffffff = 4.47:1",
      expected: ">= 4.5:1 (WCAG AA)",
    });
    expect(result.measured.contrast_indeterminate).toBe(1);
    expect(result.subscores.contrast).toBe(33); // 1 of 3 measurable passes
  });

  it("flags non-brand fonts and explains unavailable brand fonts as info", () => {
    const result = evaluateRenderedCompliance(
      page([
        el({ locator: "p.a", fontFamily: "Georgia, serif", renderedFamily: "Georgia" }),
        el({ locator: "p.b", fontFamily: "Inter, sans-serif", renderedFamily: "sans-serif" }),
        el({ locator: "p.c", fontFamily: "Arial, Inter", renderedFamily: "Arial" }),
      ]),
      BRAND,
    );
    const fonts = result.findings.filter((f) => f.rule === "R-FONT");
    expect(fonts.find((f) => f.locator === "p.a")).toMatchObject({ severity: "warning", measured: "Georgia", expected: "Inter" });
    expect(fonts.find((f) => f.locator === "p.b")).toMatchObject({ severity: "info", measured: "sans-serif (generic)" });
    expect(fonts.find((f) => f.locator === "p.c")).toMatchObject({ severity: "warning", measured: "Arial" });
    expect(result.subscores.typography).toBe(33);
  });

  it("warns on a missing logo only when the brand name is rendered as text", () => {
    const withName = evaluateRenderedCompliance(page([el()], false), BRAND);
    expect(withName.findings.find((f) => f.rule === "R-LOGO")?.severity).toBe("warning");
    const noName = evaluateRenderedCompliance({ ...page([el()], false), brandNameVisible: false }, BRAND);
    expect(noName.findings.find((f) => f.rule === "R-LOGO")?.severity).toBe("info");
  });

  it("skips color/font scoring when the brand defines none, and flattens untrusted strings", () => {
    const result = evaluateRenderedCompliance(
      page([el({ color: "rgb(0, 100, 0)", locator: "p\n\u0000injected", text: "line1\nline2" })]),
      { palette: [], fonts: [], clientName: "" },
    );
    expect(result.subscores.color).toBeNull();
    expect(result.subscores.typography).toBeNull();
    expect(result.findings.filter((f) => f.rule === "R-COLOR" || f.rule === "R-FONT")).toEqual([]);
    expect(result.score).toBe(100); // contrast only
    expect(JSON.stringify(result)).not.toMatch(/\\n|\\u0000/);
  });
});
