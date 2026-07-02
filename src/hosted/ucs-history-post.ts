/**
 * Shared request-building for POSTs to UCS's
 * `/api/brand/hosted/{slug}/agent/history` endpoint.
 *
 * Both feedback-fetcher.ts (brand_feedback's explicit append) and
 * telemetry.ts (AgentRun telemetry for every hosted tool call) send the
 * same `{ entry }` envelope to the same endpoint with the same auth/timeout
 * shape but need different handling of the response: feedback throws typed
 * errors callers branch on; telemetry logs and swallows everything. This
 * module stops at "build and dispatch the request" and returns the raw
 * Response, leaving each caller's distinct response handling untouched.
 */
const USER_AGENT = "brandcode-mcp";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface UcsHistoryPostOptions {
  ucsBaseUrl: string;
  ucsServiceToken: string;
  slug: string;
  entry: Record<string, unknown>;
  signal?: AbortSignal;
}

/** Dispatches the POST. Throws on network failure (native fetch behavior); does not inspect the response status. */
export function postUcsHistoryEntry(
  opts: UcsHistoryPostOptions,
): Promise<Response> {
  const url = new URL(
    `/api/brand/hosted/${encodeURIComponent(opts.slug)}/agent/history`,
    opts.ucsBaseUrl,
  );
  return fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      authorization: `Bearer ${opts.ucsServiceToken}`,
    },
    body: JSON.stringify({ entry: opts.entry }),
    signal: opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
}
