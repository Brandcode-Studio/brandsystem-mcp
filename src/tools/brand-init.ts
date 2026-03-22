import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";

const paramsShape = {
  client_name: z.string().describe("Company or brand name"),
  industry: z.string().optional().describe("Industry vertical (e.g. 'content marketing agency')"),
  website_url: z.string().optional().describe("Primary website URL for web extraction"),
  figma_file_key: z.string().optional().describe("Figma file key for design token extraction"),
};

type Params = { client_name: string; industry?: string; website_url?: string; figma_file_key?: string };

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (await brandDir.exists()) {
    return buildResponse({
      what_happened: ".brand/ directory already exists",
      next_steps: [
        "Run brand_status to see current state",
        "Delete .brand/ manually if you want to start over",
      ],
      data: { error: "already_exists" },
    });
  }

  await brandDir.scaffold();

  const config = {
    schema_version: "0.1.0",
    session: 1,
    client_name: input.client_name,
    industry: input.industry,
    website_url: input.website_url,
    figma_file_key: input.figma_file_key,
    created_at: new Date().toISOString(),
  };

  await brandDir.writeConfig(config);

  await brandDir.writeCoreIdentity({
    schema_version: "0.1.0",
    colors: [],
    typography: [],
    logo: [],
    spacing: null,
  });

  const nextSteps: string[] = [];
  if (input.website_url) {
    nextSteps.push(`Run brand_extract_web with url "${input.website_url}" to pull colors, fonts, and logo`);
  } else {
    nextSteps.push("Run brand_extract_web with your website URL to pull colors, fonts, and logo");
  }
  if (input.figma_file_key) {
    nextSteps.push(`Run brand_extract_figma with figma_file_key "${input.figma_file_key}" to extract design tokens`);
  } else {
    nextSteps.push("Run brand_extract_figma if you have a Figma file with brand tokens");
  }

  return buildResponse({
    what_happened: `Created .brand/ directory for "${input.client_name}"`,
    next_steps: nextSteps,
    data: {
      client_name: input.client_name,
      brand_dir: ".brand/",
      files_created: ["brand.config.yaml", "core-identity.yaml", "assets/logo/"],
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_init",
    "Initialize a new brand system. Creates a .brand/ directory with configuration scaffold and empty core-identity.yaml. Use this FIRST before any other brand tools. Do NOT use if .brand/ already exists — use brand_status instead.",
    paramsShape,
    async (args) => handler(args as Params)
  );
}
