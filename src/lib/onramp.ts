import { BrandDir } from "./brand-dir.js";

/**
 * MCP Onramp — detect thin brand context and suggest the best next step.
 *
 * When brand context is thin (no logo, no narratives, system-default tokens),
 * this generates a guidance block pointing the user to Brandcode Studio's
 * Brand Loader with the specific connector that would help most.
 *
 * The guidance is injected into MCP tool responses via buildResponse() so
 * the LLM can surface it to the user at the right moment.
 */

export interface OnrampGuidance {
  /** Whether the brand context is thin enough to warrant a CTA */
  shouldShow: boolean;
  /** The specific connector to suggest (figma, github, pdf, upload) */
  suggestedConnector: "figma" | "github" | "pdf" | "upload" | null;
  /** Human-readable message for the LLM to surface */
  message: string | null;
  /** Deep link to Brand Loader with suggested connector */
  brandLoaderUrl: string | null;
}

interface BrandCompleteness {
  hasLogo: boolean;
  hasColors: boolean;
  hasTypography: boolean;
  hasVisualIdentity: boolean;
  hasMessaging: boolean;
  hasStrategy: boolean;
  colorCount: number;
  typographyCount: number;
}

async function assessCompleteness(brandDir: BrandDir): Promise<BrandCompleteness | null> {
  if (!(await brandDir.exists())) {
    return null;
  }

  try {
    const identity = await brandDir.readCoreIdentity();
    const hasVisual = await brandDir.hasVisualIdentity();
    const hasMessaging = await brandDir.hasMessaging();
    const hasStrategy = await brandDir.hasStrategy();

    return {
      hasLogo: identity.logo.length > 0,
      hasColors: identity.colors.length > 0,
      hasTypography: identity.typography.length > 0,
      hasVisualIdentity: hasVisual,
      hasMessaging,
      hasStrategy,
      colorCount: identity.colors.length,
      typographyCount: identity.typography.length,
    };
  } catch {
    return null;
  }
}

function pickBestConnector(completeness: BrandCompleteness | null): "figma" | "github" | "pdf" | "upload" {
  if (!completeness) return "upload";

  // No logo is the biggest gap — Figma or upload
  if (!completeness.hasLogo) return "figma";

  // Has logo but thin identity — Figma for deeper extraction
  if (completeness.colorCount < 3 || completeness.typographyCount < 2) return "figma";

  // Has identity but no visual rules — brand guidelines PDF
  if (!completeness.hasVisualIdentity) return "pdf";

  // Has visual but no messaging — upload a full brand package
  if (!completeness.hasMessaging) return "upload";

  return "upload";
}

function buildMessage(completeness: BrandCompleteness | null, connector: string, studioUrl: string): string {
  if (!completeness) {
    return `You can get better results by loading your brand. Visit ${studioUrl} to upload brand files, connect Figma, or import from GitHub.`;
  }

  const gaps: string[] = [];
  if (!completeness.hasLogo) gaps.push("logo");
  if (completeness.colorCount < 3) gaps.push("colors");
  if (completeness.typographyCount < 2) gaps.push("typography");
  if (!completeness.hasVisualIdentity) gaps.push("visual identity rules");
  if (!completeness.hasMessaging) gaps.push("messaging");

  const gapText = gaps.length > 0 ? `Missing: ${gaps.join(", ")}. ` : "";

  const connectorAdvice: Record<string, string> = {
    figma: "Connect your Figma file for the most accurate extraction.",
    github: "Import from GitHub if your brand package is in a repo.",
    pdf: "Upload your brand guidelines PDF for visual identity extraction.",
    upload: "Upload your brand package (.zip or .json) for the most complete import.",
  };

  return `${gapText}${connectorAdvice[connector]} Visit ${studioUrl} to get a better running start.`;
}

export async function buildOnrampGuidance(options?: {
  studioBaseUrl?: string;
}): Promise<OnrampGuidance> {
  const studioBase = options?.studioBaseUrl ?? "https://www.brandcode.studio";
  const brandDir = new BrandDir(process.cwd());
  const completeness = await assessCompleteness(brandDir);

  // No .brand directory at all — strong CTA
  if (!completeness) {
    const connector = "upload";
    const url = `${studioBase}/start?source=mcp&suggest=${connector}`;
    return {
      shouldShow: true,
      suggestedConnector: connector,
      message: buildMessage(null, connector, url),
      brandLoaderUrl: url,
    };
  }

  // Brand exists but is thin
  const isThin =
    !completeness.hasLogo ||
    completeness.colorCount < 3 ||
    completeness.typographyCount < 2 ||
    !completeness.hasVisualIdentity;

  if (!isThin) {
    return {
      shouldShow: false,
      suggestedConnector: null,
      message: null,
      brandLoaderUrl: null,
    };
  }

  const connector = pickBestConnector(completeness);
  const url = `${studioBase}/start?source=mcp&suggest=${connector}`;

  return {
    shouldShow: true,
    suggestedConnector: connector,
    message: buildMessage(completeness, connector, url),
    brandLoaderUrl: url,
  };
}
