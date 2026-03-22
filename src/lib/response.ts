import type { McpResponseData } from "../types/index.js";

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

  const text = JSON.stringify(output, null, 2);

  // Response size discipline: warn if over 5K chars
  if (text.length > 5000) {
    console.error(
      `[brandsystem] Response size ${text.length} chars exceeds 5K target`
    );
  }

  return {
    content: [{ type: "text", text }],
  };
}
