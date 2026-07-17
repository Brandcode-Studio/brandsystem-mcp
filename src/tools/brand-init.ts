import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { SCHEMA_VERSION } from "../schemas/index.js";
import { ERROR_CODES } from "../types/index.js";

const paramsShape = {
  client_name: z.string().describe("Company or brand name"),
  industry: z.string().optional().describe("Industry vertical (e.g. 'content marketing agency')"),
  website_url: z.string().optional().describe("Primary website URL for web extraction"),
  figma_file_key: z.string().optional().describe("Figma file key for design token extraction"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (await brandDir.exists()) {
    return buildResponse({
      what_happened: ".brand/ directory already exists",
      next_steps: [
        "Run brand_status to see current state",
        "Delete .brand/ manually if you want to start over",
      ],
      data: { error: ERROR_CODES.ALREADY_EXISTS },
    });
  }

  // Shared init logic (scaffold + config + empty core identity)
  await brandDir.initBrand({
    schema_version: SCHEMA_VERSION,
    session: 1,
    client_name: input.client_name,
    industry: input.industry,
    website_url: input.website_url,
    figma_file_key: input.figma_file_key,
    created_at: new Date().toISOString(),
  });

  // Ensure brandcode-auth.json is gitignored (contains secrets)
  await ensureGitignoreEntry(process.cwd(), ".brand/brandcode-auth.json");

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

/**
 * Ensure a path is present in the project .gitignore.
 * Creates .gitignore if it doesn't exist.
 */
async function ensureGitignoreEntry(cwd: string, entry: string): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");
  let content = "";
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  const lines = content.split("\n");
  if (lines.some((line) => line.trim() === entry)) {
    return; // Already present
  }

  const newContent = content.endsWith("\n") || content === ""
    ? content + entry + "\n"
    : content + "\n" + entry + "\n";
  await writeFile(gitignorePath, newContent, "utf-8");
}

export function register(server: McpServer) {
  server.tool(
    "brand_init",
    "Initialize a .brand/ directory with empty config scaffold. Low-level tool — prefer brand_start instead, which calls this automatically and also presents extraction options. Only use brand_init directly if you need to set up the directory without running extraction. Returns list of created files.",
    paramsShape,
    { title: "Initialize .brand/ directory", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
