/**
 * brand_connect_repo — Connect a GitHub repo to Brandcode Studio (C-1)
 *
 * Registers a `.brand/` directory in a GitHub repo as the source of truth
 * for a hosted brand. Studio polls the repo every 5 minutes and auto-syncs
 * changes. Git gives version history, PRs for brand changes, and team
 * collaboration for free.
 *
 * Requires auth via brand_brandcode_auth.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import { readAuthCredentials } from "../lib/auth-state.js";

const paramsShape = {
  repo: z
    .string()
    .describe(
      'GitHub repo in "owner/repo" format (e.g. "acme-corp/brand-system")',
    ),
  brand_slug: z
    .string()
    .describe(
      "Brand slug to connect this repo to (e.g. \"acme\"). Must match an existing hosted brand or will create one.",
    ),
  branch: z
    .string()
    .default("main")
    .describe("Branch to watch (default: main)"),
  brand_path: z
    .string()
    .default(".brand")
    .describe("Path to .brand/ directory within the repo (default: .brand)"),
  brandcode_url: z
    .string()
    .optional()
    .describe(
      "Brandcode Studio URL (default: https://www.brandcode.studio)",
    ),
};

const ParamsSchema = z.object(paramsShape);

async function handler(raw: Record<string, unknown>) {
  const parsed = safeParseParams(ParamsSchema, raw);
  if (!parsed.success) {
    return parsed.response;
  }

  const input = parsed.data;
  const cwd = process.cwd();

  // Require auth
  const auth = await readAuthCredentials(cwd);
  if (!auth) {
    return buildResponse({
      what_happened:
        "Not authenticated with Brandcode Studio. Auth is required to connect a repo.",
      next_steps: [
        "Run brand_brandcode_auth to authenticate first",
      ],
      data: { error: ERROR_CODES.NOT_AUTHENTICATED },
    });
  }

  const studioUrl =
    input.brandcode_url?.replace(/\/$/, "") ||
    auth.studioUrl?.replace(/\/$/, "") ||
    "https://www.brandcode.studio";

  // Call the connect route
  const connectUrl = `${studioUrl}/api/brand/repo/connect`;

  try {
    const response = await fetch(connectUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-brand-session-admin-token": auth.token,
      },
      body: JSON.stringify({
        brandSlug: input.brand_slug,
        repo: input.repo,
        branch: input.branch,
        brandPath: input.brand_path,
        ownerEmail: auth.email,
      }),
    });

    const body = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      const errorMsg =
        (body.error as string) ?? `Studio returned ${response.status}`;

      if (response.status === 409) {
        const existing = body.existing as Record<string, unknown> | undefined;
        return buildResponse({
          what_happened: errorMsg,
          next_steps: [
            `Disconnect first: brand_disconnect_repo brand_slug="${input.brand_slug}"`,
            "Or connect to a different brand slug",
          ],
          data: {
            error: ERROR_CODES.ALREADY_EXISTS,
            existing_connection: existing,
          },
        });
      }

      return buildResponse({
        what_happened: errorMsg,
        next_steps: [
          "Check that the repo exists and GITHUB_TOKEN has access on Vercel",
          "Verify the brand slug is correct",
        ],
        data: { error: ERROR_CODES.FETCH_FAILED, status: response.status },
      });
    }

    const connection = body.connection as Record<string, unknown>;
    const initialSync = body.initialSync as Record<string, unknown>;
    const synced = initialSync?.synced === true;
    const changedFiles = (initialSync?.changedFiles as string[]) ?? [];

    const lines = [
      `Connected ${input.repo} → ${input.brand_slug}`,
      "",
      `Repository: ${connection?.repo}`,
      `Branch:     ${connection?.branch}`,
      `Path:       ${input.brand_path}/`,
      "",
      synced
        ? `Initial sync: ${changedFiles.length} file(s) synced from repo`
        : initialSync?.error
          ? `Initial sync failed: ${initialSync.error}`
          : "Initial sync: no .brand/ files found yet",
      "",
      "Studio will poll this repo every 5 minutes.",
      "Push changes to .brand/ and they'll appear in Studio automatically.",
    ];

    if (changedFiles.length > 0) {
      lines.push("");
      lines.push("Files synced:");
      for (const file of changedFiles.slice(0, 10)) {
        lines.push(`  ${file}`);
      }
      if (changedFiles.length > 10) {
        lines.push(`  ... and ${changedFiles.length - 10} more`);
      }
    }

    return buildResponse({
      what_happened: `Connected repo ${input.repo} to brand "${input.brand_slug}". ${synced ? "Initial sync complete." : "Waiting for .brand/ files."}`,
      next_steps: [
        `Run brand_repo_status brand_slug="${input.brand_slug}" to check connection health`,
        "Push a change to .brand/ in the repo to trigger auto-sync",
        `Run brand_disconnect_repo brand_slug="${input.brand_slug}" to remove the connection`,
      ],
      data: {
        status: lines.join("\n"),
        connection,
        initial_sync: initialSync,
      },
    });
  } catch (err) {
    return buildResponse({
      what_happened: `Failed to connect: ${(err as Error).message}`,
      next_steps: [
        "Check your network connection",
        `Verify Studio is reachable: ${studioUrl}`,
      ],
      data: { error: ERROR_CODES.FETCH_FAILED },
    });
  }
}

export function register(server: McpServer) {
  server.tool(
    "brand_connect_repo",
    'Connect a GitHub repository to Brandcode Studio for automatic brand syncing. The repo\'s .brand/ directory becomes the source of truth — push changes to git and Studio picks them up every 5 minutes. Requires auth (run brand_brandcode_auth first). Use when the user says "connect my repo", "sync from GitHub", "link my brand repo", or "set up git-connected brand".',
    paramsShape,
    async (input) => handler(input as unknown as Record<string, unknown>),
  );
}
