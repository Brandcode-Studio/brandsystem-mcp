/**
 * Shared resolve + auth for the inbound capture tools (capture_taste,
 * run_research_recipe). Both target a connected Brandcode brand and post under
 * the user's session bearer; this centralizes the "which brand + are we signed
 * in" gate so each tool refuses identically before any write.
 */

import { buildResponse } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import { resolveBrandcodeHostedUrl } from "../connectors/brandcode/resolve.js";
import { readConnectorConfig } from "../connectors/brandcode/persistence.js";
import { readAuthCredentials } from "../lib/auth-state.js";

export type CaptureTarget = { baseUrl: string; slug: string };
type Refusal = { error: ReturnType<typeof buildResponse> };

/**
 * Resolve the brand to capture into. Explicit `brand` (slug or Studio URL) wins;
 * otherwise falls back to the brand connected in the current directory. Returns
 * a ready-to-return refusal response when neither resolves.
 */
export async function resolveCaptureTarget(brand?: string): Promise<CaptureTarget | Refusal> {
  if (brand) {
    try {
      const resolved = resolveBrandcodeHostedUrl(brand);
      return { baseUrl: resolved.baseUrl, slug: resolved.slug };
    } catch (err) {
      return {
        error: buildResponse({
          what_happened: `Could not resolve brand "${brand}": ${(err as Error).message}`,
          next_steps: ["Pass a brand slug (e.g. 'acme') or a Studio brand URL."],
          data: { error: ERROR_CODES.VALIDATION_FAILED },
        }),
      };
    }
  }
  const config = await readConnectorConfig(process.cwd());
  if (!config) {
    return {
      error: buildResponse({
        what_happened: "No connected brand found in this directory.",
        next_steps: ["Run brand_brandcode_connect with a Studio brand URL, or pass `brand` explicitly."],
        data: { error: ERROR_CODES.NOT_FOUND },
      }),
    };
  }
  const resolved = resolveBrandcodeHostedUrl(config.brandUrl);
  return { baseUrl: resolved.baseUrl, slug: resolved.slug };
}

export type StudioAuth = { token: string; email: string };

/** Read the stored Studio session, or a ready-to-return NOT_AUTHENTICATED refusal. */
export async function requireStudioAuth(): Promise<StudioAuth | Refusal> {
  const creds = await readAuthCredentials(process.cwd());
  if (!creds) {
    return {
      error: buildResponse({
        what_happened: "Not authenticated with Brandcode Studio.",
        next_steps: ["Run brand_brandcode_auth to sign in, then try again."],
        data: { error: ERROR_CODES.NOT_AUTHENTICATED },
      }),
    };
  }
  return { token: creds.token, email: creds.email };
}

export function isRefusal(value: unknown): value is Refusal {
  return Boolean(value) && typeof value === "object" && "error" in (value as Record<string, unknown>);
}
