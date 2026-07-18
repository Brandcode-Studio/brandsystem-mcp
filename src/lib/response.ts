import { z } from "zod";
import type { McpResponseData } from "../types/index.js";
import { ERROR_CODES } from "../types/index.js";
import { buildOnrampGuidance, type OnrampGuidance } from "./onramp.js";
import { trackToolCall as _trackToolCall } from "./telemetry.js";
export { trackToolCall, startToolTimer } from "./telemetry.js";

const MAX_RESPONSE_CHARS = 50000;
/** Standard per-response token target; entry tools have tighter budgets in tests. */
const RESPONSE_TOKEN_WARN = 1250;

/**
 * Parse an answers parameter that may arrive as a JSON string, a plain object,
 * or natural language. MCP clients differ in how they serialize tool args:
 * some send {"answers": "{\"key\":\"val\"}"} (string), others send
 * {"answers": {"key":"val"}} (object). This helper handles both gracefully.
 */
export function parseAnswers(raw: unknown): Record<string, unknown> {
  // Already an object (MCP client sent it properly)
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  // JSON string
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      return JSON.parse(trimmed);
    }
    // Plain text — wrap in a single "text" key so the handler can process it
    return { text: trimmed };
  }
  throw new Error("answers must be a JSON object or a JSON-encoded string");
}

/**
 * Safely parse tool args against a Zod schema. Returns either the parsed
 * data or a structured MCP error response the caller can return directly.
 */
export function safeParseParams<T extends z.ZodTypeAny>(
  schema: T,
  args: unknown,
): { success: true; data: z.infer<T> } | { success: false; response: ReturnType<typeof buildResponse> } {
  // Unknown-argument detection (#42): a misspelled key ("url" for
  // "website_url") silently swallowed costs agents a full round-trip.
  // Error messages teach: name the bad key, suggest the closest valid one.
  if (
    schema instanceof z.ZodObject &&
    args &&
    typeof args === "object" &&
    !Array.isArray(args)
  ) {
    const known = Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape);
    const unknown = Object.keys(args as Record<string, unknown>).filter(
      (k) => !known.includes(k)
    );
    if (unknown.length > 0) {
      const suggest = (bad: string): string | null => {
        let best: string | null = null;
        let bestScore = 0;
        for (const k of known) {
          const a = bad.toLowerCase();
          const b = k.toLowerCase();
          const overlap = [...a].filter((ch) => b.includes(ch)).length / Math.max(a.length, b.length);
          const contained = b.includes(a) || a.includes(b) ? 0.5 : 0;
          const score = overlap + contained;
          if (score > bestScore) { bestScore = score; best = k; }
        }
        // Substring containment (url ⊂ website_url) is the strongest signal
        // agents actually produce; 0.7 admits it while rejecting noise.
        return bestScore >= 0.7 ? best : null;
      };
      const details = unknown.map((k) => {
        const hint = suggest(k);
        return hint ? `"${k}" (did you mean "${hint}"?)` : `"${k}"`;
      });
      return {
        success: false,
        response: buildResponse({
          what_happened: `Unknown argument${unknown.length > 1 ? "s" : ""}: ${details.join(", ")}`,
          next_steps: [`Valid arguments: ${known.join(", ")}`, "Retry with the corrected argument names"],
          data: { error: ERROR_CODES.VALIDATION_FAILED, unknown_arguments: unknown, valid_arguments: known },
        }),
      };
    }
  }

  const result = schema.safeParse(args);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues.map(
    (i) => `${i.path.join(".")}: ${i.message}`,
  );
  return {
    success: false,
    response: buildResponse({
      what_happened: `Invalid input: ${issues.join(", ")}`,
      next_steps: ["Check the parameter types and try again"],
      data: { error: ERROR_CODES.VALIDATION_FAILED, issues },
    }),
  };
}

/** Cached onramp guidance — set once per session, reused across responses */
let _cachedOnramp: OnrampGuidance | null = null;
let _onrampChecked = false;
// Onramp guidance appears once per session — repeating it on every
// response is pure token noise for agents (Colovore field report, #42).
let _onrampShown = false;

/**
 * Check brand completeness and cache the onramp guidance for the session.
 * Call this once early (e.g., on first tool invocation) — subsequent calls
 * return the cached result. The cache prevents re-reading .brand/ on every
 * tool response.
 */
export async function checkOnramp(options?: { studioBaseUrl?: string }): Promise<OnrampGuidance> {
  if (_onrampChecked && _cachedOnramp) return _cachedOnramp;
  _cachedOnramp = await buildOnrampGuidance(options);
  _onrampChecked = true;
  return _cachedOnramp;
}

/**
 * Response envelope shape, exposed for outputSchema declaration at the
 * registration choke point (server.ts). structuredContent always matches:
 * { _metadata: { what_happened, next_steps }, ...tool data keys }.
 */
export const RESPONSE_ENVELOPE_SCHEMA = z
  .object({
    _metadata: z
      .object({
        what_happened: z.string(),
        next_steps: z.array(z.string()),
      })
      .passthrough(),
  })
  .passthrough(); // tool data keys live at the top level alongside _metadata

/** Rough token estimate for budget discipline (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Active tool profile, set by createServer — lets responses annotate
 * guidance that points at tools the current profile doesn't register (#42). */
let _activeProfile: "core" | "full" = "core";
let _coreToolNames: ReadonlySet<string> = new Set();
export function setActiveProfile(profile: "core" | "full", coreNames: ReadonlySet<string>): void {
  _activeProfile = profile;
  _coreToolNames = coreNames;
}

function annotateProfileGaps(steps: string[]): string[] {
  if (_activeProfile !== "core" || _coreToolNames.size === 0) return steps;
  return steps.map((step) => {
    const mentioned = step.match(/brand_[a-z_]+/g) ?? [];
    const fullOnly = [...new Set(mentioned)].filter((t) => !_coreToolNames.has(t));
    if (fullOnly.length === 0 || step.includes("--profile=full")) return step;
    return `${step} (${fullOnly.join(", ")} require${fullOnly.length === 1 ? "s" : ""} the full profile — restart the server with --profile=full or BRANDSYSTEM_PROFILE=full)`;
  });
}

export function buildResponse(input: McpResponseData): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  const output: Record<string, unknown> = {
    _metadata: {
      what_happened: input.what_happened,
      next_steps: annotateProfileGaps(input.next_steps),
    },
  };

  if (input.data) {
    Object.assign(output, input.data);
  }

  // Inject onramp guidance if brand context is thin (cached, non-blocking)
  if (_cachedOnramp?.shouldShow && !_onrampShown) {
    _onrampShown = true;
    output["brandcode_onramp"] = {
      message: _cachedOnramp.message,
      suggested_connector: _cachedOnramp.suggestedConnector,
      brand_loader_url: _cachedOnramp.brandLoaderUrl,
    };
  }

  // Response budget discipline (tokens, ~4 chars each): warn past the
  // standard target; never truncate mid-JSON — oversized responses drop
  // their largest data values behind a structured overflow marker instead,
  // so the payload stays valid JSON and the agent knows exactly what was
  // elided and how to get it back.
  // Compact serialization: agents parse, humans rarely read this raw, and
  // indentation costs ~25% of every response's token budget.
  let text = JSON.stringify(output);
  if (estimateTokens(text) > RESPONSE_TOKEN_WARN) {
    console.error(
      `[brandsystem] Response ~${estimateTokens(text)} tokens exceeds ${RESPONSE_TOKEN_WARN}-token target`
    );
  }

  while (text.length > MAX_RESPONSE_CHARS) {
    const candidates = Object.entries(output)
      .filter(([k]) => k !== "_metadata" && k !== "response_overflow")
      .map(([k, v]) => [k, JSON.stringify(v)?.length ?? 0] as const)
      .sort((a, b) => b[1] - a[1]);
    if (candidates.length === 0 || candidates[0][1] < 256) break;
    const [largestKey, size] = candidates[0];
    const overflow = (output["response_overflow"] ??= {}) as Record<string, unknown>;
    overflow[largestKey] = {
      elided: true,
      original_chars: size,
      message: `Value elided to stay under the response limit. Re-run with narrower parameters (e.g. a slice, page, or filter) to retrieve "${largestKey}".`,
    };
    delete output[largestKey];
    text = JSON.stringify(output);
  }

  // Auto-telemetry: track every tool response (opt-in via BRANDSYSTEM_TELEMETRY)
  const isError = !!(input.data && typeof input.data === "object" && "error" in input.data);
  _trackToolCall({
    tool: input.what_happened.split(":")[0].split("—")[0].trim().toLowerCase().replace(/\s+/g, "_").slice(0, 50),
    success: !isError,
    error_code: isError ? String((input.data as Record<string, unknown>).error) : undefined,
  });

  return {
    content: [{ type: "text", text }],
    // Structured twin of the text payload (MCP structuredContent). Same
    // object — clients get typed access, text remains the fallback.
    structuredContent: output,
  };
}
