#!/usr/bin/env node
/**
 * Public agent-evaluation harness for @brandsystem/mcp.
 *
 * Two tiers (see eval/README.md for the full methodology):
 *   DETERMINISTIC  — runs everywhere, no LLM, gates the exit code.
 *   MODEL-DEPENDENT — first-tool selection; only with --with-llm AND
 *                     ANTHROPIC_API_KEY. Never affects the exit code.
 *
 * Honesty contract: this script only reports numbers it actually measured
 * in this run, stamped with date / node / package version (and model id for
 * the LLM tier). It never emits placeholder or previously-published results.
 *
 * Usage:
 *   npm run build && npm run eval                       # deterministic tier
 *   ANTHROPIC_API_KEY=... npm run eval -- --with-llm    # + first-tool selection
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, cp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const FIXTURE_BRAND = join(ROOT, "test", "fixtures", "brand-complete");
const EVAL_DIR = join(ROOT, "eval");
const RESULTS_DIR = join(EVAL_DIR, "results");

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

if (!existsSync(join(DIST, "server.js"))) {
  console.error(
    "eval: dist/server.js not found. This harness runs against compiled output.\n" +
      "Run `npm run build` first, then `npm run eval`."
  );
  process.exit(1);
}

const { createServer } = await import(pathToFileURL(join(DIST, "server.js")).href);
const { BrandRuntimeSchema } = await import(
  pathToFileURL(join(DIST, "schemas", "brand-runtime.js")).href
);
const { estimateTokens } = await import(
  pathToFileURL(join(DIST, "lib", "response.js")).href
);
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const WITH_LLM = process.argv.includes("--with-llm");
const API_KEY = process.env.ANTHROPIC_API_KEY;

// ---------------------------------------------------------------------------
// Harness plumbing
// ---------------------------------------------------------------------------

const tempDirs = [];

async function copyBrandFixture() {
  const dest = await mkdtemp(join(tmpdir(), "brand-eval-"));
  await cp(FIXTURE_BRAND, dest, { recursive: true });
  tempDirs.push(dest);
  return dest;
}

async function emptyDir() {
  const dest = await mkdtemp(join(tmpdir(), "brand-eval-empty-"));
  tempDirs.push(dest);
  return dest;
}

/**
 * Run fn against a connected in-memory client whose server sees `dir` as cwd.
 * process.cwd is patched for the duration (same technique as test/helpers.ts)
 * because tools resolve the .brand/ directory via process.cwd() at call time.
 */
async function withServer(dir, profile, fn) {
  const realCwd = process.cwd;
  process.cwd = () => dir;
  try {
    const server = createServer({ profile });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "agent-eval", version: pkg.version });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      return await fn(client);
    } finally {
      await client.close();
    }
  } finally {
    process.cwd = realCwd;
  }
}

function parseText(result) {
  return JSON.parse(result.content[0].text);
}

const checks = [];
function record(metric, value, target, pass, detail) {
  checks.push({ metric, value, target, pass, ...(detail ? { detail } : {}) });
}

// ---------------------------------------------------------------------------
// A. Entry-tool response budgets
//    Budgets mirror test/response-budgets.test.ts — token estimates
//    (~4 chars/token) with headroom over measured actuals. Measured on the
//    full profile, empty-directory status first, matching the test file.
// ---------------------------------------------------------------------------

const BUDGETS = {
  brand_status_getting_started: 950,
  brand_status_with_brand: 850,
  brand_context_standard: 900,
  brand_context_compact: 500,
};

async function measureTokens(dir, tool, args) {
  return withServer(dir, "full", async (client) => {
    const result = await client.callTool({ name: tool, arguments: args ?? {} });
    return estimateTokens(result.content[0].text);
  });
}

async function runBudgetChecks() {
  const empty = await emptyDir();
  const brand = await copyBrandFixture();

  const gettingStarted = await measureTokens(empty, "brand_status", {});
  record(
    "budget: brand_status (getting started)",
    `${gettingStarted} tokens`,
    `<= ${BUDGETS.brand_status_getting_started}`,
    gettingStarted <= BUDGETS.brand_status_getting_started
  );

  const withBrand = await measureTokens(brand, "brand_status", {});
  record(
    "budget: brand_status (with brand)",
    `${withBrand} tokens`,
    `<= ${BUDGETS.brand_status_with_brand}`,
    withBrand <= BUDGETS.brand_status_with_brand
  );

  const ctxStandard = await measureTokens(brand, "brand_context", {
    task_type: "social-post",
  });
  record(
    "budget: brand_context (standard)",
    `${ctxStandard} tokens`,
    `<= ${BUDGETS.brand_context_standard}`,
    ctxStandard <= BUDGETS.brand_context_standard
  );

  const ctxCompact = await measureTokens(brand, "brand_context", {
    task_type: "social-post",
    budget: "compact",
  });
  record(
    "budget: brand_context (compact)",
    `${ctxCompact} tokens`,
    `<= ${BUDGETS.brand_context_compact}`,
    ctxCompact <= BUDGETS.brand_context_compact
  );
}

// ---------------------------------------------------------------------------
// B. Envelope conformance across the CORE tool surface
//    Every core tool, called with minimal empty-safe args on a brand-complete
//    copy, must return structuredContent matching the response envelope
//    ({_metadata:{what_happened,next_steps}, ...data}) and text that parses
//    to the same shape. The brandcode auth/connect tools are called in their
//    network-free modes — a graceful, well-formed response (including a
//    structured error payload) IS the pass condition; a thrown error is not.
// ---------------------------------------------------------------------------

// Minimal empty-safe arguments per core tool. Ordered read-only first, then
// mutating tools (clarify answers a real fixture clarification; compile
// regenerates artifacts in the temp copy).
const CORE_TOOL_ARGS = new Map([
  ["brand_status", {}],
  ["brand_runtime", {}],
  ["brand_context", { task_type: "social-post" }],
  ["brand_check", { color: "#2a4494" }],
  ["brand_preflight", { html: "<div><style>.a{color:#2a4494}</style>ok</div>" }],
  ["brand_report", {}],
  ["brand_export", { target: "chat" }],
  ["brand_brandcode_auth", { mode: "status" }],
  ["brand_brandcode_connect", { mode: "pull" }], // no url: graceful structured error expected
  ["brand_start", { client_name: "Fixture Brand" }],
  ["brand_clarify", { id: "clarify-1", answer: "yes" }],
  ["brand_compile", {}],
]);

function envelopeOk(result) {
  const sc = result.structuredContent;
  if (!sc || typeof sc !== "object") return "missing structuredContent";
  const meta = sc._metadata;
  if (!meta || typeof meta.what_happened !== "string" || meta.what_happened.length === 0) {
    return "missing _metadata.what_happened";
  }
  if (!Array.isArray(meta.next_steps)) return "missing _metadata.next_steps";
  let parsed;
  try {
    parsed = parseText(result);
  } catch {
    return "text payload is not valid JSON";
  }
  if (parsed?._metadata?.what_happened !== meta.what_happened) {
    return "text payload does not mirror structuredContent";
  }
  return null;
}

async function runEnvelopeChecks() {
  const dir = await copyBrandFixture();
  await withServer(dir, "core", async (client) => {
    const { tools } = await client.listTools();
    const registered = tools.map((t) => t.name);

    // Every registered core tool must have an args mapping; every mapped tool
    // must be registered. Drift in either direction fails loudly.
    const unmapped = registered.filter((n) => !CORE_TOOL_ARGS.has(n));
    const stale = [...CORE_TOOL_ARGS.keys()].filter((n) => !registered.includes(n));
    record(
      "envelope: core surface coverage",
      `${registered.length} tools registered / ${CORE_TOOL_ARGS.size} mapped`,
      "every core tool exercised",
      unmapped.length === 0 && stale.length === 0,
      unmapped.length || stale.length
        ? `unmapped: [${unmapped.join(", ")}], stale: [${stale.join(", ")}]`
        : undefined
    );

    for (const [name, args] of CORE_TOOL_ARGS) {
      if (!registered.includes(name)) continue; // already reported above
      try {
        const result = await client.callTool({ name, arguments: args });
        if (result.isError) {
          record(`envelope: ${name}`, "protocol error", "well-formed envelope", false,
            String(result.content?.[0]?.text ?? "").slice(0, 200));
          continue;
        }
        const problem = envelopeOk(result);
        record(`envelope: ${name}`, problem ?? "ok", "well-formed envelope", problem === null, problem ?? undefined);
      } catch (err) {
        record(`envelope: ${name}`, "threw", "well-formed envelope", false, String(err).slice(0, 200));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// C. Second-agent runtime usability
//    Scenario: agent 1 compiles a brand; a SECOND agent on a fresh server
//    loads it purely through brand_runtime + brand_context. brand_compile is
//    run first because approval/provenance/schema_version are emitted by the
//    compiler (0.9.6+); the shipped fixture's checked-in runtime predates
//    them. The compiled brand-runtime.json is also validated against
//    BrandRuntimeSchema from dist/schemas.
// ---------------------------------------------------------------------------

async function runSecondAgentChecks() {
  const dir = await copyBrandFixture();
  await withServer(dir, "core", async (client) => {
    const compile = await client.callTool({ name: "brand_compile", arguments: {} });
    const compileOk = !compile.isError && envelopeOk(compile) === null;
    record("second-agent: brand_compile", compileOk ? "ok" : "failed", "succeeds", compileOk);

    const rt = await client.callTool({ name: "brand_runtime", arguments: {} });
    const rtParsed = rt.structuredContent ?? {};
    const runtime = rtParsed.runtime;
    const rtOk =
      !rt.isError &&
      envelopeOk(rt) === null &&
      runtime &&
      typeof runtime === "object" &&
      !("error" in rtParsed);
    record("second-agent: brand_runtime succeeds", rtOk ? "ok" : "failed", "succeeds", Boolean(rtOk));

    const approval = rtParsed.approval ?? runtime?.approval;
    const provenance = runtime?.provenance;
    const versioned = Boolean(runtime?.schema_version || runtime?.version);
    const contractOk =
      typeof approval === "string" &&
      approval.length > 0 &&
      provenance &&
      Array.isArray(provenance.sources) &&
      versioned;
    record(
      "second-agent: runtime trust fields",
      contractOk
        ? `approval=${approval}, provenance+${runtime.schema_version ? "schema_version" : "version"}`
        : "missing field(s)",
      "approval + provenance + schema_version||version",
      Boolean(contractOk),
      contractOk
        ? undefined
        : `approval=${JSON.stringify(approval)}, provenance=${JSON.stringify(provenance)}, versioned=${versioned}`
    );

    let schemaOk = false;
    let schemaDetail;
    try {
      const raw = JSON.parse(await readFile(join(dir, ".brand", "brand-runtime.json"), "utf-8"));
      BrandRuntimeSchema.parse(raw);
      schemaOk = true;
    } catch (err) {
      schemaDetail = String(err).slice(0, 300);
    }
    record(
      "second-agent: brand-runtime.json vs BrandRuntimeSchema",
      schemaOk ? "valid" : "invalid",
      "parses",
      schemaOk,
      schemaDetail
    );

    const ctx = await client.callTool({
      name: "brand_context",
      arguments: { task_type: "landing-page" },
    });
    const ctxParsed = ctx.structuredContent ?? {};
    const ctxOk = !ctx.isError && envelopeOk(ctx) === null && !("error" in ctxParsed);
    record("second-agent: brand_context succeeds", ctxOk ? "ok" : "failed", "succeeds", Boolean(ctxOk));
  });
}

// ---------------------------------------------------------------------------
// D. Compliance accuracy
//    Each labeled case in eval/fixtures/compliance/cases.json is scored with
//    brand_check_compliance against a fresh brand-complete copy (full profile
//    — the tool is not in the core surface). Reported as accuracy %.
// ---------------------------------------------------------------------------

async function runComplianceChecks() {
  const fixture = JSON.parse(
    readFileSync(join(EVAL_DIR, "fixtures", "compliance", "cases.json"), "utf-8")
  );
  const dir = await copyBrandFixture();
  const caseResults = [];

  await withServer(dir, "full", async (client) => {
    for (const c of fixture.cases) {
      try {
        const result = await client.callTool({
          name: "brand_check_compliance",
          arguments: { content: c.content },
        });
        const verdict = result.structuredContent?.result ?? "error";
        caseResults.push({
          id: c.id,
          expected: c.expected,
          actual: verdict,
          correct: verdict === c.expected,
        });
      } catch (err) {
        caseResults.push({
          id: c.id,
          expected: c.expected,
          actual: "threw",
          correct: false,
          error: String(err).slice(0, 200),
        });
      }
    }
  });

  const correct = caseResults.filter((r) => r.correct).length;
  const accuracy = (correct / caseResults.length) * 100;
  const wrong = caseResults.filter((r) => !r.correct).map((r) => `${r.id} (got ${r.actual})`);
  record(
    "compliance accuracy",
    `${accuracy.toFixed(1)}% (${correct}/${caseResults.length})`,
    ">= 90%",
    accuracy >= 90,
    wrong.length ? `mismatches: ${wrong.join("; ")}` : undefined
  );
  return caseResults;
}

// ---------------------------------------------------------------------------
// E. MODEL-DEPENDENT: first-tool selection (--with-llm + ANTHROPIC_API_KEY)
//    One API call per prompt fixture to claude-haiku-4-5. Scored exact-match
//    against expected_tools. Results are stamped with the model id and date;
//    they vary by model and are never run in CI and never affect exit code.
// ---------------------------------------------------------------------------

const LLM_MODEL = "claude-haiku-4-5-20251001";
const LLM_SYSTEM =
  "You are choosing which MCP tool to call first for the user's request. Reply with ONLY the tool name.";

async function buildToolList(profile) {
  const dir = await copyBrandFixture();
  return withServer(dir, profile, async (client) => {
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      annotations: t.annotations ?? null,
    }));
  });
}

function normalizeToolReply(text) {
  const cleaned = text.trim().replace(/^[`"'\s]+|[`"'.\s]+$/g, "");
  return cleaned.split(/\s+/)[0] ?? "";
}

async function runFirstToolSelection() {
  const fixture = JSON.parse(
    readFileSync(join(EVAL_DIR, "fixtures", "prompts.json"), "utf-8")
  );
  const toolLists = {};
  for (const profile of new Set(fixture.cases.map((c) => c.profile))) {
    toolLists[profile] = await buildToolList(profile);
  }

  const caseResults = [];
  for (const c of fixture.cases) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: LLM_MODEL,
          max_tokens: 100,
          system: LLM_SYSTEM,
          messages: [
            {
              role: "user",
              content: `${c.prompt}\n\nAvailable tools (JSON):\n${JSON.stringify(toolLists[c.profile])}`,
            },
          ],
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        caseResults.push({
          id: c.id,
          expected: c.expected_tools,
          selected: null,
          correct: false,
          error: `HTTP ${response.status}: ${body.slice(0, 200)}`,
        });
        continue;
      }
      const data = await response.json();
      const text = data.content?.find((b) => b.type === "text")?.text ?? "";
      const selected = normalizeToolReply(text);
      caseResults.push({
        id: c.id,
        expected: c.expected_tools,
        selected,
        correct: c.expected_tools.includes(selected),
      });
    } catch (err) {
      caseResults.push({
        id: c.id,
        expected: c.expected_tools,
        selected: null,
        correct: false,
        error: String(err).slice(0, 200),
      });
    }
  }

  const correct = caseResults.filter((r) => r.correct).length;
  const accuracy = (correct / caseResults.length) * 100;
  return {
    model: LLM_MODEL,
    date: new Date().toISOString(),
    metric: "first_tool_selection_accuracy",
    value: `${accuracy.toFixed(1)}% (${correct}/${caseResults.length})`,
    accuracy,
    cases: caseResults,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

try {
  await runBudgetChecks();
  await runEnvelopeChecks();
  await runSecondAgentChecks();
  const complianceCases = await runComplianceChecks();

  let modelDependent = null;
  if (WITH_LLM && API_KEY) {
    modelDependent = await runFirstToolSelection();
  } else if (WITH_LLM) {
    modelDependent = {
      skipped: "ANTHROPIC_API_KEY not set — model-dependent tier not run",
    };
  }

  const mode = WITH_LLM && API_KEY ? "full" : "deterministic";
  const runStamp = {
    date: new Date().toISOString(),
    mode,
    node: process.version,
    package: `${pkg.name}@${pkg.version}`,
  };
  const results = {
    run: runStamp,
    deterministic: { checks, compliance_cases: complianceCases },
    model_dependent: modelDependent,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${runStamp.date.slice(0, 10)}-${mode}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");

  // Markdown summary
  const lines = [];
  lines.push(`## brandsystem-mcp agent eval — ${runStamp.date}`);
  lines.push("");
  lines.push(`Mode: ${mode} | ${runStamp.package} | node ${runStamp.node}`);
  lines.push("");
  lines.push("| Check | Value | Target | Pass |");
  lines.push("|---|---|---|---|");
  for (const c of checks) {
    lines.push(`| ${c.metric} | ${c.value} | ${c.target} | ${c.pass ? "PASS" : "FAIL"} |`);
  }
  if (modelDependent && !modelDependent.skipped) {
    lines.push("");
    lines.push(`### Model-dependent (informational — does not gate)`);
    lines.push("");
    lines.push(`Model: ${modelDependent.model} | Run: ${modelDependent.date}`);
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|---|---|");
    lines.push(`| first-tool selection accuracy | ${modelDependent.value} |`);
    for (const r of modelDependent.cases) {
      lines.push(
        `| ${r.id} | ${r.correct ? "correct" : "MISS"} — selected \`${r.selected ?? "n/a"}\`, expected \`${r.expected.join("` or `")}\`${r.error ? ` (${r.error})` : ""} |`
      );
    }
  } else if (modelDependent?.skipped) {
    lines.push("");
    lines.push(`> Model-dependent tier skipped: ${modelDependent.skipped}`);
  }
  lines.push("");
  lines.push(`Results written to ${outPath}`);
  console.log(lines.join("\n"));

  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    console.error(`\neval: ${failed.length} deterministic check(s) FAILED.`);
    process.exit(1);
  }
} finally {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
