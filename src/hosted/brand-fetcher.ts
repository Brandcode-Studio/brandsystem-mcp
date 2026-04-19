/**
 * Service-token authenticated fetcher for UCS hosted brand packages.
 *
 * Used by hosted-surface tools to resolve a brand slug into its governance
 * payload. All calls carry the hosted MCP's service token (UCS matches it
 * against BRANDCODE_MCP_SERVICE_TOKEN). Bearer-token scope is enforced before
 * this runs — the fetcher trusts its input.
 */
import type { BrandPackagePayload, PullResult } from "../connectors/brandcode/types.js";

const USER_AGENT = "brandcode-mcp";
const DEFAULT_TIMEOUT_MS = 15_000;

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface FetchBrandOptions {
  ucsBaseUrl: string;
  ucsServiceToken: string;
  slug: string;
  /** Optional signal for request cancellation. */
  signal?: AbortSignal;
}

export async function fetchHostedBrandPackage(
  opts: FetchBrandOptions,
): Promise<BrandPackagePayload | null> {
  const url = `${opts.ucsBaseUrl}/api/brand/hosted/${encodeURIComponent(opts.slug)}/pull`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
        authorization: `Bearer ${opts.ucsServiceToken}`,
      },
      signal: opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new UpstreamError(
      502,
      "ucs_unreachable",
      `UCS pull failed: ${(err as Error).message}`,
    );
  }

  if (response.status === 404) {
    return null;
  }

  if (response.status === 401 || response.status === 403) {
    throw new UpstreamError(
      502,
      "ucs_auth",
      `UCS rejected service token (${response.status})`,
    );
  }

  if (!response.ok) {
    throw new UpstreamError(
      502,
      "ucs_error",
      `UCS returned ${response.status}`,
    );
  }

  const body = (await response.json()) as PullResult;
  return body.package ?? null;
}
