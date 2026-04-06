import { z } from "zod";
import type { McpResponseData } from "../types/index.js";
import { ERROR_CODES } from "../types/index.js";

const MAX_RESPONSE_CHARS = 50000;

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

export function buildResponse(input: McpResponseData): {
  content: Array<{ type: "text"; text: string }>;
} {
  const output: Record<string, unknown> = {
    _metadata: {
      what_happened: input.what_happened,
      next_steps: input.next_steps,
    },
  };

  if (input.data) {
    Object.assign(output, input.data);
  }

  // Response size discipline: warn if over 5K chars
  let text = JSON.stringify(output, null, 2);
  if (text.length > 5000) {
    console.error(
      `[brandsystem] Response size ${text.length} chars exceeds 5K target`
    );
  }

  // Hard truncation with warning for very large responses
  if (text.length > MAX_RESPONSE_CHARS) {
    output["response_size_warning"] = {
      original_chars: text.length,
      truncated_to: MAX_RESPONSE_CHARS,
      message: "Response was truncated. Some data may be missing. Use more specific parameters to reduce response size.",
    };
    // Re-serialize with warning included, then truncate
    text = JSON.stringify(output, null, 2);
    if (text.length > MAX_RESPONSE_CHARS) {
      text = text.substring(0, MAX_RESPONSE_CHARS) + "\n...[TRUNCATED]";
    }
  }

  return {
    content: [{ type: "text", text }],
  };
}
