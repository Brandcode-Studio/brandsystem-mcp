/**
 * Failure signals → feedback offer.
 *
 * The default Core profile keeps brand_feedback out of tools/list so the
 * first-tool surface stays at 12. When a tool response shows a clear,
 * already-existing failure signal, server.ts reveals brand_feedback for the
 * rest of the session (notifications/tools/list_changed) and appends one
 * next_steps line to that failing response, for clients that ignore
 * list_changed. Nothing is ever sent automatically: brand_feedback only
 * POSTs when an agent explicitly calls it.
 *
 * Signals are deliberately limited to what tools already report — no new
 * heuristics:
 *   - isError: true (the server.ts error fence)
 *   - response_overflow (buildResponse had to elide data)
 *   - an error code meaning "the tool tried and failed" (fetch/parse/render),
 *     as opposed to precondition or input errors such as not_initialized
 *   - extraction_quality.score === "LOW" (brand_start, brand_extract_web)
 *   - brand_extract_pdf finishing with no colors and no typography
 */

export const FEEDBACK_TOOL_NAME = "brand_feedback";

/** Tools registered but hidden in the core profile until a failure signal. */
export const FAILURE_REVEALED_TOOL_NAMES: ReadonlySet<string> = new Set([FEEDBACK_TOOL_NAME]);

/**
 * The one next_steps line added to failing responses. Accurate to what
 * brand_feedback sends: the agent-written report fields (category, summary,
 * detail, tool name, optional error context) — never .brand/ files.
 */
export const FEEDBACK_OFFER_STEP =
  "If this result looks wrong, run brand_feedback to report it. It sends the short note you write (not your .brand/ files) to the Brandcode team; nothing is sent unless you call it.";

/** Error codes that mean the tool attempted the work and it failed. */
const FAILURE_ERROR_CODES: ReadonlySet<string> = new Set([
  "tool_execution_failed", // server.ts error fence
  "fetch_failed",
  "auto_fetch_failed",
  "parse_failed",
  "render_failed",
]);

export type FailureSignal =
  | "tool_error"
  | "response_overflow"
  | "tool_failure_code"
  | "low_extraction_quality"
  | "empty_extraction";

interface ToolResultLike {
  isError?: unknown;
  structuredContent?: unknown;
  content?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

/** Return the first failure signal a tool result carries, or null. */
export function detectFailureSignal(toolName: string, result: unknown): FailureSignal | null {
  const r = asRecord(result) as ToolResultLike | null;
  if (!r) return null;
  if (r.isError === true) return "tool_error";

  const data = asRecord(r.structuredContent);
  if (!data) return null;
  if ("response_overflow" in data) return "response_overflow";
  if (typeof data.error === "string" && FAILURE_ERROR_CODES.has(data.error)) {
    return "tool_failure_code";
  }

  const quality = asRecord(data.extraction_quality);
  if (quality?.score === "LOW") return "low_extraction_quality";

  if (toolName === "brand_extract_pdf" && data.success === true) {
    const extracted = asRecord(data.extracted);
    if (extracted && isEmptyArray(extracted.colors) && isEmptyArray(extracted.typography)) {
      return "empty_extraction";
    }
  }
  return null;
}

/**
 * Append FEEDBACK_OFFER_STEP to a buildResponse-shaped result, replacing any
 * older brand_feedback mention so the line appears exactly once. Mutates and
 * returns the result; the text twin is re-serialized only where it mirrors
 * structuredContent (other content items, e.g. screenshots, are untouched).
 */
export function appendFeedbackOffer<T>(result: T): T {
  const r = asRecord(result) as ToolResultLike | null;
  const data = asRecord(r?.structuredContent);
  const meta = asRecord(data?._metadata);
  if (!r || !data || !meta || !Array.isArray(meta.next_steps)) return result;

  const before = JSON.stringify(data);
  const steps = (meta.next_steps as unknown[]).filter(
    (step) => !(typeof step === "string" && step.includes(FEEDBACK_TOOL_NAME))
  );
  steps.push(FEEDBACK_OFFER_STEP);
  meta.next_steps = steps;
  const after = JSON.stringify(data);

  if (Array.isArray(r.content)) {
    for (const item of r.content as Array<Record<string, unknown>>) {
      if (item?.type === "text" && item.text === before) item.text = after;
    }
  }
  return result;
}
