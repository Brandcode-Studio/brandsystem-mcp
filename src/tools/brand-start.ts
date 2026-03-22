import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { SCHEMA_VERSION } from "../schemas/index.js";

const paramsShape = {
  client_name: z.string().describe("Company or brand name"),
  website_url: z.string().optional().describe("Company website URL"),
  industry: z.string().optional().describe("Industry vertical (e.g. 'fintech', 'healthcare')"),
};

type Params = { client_name: string; website_url?: string; industry?: string };

interface SourceOption {
  key: string;
  label: string;
  description: string;
  tool_to_run: string;
  recommended: boolean;
  ready: boolean;
  ready_reason?: string;
}

function buildSourceMenu(websiteUrl?: string): SourceOption[] {
  return [
    {
      key: "A",
      label: "Scan your website",
      description: "Pull colors, fonts, and logo directly from your live site. Lowest friction — no files needed.",
      tool_to_run: "brand_extract_web",
      recommended: true,
      ready: true,
      ...(websiteUrl
        ? { ready_reason: `URL "${websiteUrl}" provided — can start immediately` }
        : { ready_reason: "Just needs a URL" }),
    },
    {
      key: "B",
      label: "Connect to Figma",
      description: "Extract design tokens, colors, and typography from a Figma design file.",
      tool_to_run: "brand_extract_figma",
      recommended: false,
      ready: false,
      ready_reason: "Requires a Figma file key",
    },
    {
      key: "C",
      label: "Upload brand guidelines",
      description: "Share a PDF or document with your brand guidelines and we'll extract the values.",
      tool_to_run: "(manual — ask user for the file, then extract values into core-identity)",
      recommended: false,
      ready: false,
      ready_reason: "User needs to provide a file",
    },
    {
      key: "D",
      label: "Upload an on-brand asset",
      description: "Share a known-good file (social graphic, presentation, screenshot) to sample colors and fonts from.",
      tool_to_run: "(manual — analyze the asset and extract brand values)",
      recommended: false,
      ready: false,
      ready_reason: "User needs to provide a file",
    },
    {
      key: "E",
      label: "Start from scratch",
      description: "Skip extraction entirely. Manually enter colors, fonts, and logo values.",
      tool_to_run: "(manual entry — no extraction tool needed)",
      recommended: false,
      ready: true,
    },
  ];
}

async function handleExistingBrand(brandDir: BrandDir): Promise<ReturnType<typeof buildResponse>> {
  const config = await brandDir.readConfig();
  const identity = await brandDir.readCoreIdentity();

  const hasColors = identity.colors.length > 0;
  const hasTypography = identity.typography.length > 0;
  const hasLogo = identity.logo.length > 0;
  const hasPrimary = identity.colors.some((c) => c.role === "primary");

  const gaps: string[] = [];
  if (!hasColors) gaps.push("colors");
  if (!hasTypography) gaps.push("typography");
  if (!hasLogo) gaps.push("logo");
  if (hasColors && !hasPrimary) gaps.push("primary color role");

  const nextSteps: string[] = [];
  if (gaps.length > 0) {
    nextSteps.push(`Missing: ${gaps.join(", ")}. Run brand_extract_web or brand_extract_figma to fill gaps`);
  }
  if (hasColors && hasTypography) {
    nextSteps.push("Run brand_compile to generate tokens.json");
  }
  nextSteps.push("Run brand_status for full details");
  nextSteps.push("Run brand_report to generate a portable brand identity report");

  return buildResponse({
    what_happened: `Brand system already exists for "${config.client_name}" (session ${config.session})`,
    next_steps: nextSteps,
    data: {
      existing: true,
      client_name: config.client_name,
      summary: {
        colors: identity.colors.length,
        typography: identity.typography.length,
        logos: identity.logo.length,
        has_primary: hasPrimary,
        gaps: gaps.length > 0 ? gaps : "none",
      },
      conversation_guide: {
        instruction:
          gaps.length > 0
            ? `The brand system has gaps (${gaps.join(", ")}). Present the summary, then suggest extraction tools to fill what's missing.`
            : "The brand system has core identity populated. Suggest compiling tokens or generating a report.",
      },
    },
  });
}

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  // If .brand/ already exists, return status + actionable next steps
  if (await brandDir.exists()) {
    return handleExistingBrand(brandDir);
  }

  // Initialize the .brand/ directory (shared logic with brand_init)
  await brandDir.initBrand({
    schema_version: SCHEMA_VERSION,
    session: 1,
    client_name: input.client_name,
    industry: input.industry,
    website_url: input.website_url,
    created_at: new Date().toISOString(),
  });

  const sourceMenu = buildSourceMenu(input.website_url);
  const recommended = "A";

  const nextSteps = [
    "Present the source menu below and ask the user how they'd like to populate their brand identity",
  ];
  if (input.website_url) {
    nextSteps.push(
      `Option A can start immediately — run brand_extract_web with url "${input.website_url}"`
    );
  }

  return buildResponse({
    what_happened: `Created .brand/ directory for "${input.client_name}"`,
    next_steps: nextSteps,
    data: {
      client_name: input.client_name,
      brand_dir: ".brand/",
      files_created: ["brand.config.yaml", "core-identity.yaml", "assets/logo/"],
      source_menu: sourceMenu,
      recommended,
      conversation_guide: {
        design_principle: "Get just enough to make the extraction smart, then show results fast. The user should see their brand reflected back within 5 minutes of starting.",
        instruction: [
          `Welcome the user and confirm the brand system was created for "${input.client_name}".`,
          "",
          "BEFORE presenting the source menu, ask these quick context questions (skip any already answered via params):",
          "",
          `${input.website_url ? "✓ Website URL already provided." : "1. \"What's your primary website URL?\" — needed for extraction"}`,
          `${input.industry ? "✓ Industry already provided." : "2. \"What industry are you in, and who's your primary audience?\" — helps infer color/tone decisions"}`,
          "3. \"In one sentence, what's the core idea or perspective behind your brand?\" — This doesn't need to be polished. Even a rough articulation grounds the extraction. Example: 'We believe brands need operating systems, not just guidelines.'",
          "4. \"Do you have a Figma file with your brand identity? If so, share the URL or file key.\" — Routes the extraction path. If yes, note we can use it for higher accuracy after the web scan.",
          "",
          "Once you have context (or the user wants to skip ahead), present the source menu:",
          "",
          "Present the source menu as a numbered list with clear descriptions.",
          `Highlight option A as the recommended starting point${input.website_url ? " — and note it can start immediately since a URL was provided" : ""}.`,
          "Ask: 'Which would you like to start with?'",
          "",
          "Based on their choice:",
          "  A → Run brand_extract_web (with the website_url if provided), then immediately run brand_compile and brand_report to show results fast",
          "  B → Ask for their Figma file key, then run brand_extract_figma in plan mode",
          "  C → Ask them to share/upload their brand guidelines document, then extract values into core-identity manually",
          "  D → Ask them to share/upload an on-brand asset, then analyze it and extract brand values",
          "  E → Begin manual entry by asking for primary brand color, then font, then proceed through core identity fields",
          "",
          "AFTER extraction completes:",
          "  1. Run brand_compile to generate tokens",
          "  2. Run brand_report to generate the HTML report",
          "  3. Show the report as an artifact (in Chat) or write to .brand/ (in Code)",
          "  4. Ask: 'Does this look right? If anything's off, I can help fix it.'",
        ].join("\n"),
      },
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_start",
    "Onboarding entry point. Creates a brand system for a new client and presents extraction source options (website scan, Figma, upload guidelines, upload asset, or manual). If .brand/ already exists, returns current status with actionable next steps. Use this FIRST — it replaces the need to call brand_init directly.",
    paramsShape,
    async (args) => handler(args as Params)
  );
}
