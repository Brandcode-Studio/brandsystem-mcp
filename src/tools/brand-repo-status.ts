/**
 * brand_repo_status — Check git-connected repo health (C-7)
 *
 * Shows connection state, last sync info, recent events, and health
 * for a repo-connected brand. Read-only — calls the Studio status API.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import { readAuthCredentials } from "../lib/auth-state.js";

const paramsShape = {
  brand_slug: z
    .string()
    .describe("Brand slug to check repo connection for"),
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

  const auth = await readAuthCredentials(cwd);
  const studioUrl =
    input.brandcode_url?.replace(/\/$/, "") ||
    auth?.studioUrl?.replace(/\/$/, "") ||
    "https://www.brandcode.studio";

  const statusUrl = `${studioUrl}/api/brand/repo/status?brandSlug=${encodeURIComponent(input.brand_slug)}`;

  try {
    const response = await fetch(statusUrl, { cache: "no-store" });
    const body = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      return buildResponse({
        what_happened:
          (body.error as string) ?? `Studio returned ${response.status}`,
        next_steps: ["Check that the brand slug is correct"],
        data: { error: ERROR_CODES.FETCH_FAILED, status: response.status },
      });
    }

    if (!body.connected) {
      return buildResponse({
        what_happened: `No repo connection found for "${input.brand_slug}".`,
        next_steps: [
          `Run brand_connect_repo repo="owner/repo" brand_slug="${input.brand_slug}" to connect a repo`,
        ],
        data: { connected: false },
      });
    }

    const health = body.health as Record<string, unknown>;
    const lastSync = body.lastSync as Record<string, unknown> | null;
    const lastPoll = body.lastPoll as Record<string, unknown> | null;
    const recentEvents = body.recentEvents as Array<Record<string, unknown>>;

    const lines = [
      "── Git-Connected Brand Source ────────",
      `Brand:       ${body.brandSlug}`,
      `Repository:  ${body.repo}`,
      `Branch:      ${body.branch}`,
      `Path:        ${body.brandPath}/`,
      `Health:      ${health?.status} — ${health?.message}`,
      `Syncs:       ${body.syncCount}`,
      `Owner:       ${body.ownerEmail}`,
      `Connected:   ${body.createdAt}`,
    ];

    if (lastSync) {
      lines.push("");
      lines.push("── Last Sync ─────────────────────────");
      lines.push(`Time:        ${lastSync.at}`);
      lines.push(`Commit:      ${lastSync.commit}`);
      lines.push(`Tree SHA:    ${lastSync.treeSha}`);
    }

    if (lastPoll) {
      lines.push("");
      lines.push("── Last Poll ─────────────────────────");
      lines.push(`Time:        ${lastPoll.at}`);
      if (lastPoll.error) {
        lines.push(`Error:       ${lastPoll.error}`);
      }
    }

    if (recentEvents && recentEvents.length > 0) {
      lines.push("");
      lines.push("── Recent Syncs ──────────────────────");
      for (const event of recentEvents) {
        const files = event.changedFiles as string[];
        lines.push(
          `  ${event.syncedAt} — ${event.commitSha} (${files.length} file${files.length === 1 ? "" : "s"})`,
        );
      }
    }

    return buildResponse({
      what_happened: `Repo connection for "${input.brand_slug}" is ${health?.status}.`,
      next_steps: [
        "Push a change to .brand/ to trigger a sync on the next poll",
        `Run brand_disconnect_repo brand_slug="${input.brand_slug}" to remove the connection`,
        "Run brand_brandcode_sync to pull the latest brand data locally",
      ],
      data: {
        status: lines.join("\n"),
        connected: true,
        health,
        last_sync: lastSync,
        last_poll: lastPoll,
        sync_count: body.syncCount,
        recent_events: recentEvents,
      },
    });
  } catch (err) {
    return buildResponse({
      what_happened: `Failed to check status: ${(err as Error).message}`,
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
    "brand_repo_status",
    'Check the health and sync status of a git-connected brand repo. Shows last sync time, commit SHA, polling health, and recent sync events. Use when the user says "repo status", "is my repo syncing?", "check git connection", or "when did it last sync?".',
    paramsShape,
    async (input) => handler(input as unknown as Record<string, unknown>),
  );
}
