/**
 * Resolve a Brandcode Studio URL into structured API endpoints.
 *
 * Accepted input formats:
 *   - Full brand page:  https://brandcode.studio/start/brands/pendium
 *   - Direct slug:      pendium
 *   - API detail URL:   https://brandcode.studio/api/brand/hosted/pendium
 *   - Custom domain:    https://custom.host/start/brands/pendium
 */

import type { ResolvedHostedBrand } from "./types.js";

const DEFAULT_HOST = "https://brandcode.studio";

/**
 * Extract slug and base URL from any recognized Brandcode input.
 * Throws if the input cannot be resolved.
 */
export function resolveBrandcodeHostedUrl(input: string): ResolvedHostedBrand {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Empty Brandcode URL or slug");
  }

  let baseUrl: string;
  let slug: string;

  // Try parsing as URL first
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed);
    baseUrl = `${url.protocol}//${url.host}`;
    const segments = url.pathname.split("/").filter(Boolean);

    // /start/brands/:slug
    const brandsIdx = segments.indexOf("brands");
    if (brandsIdx !== -1 && segments[brandsIdx + 1]) {
      slug = segments[brandsIdx + 1];
    }
    // /api/brand/hosted/:slug[/...]
    else if (
      segments[0] === "api" &&
      segments[1] === "brand" &&
      segments[2] === "hosted" &&
      segments[3]
    ) {
      slug = segments[3];
    } else {
      throw new Error(
        `Cannot extract brand slug from URL: ${trimmed}. ` +
          `Expected /start/brands/:slug or /api/brand/hosted/:slug`,
      );
    }
  } else {
    // Treat as bare slug
    if (/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
      slug = trimmed;
      baseUrl = DEFAULT_HOST;
    } else {
      throw new Error(
        `Invalid brand slug: "${trimmed}". Slugs must be lowercase alphanumeric with hyphens.`,
      );
    }
  }

  return {
    slug,
    baseUrl,
    detailUrl: `${baseUrl}/api/brand/hosted/${slug}`,
    connectUrl: `${baseUrl}/api/brand/hosted/${slug}/connect`,
    pullUrl: `${baseUrl}/api/brand/hosted/${slug}/pull`,
  };
}
