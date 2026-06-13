import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import {
  postTasteCapture,
  type TasteCapturePayload,
} from "../connectors/brandcode/capture.js";
import { BrandcodeClientError } from "../connectors/brandcode/client.js";
import { isRefusal, requireStudioAuth, resolveCaptureTarget } from "./brand-capture-context.js";

// ── capture_taste ──────────────────────────────────────────────────────────────
// Inbound write-back: send an attribute-level taste judgment from the edge
// (chat/code) into the connected brand's review queue in Brandcode Studio.
// This QUEUES a candidate for human review — it never adds anything to the brand.
// UCS contract: app/tools/lib/edge-taste-capture.ts via the taste-capture route.

const paramsShape = {
  candidate_ref: z
    .string()
    .min(1)
    .max(255)
    .describe(
      "Stable reference to the thing you are judging — an id, blob key, file path, or short label (e.g. 'variant-851', 'hero-headline-v3').",
    ),
  verdict: z
    .enum(["distinctive", "generic", "flag"])
    .describe(
      "Your taste judgment. 'distinctive': distinctively on-brand, worth keeping. 'generic': technically correct but generic/forgettable. 'flag': needs human review for a reason you name.",
    ),
  attribute_reason: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "REQUIRED. What SPECIFICALLY worked or failed — the attribute, not a vague verdict. e.g. 'the asymmetric crop and editorial caption feel like us; the stock-gradient background does not.' This is the load-bearing field; the capture is refused without it.",
    ),
  candidate_text: z
    .string()
    .max(4000)
    .optional()
    .describe("Optional description of the candidate (copy, layout notes). Images are referenced by candidate_ref, not pasted."),
  surface: z
    .enum(["chat", "code", "studio"])
    .optional()
    .describe("Where the judgment was made. Defaults to 'chat'."),
  brand: z
    .string()
    .optional()
    .describe(
      "Brandcode brand slug or Studio URL. Optional — defaults to the brand connected in this directory (brand_brandcode_connect).",
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const target = await resolveCaptureTarget(input.brand);
  if (isRefusal(target)) return target.error;

  const auth = await requireStudioAuth();
  if (isRefusal(auth)) return auth.error;

  const payload: TasteCapturePayload = {
    candidateRef: input.candidate_ref,
    candidateText: input.candidate_text ?? null,
    verdict: input.verdict,
    attributeReason: input.attribute_reason,
    surface: input.surface ?? "chat",
    actor: auth.email,
  };

  try {
    const result = await postTasteCapture(target.baseUrl, target.slug, auth.token, payload);
    if (!result.ok) {
      return buildResponse({
        what_happened: `Studio refused the capture: ${result.message ?? result.code ?? result.error ?? "unknown reason"}`,
        next_steps: [
          result.code === "missing_reason"
            ? "Add a specific attribute_reason — what exactly worked or failed."
            : "Check the brand slug and your authority for this brand, then retry.",
        ],
        data: { error: result.code ?? result.error ?? "refused", brand: target.slug },
      });
    }
    return buildResponse({
      what_happened: `Taste captured for review on "${target.slug}"${result.quarantined ? " (flagged for review — content matched an injection pattern)" : ""}. This is queued for a human to review — it has NOT been added to the brand.`,
      next_steps: [
        "A brand admin reviews captures in the Studio Brand review queue and decides what becomes canon.",
        "Capture more judgments to strengthen the brand's taste signal.",
      ],
      data: {
        captured: true,
        routed: "queued",
        brand: target.slug,
        candidate_ref: input.candidate_ref,
        verdict: input.verdict,
        quarantined: result.quarantined,
        canonical_mutation: false,
        ref: result.ref,
      },
    });
  } catch (err) {
    if (err instanceof BrandcodeClientError) {
      const auth = err.status === 401 || err.status === 403;
      return buildResponse({
        what_happened: auth
          ? `Studio rejected the request (${err.status}): you may not have authority for "${target.slug}".`
          : `Studio capture failed (${err.status}).`,
        next_steps: auth
          ? ["Confirm you are signed in as an owner/admin of this brand (brand_brandcode_auth)."]
          : ["The capture was not recorded. Try again; if it persists, report via brand_feedback."],
        data: { error: auth ? ERROR_CODES.NOT_AUTHENTICATED : "capture_failed", status: err.status, brand: target.slug },
      });
    }
    return buildResponse({
      what_happened: `Could not reach Brandcode Studio: ${(err as Error).message}`,
      next_steps: ["Check your connection and retry. The capture was not recorded."],
      data: { error: "network_error", brand: target.slug },
    });
  }
}

export function register(server: McpServer) {
  server.tool(
    "capture_taste",
    "Capture an attribute-level taste judgment from the edge (chat/code) into the connected Brandcode brand's review queue. Use when you or the user judges a specific candidate — a variant, headline, layout, asset — as distinctively on-brand, generic, or needing review, AND can say WHAT specifically worked or failed. Distinct from brand_feedback (which is tool/workflow telemetry): this captures BRAND TASTE with its attribute reason. Requires candidate_ref, verdict (distinctive|generic|flag), and attribute_reason (the load-bearing field — refused if blank). QUEUES the judgment for human review in Studio; it NEVER adds anything to the brand or promotes canon. Defaults to the brand connected in this directory; pass `brand` to target another. Requires authentication (brand_brandcode_auth).",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
