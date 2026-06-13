/**
 * Hosted `capture_taste` tool.
 *
 * Captures attribute-level taste judgments into UCS for review. This is a
 * hosted contribute action: it queues a candidate for human review and never
 * promotes canon.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../../lib/response.js";
import {
  postTasteCapture,
  type TasteCapturePayload,
} from "../../connectors/brandcode/capture.js";
import { BrandcodeClientError } from "../../connectors/brandcode/client.js";
import { enforceToolScope } from "../scope.js";
import type { HostedBrandContext } from "../types.js";

const paramsShape = {
  candidate_ref: z
    .string()
    .min(1)
    .max(255)
    .describe(
      "Stable reference to the candidate being judged: id, blob key, file path, or short label.",
    ),
  verdict: z
    .enum(["distinctive", "generic", "flag"])
    .describe(
      "Taste judgment: distinctive, generic, or flag for human review.",
    ),
  attribute_reason: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "Required specific attribute-level reason: what worked or failed, not a vague verdict.",
    ),
  candidate_text: z
    .string()
    .max(4000)
    .optional()
    .describe("Optional candidate copy or layout notes. Images should be referenced by candidate_ref."),
  surface: z
    .enum(["chat", "code", "studio"])
    .optional()
    .describe("Where the judgment was made. Defaults to chat."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

function buildPayload(input: Params, context: HostedBrandContext): TasteCapturePayload {
  return {
    candidateRef: input.candidate_ref,
    candidateText: input.candidate_text ?? null,
    verdict: input.verdict,
    attributeReason: input.attribute_reason,
    surface: input.surface ?? "chat",
    actor: `brandcode-mcp:${context.auth.keyId}`,
  };
}

function refusedResponse(
  context: HostedBrandContext,
  input: Params,
  result: { code?: string; error?: string; message?: string },
) {
  const code = result.code ?? result.error ?? "refused";
  return buildResponse({
    what_happened: `UCS refused the taste capture for "${context.slug}": ${result.message ?? code}`,
    next_steps: [
      code === "missing_reason"
        ? "Call capture_taste with a specific attribute_reason naming what worked or failed"
        : "Check the brand slug and hosted capture authority, then retry",
    ],
    data: {
      error: code,
      brand: context.slug,
      candidate_ref: input.candidate_ref,
      canonical_mutation: false,
    },
  });
}

function upstreamErrorResponse(
  context: HostedBrandContext,
  input: Params,
  err: BrandcodeClientError,
) {
  const authError = err.status === 401 || err.status === 403;
  return buildResponse({
    what_happened: authError
      ? `UCS rejected hosted capture authority for "${context.slug}" (${err.status}).`
      : `UCS taste capture failed for "${context.slug}" (${err.status}).`,
    next_steps: authError
      ? ["Check the hosted MCP UCS service token configuration"]
      : ["Retry in a moment or inspect the UCS taste-capture route"],
    data: {
      error: authError ? "ucs_auth" : "capture_failed",
      status: authError ? 502 : 502,
      upstream_status: err.status,
      brand: context.slug,
      candidate_ref: input.candidate_ref,
      canonical_mutation: false,
    },
  });
}

export function registerCaptureTaste(
  server: McpServer,
  context: HostedBrandContext,
) {
  server.tool(
    "capture_taste",
    "Capture an attribute-level taste judgment into this hosted brand's review queue. Requires capture scope, candidate_ref, verdict, and attribute_reason. Queues for human review; never promotes canon.",
    paramsShape,
    async (args) => {
      const scopeError = enforceToolScope("capture_taste", context);
      if (scopeError) return scopeError;

      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;

      try {
        const result = await postTasteCapture(
          context.ucsBaseUrl,
          context.slug,
          context.ucsServiceToken,
          buildPayload(parsed.data, context),
        );
        if (!result.ok) return refusedResponse(context, parsed.data, result);

        return buildResponse({
          what_happened: `Taste captured for review on "${context.slug}"${result.quarantined ? " (flagged for review — content matched an injection pattern)" : ""}. This is queued for a human to review — it has NOT been added to the brand.`,
          next_steps: [
            "Review the captured taste signal in Brandcode Studio before promoting anything to canon",
            "Capture more judgments to strengthen the brand's taste signal",
          ],
          data: {
            captured: true,
            routed: "queued",
            brand: context.slug,
            candidate_ref: parsed.data.candidate_ref,
            verdict: parsed.data.verdict,
            quarantined: result.quarantined,
            canonical_mutation: false,
            ref: result.ref,
          },
        });
      } catch (err) {
        if (err instanceof BrandcodeClientError) {
          return upstreamErrorResponse(context, parsed.data, err);
        }
        return buildResponse({
          what_happened: `Could not reach UCS taste capture for "${context.slug}": ${(err as Error).message}`,
          next_steps: ["Check hosted connectivity and retry. The capture was not recorded."],
          data: {
            error: "network_error",
            brand: context.slug,
            candidate_ref: parsed.data.candidate_ref,
            canonical_mutation: false,
          },
        });
      }
    },
  );
}
