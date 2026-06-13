#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const LOCKED_TOOL_ORDER = [
  "brand_runtime",
  "brand_search",
  "brand_check",
  "brand_status",
  "list_brand_assets",
  "get_brand_asset",
  "brand_feedback",
  "capture_taste",
  "brand_history",
];

const DEFAULT_TIMEOUT_MS = 20_000;

const args = new Set(process.argv.slice(2));

function usage() {
  return `Usage: npm run smoke:hosted-mcp -- [--json] [--strict]

Smoke a hosted Brandcode MCP Streamable HTTP endpoint without hardcoded secrets.

Required for live proof:
  BRANDCODE_MCP_SMOKE_URL       Hosted endpoint, e.g. https://mcp.staging.brandcode.studio/{slug}
  BRANDCODE_MCP_SMOKE_FULL_KEY  Bearer key with read, check, and feedback scopes

Optional proof inputs:
  BRANDCODE_MCP_SMOKE_READ_KEY       Bearer key with read scope only, used for insufficient-scope checks
  BRANDCODE_MCP_SMOKE_ASSET_ID       Asset id for get_brand_asset proof; omitted means skipped
  BRANDCODE_MCP_SMOKE_SKIP_FEEDBACK  Set to 1 to skip append proof when UCS history append is intentionally blocked
  BRANDCODE_MCP_SMOKE_TIMEOUT_MS     Per-operation timeout in milliseconds; default ${DEFAULT_TIMEOUT_MS}

Exit behavior:
  pass -> 0
  blocked/skipped only -> 0, or 2 with --strict
  failed assertion -> 1`;
}

if (args.has("--help") || args.has("-h")) {
  console.log(usage());
  process.exit(0);
}

const jsonOnly = args.has("--json");
const strict = args.has("--strict");
const timeoutMs = Number.parseInt(
  process.env.BRANDCODE_MCP_SMOKE_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
  10,
);

function check(name, status, detail, evidence = {}) {
  return { name, status, detail, ...evidence };
}

function withTimeout(promise, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function textFromToolResult(result) {
  const part = Array.isArray(result.content)
    ? result.content.find((item) => item?.type === "text")
    : null;
  if (!part || typeof part.text !== "string") {
    throw new Error("Tool result did not include a text content part");
  }
  return part.text;
}

function parseToolResult(result) {
  return JSON.parse(textFromToolResult(result));
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const record = payload;
  return {
    what_happened: record._metadata?.what_happened ?? null,
    error: record.error ?? null,
    status: record.status ?? null,
    required_scope: record.required_scope ?? null,
    append_status: record.append_status ?? null,
    runtime_origin: record.runtime_origin ?? null,
    total_hits: record.total_hits ?? null,
    history_origin: record.history_origin ?? null,
    custody_safe: record.custody_safe ?? null,
  };
}

function rawPrivateProviderUrlExposed(payload) {
  return /private-provider|blob\.core\.windows\.net|vercel-storage\.com|oaidalleapiprodscus|https?:\/\/[^"\\\s]+/i.test(
    JSON.stringify(payload ?? {}),
  );
}

function assetCustodyEvidence(assetPayload, assetId) {
  const asset = assetPayload?.asset;
  const deliveryRef =
    asset && typeof asset === "object" && !Array.isArray(asset)
      ? asset.delivery_ref
      : null;
  const custody =
    asset && typeof asset === "object" && !Array.isArray(asset)
      ? asset.custody
      : null;
  return {
    asset_id: assetId,
    custody_safe: assetPayload?.custody_safe ?? null,
    safe_for_mcp:
      custody && typeof custody === "object" && !Array.isArray(custody)
        ? custody.safe_for_mcp ?? null
        : null,
    blocked_private_provider_url:
      custody && typeof custody === "object" && !Array.isArray(custody)
        ? custody.blocked_private_provider_url ?? null
        : null,
    delivery_posture:
      deliveryRef && typeof deliveryRef === "object" && !Array.isArray(deliveryRef)
        ? deliveryRef.posture ?? null
        : null,
    delivery_ref_kind:
      deliveryRef && typeof deliveryRef === "object" && !Array.isArray(deliveryRef)
        ? deliveryRef.package_path
          ? "package_path"
          : deliveryRef.package_url
            ? "package_url"
            : deliveryRef.posture ?? "unknown"
        : null,
    raw_private_provider_url_exposed: rawPrivateProviderUrlExposed(assetPayload),
  };
}

function assetIsPackageSafe(assetPayload) {
  const evidence = assetCustodyEvidence(assetPayload, null);
  return (
    Boolean(assetPayload?.asset) &&
    assetPayload?.custody_safe === true &&
    evidence.safe_for_mcp === true &&
    evidence.blocked_private_provider_url === false &&
    evidence.delivery_posture !== "blocked_private_provider_url" &&
    evidence.raw_private_provider_url_exposed === false &&
    (evidence.delivery_ref_kind === "package_path" ||
      evidence.delivery_ref_kind === "package_url")
  );
}

function assetIsBlockedPrivateProvider(assetPayload) {
  const evidence = assetCustodyEvidence(assetPayload, null);
  return (
    Boolean(assetPayload?.asset) &&
    assetPayload?.custody_safe === true &&
    evidence.safe_for_mcp === false &&
    evidence.blocked_private_provider_url === true &&
    evidence.delivery_posture === "blocked_private_provider_url" &&
    evidence.raw_private_provider_url_exposed === false
  );
}

function classifyConnectionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid_token|slug_forbidden|missing_bearer/i.test(message)) {
    return {
      status: "fail",
      detail: `Hosted MCP rejected the supplied key or slug: ${message}`,
    };
  }
  if (
    /authentication required|deployment protection|vercel|401|403/i.test(
      message,
    )
  ) {
    return {
      status: "blocked",
      detail:
        "Endpoint was not reachable as a normal external MCP client; resolve Vercel deployment protection or provide a reachable staging endpoint",
    };
  }
  return {
    status: "fail",
    detail: `Could not connect to hosted MCP endpoint: ${message}`,
  };
}

async function connect(endpoint, key, name) {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: {
        authorization: `Bearer ${key}`,
      },
    },
  });
  const client = new Client({
    name: "brandcode-mcp-hosted-smoke",
    version: "1.0.0",
  });
  await withTimeout(client.connect(transport), `${name} initialize`);
  return { client, transport };
}

async function closeConnection(connection) {
  if (!connection) return;
  await connection.client.close().catch(() => {});
  await connection.transport.close().catch(() => {});
}

async function callTool(client, name, toolArgs = {}) {
  const result = await withTimeout(
    client.callTool({ name, arguments: toolArgs }),
    `call ${name}`,
  );
  return parseToolResult(result);
}

function assertNoToolError(name, payload, options = {}) {
  if (payload.error) {
    const blocker = options.blockedErrors?.[payload.error];
    if (blocker) {
      return check(name, "blocked", blocker, summarizePayload(payload));
    }
    return check(
      name,
      "fail",
      `${name} returned error ${payload.error}`,
      summarizePayload(payload),
    );
  }
  return null;
}

async function run() {
  const endpoint = process.env.BRANDCODE_MCP_SMOKE_URL;
  const fullKey = process.env.BRANDCODE_MCP_SMOKE_FULL_KEY;
  const readKey = process.env.BRANDCODE_MCP_SMOKE_READ_KEY;
  const assetId = process.env.BRANDCODE_MCP_SMOKE_ASSET_ID;
  const skipFeedback = process.env.BRANDCODE_MCP_SMOKE_SKIP_FEEDBACK === "1";
  const checks = [];

  const missing = [];
  if (!endpoint) missing.push("BRANDCODE_MCP_SMOKE_URL");
  if (!fullKey) missing.push("BRANDCODE_MCP_SMOKE_FULL_KEY");

  if (missing.length > 0) {
    checks.push(
      check(
        "environment",
        "blocked",
        `Missing required live proof env: ${missing.join(", ")}`,
        {
          missing_env: missing,
          key_posture: {
            full: Boolean(fullKey),
            read_only: Boolean(readKey),
          },
        },
      ),
    );
    return { endpoint: endpoint ?? null, checks };
  }

  let fullConnection;
  try {
    fullConnection = await connect(endpoint, fullKey, "full-key");
    checks.push(
      check("initialize", "pass", "MCP initialize succeeded with full key", {
        key_posture: "full",
      }),
    );
  } catch (error) {
    const classified = classifyConnectionError(error);
    checks.push(check("initialize", classified.status, classified.detail));
    return { endpoint, checks };
  }

  try {
    const { tools } = await withTimeout(
      fullConnection.client.listTools(),
      "tools/list",
    );
    const names = tools.map((tool) => tool.name);
    const matches =
      names.length === LOCKED_TOOL_ORDER.length &&
      names.every((name, index) => name === LOCKED_TOOL_ORDER[index]);
    checks.push(
      check(
        "tools/list locked order",
        matches ? "pass" : "fail",
        matches
          ? "tools/list returned the locked hosted surface order"
          : "tools/list drifted from the locked hosted surface order",
        { expected: LOCKED_TOOL_ORDER, actual: names },
      ),
    );

    const status = await callTool(fullConnection.client, "brand_status");
    const statusError = assertNoToolError("brand_status", status);
    checks.push(
      statusError ??
        check("brand_status", "pass", "brand_status returned capability status", {
          implemented_tools:
            Array.isArray(status.implemented_tools)
              ? status.implemented_tools.map((tool) => tool.tool)
              : null,
        }),
    );

    const runtime = await callTool(fullConnection.client, "brand_runtime", {
      slice: "minimal",
    });
    const runtimeError = assertNoToolError("brand_runtime", runtime);
    checks.push(
      runtimeError ??
        check(
          "brand_runtime",
          runtime.runtime_origin === "hosted" || Boolean(runtime.runtime)
            ? "pass"
            : "fail",
          runtime.runtime_origin === "hosted" || Boolean(runtime.runtime)
            ? "brand_runtime returned hosted runtime data"
            : "brand_runtime did not report hosted runtime data",
          summarizePayload(runtime),
        ),
    );

    const search = await callTool(fullConnection.client, "brand_search", {
      query: "brand",
      limit: 3,
    });
    const searchError = assertNoToolError("brand_search", search);
    checks.push(
      searchError ??
        check(
          "brand_search",
          Array.isArray(search.hits) ? "pass" : "fail",
          Array.isArray(search.hits)
            ? "brand_search returned a governed search result shape"
            : "brand_search did not return a hits array",
          summarizePayload(search),
        ),
    );

    const listAssets = await callTool(fullConnection.client, "list_brand_assets", {
      limit: 3,
    });
    const listAssetsError = assertNoToolError(
      "list_brand_assets",
      listAssets,
    );
    checks.push(
      listAssetsError ??
        check(
          "list_brand_assets",
          Array.isArray(listAssets.assets) ? "pass" : "fail",
          Array.isArray(listAssets.assets)
            ? "list_brand_assets returned a package-safe asset catalog shape"
            : "list_brand_assets did not return an assets array",
          {
            asset_count: Array.isArray(listAssets.assets)
              ? listAssets.assets.length
              : null,
            custody_safe: listAssets.custody_safe ?? null,
            raw_private_provider_url_exposed:
              rawPrivateProviderUrlExposed(listAssets),
          },
        ),
    );

    if (assetId) {
      const asset = await callTool(fullConnection.client, "get_brand_asset", {
        asset_id: assetId,
      });
      const assetError = assertNoToolError("get_brand_asset", asset);
      checks.push(
        assetError ??
          check(
            "get_brand_asset",
            assetIsPackageSafe(asset)
              ? "pass"
              : assetIsBlockedPrivateProvider(asset)
                ? "blocked"
                : "fail",
            assetIsPackageSafe(asset)
              ? "get_brand_asset returned a package-safe asset without raw private provider URLs"
              : assetIsBlockedPrivateProvider(asset)
                ? "get_brand_asset blocked private-provider-only delivery without exposing raw URLs"
              : "get_brand_asset did not return a package-safe asset custody posture",
            assetCustodyEvidence(asset, assetId),
          ),
      );
    } else {
      checks.push(
        check(
          "get_brand_asset",
          "skipped",
          "Missing optional BRANDCODE_MCP_SMOKE_ASSET_ID",
          { missing_env: ["BRANDCODE_MCP_SMOKE_ASSET_ID"] },
        ),
      );
    }

    const checkPayload = await callTool(fullConnection.client, "brand_check", {
      text: "Hosted smoke proof should preserve governed brand claims.",
    });
    const checkError = assertNoToolError("brand_check", checkPayload);
    checks.push(
      checkError ??
        check(
          "brand_check",
          ["pass", "review", "fail"].includes(checkPayload.verdict)
            ? "pass"
            : "fail",
          ["pass", "review", "fail"].includes(checkPayload.verdict)
            ? "brand_check returned a governed verdict"
            : "brand_check did not return a valid verdict",
          { verdict: checkPayload.verdict ?? null },
        ),
    );

    const history = await callTool(fullConnection.client, "brand_history", {
      limit: 1,
    });
    const historyError = assertNoToolError("brand_history", history, {
      blockedErrors: {
        ucs_auth:
          "Hosted UCS service token rejected or missing; set BRANDCODE_MCP_SERVICE_TOKEN in the hosted deployment before history proof",
      },
    });
    checks.push(
      historyError ??
        check(
          "brand_history",
          Array.isArray(history.history) ? "pass" : "fail",
          Array.isArray(history.history)
            ? "brand_history returned scoped hosted MCP history shape"
            : "brand_history did not return a history array",
          summarizePayload(history),
        ),
    );

    if (skipFeedback) {
      checks.push(
        check(
          "brand_feedback",
          "skipped",
          "BRANDCODE_MCP_SMOKE_SKIP_FEEDBACK=1 set; append proof intentionally skipped",
        ),
      );
    } else {
      const feedback = await callTool(fullConnection.client, "brand_feedback", {
        kind: "observation",
        summary: "Hosted MCP smoke proof observation",
        source_tool: "hosted-mcp-smoke",
      });
      const feedbackError = assertNoToolError("brand_feedback", feedback, {
        blockedErrors: {
          ucs_auth:
            "Hosted UCS service token rejected or missing; provision BRANDCODE_MCP_SERVICE_TOKEN in the hosted deployment before feedback append proof",
        },
      });
      checks.push(
        feedbackError ??
          check(
            "brand_feedback",
            feedback.append_status === "recorded" ? "pass" : "fail",
            feedback.append_status === "recorded"
              ? "brand_feedback appended an observation to UCS history"
              : "brand_feedback did not record append_status=recorded",
            summarizePayload(feedback),
          ),
      );
    }
  } catch (error) {
    checks.push(
      check(
        "full-key smoke",
        "fail",
        error instanceof Error ? error.message : String(error),
      ),
    );
  } finally {
    await closeConnection(fullConnection);
  }

  if (!readKey) {
    checks.push(
      check(
        "insufficient-scope",
        "blocked",
        "Missing optional BRANDCODE_MCP_SMOKE_READ_KEY for read-only key scope proof",
        { missing_env: ["BRANDCODE_MCP_SMOKE_READ_KEY"] },
      ),
    );
    return { endpoint, checks };
  }

  let readConnection;
  try {
    readConnection = await connect(endpoint, readKey, "read-key");
    checks.push(
      check("initialize read-only", "pass", "MCP initialize succeeded with read-only key", {
        key_posture: "read-only",
      }),
    );

    for (const [toolName, requiredScope, toolArgs] of [
      ["brand_check", "check", { text: "Read-only key should be blocked." }],
      [
        "brand_feedback",
        "feedback",
        { summary: "Read-only key should be blocked." },
      ],
      [
        "capture_taste",
        "capture",
        {
          candidate_ref: "smoke-read-only",
          verdict: "generic",
          attribute_reason: "Read-only key should be blocked before capture.",
        },
      ],
    ]) {
      const payload = await callTool(readConnection.client, toolName, toolArgs);
      const ok =
        payload.error === "insufficient_scope" &&
        payload.status === 403 &&
        payload.required_scope === requiredScope;
      checks.push(
        check(
          `insufficient-scope ${toolName}`,
          ok ? "pass" : "fail",
          ok
            ? `${toolName} returned structured insufficient_scope for read-only key`
            : `${toolName} did not return the expected insufficient_scope response`,
          summarizePayload(payload),
        ),
      );
    }
  } catch (error) {
    const classified = classifyConnectionError(error);
    checks.push(
      check("initialize read-only", classified.status, classified.detail),
    );
  } finally {
    await closeConnection(readConnection);
  }

  return { endpoint, checks };
}

const result = await run();
const failed = result.checks.filter((item) => item.status === "fail");
const blocked = result.checks.filter((item) => item.status === "blocked");
const skipped = result.checks.filter((item) => item.status === "skipped");
const summary = {
  ok: failed.length === 0 && blocked.length === 0,
  status:
    failed.length > 0 ? "fail" : blocked.length > 0 ? "blocked" : "pass",
  endpoint: result.endpoint,
  checked_at: new Date().toISOString(),
  checks: result.checks,
  counts: {
    pass: result.checks.filter((item) => item.status === "pass").length,
    fail: failed.length,
    blocked: blocked.length,
    skipped: skipped.length,
  },
};

if (jsonOnly) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`Brandcode hosted MCP smoke: ${summary.status}`);
  for (const item of summary.checks) {
    console.log(`- ${item.status.toUpperCase()} ${item.name}: ${item.detail}`);
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (failed.length > 0) {
  process.exit(1);
}
if (strict && blocked.length > 0) {
  process.exit(2);
}
