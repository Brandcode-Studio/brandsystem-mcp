import { z } from "zod";
import * as cheerio from "cheerio";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { extractFromCSS, inferColorConfidence, inferColorRole, promotePrimaryColor, getTopChromaticCandidates } from "../lib/css-parser.js";
import { extractLogos, fetchLogo, fetchClearbitLogo, probeCommonLogoPaths, fetchGoogleFavicon, fetchAndEncodeLogo } from "../lib/logo-extractor.js";
import { resolveSvg, resolveImage } from "../lib/svg-resolver.js";
import { mergeColor, mergeTypography } from "../lib/confidence.js";
import { getVersion } from "../lib/version.js";
import { generateColorName, isCssArtifactName } from "../lib/color-namer.js";
import { safeFetch } from "../lib/url-validator.js";
import { ERROR_CODES, type ColorEntry, type TypographyEntry, type LogoSpec, type CoreIdentity } from "../types/index.js";

const paramsShape = {
  url: z.string().url().describe("Website URL to scan (e.g. 'https://acme.com'). The homepage usually has the best logo and color data."),
  logo_url: z.string().optional().describe("Direct URL to a logo SVG/PNG file (e.g. 'https://acme.com/logo.svg'). Use if automatic extraction misses the logo."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init first to create the brand system"],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  if (!input.url.startsWith("http://") && !input.url.startsWith("https://")) {
    return buildResponse({
      what_happened: "Only http:// and https:// URLs are supported",
      next_steps: ["Provide a URL starting with https://"],
      data: { error: ERROR_CODES.INVALID_PROTOCOL },
    });
  }

  let html: string;
  try {
    const response = await safeFetch(input.url, {
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
        data: { error: ERROR_CODES.FETCH_FAILED, status: response.status, statusText: response.statusText },
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
      data: { error: ERROR_CODES.FETCH_FAILED, details: String(err) },
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
      const resp = await safeFetch(sheetUrl, {
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
  // SSRF guard: only fetch logo_url with http/https protocols
  if (input.logo_url && (input.logo_url.startsWith("http://") || input.logo_url.startsWith("https://"))) {
    const fetched = await fetchLogo(input.logo_url);
    if (fetched) {
      const isSvg = fetched.contentType.includes("svg") || fetched.content.toString("utf-8").trim().startsWith("<");

      if (isSvg) {
        const svgContent = fetched.content.toString("utf-8");
        const { inline_svg, data_uri } = resolveSvg(svgContent);
        const filename = "logo-wordmark.svg";
        await brandDir.writeAsset(`logo/${filename}`, inline_svg);

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
        await brandDir.writeAsset(`logo/${filename}`, inline_svg);

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
        await brandDir.writeAsset(`logo/${filename}`, inline_svg);

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

  // ── Fallback 1: Clearbit Logo API (free, high-quality PNGs) ──
  if (!logoFound) {
    const clearbitLogo = await fetchClearbitLogo(input.url);
    if (clearbitLogo && clearbitLogo.data_uri) {
      logos.push({
        type: "wordmark",
        source: "web",
        confidence: "medium",
        variants: [{ name: "default", data_uri: clearbitLogo.data_uri }],
      });
      logoFound = true;
    }
  }

  // ── Fallback 2: Probe common logo file paths ─────────────────
  if (!logoFound) {
    const probedLogo = await probeCommonLogoPaths(input.url);
    if (probedLogo) {
      const fetched = await fetchLogo(probedLogo.url);
      if (fetched) {
        const isSvg = fetched.contentType.includes("svg") || fetched.content.toString("utf-8").trim().startsWith("<");
        if (isSvg) {
          const svgContent = fetched.content.toString("utf-8");
          const { inline_svg, data_uri } = resolveSvg(svgContent);
          logos.push({
            type: "wordmark",
            source: "web",
            confidence: "medium",
            variants: [{ name: "default", inline_svg, data_uri }],
          });
        } else {
          const { data_uri } = resolveImage(fetched.content, fetched.contentType);
          logos.push({
            type: "wordmark",
            source: "web",
            confidence: "low",
            variants: [{ name: "default", data_uri }],
          });
        }
        logoFound = true;
      }
    }
  }

  // ── Fallback 3: Fetch + encode apple-touch-icon or OG image ──
  // These were found in HTML extraction but not yet fetched
  if (!logoFound) {
    const fallbackCandidates = extractLogos(html, input.url)
      .filter(c => c.type === "apple-touch-icon" || c.type === "og-image");
    for (const candidate of fallbackCandidates) {
      const encoded = await fetchAndEncodeLogo(candidate.url);
      if (encoded && encoded.data_uri) {
        logos.push({
          type: candidate.type === "apple-touch-icon" ? "logomark" : "wordmark",
          source: "web",
          confidence: "low",
          variants: [{ name: "default", data_uri: encoded.data_uri }],
        });
        logoFound = true;
        break;
      }
    }
  }

  // ── Fallback 4: Google favicon (GUARANTEED — always returns something) ──
  if (!logoFound) {
    const googleFav = await fetchGoogleFavicon(input.url);
    if (googleFav && googleFav.data_uri) {
      logos.push({
        type: "logomark",
        source: "web",
        confidence: "low",
        variants: [{ name: "default", data_uri: googleFav.data_uri }],
      });
      logoFound = true;
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
      all_colors: colors.map((c) => ({
        name: c.name,
        hex: c.value,
        role: c.role,
        confidence: c.confidence,
        source: c.source,
      })),
      fonts: typography.map((t) => ({ family: t.family, confidence: t.confidence })),
      confirmation_needed: {
        logo: { found: logoFound, preview_available: logoPreviewAvailable },
        colors: {
          chromatic_candidates: chromaticCandidates,
          suggested_primary: suggestedPrimary,
          all_extracted: colors.map((c) => ({
            hex: c.value,
            name: c.name,
            role: c.role,
          })),
          instruction: "Show ALL extracted colors to the user. Ask them to: 1) Confirm which is the primary brand color, 2) Identify any colors that should NOT be in the brand system (e.g., retired colors, third-party colors), 3) Assign roles to any 'unknown' colors (secondary, accent, etc.)",
        },
        fonts: typography.map((t) => t.family),
      },
      conversation_guide: {
        instruction: [
          "After showing extraction results, CONFIRM THREE THINGS with the user before compiling:",
          "",
          "1. LOGO: If a logo was found, show it and ask 'Is this your logo?' If no logo was found, say:",
          "   'I couldn't find your logo automatically. Here are ways to add it:",
          "   A) Share a direct URL to your logo file (e.g., yoursite.com/logo.svg or a PNG)",
          "   B) Paste the SVG code if you have it",
          "   C) Upload a transparent PNG of your logo (works great for Chat artifacts)",
          "   D) Connect to Figma — I can pull it directly from your design file",
          "   E) I can search the web for your logo — but NOTE: search results often show older logo versions. Your website header or Figma file is always the most current source.'",
          "",
          "2. COLORS: Show ALL extracted colors as a visual list (hex + name + current role).",
          "   Ask three questions:",
          "   a) 'Which of these is your PRIMARY brand color?' (show the chromatic candidates prominently)",
          "   b) 'Are any of these NOT part of your brand? (e.g., retired colors, third-party colors)' — remove any they flag",
          "   c) 'What role should the remaining colors play?' (secondary, accent, neutral, etc.)",
          "   This is critical — agencies and editorial sites often have colors from client work or content in their CSS.",
          "",
          "3. FONTS: List the extracted fonts and ask 'Are these your brand fonts? Any missing or wrong?'",
          "",
          "After the user confirms (or provides corrections), THEN run brand_compile.",
        ].join("\n"),
        conditionals: {
          extraction_quality_guidance: `Extraction quality: ${qualityScore} (${qualityPoints}/10 points). ${qualityRecommendation} Communicate this to the user before confirming details.`,
          figma_check: "Check if you have access to Figma MCP tools (get_design_context, get_variable_defs, get_screenshot). If yes, tell the user: 'I also have access to Figma — if you share a file URL, I can pull higher-accuracy colors, typography, and your logo directly from the source design file.' If they provide a Figma URL, use the Figma MCP tools alongside brand_extract_figma.",
          logo_missing_tools: "If the user wants to add a logo: use brand_set_logo with SVG markup, a URL, or a data URI. If they provide a direct URL, you can also re-run brand_extract_web with the logo_url parameter.",
        },
      },
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_extract_web",
    "Extract brand colors, fonts, and logo from any website URL — get brand identity from a live site. Use when asked 'extract brand from URL', 'get brand colors from website', 'scan my site', or when the user provides a website URL. Parses HTML for logo candidates (SVG, img, favicons, Clearbit fallback) and CSS for colors and font-family declarations. Confidence-scores everything. Pass logo_url to fetch a specific logo directly. Returns colors with roles, fonts with frequency, logo preview data, and extraction quality score.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
