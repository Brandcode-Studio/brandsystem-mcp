import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import {
  postIntelligenceFindings,
  type ResearchFindingPayload,
  type ResearchRecipePayload,
} from "../connectors/brandcode/capture.js";
import { BrandcodeClientError } from "../connectors/brandcode/client.js";
import { isRefusal, requireStudioAuth, resolveCaptureTarget } from "./brand-capture-context.js";

// ── run_research_recipe ──────────────────────────────────────────────────────
// Inbound write-back: run a named research recipe from the edge and land its
// findings as intelligence candidates in the connected brand's review queue.
// The agent gathers findings (deep-research skill + Pendium), normalizes them to
// {statement, citations}, and this tool ingests them through the UCS evidence
// bar. Sourced findings queue; unsourced ones are refused (never fabricated).
// QUEUES candidates for human review — it NEVER promotes canon.
// UCS contracts: app/tools/lib/research-recipe.ts + intelligence-candidate.ts.

const citationShape = z.object({
  url: z.string().min(1).max(2000).describe("Source URL backing the finding."),
  title: z.string().max(300).optional().describe("Optional source title."),
});

const findingShape = z.object({
  statement: z
    .string()
    .min(1)
    .max(2000)
    .describe("One-sentence finding the research surfaced (a claim, gap, or pressure)."),
  citations: z
    .array(citationShape)
    .default([])
    .describe(
      "Sources backing the statement. A finding with NO citation is refused for proof_point/narrative by the evidence bar — never invent a source.",
    ),
  direction: z
    .enum(["supports", "gap", "escalate"])
    .optional()
    .describe(
      "What the finding implies. 'supports': reinforces a claim. 'gap': a missing proof. 'escalate': implies a new canonical claim or direction decision (routes to a named decision, not the queue).",
    ),
  confidence: z.number().min(0).max(1).optional().describe("0–1 confidence, if the run can estimate it."),
});

const paramsShape = {
  recipe_id: z
    .string()
    .min(1)
    .max(120)
    .describe("Stable id for the research recipe (e.g. 'competitor-claims-weekly')."),
  question: z
    .string()
    .min(1)
    .max(600)
    .describe("The research brief — what this recipe gathers."),
  findings: z
    .array(findingShape)
    .min(1)
    .describe(
      "Findings the agent gathered for this recipe run, each a statement + its citations. Run the brief first (deep-research skill / Pendium), normalize, then pass them here.",
    ),
  cadence: z
    .enum(["manual", "weekly", "on_signal"])
    .optional()
    .describe("How often this recipe is meant to run. Defaults to 'manual'."),
  default_target: z
    .enum(["proof_point", "narrative", "escalate"])
    .optional()
    .describe("Default canon target for findings that don't imply one. Defaults to 'proof_point' server-side."),
  brand: z
    .string()
    .optional()
    .describe("Brandcode brand slug or Studio URL. Defaults to the brand connected in this directory."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const target = await resolveCaptureTarget(input.brand);
  if (isRefusal(target)) return target.error;

  const auth = await requireStudioAuth();
  if (isRefusal(auth)) return auth.error;

  const recipe: ResearchRecipePayload = {
    id: input.recipe_id,
    question: input.question,
    cadence: input.cadence ?? "manual",
    defaultTarget: input.default_target,
  };
  const findings: ResearchFindingPayload[] = input.findings.map((f) => ({
    statement: f.statement,
    citations: f.citations ?? [],
    direction: f.direction,
    confidence: f.confidence,
  }));

  try {
    const result = await postIntelligenceFindings(
      target.baseUrl,
      target.slug,
      auth.token,
      recipe,
      findings,
    );
    if (!result.ok) {
      return buildResponse({
        what_happened: `Studio refused the recipe run: ${result.message ?? result.code ?? result.error ?? "unknown reason"}`,
        next_steps: ["Check the brand slug and your authority for this brand, then retry."],
        data: { error: result.code ?? result.error ?? "refused", brand: target.slug },
      });
    }

    const queued = result.outcomes.filter((o) => o.status === "queued").length;
    const escalated = result.outcomes.filter((o) => o.status === "escalated-to-decision").length;
    const refused = result.outcomes.filter((o) => o.status === "refused").length;

    const nextSteps: string[] = [
      "A brand admin reviews intelligence candidates in the Studio Brand review queue and decides what becomes canon.",
    ];
    if (refused > 0) {
      nextSteps.push(
        `${refused} finding(s) were refused — add a real source (URL) to each, then re-run. The route never fabricates a source.`,
      );
    }
    if (escalated > 0) {
      nextSteps.push(`${escalated} finding(s) escalated to a named decision (a possible new canonical claim or direction).`);
    }

    return buildResponse({
      what_happened: `Recipe "${recipe.id}" ran: ${queued} queued for review, ${escalated} escalated, ${refused} refused. Candidates are queued for human review — nothing was added to the brand.`,
      next_steps: nextSteps,
      data: {
        ran: true,
        brand: target.slug,
        recipe_id: recipe.id,
        count: result.count,
        queued,
        escalated,
        refused,
        canonical_mutation: false,
        outcomes: result.outcomes,
      },
    });
  } catch (err) {
    if (err instanceof BrandcodeClientError) {
      const authErr = err.status === 401 || err.status === 403;
      return buildResponse({
        what_happened: authErr
          ? `Studio rejected the request (${err.status}): you may not have authority for "${target.slug}".`
          : `Studio recipe run failed (${err.status}).`,
        next_steps: authErr
          ? ["Confirm you are signed in as an owner/admin of this brand (brand_brandcode_auth)."]
          : ["Nothing was recorded. Try again; if it persists, report via brand_feedback."],
        data: {
          error: authErr ? ERROR_CODES.NOT_AUTHENTICATED : "recipe_run_failed",
          status: err.status,
          brand: target.slug,
        },
      });
    }
    return buildResponse({
      what_happened: `Could not reach Brandcode Studio: ${(err as Error).message}`,
      next_steps: ["Check your connection and retry. Nothing was recorded."],
      data: { error: "network_error", brand: target.slug },
    });
  }
}

export function register(server: McpServer) {
  server.tool(
    "run_research_recipe",
    "Run a named research recipe from the edge and land its findings as intelligence candidates in the connected Brandcode brand's review queue. Use after gathering research (deep-research skill, Pendium, web) about a brand's market, competitors, proof claims, or narrative pressure: normalize what you found into findings (each a one-sentence statement + its source citations) and pass them here. The UCS evidence bar gates every finding — sourced findings queue for review, UNSOURCED findings are refused (never invent a citation), and findings that imply a new canonical claim escalate to a named decision. QUEUES candidates for human review; it NEVER promotes canon or adds anything to the brand. Defaults to the brand connected in this directory. Requires authentication (brand_brandcode_auth).",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
