/**
 * Service-token authenticated fetcher for UCS hosted AgentRun history.
 *
 * This is read-only. It intentionally calls the UCS GET history route and does
 * not wire telemetry POST or feedback append behavior.
 */
const USER_AGENT = "brandcode-mcp";
const DEFAULT_TIMEOUT_MS = 15_000;

export class HistoryUpstreamError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public upstreamStatus?: number,
  ) {
    super(message);
    this.name = "HistoryUpstreamError";
  }
}

export interface FetchHostedHistoryOptions {
  ucsBaseUrl: string;
  ucsServiceToken: string;
  slug: string;
  limit: number;
  /** Accepted by the tool for future compatibility; UCS GET has no cursor yet. */
  cursor?: string;
  signal?: AbortSignal;
}

export async function fetchHostedAgentHistory(
  opts: FetchHostedHistoryOptions,
): Promise<unknown> {
  const url = new URL(
    `/api/brand/hosted/${encodeURIComponent(opts.slug)}/agent/history`,
    opts.ucsBaseUrl,
  );
  // Filter by the first-class `mcp-hosted` surface (UCS AgentSupportSurface).
  // We intentionally do NOT send provider=mcp: UCS models provider as the
  // downstream model (openai|claude|gemini), not the transport, so an "mcp"
  // provider filter matches nothing. Surface is the correct discriminator.
  url.searchParams.set("surface", "mcp-hosted");
  url.searchParams.set("limit", String(opts.limit));

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
    throw new HistoryUpstreamError(
      502,
      "ucs_unreachable",
      `UCS history fetch failed: ${(err as Error).message}`,
    );
  }

  const body = await response.json().catch(() => null);
  const message =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).error
      : null;

  if (response.status === 404) {
    throw new HistoryUpstreamError(
      404,
      "hosted_brand_not_found",
      typeof message === "string" ? message : "Hosted brand not found",
      response.status,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new HistoryUpstreamError(
      502,
      "ucs_auth",
      `UCS rejected service token (${response.status})`,
      response.status,
    );
  }

  if (!response.ok) {
    throw new HistoryUpstreamError(
      502,
      "ucs_error",
      typeof message === "string" ? message : `UCS returned ${response.status}`,
      response.status,
    );
  }

  return body;
}
