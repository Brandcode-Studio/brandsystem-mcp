import { z } from "zod";
import * as cheerio from "cheerio";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { extractFromCSS, inferColorConfidence, inferColorRole, promotePrimaryColor, getTopChromaticCandidates } from "../lib/css-parser.js";
import { extractLogos, fetchLogo } from "../lib/logo-extractor.js";
import { resolveSvg, resolveImage } from "../lib/svg-resolver.js";
import { mergeColor, mergeTypography } from "../lib/confidence.js";
import { getVersion } from "../lib/version.js";
import { generateColorName, isCssArtifactName } from "../lib/color-namer.js";
import type { ColorEntry, TypographyEntry, LogoSpec, CoreIdentity } from "../types/index.js";

const paramsShape = {
  url: z.string().url().describe("Website URL to extract brand identity from"),
  logo_url: z.string().optional().describe("Direct URL to a logo SVG/PNG file. Use if automatic extraction didn't find the logo."),
};

async function handler(input: { url: string; logo_url?: string }) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init first to create the brand system"],
      data: { error: "not_initialized" },
    });
  }

  if (!input.url.startsWith("http://") && !input.url.startsWith("https://")) {
    return buildResponse({
      what_happened: "Only http:// and https:// URLs are supported",
      next_steps: ["Provide a URL starting with https://"],
      data: { error: "invalid_protocol" },
    });
  }

  let html: string;
  try {
    const response = await fetch(input.url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
    });
    if (!response.ok) {
      return buildResponse({
        what_happened: `Failed to fetch ${input.url} (HTTP ${response.status})`,
        next_steps: [
          "Check the URL is correct and publicly accessible (not behind a login)",
          "Try a different page URL on the same domain",
          "Try brand_extract_figma instead if you have a Figma file",
          "If this keeps happening, run brand_feedback to report the issue.",
        ],
        data: { error: "fetch_failed", status: response.status, statusText: response.statusText },
      });
    }
    html = await response.text();
  } catch (err) {
    return buildResponse({
      what_happened: `Failed to fetch ${input.url}`,
      next_steps: [
        "Check the URL is correct and publicly accessible (not behind a login)",
        "Try a different page URL on the same domain",
        "Try brand_extract_figma instead if you have a Figma file",
        "If this keeps happening, run brand_feedback to report the issue.",
      ],
      data: { error: "fetch_failed", details: String(err) },
    });
  }

  const $ = cheerio.load(html);

  // Extract CSS from <style> blocks and external stylesheets
  let allCSS = "";
  $("style").each((_, el) => {
    allCSS += $(el).text() + "\n";
  });

  const stylesheetUrls: string[] = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      try {
        const resolved = new URL(href, input.url).href;
        if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
          stylesheetUrls.push(resolved);
        }
      } catch {
        // Invalid URL — skip
      }
    }
  });

  for (const sheetUrl of stylesheetUrls.slice(0, 5)) {
    try {
      const resp = await fetch(sheetUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
      });
      allCSS += (await resp.text()) + "\n";
    } catch {
      // Skip failed stylesheets
    }
  }

  const { colors: extractedColors, fonts: extractedFonts } = extractFromCSS(allCSS);

  // Get top chromatic candidates BEFORE promotion (for confirmation flow)
  const chromaticCandidates = getTopChromaticCandidates(extractedColors);

  // Promote the most frequent chromatic color to primary if none was explicitly named
  const promotedColors = promotePrimaryColor(extractedColors);

  // Track what the auto-promoted primary was (if any)
  const autoPromoted = promotedColors.find(
    (c) => (c as unknown as { _promoted_role?: string })._promoted_role === "primary"
  );
  const suggestedPrimary = autoPromoted?.value ?? null;

  const identity = await brandDir.readCoreIdentity();
  let colors = [...identity.colors];

  for (const ec of promotedColors.slice(0, 20)) {
    const role = inferColorRole(ec as Parameters<typeof inferColorRole>[0]);
    const rawName = ec.property.startsWith("--")
      ? ec.property.replace(/^--/, "").replace(/[-_]/g, " ")
      : `${ec.property} ${ec.value}`;

    // Generate clean human-readable name
    const name = isCssArtifactName(rawName, ec.value)
      ? generateColorName(ec.value, role)
      : rawName;

    const entry: ColorEntry = {
      name,
      value: ec.value,
      role,
      source: "web",
      confidence: inferColorConfidence(ec),
      css_property: ec.property,
    };
    colors = mergeColor(colors, entry);
  }

  let typography = [...identity.typography];
  for (const ef of extractedFonts.slice(0, 5)) {
    const entry: TypographyEntry = {
      name: ef.family,
      family: ef.family,
      source: "web",
      confidence: ef.frequency >= 5 ? "high" : ef.frequency >= 2 ? "medium" : "low",
    };
    typography = mergeTypography(typography, entry);
  }

  // --- Logo extraction ---
  const logos: LogoSpec[] = [...identity.logo];
  let logoFound = false;

  // If logo_url is provided, use it directly (override auto-extraction)
  if (input.logo_url) {
    const fetched = await fetchLogo(input.logo_url);
    if (fetched) {
      const isSvg = fetched.contentType.includes("svg") || fetched.content.toString("utf-8").trim().startsWith("<");

      if (isSvg) {
        const svgContent = fetched.content.toString("utf-8");
        const { inline_svg, data_uri } = resolveSvg(svgContent);
        const filename = "logo-wordmark.svg";
        await brandDir.writeAsset(`logo/${filename}`, svgContent);

        logos.push({
          type: "wordmark",
          source: "web",
          confidence: "high",
          variants: [{
            name: "default",
            file: `logo/${filename}`,
            inline_svg,
            data_uri,
          }],
        });
        logoFound = true;
      } else {
        const { data_uri } = resolveImage(fetched.content, fetched.contentType);
        const ext = fetched.contentType.includes("png") ? "png" : "jpg";
        const filename = `logo-wordmark.${ext}`;
        await brandDir.writeAsset(`logo/${filename}`, fetched.content);

        logos.push({
          type: "wordmark",
          source: "web",
          confidence: "high",
          variants: [{ name: "default", file: `logo/${filename}`, data_uri }],
        });
        logoFound = true;
      }
    }
  }

  // Auto-extract logos from HTML only if no logo_url was provided
  if (!logoFound) {
    const logoCandidates = extractLogos(html, input.url);

    for (const candidate of logoCandidates.slice(0, 5)) {
      // Handle inline SVGs directly — no fetch needed
      if (candidate.inline_svg) {
        const { inline_svg, data_uri } = resolveSvg(candidate.inline_svg);
        const filename = `logo-${candidate.type}.svg`;
        await brandDir.writeAsset(`logo/${filename}`, candidate.inline_svg);

        logos.push({
          type: "wordmark",
          source: "web",
          confidence: candidate.confidence,
          variants: [{
            name: "default",
            file: `logo/${filename}`,
            inline_svg,
            data_uri,
          }],
        });
        logoFound = true;
        break;
      }

      // Fetch remote logos
      const fetched = await fetchLogo(candidate.url);
      if (!fetched) continue;

      const isSvg = fetched.contentType.includes("svg") || fetched.content.toString("utf-8").trim().startsWith("<");

      if (isSvg) {
        const svgContent = fetched.content.toString("utf-8");
        const { inline_svg, data_uri } = resolveSvg(svgContent);
        const filename = `logo-${candidate.type}.svg`;
        await brandDir.writeAsset(`logo/${filename}`, svgContent);

        logos.push({
          type: "wordmark",
          source: "web",
          confidence: candidate.confidence,
          variants: [{
            name: "default",
            file: `logo/${filename}`,
            inline_svg,
            data_uri,
          }],
        });
        logoFound = true;
        break;
      } else {
        const { data_uri } = resolveImage(fetched.content, fetched.contentType);
        const ext = fetched.contentType.includes("png") ? "png" : "jpg";
        const filename = `logo-${candidate.type}.${ext}`;
        await brandDir.writeAsset(`logo/${filename}`, fetched.content);

        logos.push({
          type: "wordmark",
          source: "web",
          confidence: candidate.confidence,
          variants: [{ name: "default", file: `logo/${filename}`, data_uri }],
        });
        logoFound = true;
        break;
      }
    }
  }

  const updated: CoreIdentity = {
    schema_version: identity.schema_version,
    colors,
    typography,
    logo: logos,
    spacing: identity.spacing,
  };
  await brandDir.writeCoreIdentity(updated);

  const newColors = colors.length - identity.colors.length;
  const newFonts = typography.length - identity.typography.length;
  const newLogos = logos.length - identity.logo.length;

  // Check if the first logo has a preview-capable variant
  const firstLogo = logos.length > 0 ? logos[logos.length - 1] : null;
  const logoPreviewAvailable = !!(
    firstLogo?.variants[0]?.inline_svg || firstLogo?.variants[0]?.data_uri
  );

  // --- Extraction quality scoring ---
  let qualityPoints = 0;
  const qualityReasons: string[] = [];

  // Logo: +3 if inline SVG found
  const hasInlineSvgLogo = logos.some((l) =>
    l.variants.some((v) => v.inline_svg)
  );
  if (hasInlineSvgLogo) {
    qualityPoints += 3;
    qualityReasons.push("Logo found with inline SVG");
  } else if (logoFound) {
    qualityReasons.push("Logo found but not as inline SVG");
  }

  // Colors: +2 if 4+, +1 if 2-3
  if (colors.length >= 4) {
    qualityPoints += 2;
    qualityReasons.push(`${colors.length} colors extracted`);
  } else if (colors.length >= 2) {
    qualityPoints += 1;
    qualityReasons.push(`Only ${colors.length} colors extracted`);
  } else {
    qualityReasons.push("Fewer than 2 colors extracted");
  }

  // Fonts: +2 if 3+, +1 if 1-2
  if (typography.length >= 3) {
    qualityPoints += 2;
    qualityReasons.push(`${typography.length} fonts extracted`);
  } else if (typography.length >= 1) {
    qualityPoints += 1;
    qualityReasons.push(`Only ${typography.length} font(s) extracted`);
  } else {
    qualityReasons.push("No fonts extracted");
  }

  // Primary color candidate: +1
  if (suggestedPrimary) {
    qualityPoints += 1;
    qualityReasons.push("Primary color candidate identified");
  }

  // Surface and text roles detected: +1
  const hasSurfaceRole = colors.some((c) => c.role === "surface");
  const hasTextRole = colors.some((c) => c.role === "text");
  if (hasSurfaceRole && hasTextRole) {
    qualityPoints += 1;
    qualityReasons.push("Both surface and text color roles detected");
  }

  // Score mapping
  let qualityScore: "HIGH" | "MEDIUM" | "LOW";
  let qualityRecommendation: string;
  if (qualityPoints >= 8) {
    qualityScore = "HIGH";
    qualityRecommendation = "Strong extraction. Ready to confirm and compile.";
  } else if (qualityPoints >= 5) {
    qualityScore = "MEDIUM";
    qualityRecommendation = "Decent extraction but some gaps. Consider Figma extraction for higher accuracy.";
  } else {
    qualityScore = "LOW";
    qualityRecommendation = "Limited extraction. Try a different page URL, connect to Figma, or add your brand assets manually.";
  }

  const extractionQuality = {
    score: qualityScore,
    points: qualityPoints,
    reasons: qualityReasons,
    recommendation: qualityRecommendation,
  };

  return buildResponse({
    what_happened: `Extracted brand identity from ${input.url}`,
    next_steps: [
      "CONFIRM the three items below with the user BEFORE running brand_compile",
    ],
    data: {
      url: input.url,
      extraction_quality: extractionQuality,
      extraction: {
        colors: { total: colors.length, new: newColors },
        typography: { total: typography.length, new: newFonts },
        logos: { total: logos.length, new: newLogos },
        stylesheets_parsed: stylesheetUrls.slice(0, 5).length + 1,
      },
      top_colors: colors.slice(0, 6).map((c) => ({ name: c.name, hex: c.value, role: c.role, confidence: c.confidence })),
      fonts: typography.map((t) => ({ family: t.family, confidence: t.confidence })),
      confirmation_needed: {
        logo: { found: logoFound, preview_available: logoPreviewAvailable },
        primary_color: {
          candidates: chromaticCandidates,
          auto_assigned: suggestedPrimary,
        },
        fonts: typography.map((t) => t.family),
      },
      conversation_guide: {
        extraction_quality_guidance: `Extraction quality: ${qualityScore} (${qualityPoints}/10 points). ${qualityRecommendation} Communicate this to the user before confirming details.`,
        confirm_before_compile: [
          "After showing extraction results, CONFIRM THREE THINGS with the user before compiling:",
          "",
          "1. LOGO: If a logo was found, show it and ask 'Is this your logo?' If no logo was found, say:",
          "   'I couldn't find your logo automatically. Here are 3 ways to add it:",
          "   A) Share a direct URL to your logo file (e.g., yoursite.com/logo.svg)",
          "   B) Paste the SVG code if you have it",
          "   C) Connect to Figma — I can pull it directly from your design file",
          "   D) Upload the logo file (if your AI tool supports file uploads)'",
          "",
          "2. PRIMARY COLOR: Show the top 3-4 chromatic colors extracted and ask 'Which of these is your primary brand color?' Do NOT auto-assign. List them with hex values.",
          "",
          "3. FONTS: List the extracted fonts and ask 'Are these your brand fonts? Any missing or wrong?'",
          "",
          "After the user confirms (or provides corrections), THEN run brand_compile.",
        ].join("\n"),
        figma_check: "Check if you have access to Figma MCP tools (get_design_context, get_variable_defs, get_screenshot). If yes, tell the user: 'I also have access to Figma — if you share a file URL, I can pull higher-accuracy colors, typography, and your logo directly from the source design file.' If they provide a Figma URL, use the Figma MCP tools alongside brand_extract_figma.",
        logo_missing_tools: "If the user wants to add a logo: use brand_set_logo with SVG markup, a URL, or a data URI. If they provide a direct URL, you can also re-run brand_extract_web with the logo_url parameter.",
      },
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_extract_web",
    "Extract brand identity from a website. Parses CSS for colors and fonts, finds logos in HTML. Use AFTER brand_init. Results are confidence-scored — Figma extraction (if available) will override lower-confidence web data. Optionally pass logo_url to directly fetch a specific logo file.",
    paramsShape,
    async (args) => handler(args as { url: string; logo_url?: string })
  );
}
