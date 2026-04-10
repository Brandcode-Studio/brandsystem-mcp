import { describe, it, expect } from "vitest";
import { buildDesignSynthesis, renderDesignMarkdown } from "../../src/lib/design-synthesis.js";
import type { BrandConfigData, CoreIdentityData } from "../../src/schemas/index.js";
import type { ExtractionEvidenceFile } from "../../src/lib/site-evidence.js";

const config: BrandConfigData = {
  schema_version: "0.1.0",
  session: 1,
  client_name: "Acme",
  website_url: "https://acme.test",
  created_at: "2026-04-10T00:00:00.000Z",
};

const identity: CoreIdentityData = {
  schema_version: "0.1.0",
  colors: [
    { name: "Brand Blue", value: "#2665fd", role: "primary", source: "web", confidence: "high" },
    { name: "Canvas", value: "#ffffff", role: "surface", source: "web", confidence: "high" },
    { name: "Ink", value: "#111111", role: "text", source: "web", confidence: "high" },
  ],
  typography: [
    { name: "Heading", family: "Inter", weight: 700, source: "web", confidence: "high" },
    { name: "Body", family: "Inter", weight: 400, source: "web", confidence: "high" },
  ],
  logo: [],
  spacing: null,
};

const evidence: ExtractionEvidenceFile = {
  schema_version: "0.4.0",
  source_url: "https://acme.test",
  discovered_pages: 3,
  selected_pages: [
    {
      url: "https://acme.test",
      page_type: "home",
      selection_reason: "homepage baseline",
      priority: 100,
      title: "Acme",
      viewports: [
        {
          viewport: "desktop",
          screenshot_asset: "assets/evidence/home-desktop.png",
          computed_elements: [
            {
              selector: "hero_heading",
              color: "#111111",
              backgroundColor: "transparent",
              fontFamily: "Inter",
              fontSize: "56px",
              fontWeight: "700",
              lineHeight: "60px",
              letterSpacing: "-1px",
              borderColor: "transparent",
              borderRadius: "0px",
              boxShadow: "none",
              maxWidth: "1200px",
              paddingInline: "0px",
              paddingBlock: "0px",
            },
            {
              selector: "primary_button",
              color: "#ffffff",
              backgroundColor: "#2665fd",
              fontFamily: "Inter",
              fontSize: "16px",
              fontWeight: "600",
              lineHeight: "20px",
              letterSpacing: "0px",
              borderColor: "#2665fd",
              borderRadius: "12px",
              boxShadow: "0px 8px 24px rgba(38, 101, 253, 0.24)",
              maxWidth: "none",
              paddingInline: "24px",
              paddingBlock: "12px",
            },
            {
              selector: "card",
              color: "#111111",
              backgroundColor: "#ffffff",
              fontFamily: "Inter",
              fontSize: "16px",
              fontWeight: "400",
              lineHeight: "24px",
              letterSpacing: "0px",
              borderColor: "#e5e7eb",
              borderRadius: "16px",
              boxShadow: "0px 12px 36px rgba(17, 17, 17, 0.08)",
              maxWidth: "480px",
              paddingInline: "24px",
              paddingBlock: "24px",
            },
          ],
          css_custom_properties: {
            "--radius-sm": "8px",
            "--radius-lg": "16px",
            "--space-2": "8px",
            "--space-6": "24px",
            "--space-20": "80px",
            "--container-max-width": "1200px",
            "--shadow-soft": "0px 8px 24px rgba(17, 17, 17, 0.08)",
            "--duration-fast": "160ms",
            "--ease-standard": "cubic-bezier(0.2, 0.8, 0.2, 1)",
          },
          unique_colors: ["#2665fd", "#ffffff", "#111111"],
          unique_fonts: ["Inter"],
          role_candidates: [],
        },
      ],
    },
  ],
  site_summary: {
    page_types: ["home"],
    viewports: ["desktop"],
    aggregated_colors: ["#2665fd", "#ffffff", "#111111"],
    aggregated_fonts: ["Inter"],
  },
};

describe("buildDesignSynthesis", () => {
  it("captures radius, shadow, layout, motion, and personality signals from evidence", () => {
    const synthesis = buildDesignSynthesis(config, identity, { evidence, source: "evidence" });

    expect(synthesis.source).toBe("evidence");
    expect(synthesis.shape.radius_scale.length).toBeGreaterThan(0);
    expect(synthesis.depth.shadow_scale.length).toBeGreaterThan(0);
    expect(synthesis.layout.content_width).toBe("1200px");
    expect(synthesis.motion.duration_tokens.length).toBeGreaterThan(0);
    expect(synthesis.colors.mood.contrast).toBe("high");
    expect(synthesis.personality.adjectives.length).toBeGreaterThan(0);
  });

  it("falls back to current-brand mode when no evidence is provided", () => {
    const synthesis = buildDesignSynthesis(config, identity, { source: "current-brand" });

    expect(synthesis.source).toBe("current-brand");
    expect(synthesis.evidence.pages_sampled).toBe(0);
    expect(synthesis.ambiguities.some((item) => item.includes("No extraction-evidence.json"))).toBe(true);
  });
});

describe("renderDesignMarkdown", () => {
  it("renders the expected DESIGN.md sections", () => {
    const synthesis = buildDesignSynthesis(config, identity, { evidence, source: "evidence" });
    const markdown = renderDesignMarkdown(synthesis);

    expect(markdown).toContain("# DESIGN.md");
    expect(markdown).toContain("## 1. Visual Theme and Atmosphere");
    expect(markdown).toContain("## 2. Color Palette and Roles");
    expect(markdown).toContain("## 9. Agent Prompt Guide");
    expect(markdown).toContain("Acme");
  });
});
