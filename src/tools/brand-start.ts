import { z } from "zod";
import * as cheerio from "cheerio";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { SCHEMA_VERSION } from "../schemas/index.js";
import { extractFromCSS, inferColorConfidence, inferColorRole, promotePrimaryColor, getTopChromaticCandidates } from "../lib/css-parser.js";
import { extractLogos, fetchLogo, fetchClearbitLogo, probeCommonLogoPaths, fetchGoogleFavicon, fetchAndEncodeLogo } from "../lib/logo-extractor.js";
import { resolveSvg, resolveImage } from "../lib/svg-resolver.js";
import { mergeColor, mergeTypography, needsClarification } from "../lib/confidence.js";
import { getVersion } from "../lib/version.js";
import { generateColorName, isCssArtifactName } from "../lib/color-namer.js";
import { safeFetch, readResponseWithLimit, MAX_HTML_BYTES, MAX_CSS_BYTES } from "../lib/url-validator.js";
import { compileDTCG } from "../lib/dtcg-compiler.js";
import { compileRuntime } from "../lib/runtime-compiler.js";
import { compileInteractionPolicy } from "../lib/interaction-policy-compiler.js";
import { generateReportHTML, generateBrandInstructions } from "../lib/report-html.js";
import { ERROR_CODES, type ColorEntry, type TypographyEntry, type LogoSpec, type CoreIdentity, type ClarificationItem } from "../types/index.js";

const paramsShape = {
  client_name: z.string().describe("Company or brand name (e.g. 'Acme Corp')"),
  website_url: z.string().url().optional().describe("Company website URL to extract brand identity from (e.g. 'https://acme.com')"),
  industry: z.string().optional().describe("Industry vertical for smarter extraction (e.g. 'fintech', 'healthcare', 'content marketing')"),
  mode: z.enum(["interactive", "auto"]).default("interactive")
    .describe("'auto' (recommended): runs full pipeline in one call when website_url is provided. 'interactive': presents source menu for user to choose extraction method."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

interface SourceOption {
  key: string;
  label: string;
  description: string;
  tool_to_run: string;
  recommended: boolean;
  ready: boolean;
  ready_reason?: string;
}

function buildSourceMenu(websiteUrl?: string): SourceOption[] {
  return [
    {
      key: "A",
      label: "Scan your website",
      description: "Pull colors, fonts, and logo directly from your live site. Lowest friction — no files needed.",
      tool_to_run: "brand_extract_web",
      recommended: true,
      ready: true,
      ...(websiteUrl
        ? { ready_reason: `URL "${websiteUrl}" provided — can start immediately` }
        : { ready_reason: "Just needs a URL" }),
    },
    {
      key: "B",
      label: "Connect to Figma",
      description: "Extract design tokens, colors, and typography from a Figma design file.",
      tool_to_run: "brand_extract_figma",
      recommended: false,
      ready: false,
      ready_reason: "Requires a Figma file key",
    },
    {
      key: "C",
      label: "Upload brand guidelines",
      description: "Share a PDF or document with your brand guidelines and we'll extract the values.",
      tool_to_run: "(manual — ask user for the file, then extract values into core-identity)",
      recommended: false,
      ready: false,
      ready_reason: "User needs to provide a file",
    },
    {
      key: "D",
      label: "Upload an on-brand asset",
      description: "Share a known-good file (social graphic, presentation, screenshot) to sample colors and fonts from.",
      tool_to_run: "(manual — analyze the asset and extract brand values)",
      recommended: false,
      ready: false,
      ready_reason: "User needs to provide a file",
    },
    {
      key: "E",
      label: "Start from scratch",
      description: "Skip extraction entirely. Manually enter colors, fonts, and logo values.",
      tool_to_run: "(manual entry — no extraction tool needed)",
      recommended: false,
      ready: true,
    },
  ];
}

async function handleExistingBrand(brandDir: BrandDir): Promise<ReturnType<typeof buildResponse>> {
  const config = await brandDir.readConfig();
  const identity = await brandDir.readCoreIdentity();

  const hasColors = identity.colors.length > 0;
  const hasTypography = identity.typography.length > 0;
  const hasLogo = identity.logo.length > 0;
  const hasPrimary = identity.colors.some((c) => c.role === "primary");

  const gaps: string[] = [];
  if (!hasColors) gaps.push("colors");
  if (!hasTypography) gaps.push("typography");
  if (!hasLogo) gaps.push("logo");
  if (hasColors && !hasPrimary) gaps.push("primary color role");

  const nextSteps: string[] = [];
  if (gaps.length > 0) {
    nextSteps.push(`Missing: ${gaps.join(", ")}. Run brand_extract_web or brand_extract_figma to fill gaps`);
  }
  if (hasColors && hasTypography) {
    nextSteps.push("Run brand_compile to generate tokens, brand runtime, and interaction policy");
  }
  nextSteps.push("Run brand_status for full details");
  nextSteps.push("Run brand_report to generate a portable brand identity report");

  return buildResponse({
    what_happened: `Brand system already exists for "${config.client_name}" (session ${config.session})`,
    next_steps: nextSteps,
    data: {
      existing: true,
      client_name: config.client_name,
      summary: {
        colors: identity.colors.length,
        typography: identity.typography.length,
        logos: identity.logo.length,
        has_primary: hasPrimary,
        gaps: gaps.length > 0 ? gaps : "none",
      },
      conversation_guide: {
        instruction:
          gaps.length > 0
            ? `The brand system has gaps (${gaps.join(", ")}). Present the summary, then suggest extraction tools to fill what's missing.`
            : "The brand system has core identity populated. Suggest compiling (brand_compile produces tokens, runtime, and interaction policy) or generating a report. If they want team access, suggest brand_brandcode_connect.",
      },
    },
  });
}

async function handleAutoMode(input: Params, brandDir: BrandDir): Promise<ReturnType<typeof buildResponse>> {
  const websiteUrl = input.website_url!;

  // SSRF guard: only allow http/https protocols
  if (!websiteUrl.startsWith("http://") && !websiteUrl.startsWith("https://")) {
    // fall back to interactive mode
    const sourceMenu = buildSourceMenu(input.website_url);
    return buildResponse({
      what_happened: `Auto mode: website_url has unsupported protocol. Falling back to interactive mode.`,
      next_steps: ["Provide a URL starting with http:// or https://"],
      data: { source_menu: sourceMenu, fallback: "interactive" },
    });
  }

  const url = websiteUrl;

  // --- Step 1: Web extraction (same logic as brand_extract_web) ---
  let html: string;
  try {
    const response = await safeFetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": `brandsystem-mcp/${getVersion()}` },
    });
    if (!response.ok) {
      return buildResponse({
        what_happened: `Auto mode: failed to fetch ${url} (HTTP ${response.status}). Falling back to interactive mode.`,
        next_steps: [
          "Check the URL is correct and publicly accessible",
          "Try brand_extract_web manually with a different URL, or use brand_extract_figma",
        ],
        data: { error: ERROR_CODES.AUTO_FETCH_FAILED, status: response.status, fallback: "interactive" },
      });
    }
    html = await readResponseWithLimit(response, MAX_HTML_BYTES);
  } catch (err) {
    return buildResponse({
      what_happened: `Auto mode: failed to fetch ${url}. Falling back to interactive mode.`,
      next_steps: [
        "Check the URL is correct and publicly accessible",
        "Try brand_extract_web manually with a different URL, or use brand_extract_figma",
      ],
      data: { error: ERROR_CODES.AUTO_FETCH_FAILED, details: String(err), fallback: "interactive" },
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
        const resolved = new URL(href, url).href;
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
      const cssText = await readResponseWithLimit(resp, MAX_CSS_BYTES);
      allCSS += cssText + "\n";
    } catch {
      // Skip failed stylesheets
    }
  }

  // Extract inline styles from key semantic elements (catches page builders)
  const inlineStyleSelectors = [
    "body", "header", "nav", "footer", "[class*=hero]", "[class*=banner]",
    "h1", "h2", "h3", "a", "button", "[class*=btn]", "[class*=cta]",
    "section", "[class*=elementor-section]", "[class*=sqs-block]",
  ];
  const inlineCSS: string[] = [];
  for (const sel of inlineStyleSelectors) {
    $(sel).each((i, el) => {
      if (i >= 10) return false;
      const style = $(el).attr("style");
      if (style) {
        inlineCSS.push(`${sel} { ${style} }`);
      }
    });
  }
  if (inlineCSS.length > 0) {
    allCSS += "\n/* inline styles */\n" + inlineCSS.join("\n") + "\n";
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

  const cleanedFonts = extractedFonts.filter(f => !f.family.startsWith("var("));
  let typography = [...identity.typography];
  for (const ef of cleanedFonts.slice(0, 8)) {
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

  const logoCandidates = extractLogos(html, url);

  for (const candidate of logoCandidates.slice(0, 5)) {
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

  // ── Fallback 1: Clearbit Logo API ──
  if (!logoFound) {
    const clearbitLogo = await fetchClearbitLogo(websiteUrl);
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

  // ── Fallback 2: Common logo paths ──
  if (!logoFound) {
    const probedLogo = await probeCommonLogoPaths(websiteUrl);
    if (probedLogo) {
      const fetched = await fetchLogo(probedLogo.url);
      if (fetched) {
        const isSvg = fetched.contentType.includes("svg") || fetched.content.toString("utf-8").trim().startsWith("<");
        if (isSvg) {
          const svgContent = fetched.content.toString("utf-8");
          const { inline_svg, data_uri } = resolveSvg(svgContent);
          logos.push({ type: "wordmark", source: "web", confidence: "medium", variants: [{ name: "default", inline_svg, data_uri }] });
        } else {
          const { data_uri } = resolveImage(fetched.content, fetched.contentType);
          logos.push({ type: "wordmark", source: "web", confidence: "low", variants: [{ name: "default", data_uri }] });
        }
        logoFound = true;
      }
    }
  }

  // ── Fallback 3: Fetch + encode apple-touch-icon or OG image ──
  if (!logoFound) {
    const fallbackCandidates = logoCandidates.filter(c => c.type === "apple-touch-icon" || c.type === "og-image");
    for (const candidate of fallbackCandidates) {
      const encoded = await fetchAndEncodeLogo(candidate.url);
      if (encoded && encoded.data_uri) {
        logos.push({ type: candidate.type === "apple-touch-icon" ? "logomark" : "wordmark", source: "web", confidence: "low", variants: [{ name: "default", data_uri: encoded.data_uri }] });
        logoFound = true;
        break;
      }
    }
  }

  // ── Fallback 4: Google favicon (GUARANTEED) ──
  if (!logoFound) {
    const googleFav = await fetchGoogleFavicon(websiteUrl);
    if (googleFav && googleFav.data_uri) {
      logos.push({ type: "logomark", source: "web", confidence: "low", variants: [{ name: "default", data_uri: googleFav.data_uri }] });
      logoFound = true;
    }
  }

  // Write updated core identity
  const updated: CoreIdentity = {
    schema_version: identity.schema_version,
    colors,
    typography,
    logo: logos,
    spacing: identity.spacing,
  };
  await brandDir.writeCoreIdentity(updated);

  // --- Extraction quality scoring (same logic as brand_extract_web) ---
  let qualityPoints = 0;
  const qualityReasons: string[] = [];

  const hasInlineSvgLogo = logos.some((l) => l.variants.some((v) => v.inline_svg));
  if (hasInlineSvgLogo) {
    qualityPoints += 3;
    qualityReasons.push("Logo found with inline SVG");
  } else if (logoFound) {
    qualityReasons.push("Logo found but not as inline SVG");
  }

  if (colors.length >= 4) {
    qualityPoints += 2;
    qualityReasons.push(`${colors.length} colors extracted`);
  } else if (colors.length >= 2) {
    qualityPoints += 1;
    qualityReasons.push(`Only ${colors.length} colors extracted`);
  } else {
    qualityReasons.push("Fewer than 2 colors extracted");
  }

  if (typography.length >= 3) {
    qualityPoints += 2;
    qualityReasons.push(`${typography.length} fonts extracted`);
  } else if (typography.length >= 1) {
    qualityPoints += 1;
    qualityReasons.push(`Only ${typography.length} font(s) extracted`);
  } else {
    qualityReasons.push("No fonts extracted");
  }

  if (suggestedPrimary) {
    qualityPoints += 1;
    qualityReasons.push("Primary color candidate identified");
  }

  const hasSurfaceRole = colors.some((c) => c.role === "surface");
  const hasTextRole = colors.some((c) => c.role === "text");
  if (hasSurfaceRole && hasTextRole) {
    qualityPoints += 1;
    qualityReasons.push("Both surface and text color roles detected");
  }

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

  // --- Step 2: Compile (same logic as brand_compile) ---
  const config = await brandDir.readConfig();
  const freshIdentity = await brandDir.readCoreIdentity();

  const tokens = compileDTCG(freshIdentity, config.client_name);
  await brandDir.writeTokens(tokens);

  const clarifications: ClarificationItem[] = [];
  let itemId = 0;

  if (!freshIdentity.colors.some((c) => c.role === "primary")) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "colors.primary",
      question: "No primary brand color identified. Which color is your primary brand color?",
      source: "compilation",
      priority: "high",
    });
  }

  for (const color of freshIdentity.colors) {
    if (needsClarification(color.confidence)) {
      clarifications.push({
        id: `clarify-${++itemId}`,
        field: `colors.${color.role}`,
        question: `Color ${color.value} (${color.name}) has low confidence. Is this correct and what role does it play?`,
        source: color.source,
        priority: "medium",
      });
    }
  }

  if (freshIdentity.typography.length === 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "typography",
      question: "No fonts detected. What font family does your brand use?",
      source: "compilation",
      priority: "high",
    });
  }

  for (const typo of freshIdentity.typography) {
    if (needsClarification(typo.confidence)) {
      clarifications.push({
        id: `clarify-${++itemId}`,
        field: `typography.${typo.family}`,
        question: `Font "${typo.family}" has low confidence. Is this your brand font?`,
        source: typo.source,
        priority: "medium",
      });
    }
  }

  if (freshIdentity.logo.length === 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "logo",
      question: "No logo detected. Provide your logo as SVG for best results.",
      source: "compilation",
      priority: "high",
    });
  }

  const unknownColors = freshIdentity.colors.filter((c) => c.role === "unknown");
  if (unknownColors.length > 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "colors.roles",
      question: `${unknownColors.length} color(s) have no assigned role: ${unknownColors.map((c) => c.value).join(", ")}. What role does each play?`,
      source: "compilation",
      priority: "medium",
    });
  }

  await brandDir.writeClarifications({ schema_version: SCHEMA_VERSION, items: clarifications });

  const brandTokens = tokens.brand as Record<string, unknown>;
  const colorTokenCount = Object.keys((brandTokens.color as Record<string, unknown>) || {}).length;
  const typoTokenCount = Object.keys((brandTokens.typography as Record<string, unknown>) || {}).length;
  const tokenCount = colorTokenCount + typoTokenCount;

  // --- Step 2b: Compile runtime + interaction policy (same logic as brand_compile) ---
  const runtime = compileRuntime(config, freshIdentity, null, null, null);
  await brandDir.writeRuntime(runtime);

  const policy = compileInteractionPolicy(config.schema_version, null, null, null);
  await brandDir.writePolicy(policy);

  // --- Step 3: Generate report (same logic as brand_report) ---
  let pass = 0, warn = 0, fail = 0;
  if (freshIdentity.colors.length > 0) pass++; else warn++;
  if (freshIdentity.colors.some((c) => c.role === "primary")) pass++; else warn++;
  if (freshIdentity.typography.length > 0) pass++; else warn++;
  if (freshIdentity.logo.length > 0) pass++; else warn++;
  if (tokenCount > 0) pass++; else warn++;
  if (freshIdentity.colors.every((c) => /^#[0-9a-fA-F]{3,8}$/.test(c.value))) pass++; else fail++;
  const lowConf = [...freshIdentity.colors, ...freshIdentity.typography].filter(
    (e) => e.confidence === "low"
  ).length;
  if (lowConf === 0) pass++; else warn++;

  const reportHtml = generateReportHTML({
    config,
    identity: freshIdentity,
    clarifications,
    tokenCount,
    auditSummary: { pass, warn, fail },
  });
  await brandDir.writeMarkdown("brand-report.html", reportHtml);

  const brandInstructions = generateBrandInstructions(config, freshIdentity);

  // --- Build the combined auto-mode response ---
  const filesWritten = [
    "brand.config.yaml",
    "core-identity.yaml",
    "tokens.json",
    "brand-runtime.json",
    "interaction-policy.json",
    "needs-clarification.yaml",
    "brand-report.html",
  ];

  const hasPrimary = freshIdentity.colors.some((c) => c.role === "primary");

  return buildResponse({
    what_happened: `Auto mode: created .brand/ for "${input.client_name}", extracted from ${url}, compiled tokens + runtime + policy, and generated report`,
    next_steps: [
      "Show the user their brand summary and confirm key decisions before proceeding",
    ],
    data: {
      mode: "auto",
      client_name: input.client_name,
      brand_dir: ".brand/",
      files_written: filesWritten,
      extraction_quality: extractionQuality,
      extraction_summary: {
        colors: colors.length,
        typography: typography.length,
        logos: logos.length,
        tokens: tokenCount,
        stylesheets_parsed: stylesheetUrls.slice(0, 5).length + 1,
      },
      all_colors: colors.map((c) => ({
        name: c.name,
        hex: c.value,
        role: c.role,
        confidence: c.confidence,
      })),
      fonts: typography.map((t) => ({ family: t.family, confidence: t.confidence })),
      confirmation_needed: {
        logo: {
          found: logoFound,
          preview_available: logos.length > 0 && !!(logos[logos.length - 1]?.variants[0]?.inline_svg || logos[logos.length - 1]?.variants[0]?.data_uri),
        },
        colors: {
          chromatic_candidates: chromaticCandidates,
          suggested_primary: suggestedPrimary,
          all_extracted: colors.map((c) => ({
            hex: c.value,
            name: c.name,
            role: c.role,
          })),
          instruction: "Show ALL extracted colors. Ask: 1) Which is primary? 2) Any that should NOT be in the brand? 3) Roles for unknowns.",
        },
        fonts: typography.map((t) => t.family),
      },
      clarifications: {
        total: clarifications.length,
        high_priority: clarifications.filter((c) => c.priority === "high").length,
      },
      report_file: ".brand/brand-report.html",
      report_size: `${Math.round(reportHtml.length / 1024)}KB`,
      brand_instructions: brandInstructions,
      conversation_guide: {
        instruction: [
          "The entire Session 1 pipeline ran automatically. Present the results:",
          `1. Show extraction quality (${qualityScore}) and mention: ${qualityRecommendation}`,
          `2. ${logoFound ? "Show the logo if possible — ask 'Is this your logo?'" : "No logo was found. Suggest: Figma extraction, direct logo URL via brand_set_logo, or manual upload."}`,
          `3. Show ALL ${colors.length} extracted colors (hex + name + role). Ask three things:`,
          `   a) 'Which is your PRIMARY brand color?' (highlight candidates: ${chromaticCandidates.join(", ") || "none"})`,
          `   b) 'Are any of these NOT part of your brand? (retired colors, third-party colors?)'`,
          `   c) 'What roles should the remaining colors play? (secondary, accent, etc.)'`,
          `4. List the fonts (${typography.map((t) => t.family).join(", ") || "none found"}) — ask 'Are these correct?'`,
          "5. After confirmation: 'Your brand runtime is compiled. Any agent you give brand-runtime.json to will produce on-brand content with the right colors, fonts, and logo.'",
          "6. Explain what Session 2 adds (don't just say 'go deeper'): 'Session 2 captures your visual rules — composition guidelines, anti-patterns, illustration direction. It makes the runtime dramatically more useful because agents won't just use the right colors, they'll use them the right way. Your sub-agents could reject off-brand image prompts automatically.'",
          "7. Ask: 'Want to add visual rules now, or is the core identity enough for what you need?'",
          "8. If they want team sharing: 'Run brand_brandcode_connect to save this on Brandcode Studio and sync across your team.'",
          ...(qualityScore === "LOW" ? ["If extraction quality is LOW, suggest: Figma extraction, different URL, or manual input via brand_set_logo."] : []),
        ].join("\n"),
      },
    },
  });
}

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  // If .brand/ already exists, return status + actionable next steps
  if (await brandDir.exists()) {
    return handleExistingBrand(brandDir);
  }

  // Initialize the .brand/ directory (shared logic with brand_init)
  await brandDir.initBrand({
    schema_version: SCHEMA_VERSION,
    session: 1,
    client_name: input.client_name,
    industry: input.industry,
    website_url: input.website_url,
    created_at: new Date().toISOString(),
  });

  // Auto mode: run entire Session 1 pipeline if website_url is provided
  if (input.mode === "auto" && input.website_url) {
    return handleAutoMode(input, brandDir);
  }

  const sourceMenu = buildSourceMenu(input.website_url);
  const recommended = "A";

  const nextSteps = [
    "Present the source menu below and ask the user how they'd like to populate their brand identity",
  ];
  if (input.website_url) {
    nextSteps.push(
      `Option A can start immediately — run brand_extract_web with url "${input.website_url}"`
    );
  }

  return buildResponse({
    what_happened: `Created .brand/ directory for "${input.client_name}"`,
    next_steps: nextSteps,
    data: {
      client_name: input.client_name,
      brand_dir: ".brand/",
      files_created: ["brand.config.yaml", "core-identity.yaml", "assets/logo/"],
      source_menu: sourceMenu,
      recommended,
      conversation_guide: {
        instruction: [
          `Welcome the user and confirm the brand system was created for "${input.client_name}".`,
          "",
          "BEFORE presenting the source menu, ask these quick context questions (skip any already answered via params):",
          "",
          `${input.website_url ? "✓ Website URL already provided." : "1. \"What's your primary website URL?\" — needed for extraction"}`,
          `${input.industry ? "✓ Industry already provided." : "2. \"What industry are you in, and who's your primary audience?\" — helps infer color/tone decisions"}`,
          "3. \"In one sentence, what's the core idea or perspective behind your brand?\" — This doesn't need to be polished. Even a rough articulation grounds the extraction. Example: 'We believe brands need operating systems, not just guidelines.'",
          "4. \"Do you have a Figma file with your brand identity? If so, share the URL or file key.\" — Routes the extraction path. If yes, note we can use it for higher accuracy after the web scan.",
          "",
          "Once you have context (or the user wants to skip ahead), present the source menu:",
          "",
          "Present the source menu as a numbered list with clear descriptions.",
          `Highlight option A as the recommended starting point${input.website_url ? " — and note it can start immediately since a URL was provided" : ""}.`,
          "Ask: 'Which would you like to start with?'",
          "",
          "Based on their choice:",
          "  A → Run brand_extract_web (with the website_url if provided), then immediately run brand_compile and brand_report to show results fast",
          "  B → Ask for their Figma file key, then run brand_extract_figma in plan mode",
          "  C → Ask them to share/upload their brand guidelines document, then extract values into core-identity manually",
          "  D → Ask them to share/upload an on-brand asset, then analyze it and extract brand values",
          "  E → Begin manual entry by asking for primary brand color, then font, then proceed through core identity fields",
          "",
          "AFTER extraction completes:",
          "  1. Run brand_compile to generate tokens, brand runtime, and interaction policy",
          "  2. Run brand_report to generate the HTML report",
          "  3. Show the report as an artifact (in Chat) or write to .brand/ (in Code)",
          "  4. Ask: 'Does this look right? If anything's off, I can help fix it.'",
          "  5. Mention: 'Your brand runtime and interaction policy are compiled — any MCP-connected tool now has your brand context.'",
          "  6. If they want team access: 'Run brand_brandcode_connect to sync with Brandcode Studio.'",
        ].join("\n"),
        conditionals: {
          design_principle: "Get just enough to make the extraction smart, then show results fast. The user should see their brand reflected back within 5 minutes of starting.",
        },
      },
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_start",
    "Create a brand system from any website URL — extract brand colors, fonts, and logo in under 60 seconds. Use when the user says 'create a brand system', 'extract brand from website', 'set up brand guidelines', 'get design tokens', or 'brand identity'. Set mode='auto' with a website_url to run the full pipeline (extract, compile DTCG tokens + brand runtime + interaction policy, generate HTML report) in one call. If .brand/ already exists, returns current status with next steps. Returns colors with roles, typography, logo (SVG/PNG), and confidence scores. After creation, suggest Brandcode Studio connector for team sync.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
