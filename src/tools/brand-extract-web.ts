import { z } from "zod";
import * as cheerio from "cheerio";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { extractFromCSS, inferColorConfidence, inferColorRole } from "../lib/css-parser.js";
import { extractLogos, fetchLogo } from "../lib/logo-extractor.js";
import { resolveSvg, resolveImage } from "../lib/svg-resolver.js";
import { mergeColor, mergeTypography } from "../lib/confidence.js";
import type { ColorEntry, TypographyEntry, LogoSpec, CoreIdentity } from "../types/index.js";

const paramsShape = {
  url: z.string().describe("Website URL to extract brand identity from"),
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

  let html: string;
  try {
    const response = await fetch(input.url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "brandsystem-mcp/0.1.0" },
    });
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
      const base = input.url.replace(/\/$/, "");
      const resolved = href.startsWith("http")
        ? href
        : href.startsWith("//")
        ? `https:${href}`
        : `${base}${href.startsWith("/") ? "" : "/"}${href}`;
      stylesheetUrls.push(resolved);
    }
  });

  for (const sheetUrl of stylesheetUrls.slice(0, 5)) {
    try {
      const resp = await fetch(sheetUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "brandsystem-mcp/0.1.0" },
      });
      allCSS += (await resp.text()) + "\n";
    } catch {
      // Skip failed stylesheets
    }
  }

  const { colors: extractedColors, fonts: extractedFonts } = extractFromCSS(allCSS);

  const identity = await brandDir.readCoreIdentity();
  let colors = [...identity.colors];

  for (const ec of extractedColors.slice(0, 20)) {
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

  for (const candidate of logoCandidates.slice(0, 3)) {
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
      "Run brand_extract_figma if you have a Figma file (Figma data is more authoritative)",
      "Run brand_compile to generate tokens.json and surface items needing clarification",
      "Run brand_status to see the full picture",
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
