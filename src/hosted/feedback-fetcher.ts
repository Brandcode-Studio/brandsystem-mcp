/**
 * Service-token authenticated append helper for hosted MCP feedback.
 *
 * This writes only the explicit brand_feedback entry to UCS AgentRun history.
 * It is not general telemetry and does not mutate canonical governance.
 */
import { postUcsHistoryEntry } from "./ucs-history-post.js";

export class FeedbackUpstreamError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public upstreamStatus?: number,
  ) {
    super(message);
    this.name = "FeedbackUpstreamError";
  }
}

export interface AppendHostedFeedbackOptions {
  ucsBaseUrl: string;
  ucsServiceToken: string;
  slug: string;
  entry: Record<string, unknown>;
  signal?: AbortSignal;
}

export async function appendHostedFeedback(
  opts: AppendHostedFeedbackOptions,
): Promise<unknown> {
  let response: Response;
  try {
    response = await postUcsHistoryEntry(opts);
  } catch (err) {
    throw new FeedbackUpstreamError(
      502,
      "ucs_unreachable",
      `UCS feedback append failed: ${(err as Error).message}`,
    );
  }

  const body = await response.json().catch(() => null);
  const message =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).error
      : null;

  if (response.status === 400) {
    throw new FeedbackUpstreamError(
      400,
      "ucs_history_contract_error",
      typeof message === "string"
        ? message
        : "UCS rejected the AgentRunHistoryEntry feedback contract",
      response.status,
    );
  }

  if (response.status === 404) {
    throw new FeedbackUpstreamError(
      404,
      "hosted_brand_not_found",
      typeof message === "string" ? message : "Hosted brand not found",
      response.status,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new FeedbackUpstreamError(
      502,
      "ucs_auth",
      `UCS rejected service token (${response.status})`,
      response.status,
    );
  }

  if (!response.ok) {
    throw new FeedbackUpstreamError(
      502,
      "ucs_error",
      typeof message === "string" ? message : `UCS returned ${response.status}`,
      response.status,
    );
  }

  return body;
}
