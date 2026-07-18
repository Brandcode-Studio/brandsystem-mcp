import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBrandCheck, getBrandPalette, invalidateCheckCache } from "../../src/lib/brand-check-engine.js";

// ---------------------------------------------------------------------------
// Fixture: a .brand/ directory with runtime + policy
// ---------------------------------------------------------------------------

const TEST_DIR = join(tmpdir(), `brand-check-test-${Date.now()}`);
const BRAND_DIR = join(TEST_DIR, ".brand");

const RUNTIME = {
  version: "0.1.0",
  client_name: "Test Brand",
  compiled_at: new Date().toISOString(),
  sessions_completed: 3,
  identity: {
    colors: {
      primary: "#2a4494",
      secondary: "#e8523f",
      accent: "#f5a623",
    },
    // Dark-theme palette (issue #35 gap 1): legitimate brand colors that must
    // count as on-palette alongside the default/light lane.
    colors_dark: {
      surface: "#0f0f1a",
    },
    typography: {
      Heading: "Inter",
      Body: "Source Sans Pro",
    },
    logo: { type: "wordmark", has_svg: true },
  },
  visual: {
    composition: { energy: "balanced", grid: "8px", layout: "structured" },
    signature: null,
    anti_patterns: ["No drop shadows"],
  },
  voice: {
    tone_descriptors: ["clear", "confident", "warm"],
    register: "professional peer",
    never_sounds_like: "corporate jargon",
    anchor_terms: {
      // use → not (the runtime format: { "preferred_word": "word_it_replaces" })
      "use": "leverage",
      "build": "craft",
    },
    never_say: ["synergy", "disrupt", "paradigm"],
    jargon_policy: "define on first use",
    ai_ism_patterns: ["in today's", "let's dive in", "at the end of the day", "it's worth noting"],
    conventions: { person: "we", reader_address: "you", oxford_comma: true, sentence_length: 18 },
  },
  strategy: null,
};

const POLICY = {
  version: "0.1.0",
  compiled_at: new Date().toISOString(),
  visual_rules: [
    { id: "visual-1", rule: "No drop shadows", severity: "hard", category: "visual" },
    { id: "visual-2", rule: "No gradient backgrounds", severity: "soft", category: "visual" },
  ],
  voice_rules: {
    never_say: ["synergy", "disrupt", "paradigm"],
    ai_ism_patterns: ["in today's", "let's dive in", "at the end of the day", "it's worth noting"],
    tone_constraints: { never_sounds_like: "corporate jargon", avoid_patterns: [] },
    sentence_patterns: null,
  },
  content_rules: { claims_policies: [], persona_count: 0 },
};

beforeAll(async () => {
  invalidateCheckCache();
  await mkdir(BRAND_DIR, { recursive: true });
  await writeFile(join(BRAND_DIR, "brand-runtime.json"), JSON.stringify(RUNTIME));
  await writeFile(join(BRAND_DIR, "interaction-policy.json"), JSON.stringify(POLICY));
});

afterAll(async () => {
  invalidateCheckCache();
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Text checks
// ---------------------------------------------------------------------------

describe("text checks", () => {
  it("passes clean text", async () => {
    const result = await runBrandCheck(TEST_DIR, { text: "We build great products for you." });
    expect(result).not.toBeNull();
    expect(result!.pass).toBe(true);
    expect(result!.flags).toHaveLength(0);
    expect(result!.checked).toContain("text");
  });

  it("flags never-say words", async () => {
    const result = await runBrandCheck(TEST_DIR, { text: "Our synergy with clients creates real disrupt." });
    expect(result!.pass).toBe(false);
    const neverSayFlags = result!.flags.filter((f) => f.type === "never_say");
    expect(neverSayFlags.length).toBe(2); // synergy + disrupt
    expect(neverSayFlags[0].fix).toBeDefined();
  });

  it("flags anchor term misuse", async () => {
    const result = await runBrandCheck(TEST_DIR, { text: "We leverage our experience to craft solutions." });
    expect(result!.pass).toBe(false);
    const anchorFlags = result!.flags.filter((f) => f.type === "anchor_term");
    expect(anchorFlags.length).toBe(2); // leverage → use, craft → build
    expect(anchorFlags[0].fix).toContain("use");
    expect(anchorFlags[1].fix).toContain("build");
  });

  it("flags AI-isms", async () => {
    const result = await runBrandCheck(TEST_DIR, { text: "In today's landscape, let's dive in to what matters." });
    expect(result!.pass).toBe(false);
    const aiFlags = result!.flags.filter((f) => f.type === "ai_ism");
    expect(aiFlags.length).toBe(2); // "in today's" + "let's dive in"
  });

  it("catches multiple violation types in one pass", async () => {
    const result = await runBrandCheck(TEST_DIR, {
      text: "Let's dive in to the synergy we leverage.",
    });
    expect(result!.pass).toBe(false);
    const types = new Set(result!.flags.map((f) => f.type));
    expect(types.has("ai_ism")).toBe(true);
    expect(types.has("never_say")).toBe(true);
    expect(types.has("anchor_term")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Color checks
// ---------------------------------------------------------------------------

describe("color checks", () => {
  it("passes exact brand color", async () => {
    const result = await runBrandCheck(TEST_DIR, { color: "#2a4494" });
    expect(result!.pass).toBe(true);
    expect(result!.flags).toHaveLength(0);
  });

  it("passes neutral colors", async () => {
    const result = await runBrandCheck(TEST_DIR, { color: "#ffffff" });
    expect(result!.pass).toBe(true);
  });

  it("flags off-palette color with nearest match", async () => {
    const result = await runBrandCheck(TEST_DIR, { color: "#ff0000" });
    expect(result!.pass).toBe(false);
    expect(result!.flags).toHaveLength(1);
    expect(result!.flags[0].type).toBe("off_palette");
    expect(result!.flags[0].fix).toBeDefined();
    // Should suggest the nearest brand color
    expect(result!.flags[0].message).toContain("ΔE");
  });

  it("returns info for perceptually close colors (ΔE < 3)", async () => {
    // #2b4595 is very close to #2a4494
    const result = await runBrandCheck(TEST_DIR, { color: "#2b4595" });
    expect(result!.pass).toBe(true); // info severity = still passes
    expect(result!.flags).toHaveLength(1);
    expect(result!.flags[0].severity).toBe("info");
  });

  it("normalizes 3-char hex", async () => {
    const result = await runBrandCheck(TEST_DIR, { color: "#fff" });
    expect(result!.pass).toBe(true);
  });

  it("passes an exact dark-theme brand color (colors_dark counts as on-palette)", async () => {
    const result = await runBrandCheck(TEST_DIR, { color: "#0f0f1a" });
    expect(result!.pass).toBe(true);
    expect(result!.flags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Font checks
// ---------------------------------------------------------------------------

describe("font checks", () => {
  it("passes brand font", async () => {
    const result = await runBrandCheck(TEST_DIR, { font: "Inter" });
    expect(result!.pass).toBe(true);
  });

  it("passes brand font case-insensitive", async () => {
    const result = await runBrandCheck(TEST_DIR, { font: "source sans pro" });
    expect(result!.pass).toBe(true);
  });

  it("passes system fonts", async () => {
    const result = await runBrandCheck(TEST_DIR, { font: "sans-serif" });
    expect(result!.pass).toBe(true);
  });

  it("flags non-brand font", async () => {
    const result = await runBrandCheck(TEST_DIR, { font: "Playfair Display" });
    expect(result!.pass).toBe(false);
    expect(result!.flags[0].type).toBe("non_brand_font");
    expect(result!.flags[0].fix).toContain("Inter");
  });
});

// ---------------------------------------------------------------------------
// CSS checks
// ---------------------------------------------------------------------------

describe("css checks", () => {
  it("passes clean CSS", async () => {
    const result = await runBrandCheck(TEST_DIR, { css: "color: #2a4494; font-family: Inter;" });
    expect(result!.pass).toBe(true);
  });

  it("flags box-shadow (hard anti-pattern)", async () => {
    const result = await runBrandCheck(TEST_DIR, { css: "box-shadow: 0 2px 4px rgba(0,0,0,0.1);" });
    expect(result!.pass).toBe(false);
    expect(result!.flags[0].type).toBe("anti_pattern");
    expect(result!.flags[0].severity).toBe("error"); // hard rule
  });

  it("flags gradient (soft anti-pattern)", async () => {
    const result = await runBrandCheck(TEST_DIR, {
      css: "background: linear-gradient(to right, #2a4494, #e8523f);",
    });
    expect(result!.pass).toBe(false);
    expect(result!.flags[0].severity).toBe("warning"); // soft rule
  });
});

// ---------------------------------------------------------------------------
// Multi-input checks
// ---------------------------------------------------------------------------

describe("multi-input checks", () => {
  it("checks all inputs in one call", async () => {
    const result = await runBrandCheck(TEST_DIR, {
      text: "We use great products.",
      color: "#2a4494",
      font: "Inter",
      css: "color: red;",
    });
    expect(result!.checked).toEqual(["text", "color", "font", "css"]);
    expect(result!.pass).toBe(true);
  });

  it("fails if any input fails", async () => {
    const result = await runBrandCheck(TEST_DIR, {
      text: "We use great products.", // passes
      color: "#ff0000", // fails
    });
    expect(result!.pass).toBe(false);
    expect(result!.checked).toEqual(["text", "color"]);
  });
});

// ---------------------------------------------------------------------------
// Palette helper
// ---------------------------------------------------------------------------

describe("getBrandPalette", () => {
  it("returns brand colors from both theme lanes", async () => {
    const palette = await getBrandPalette(TEST_DIR);
    expect(palette).not.toBeNull();
    expect(palette!.length).toBe(4);
    expect(palette!.map((c) => c.name)).toContain("primary");
    expect(palette!.map((c) => c.hex)).toContain("#0f0f1a");
  });

  it("returns null when no brand data", async () => {
    const palette = await getBrandPalette("/tmp/nonexistent");
    expect(palette).toBeNull();
  });
});
