import { z } from "zod";
import * as cheerio from "cheerio";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { extractFromCSS, inferColorConfidence, inferColorRole, promotePrimaryColor } from "../lib/css-parser.js";
import { extractLogos, fetchLogo } from "../lib/logo-extractor.js";
import { resolveSvg, resolveImage } from "../lib/svg-resolver.js";
import { mergeColor, mergeTypography } from "../lib/confidence.js";
import { getVersion } from "../lib/version.js";
import type { ColorEntry, TypographyEntry, LogoSpec, CoreIdentity } from "../types/index.js";

const paramsShape = {
  url: z.string().url().describe("Website URL to extract brand identity from"),
};

async function handler(input: { url: string }) {
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
        next_steps: ["Check the URL is correct and accessible", "Try brand_extract_figma instead"],
        data: { error: "fetch_failed", status: response.status, statusText: response.statusText },
      });
    }
    html = await response.text();
  } catch (err) {
    return buildResponse({
      what_happened: `Failed to fetch ${input.url}`,
      next_steps: ["Check the URL is correct and accessible", "Try brand_extract_figma instead"],
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

  // Promote the most frequent chromatic color to primary if none was explicitly named
  const promotedColors = promotePrimaryColor(extractedColors);

  const identity = await brandDir.readCoreIdentity();
  let colors = [...identity.colors];

  for (const ec of promotedColors.slice(0, 20)) {
    const entry: ColorEntry = {
      name: ec.property.startsWith("--")
        ? ec.property.replace(/^--/, "").replace(/[-_]/g, " ")
        : `${ec.property} ${ec.value}`,
      value: ec.value,
      role: inferColorRole(ec),
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

  const logoCandidates = extractLogos(html, input.url);
  const logos: LogoSpec[] = [...identity.logo];

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
      break;
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

  return buildResponse({
    what_happened: `Extracted brand identity from ${input.url}`,
    next_steps: [
      "Run brand_compile next to generate tokens and surface items needing clarification",
      "Then run brand_report to generate the portable brand identity report",
    ],
    data: {
      url: input.url,
      extraction: {
        colors: { total: colors.length, new: newColors },
        typography: { total: typography.length, new: newFonts },
        logos: { total: logos.length, new: newLogos },
        stylesheets_parsed: stylesheetUrls.slice(0, 5).length + 1,
      },
      top_colors: colors.slice(0, 5).map((c) => `${c.value} (${c.role}, ${c.confidence})`),
      fonts: typography.map((t) => `${t.family} (${t.confidence})`),
      conversation_guide: {
        auto_chain: "After reporting extraction results, immediately run brand_compile — do not wait for the user to ask.",
        figma_check: "Check if you have access to Figma MCP tools (get_design_context, get_variable_defs, get_screenshot). If yes, tell the user: 'I also have access to Figma — if you share a file URL, I can pull higher-accuracy colors, typography, and your logo directly from the source design file.' If they provide a Figma URL, use the Figma MCP tools alongside brand_extract_figma.",
        after_compile: "After compile finishes, check for clarification items. If there are any, walk through resolving them with brand_clarify. After all resolved, run brand_report.",
      },
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_extract_web",
    "Extract brand identity from a website. Parses CSS for colors and fonts, finds logos in HTML. Use AFTER brand_init. Results are confidence-scored — Figma extraction (if available) will override lower-confidence web data.",
    paramsShape,
    async (args) => handler(args as { url: string })
  );
}
