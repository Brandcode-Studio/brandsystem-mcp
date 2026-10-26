import { describe, expect, it } from "vitest";
import {
  ciede2000,
  compositeOver,
  contrastRatio,
  deltaE2000,
  flattenBackground,
  isLargeText,
  nearestPaletteColor,
  parseCssColor,
  parseHex,
  requiredContrastAA,
  toHex,
} from "../../src/lib/color-metrics.js";

describe("parseCssColor", () => {
  it("parses computed rgb/rgba in comma and space syntax", () => {
    expect(parseCssColor("rgb(42, 68, 148)")).toEqual({ r: 42, g: 68, b: 148, a: 1 });
    expect(parseCssColor("rgba(0, 0, 0, 0.5)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor("rgb(10 20 30 / 25%)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
  });

  it("parses hex (3/4/6/8 digit), color(srgb ...), and transparent", () => {
    expect(parseCssColor("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
    expect(parseHex("#2a449480")?.a).toBeCloseTo(0x80 / 255, 5);
    expect(parseCssColor("color(srgb 1 0 0.5)")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null for unparseable values", () => {
    expect(parseCssColor("oklch(0.5 0.1 200)")).toBeNull();
    expect(parseCssColor("not-a-color")).toBeNull();
    expect(parseHex("#12")).toBeNull();
  });
});

describe("CIEDE2000", () => {
  // Reference pairs from Sharma, Wu & Dalal (2005), Table 1.
  const pairs: Array<[[number, number, number], [number, number, number], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  ];

  it.each(pairs)("matches the published reference value (%j vs %j)", (l1, l2, expected) => {
    const d = ciede2000({ L: l1[0], a: l1[1], b: l1[2] }, { L: l2[0], a: l2[1], b: l2[2] });
    expect(d).toBeCloseTo(expected, 3);
  });

  it("is symmetric and zero for identical colors", () => {
    const a = parseHex("#2a4494")!;
    const b = parseHex("#e8523f")!;
    expect(deltaE2000(a, a)).toBeCloseTo(0, 10);
    expect(deltaE2000(a, b)).toBeCloseTo(deltaE2000(b, a), 10);
  });

  it("finds the nearest palette entry", () => {
    const palette = [
      { name: "Navy", hex: "#2a4494" },
      { name: "Coral", hex: "#e8523f" },
    ];
    const near = nearestPaletteColor(parseHex("#2b4596")!, palette);
    expect(near?.entry.name).toBe("Navy");
    expect(near!.deltaE).toBeLessThan(1);
    expect(nearestPaletteColor(parseHex("#fff")!, [])).toBeNull();
  });
});

describe("WCAG contrast", () => {
  it("computes the canonical ratios", () => {
    expect(contrastRatio(parseHex("#000")!, parseHex("#fff")!)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#fff")!, parseHex("#fff")!)).toBeCloseTo(1, 5);
    // #777 on white is the classic just-below-AA gray (4.48:1)
    expect(contrastRatio(parseHex("#777777")!, parseHex("#ffffff")!)).toBeCloseTo(4.48, 2);
    expect(contrastRatio(parseHex("#767676")!, parseHex("#ffffff")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the large-text threshold at 24px, or 18.66px bold", () => {
    expect(isLargeText(24, 400)).toBe(true);
    expect(isLargeText(19, 700)).toBe(true);
    expect(isLargeText(19, 400)).toBe(false);
    expect(requiredContrastAA(16, 400)).toBe(4.5);
    expect(requiredContrastAA(32, 400)).toBe(3);
  });
});

describe("compositing", () => {
  it("composites translucent layers over an opaque base", () => {
    const half = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
    expect(toHex(half)).toBe("#808080");
  });

  it("flattens a background stack, stopping at the first opaque layer", () => {
    const stack = [
      { r: 0, g: 0, b: 0, a: 0 }, // element: transparent
      { r: 255, g: 0, b: 0, a: 0.5 }, // parent: translucent red
      { r: 0, g: 0, b: 255, a: 1 }, // grandparent: opaque blue
      { r: 0, g: 255, b: 0, a: 1 }, // ignored
    ];
    expect(toHex(flattenBackground(stack))).toBe("#800080");
    // No opaque layer → white canvas base
    expect(toHex(flattenBackground([{ r: 0, g: 0, b: 0, a: 0 }]))).toBe("#ffffff");
  });
});
