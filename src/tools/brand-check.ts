import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import { runBrandCheck, getBrandPalette } from "../lib/brand-check-engine.js";
import {
  ensureLiveFreshness,
  buildLiveIndicator,
} from "../connectors/brandcode/live-source.js";

const paramsShape = {
  text: z
    .string()
    .optional()
    .describe(
      'Text to check for voice violations (never-say words, anchor term misuse, AI-isms). Example: "We leverage cutting-edge AI solutions"',
    ),
  color: z
    .string()
    .optional()
    .describe(
      'Hex color to check against the brand palette. Returns nearest brand color with perceptual distance (ΔE). Example: "#3b82f6"',
    ),
  font: z
    .string()
    .optional()
    .describe(
      'Font family name to check against brand typography. Example: "Helvetica"',
    ),
  css: z
    .string()
    .optional()
    .describe(
      'CSS snippet to check for visual anti-pattern violations (shadows, gradients, etc.). Example: "box-shadow: 0 2px 4px rgba(0,0,0,0.1)"',
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const cwd = process.cwd();

  // Require at least one input
  if (!input.text && !input.color && !input.font && !input.css) {
    return buildResponse({
      what_happened: "No input provided — pass at least one of: text, color, font, css",
      next_steps: [
        'Check text: brand_check text="We leverage AI solutions"',
        'Check color: brand_check color="#3b82f6"',
        'Check font: brand_check font="Helvetica"',
        'Check CSS: brand_check css="box-shadow: 0 2px 4px rgba(0,0,0,0.1)"',
      ],
      data: { error: ERROR_CODES.NO_INPUT },
    });
  }

  const live = await ensureLiveFreshness(cwd);
  const liveIndicator = buildLiveIndicator(live);

  const result = await runBrandCheck(cwd, {
    text: input.text,
    color: input.color,
    font: input.font,
    css: input.css,
  });

  if (!result) {
    return buildResponse({
      what_happened: "No compiled brand data found — run brand_compile first",
      next_steps: [
        "brand_check requires brand-runtime.json and interaction-policy.json",
        "Run brand_compile to generate them from your .brand/ data",
      ],
      data: { error: ERROR_CODES.NOT_COMPILED },
    });
  }

  // Build concise response
  const { pass, flags, checked } = result;

  if (pass && flags.length === 0) {
    return buildResponse({
      what_happened: `Brand check passed (${checked.join(", ")})`,
      next_steps: [],
      data: {
        pass: true,
        checked,
        flags: [],
        ...(liveIndicator ? { live: liveIndicator } : {}),
      },
    });
  }

  // Summarize flags by type
  const errorCount = flags.filter((f) => f.severity === "error").length;
  const warnCount = flags.filter((f) => f.severity === "warning").length;
  const infoCount = flags.filter((f) => f.severity === "info").length;

  const parts: string[] = [];
  if (errorCount > 0) parts.push(`${errorCount} error(s)`);
  if (warnCount > 0) parts.push(`${warnCount} warning(s)`);
  if (infoCount > 0) parts.push(`${infoCount} info`);

  // Include palette when checking colors (helps agents self-correct)
  let palette: Array<{ name: string; hex: string }> | null = null;
  if (input.color && !pass) {
    palette = await getBrandPalette(cwd);
  }

  const data: Record<string, unknown> = {
    pass,
    checked,
    flags,
  };
  if (palette) {
    data.brand_palette = palette;
  }
  if (liveIndicator) {
    data.live = liveIndicator;
  }

  return buildResponse({
    what_happened: `Brand check ${pass ? "passed" : "failed"}: ${parts.join(", ")} (${checked.join(", ")})`,
    next_steps: pass
      ? []
      : flags
          .filter((f) => f.fix)
          .slice(0, 3)
          .map((f) => f.fix!),
    data,
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_check",
    "Inline brand linter — call this WHILE writing content or code, the way you call a type-checker. <50ms pass/fail on any combination of text (voice/never-say/AI-isms), color (palette match with ΔE distance), font (typography match), or css (anti-pattern violations). Designed for tight loops: write a sentence, brand_check it, fix, continue. Returns specific actionable fixes per failed input. Requires brand_compile to have run first. NOT a publish-time gate — use brand_check_compliance for the single PASS/FAIL verdict before shipping. NOT for 0-100 scoring — use brand_audit_content. NOT for HTML/CSS rule violations — use brand_preflight.",
    paramsShape,
    { title: "Quick brand check", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
