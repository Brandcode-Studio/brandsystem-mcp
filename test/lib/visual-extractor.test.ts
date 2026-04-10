import { describe, it, expect } from "vitest";
import {
  classifyPageType,
  findChrome,
  isVisualExtractionAvailable,
  inferRolesFromVisual,
  selectRepresentativePages,
  type ComputedElement,
} from "../../src/lib/visual-extractor.js";

// ---------------------------------------------------------------------------
// Chrome finder
// ---------------------------------------------------------------------------

describe("findChrome", () => {
  it("returns a string path or null", () => {
    const result = findChrome();
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("isVisualExtractionAvailable matches findChrome", () => {
    expect(isVisualExtractionAvailable()).toBe(findChrome() !== null);
  });
});

describe("site page discovery heuristics", () => {
  it("classifies page types from URL paths", () => {
    expect(classifyPageType("https://example.com/")).toBe("home");
    expect(classifyPageType("https://example.com/pricing")).toBe("marketing");
    expect(classifyPageType("https://example.com/docs/getting-started")).toBe("content");
    expect(classifyPageType("https://example.com/about")).toBe("company");
    expect(classifyPageType("https://example.com/login")).toBe("app");
  });

  it("selects representative pages with home first and varied page types", () => {
    const pages = selectRepresentativePages("https://example.com", [
      "https://example.com/",
      "https://example.com/pricing",
      "https://example.com/docs/getting-started",
      "https://example.com/about",
      "https://example.com/login",
      "https://example.com/security",
      "https://example.com/blog/launch",
    ], 5);

    expect(pages[0]?.pageType).toBe("home");
    expect(pages.length).toBeLessThanOrEqual(5);
    expect(pages.some((page) => page.pageType === "marketing")).toBe(true);
    expect(pages.some((page) => page.pageType === "content")).toBe(true);
    expect(pages.some((page) => page.pageType === "company")).toBe(true);
    expect(pages.some((page) => page.pageType === "app")).toBe(true);
  });

  it("filters out cross-origin and asset URLs during representative selection", () => {
    const pages = selectRepresentativePages("https://example.com", [
      "https://example.com/",
      "https://cdn.example.com/logo.svg",
      "https://other.com/pricing",
      "mailto:hello@example.com",
      "https://example.com/features",
    ], 5);

    expect(pages.some((page) => page.url.includes("other.com"))).toBe(false);
    expect(pages.some((page) => page.url.endsWith(".svg"))).toBe(false);
    expect(pages.some((page) => page.url.startsWith("mailto:"))).toBe(false);
    expect(pages.some((page) => page.url === "https://example.com/features")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Visual role inference
// ---------------------------------------------------------------------------

describe("inferRolesFromVisual", () => {
  const makeElement = (overrides: Partial<ComputedElement>): ComputedElement => ({
    selector: "body",
    color: "#333333",
    backgroundColor: "#ffffff",
    fontFamily: "Inter",
    fontSize: "16px",
    fontWeight: "400",
    borderColor: "transparent",
    borderRadius: "0px",
    ...overrides,
  });

  it("infers surface from body background", () => {
    const elements = [makeElement({ selector: "body", backgroundColor: "#f5f5f5" })];
    const roles = inferRolesFromVisual(elements);
    const surface = roles.find((r) => r.role === "surface");
    expect(surface).toBeDefined();
    expect(surface!.hex).toBe("#f5f5f5");
    expect(surface!.confidence).toBe("high");
  });

  it("infers text from body color", () => {
    const elements = [makeElement({ selector: "body", color: "#1a1a1a" })];
    const roles = inferRolesFromVisual(elements);
    const text = roles.find((r) => r.role === "text");
    expect(text).toBeDefined();
    expect(text!.hex).toBe("#1a1a1a");
  });

  it("infers primary from button background", () => {
    const elements = [makeElement({ selector: "primary_button", backgroundColor: "#2665fd", color: "#ffffff" })];
    const roles = inferRolesFromVisual(elements);
    const primary = roles.find((r) => r.role === "primary");
    expect(primary).toBeDefined();
    expect(primary!.hex).toBe("#2665fd");
    expect(primary!.confidence).toBe("high");
  });

  it("infers accent from link color", () => {
    const elements = [makeElement({ selector: "link", color: "#0066cc" })];
    const roles = inferRolesFromVisual(elements);
    const accent = roles.find((r) => r.role === "accent");
    expect(accent).toBeDefined();
    expect(accent!.hex).toBe("#0066cc");
  });

  it("skips transparent backgrounds", () => {
    const elements = [makeElement({ selector: "primary_button", backgroundColor: "transparent", color: "#2665fd" })];
    const roles = inferRolesFromVisual(elements);
    // Should fall through to color-based primary detection
    const primary = roles.find((r) => r.role === "primary");
    expect(primary).toBeDefined();
    expect(primary!.hex).toBe("#2665fd");
    expect(primary!.confidence).toBe("medium"); // lower confidence from text color
  });

  it("skips neutral colors for non-surface/text roles", () => {
    const elements = [
      makeElement({ selector: "primary_button", backgroundColor: "#ffffff", color: "#000000" }),
    ];
    const roles = inferRolesFromVisual(elements);
    // White button bg should NOT be inferred as primary
    const primary = roles.find((r) => r.role === "primary");
    expect(primary).toBeUndefined();
  });

  it("handles empty elements array", () => {
    const roles = inferRolesFromVisual([]);
    expect(roles).toEqual([]);
  });

  it("deduplicates same hex + role combination", () => {
    const elements = [
      makeElement({ selector: "body", color: "#333333" }),
      makeElement({ selector: "hero_heading", color: "#333333" }),
    ];
    const roles = inferRolesFromVisual(elements);
    const textRoles = roles.filter((r) => r.role === "text" && r.hex === "#333333");
    expect(textRoles.length).toBe(1);
  });

  it("infers secondary from alternate section background", () => {
    const elements = [makeElement({ selector: "section_alt", backgroundColor: "#4a90d9" })];
    const roles = inferRolesFromVisual(elements);
    const secondary = roles.find((r) => r.role === "secondary");
    expect(secondary).toBeDefined();
    expect(secondary!.hex).toBe("#4a90d9");
  });

  it("infers surface from footer background", () => {
    const elements = [makeElement({ selector: "footer", backgroundColor: "#1a1a2e" })];
    const roles = inferRolesFromVisual(elements);
    const surface = roles.find((r) => r.role === "surface");
    expect(surface).toBeDefined();
  });

  it("handles a realistic multi-element extraction", () => {
    const elements: ComputedElement[] = [
      makeElement({ selector: "body", backgroundColor: "#ffffff", color: "#333333" }),
      makeElement({ selector: "header", backgroundColor: "#ffffff", color: "#333333" }),
      makeElement({ selector: "hero_heading", color: "#111111", fontSize: "48px", fontWeight: "700" }),
      makeElement({ selector: "primary_button", backgroundColor: "#2665fd", color: "#ffffff" }),
      makeElement({ selector: "link", color: "#0066cc" }),
      makeElement({ selector: "footer", backgroundColor: "#1a1a2e", color: "#cccccc" }),
    ];

    const roles = inferRolesFromVisual(elements);

    // Should have primary, surface, text, accent
    expect(roles.some((r) => r.role === "primary")).toBe(true);
    expect(roles.some((r) => r.role === "surface")).toBe(true);
    expect(roles.some((r) => r.role === "text")).toBe(true);
    expect(roles.some((r) => r.role === "accent")).toBe(true);

    // Primary should be the button blue
    const primary = roles.find((r) => r.role === "primary");
    expect(primary!.hex).toBe("#2665fd");
  });

  it("infers primary from dark button on light surface (Basecamp pattern)", () => {
    const elements: ComputedElement[] = [
      makeElement({ selector: "body", backgroundColor: "#ffffff", color: "#0b1215" }),
      makeElement({ selector: "primary_button", backgroundColor: "#0b1215", color: "#ffffff" }),
    ];
    const roles = inferRolesFromVisual(elements);
    const primary = roles.find((r) => r.role === "primary");
    expect(primary).toBeDefined();
    expect(primary!.hex).toBe("#0b1215");
    expect(primary!.confidence).toBe("medium");
  });

  it("infers roles from CSS custom property names", () => {
    const elements = [makeElement({ selector: "body", backgroundColor: "#ffffff", color: "#333333" })];
    const cssProps = {
      "--color-highlight": "#fde047",
      "--color-blurple": "#5522fa",
      "--color-primary": "#ff6600",
      "--color-accent": "#00ccff",
      "--box-shadow-letter": "#0b1215", // should be skipped
    };
    const roles = inferRolesFromVisual(elements, cssProps);

    // --color-primary → primary
    expect(roles.some((r) => r.role === "primary" && r.hex === "#ff6600")).toBe(true);
    // --color-accent → accent
    expect(roles.some((r) => r.role === "accent" && r.hex === "#00ccff")).toBe(true);
    // --color-highlight → accent
    expect(roles.some((r) => r.role === "accent" && r.hex === "#fde047")).toBe(true);
    // --color-blurple → unknown (named color)
    expect(roles.some((r) => r.hex === "#5522fa")).toBe(true);
    // --box-shadow-letter → should be skipped
    expect(roles.some((r) => r.source_context.includes("box-shadow"))).toBe(false);
  });
});
