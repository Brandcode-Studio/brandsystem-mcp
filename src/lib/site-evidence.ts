import { BrandDir } from "./brand-dir.js";
import { mergeColor, mergeTypography } from "./confidence.js";
import { generateColorName } from "./color-namer.js";
import type { ColorEntry, TypographyEntry } from "../types/index.js";
import type { ComputedElement, SiteExtractionResultSuccess, VisualColorCandidate } from "./visual-extractor.js";

export interface PersistedSiteViewportEvidence {
  viewport: "desktop" | "mobile";
  screenshot_asset: string;
  computed_elements: ComputedElement[];
  css_custom_properties: Record<string, string>;
  unique_colors: string[];
  unique_fonts: string[];
  role_candidates: VisualColorCandidate[];
}

export interface PersistedSitePageEvidence {
  url: string;
  page_type: string;
  selection_reason: string;
  priority: number;
  title: string;
  viewports: PersistedSiteViewportEvidence[];
}

export interface ExtractionEvidenceFile {
  schema_version: string;
  source_url: string;
  discovered_pages: number;
  selected_pages: PersistedSitePageEvidence[];
  site_summary: {
    page_types: string[];
    viewports: Array<"desktop" | "mobile">;
    aggregated_colors: string[];
    aggregated_fonts: string[];
  };
}

export interface PersistSiteExtractionResult {
  evidence: ExtractionEvidenceFile;
  colors_added: number;
  fonts_added: number;
  screenshots_saved: number;
}

function slugifyPath(pathname: string): string {
  const cleaned = pathname.replace(/\/+/g, "-").replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : "home";
}

function makeScreenshotAssetPath(pageUrl: string, pageType: string, viewport: "desktop" | "mobile"): string {
  const parsed = new URL(pageUrl);
  const pageSlug = slugifyPath(parsed.pathname);
  return `evidence/${pageType}-${pageSlug}-${viewport}.png`;
}

export async function persistSiteExtraction(
  brandDir: BrandDir,
  extraction: SiteExtractionResultSuccess,
  options: { merge?: boolean } = {},
): Promise<PersistSiteExtractionResult> {
  const merge = options.merge ?? true;

  let colorsAdded = 0;
  let fontsAdded = 0;
  let screenshotsSaved = 0;

  if (merge) {
    const identity = await brandDir.readCoreIdentity();
    let colors = [...identity.colors];
    let typography = [...identity.typography];

    const fontCounts = new Map<string, number>();

    for (const page of extraction.selectedPages) {
      for (const viewport of page.viewports) {
        for (const candidate of viewport.roleCandidates) {
          const entry: ColorEntry = {
            name: generateColorName(candidate.hex, candidate.role),
            value: candidate.hex,
            role: candidate.role as ColorEntry["role"],
            source: "web",
            confidence: candidate.confidence,
            css_property: `computed:${candidate.source_context} @ ${page.pageType}/${viewport.viewport}`,
          };
          const before = colors.length;
          colors = mergeColor(colors, entry);
          if (colors.length > before) colorsAdded++;
        }

        for (const element of viewport.computedElements) {
          if (!element.fontFamily) continue;
          const current = fontCounts.get(element.fontFamily) ?? 0;
          fontCounts.set(element.fontFamily, current + 1);
        }
      }
    }

    for (const [family, count] of [...fontCounts.entries()].sort((a, b) => b[1] - a[1])) {
      const entry: TypographyEntry = {
        name: family,
        family,
        source: "web",
        confidence: count >= 6 ? "high" : count >= 2 ? "medium" : "low",
      };
      const before = typography.length;
      typography = mergeTypography(typography, entry);
      if (typography.length > before) fontsAdded++;
    }

    await brandDir.writeCoreIdentity({
      ...identity,
      colors,
      typography,
    });
  }

  const selectedPages: PersistedSitePageEvidence[] = [];
  const aggregatedColors = new Set<string>();
  const aggregatedFonts = new Set<string>();
  const viewportsUsed = new Set<"desktop" | "mobile">();

  for (const page of extraction.selectedPages) {
    const persistedViewports: PersistedSiteViewportEvidence[] = [];

    for (const viewport of page.viewports) {
      const assetPath = makeScreenshotAssetPath(page.url, page.pageType, viewport.viewport);
      await brandDir.writeAsset(assetPath, viewport.screenshot);
      screenshotsSaved++;
      viewportsUsed.add(viewport.viewport);

      for (const color of viewport.uniqueColors) aggregatedColors.add(color);
      for (const font of viewport.uniqueFonts) aggregatedFonts.add(font);

      persistedViewports.push({
        viewport: viewport.viewport,
        screenshot_asset: `assets/${assetPath}`,
        computed_elements: viewport.computedElements,
        css_custom_properties: viewport.cssCustomProperties,
        unique_colors: viewport.uniqueColors,
        unique_fonts: viewport.uniqueFonts,
        role_candidates: viewport.roleCandidates,
      });
    }

    selectedPages.push({
      url: page.url,
      page_type: page.pageType,
      selection_reason: page.selectionReason,
      priority: page.priority,
      title: page.title,
      viewports: persistedViewports,
    });
  }

  const evidence: ExtractionEvidenceFile = {
    schema_version: "0.4.0",
    source_url: extraction.sourceUrl,
    discovered_pages: extraction.discoveredPages,
    selected_pages: selectedPages,
    site_summary: {
      page_types: [...new Set(selectedPages.map((page) => page.page_type))],
      viewports: [...viewportsUsed],
      aggregated_colors: [...aggregatedColors],
      aggregated_fonts: [...aggregatedFonts],
    },
  };

  await brandDir.writeExtractionEvidence(evidence);

  return {
    evidence,
    colors_added: colorsAdded,
    fonts_added: fontsAdded,
    screenshots_saved: screenshotsSaved,
  };
}
