#!/usr/bin/env node
/**
 * Public agent-evaluation harness for @brandsystem/mcp.
 *
 * Two tiers (see eval/README.md for the full methodology):
 *   DETERMINISTIC  — runs everywhere, no LLM, gates the exit code. Includes
 *                    the end-to-end job scenario
 *                    "e2e: adopt→clarify→promote→context→check".
 *   MODEL-DEPENDENT — first-tool selection; only with --with-llm AND a
 *                     provider API key. Never affects the exit code.
 *                     Provider/model are pluggable (anthropic, openai, or any
 *                     openai-compatible endpoint via BRANDSYSTEM_EVAL_BASE_URL).
 *
 * Evaluation sets:
 *   eval/fixtures/prompts.json          — public DEVELOPMENT set. Description
 *                                         authors may read and optimize
 *                                         against it.
 *   BRANDSYSTEM_EVAL_HOLDOUT=<path>     — private HOLDOUT set kept OUTSIDE the
 *                                         repo, frozen and committed by hash
 *                                         before testing (see eval/HOLDOUT.md
 *                                         and eval/HOLDOUT-COMMITMENTS.md).
 *                                         Holdout scores print separately and
 *                                         are labeled set: "holdout".
 *
 * Honesty contract: this script only reports numbers it actually measured
 * in this run, stamped with date / node / package version (and provider +
 * model id for the LLM tier). It never emits placeholder or previously
 * published results.
 *
 * Usage:
 *   npm run build && npm run eval                        # deterministic tier
 *   ANTHROPIC_API_KEY=... npm run eval -- --with-llm     # + first-tool selection
 *   OPENAI_API_KEY=... npm run eval -- --with-llm --model gpt-4o-mini
 *   BRANDSYSTEM_EVAL_HOLDOUT=/private/holdout.json ANTHROPIC_API_KEY=... \
 *     npm run eval -- --with-llm                         # + holdout scoring
 *   node scripts/agent-eval.mjs commit-holdout --file /private/holdout.json
 *                                                        # print public commitment
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { createHoldoutCommitment, validateHoldout } from "./holdout-commitment.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const FIXTURE_BRAND = join(ROOT, "test", "fixtures", "brand-complete");
const EVAL_DIR = join(ROOT, "eval");
const RESULTS_DIR = join(EVAL_DIR, "results");

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

// ---------------------------------------------------------------------------
// Pure helpers (exported for test/eval-harness.test.ts; no side effects)
// ---------------------------------------------------------------------------

/**
 * Infer the provider from the model id unless explicitly overridden.
 * claude-* → anthropic; gpt-* / o<digit>* → openai; a configured base URL
 * (BRANDSYSTEM_EVAL_BASE_URL) selects the generic openai-compatible adapter.
 */
export function inferProvider(model, explicitProvider, baseUrl) {
  if (explicitProvider) return explicitProvider;
  if (baseUrl) return "openai-compatible";
  if (/^claude/i.test(model)) return "anthropic";
  if (/^gpt/i.test(model) || /^o\d/i.test(model)) return "openai";
  return "anthropic";
}

export function normalizeToolReply(text) {
  const cleaned = String(text ?? "").trim().replace(/^[`"'\s]+|[`"'.\s]+$/g, "");
  return cleaned.split(/\s+/)[0] ?? "";
}

/**
 * A "no tool applies" reply. The system prompt asks the model to reply with
 * exactly NONE when nothing fits; accept the common honest variants too.
 */
export function isNoToolReply(text) {
  const t = String(text ?? "").trim().replace(/^[`"'\s]+/, "").toLowerCase();
  return /^(none\b|no[ _-]?tool)/.test(t);
}

/** A case where the correct behavior is NOT calling any brandsystem tool. */
export function isNegativeCase(c) {
  return (
    c.category === "negative" ||
    c.expected_action === "no_tool" ||
    (Array.isArray(c.expected_tools) && c.expected_tools.length === 0)
  );
}

/**
 * Derive a deterministic brand_clarify answer for a clarification item from
 * the fixture's own ground truth (the pre-degradation core identity). Used by
 * the e2e job scenario — the harness, not a model, supplies every answer.
 */
export function deriveClarifyAnswer(item, groundTruth) {
  const field = String(item.field ?? "");
  const question = String(item.question ?? "");
  const colors = groundTruth?.colors ?? [];

  if (field === "colors.roles") {
    const hexes = question.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
    const parts = hexes.map((hex) => {
      const gt = colors.find((c) => c.value?.toLowerCase() === hex.toLowerCase());
      const role = gt && gt.role !== "unknown" ? gt.role : "accent";
      return `${hex.toLowerCase()} is ${role}`;
    });
    return parts.length > 0 ? parts.join(", ") : "the dark one is primary";
  }
  if (field.startsWith("colors.")) {
    const hexInQuestion = question.match(/#[0-9a-fA-F]{3,8}/)?.[0];
    if (hexInQuestion) return hexInQuestion.toLowerCase();
    const role = field.slice("colors.".length);
    const gt = colors.find((c) => c.role === role);
    return gt?.value ?? "yes";
  }
  if (field === "typography") return groundTruth?.typography?.[0]?.family ?? "Inter";
  if (field.startsWith("typography.")) return "yes";
  if (field === "logo") return "wordmark logo already provided in .brand/assets/logo";
  return "confirmed — keep the extracted value";
}

/**
 * Format a holdout commitment as a markdown block suitable for appending to
 * eval/HOLDOUT-COMMITMENTS.md. Contains only the hash and aggregate
 * distribution — never prompts.
 */
export function formatCommitmentBlock(commitment, { date, packageCommit } = {}) {
  const kv = (obj) =>
    Object.entries(obj ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || "(none)";
  const lines = [
    `### Holdout commitment — ${date ?? new Date().toISOString().slice(0, 10)}`,
    "",
    `- schema: ${commitment.schema_version}`,
    "- serialization: canonical JSON (keys sorted recursively, no insignificant whitespace, LF only)",
    `- sha256: \`${commitment.sha256}\``,
    `- case_count: ${commitment.case_count}`,
    `- negative_case_count: ${commitment.negative_case_count}`,
    `- categories: ${kv(commitment.categories)}`,
    `- profiles: ${kv(commitment.profiles)}`,
    `- package_commit: ${packageCommit ?? "(unknown — not a git checkout)"}`,
    `- committed_at: ${date ?? new Date().toISOString().slice(0, 10)}`,
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Provider adapters (model-dependent tier only)
// ---------------------------------------------------------------------------

/**
 * Each adapter exposes complete({system, user, maxTokens}) → reply text.
 * requiredKeyEnv names the env var that gates the tier; the generic
 * openai-compatible adapter treats the key as optional (local servers).
 */
export function createAdapter(provider, model, { baseUrl } = {}) {
  if (provider === "anthropic") {
    return {
      provider,
      model,
      requiredKeyEnv: "ANTHROPIC_API_KEY",
      keyOptional: false,
      async complete({ system, user, maxTokens }) {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: user }],
          }),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
        const data = await response.json();
        return data.content?.find((b) => b.type === "text")?.text ?? "";
      },
    };
  }
  if (provider === "openai" || provider === "openai-compatible") {
    const base =
      provider === "openai"
        ? "https://api.openai.com/v1"
        : String(baseUrl ?? "").replace(/\/+$/, "");
    if (provider === "openai-compatible" && !base) {
      throw new Error("openai-compatible provider requires BRANDSYSTEM_EVAL_BASE_URL");
    }
    return {
      provider,
      model,
      requiredKeyEnv: "OPENAI_API_KEY",
      keyOptional: provider === "openai-compatible",
      async complete({ system, user, maxTokens }) {
        const headers = { "content-type": "application/json" };
        if (process.env.OPENAI_API_KEY) {
          headers.authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
        }
        const body = {
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        };
        // Newer OpenAI models reject max_tokens; compatible local servers
        // often don't know max_completion_tokens yet.
        if (provider === "openai") body.max_completion_tokens = maxTokens;
        else body.max_tokens = maxTokens;
        const response = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
        const data = await response.json();
        return data.choices?.[0]?.message?.content ?? "";
      },
    };
  }
  throw new Error(`Unknown provider "${provider}" (expected anthropic | openai | openai-compatible)`);
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    command: "run",
    withLlm: false,
    model: null,
    provider: null,
    file: null,
  };
  const rest = [...argv];
  if (rest[0] === "commit-holdout") {
    args.command = "commit-holdout";
    rest.shift();
  }
  while (rest.length > 0) {
    const arg = rest.shift();
    if (arg === "--with-llm") args.withLlm = true;
    else if (arg === "--model") args.model = rest.shift() ?? null;
    else if (arg?.startsWith("--model=")) args.model = arg.slice("--model=".length);
    else if (arg === "--provider") args.provider = rest.shift() ?? null;
    else if (arg?.startsWith("--provider=")) args.provider = arg.slice("--provider=".length);
    else if (arg === "--file") args.file = rest.shift() ?? null;
    else if (arg?.startsWith("--file=")) args.file = arg.slice("--file=".length);
  }
  return args;
}

// ---------------------------------------------------------------------------
// commit-holdout subcommand
// ---------------------------------------------------------------------------

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

async function runCommitHoldout(filePath) {
  if (!filePath) {
    console.error(
      "Usage: node scripts/agent-eval.mjs commit-holdout --file /private/path/holdout.json\n" +
        "Prints a public commitment block (hash + counts + category distribution) for\n" +
        "eval/HOLDOUT-COMMITMENTS.md. Never prints prompts. The holdout file itself\n" +
        "stays OUTSIDE the repo and is never committed."
    );
    process.exit(1);
  }
  const document = JSON.parse(await readFile(filePath, "utf-8"));
  const commitment = createHoldoutCommitment(document);
  const block = formatCommitmentBlock(commitment, {
    date: new Date().toISOString().slice(0, 10),
    packageCommit: gitHead(),
  });
  console.log(block);
  console.log(
    "Append the block above to eval/HOLDOUT-COMMITMENTS.md and commit it BEFORE any\n" +
      "testing against this holdout. Do NOT commit the holdout file itself."
  );
}

// ---------------------------------------------------------------------------
// Deterministic tier
// ---------------------------------------------------------------------------

const tempDirs = [];
const checks = [];

function record(metric, value, target, pass, detail) {
  checks.push({ metric, value, target, pass, ...(detail ? { detail } : {}) });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "commit-holdout") {
    await runCommitHoldout(args.file);
    return;
  }

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

  // --- Model-dependent tier configuration (adapters) ---
  const baseUrl = process.env.BRANDSYSTEM_EVAL_BASE_URL || null;
  const model = args.model || process.env.BRANDSYSTEM_EVAL_MODEL || DEFAULT_MODEL;
  const provider = inferProvider(model, args.provider, baseUrl);
  const holdoutPath = process.env.BRANDSYSTEM_EVAL_HOLDOUT || null;

  // -------------------------------------------------------------------------
  // Harness plumbing
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // A. Entry-tool response budgets
  //    Budgets mirror test/response-budgets.test.ts — token estimates
  //    (~4 chars/token) with headroom over measured actuals. Measured on the
  //    full profile, empty-directory status first, matching the test file.
  // -------------------------------------------------------------------------

  const BUDGETS = {
    brand_status_getting_started: 950,
    brand_status_with_brand: 850,
    brand_context_standard: 900,
    brand_context_compact: 500,
  };

  async function measureTokens(dir, tool, toolArgs) {
    return withServer(dir, "full", async (client) => {
      const result = await client.callTool({ name: tool, arguments: toolArgs ?? {} });
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

  // -------------------------------------------------------------------------
  // B. Envelope conformance across the CORE tool surface
  //    Every core tool, called with minimal empty-safe args on a brand-complete
  //    copy, must return structuredContent matching the response envelope
  //    ({_metadata:{what_happened,next_steps}, ...data}) and text that parses
  //    to the same shape. The brandcode auth/connect tools are called in their
  //    network-free modes — a graceful, well-formed response (including a
  //    structured error payload) IS the pass condition; a thrown error is not.
  // -------------------------------------------------------------------------

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

      for (const [name, toolArgs] of CORE_TOOL_ARGS) {
        if (!registered.includes(name)) continue; // already reported above
        try {
          const result = await client.callTool({ name, arguments: toolArgs });
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

  // -------------------------------------------------------------------------
  // C. Second-agent runtime usability
  //    Scenario: agent 1 compiles a brand; a SECOND agent on a fresh server
  //    loads it purely through brand_runtime + brand_context. brand_compile is
  //    run first because approval/provenance/schema_version are emitted by the
  //    compiler (0.9.6+); the shipped fixture's checked-in runtime predates
  //    them. The compiled brand-runtime.json is also validated against
  //    BrandRuntimeSchema from dist/schemas.
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // D. Compliance accuracy
  //    Each labeled case in eval/fixtures/compliance/cases.json is scored with
  //    brand_check_compliance against a fresh brand-complete copy (full profile
  //    — the tool is not in the core surface). Reported as accuracy %.
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // E. Deterministic end-to-end job scenario
  //    "e2e: adopt→clarify→promote→context→check"
  //
  //    A fresh brand-complete copy stands in for adopting an existing .brand/.
  //    The brand-complete fixture compiles with ZERO clarifications (all its
  //    values sit at medium+ confidence, and needs-clarification only fires at
  //    low), so the harness engineers one: it lowers one non-primary color to
  //    low confidence in the temp copy BEFORE the first compile — the
  //    promotion path is then actually exercised, not skipped.
  //
  //    Steps (each recorded pass/fail):
  //      adopt     — copy fixture, degrade one confidence, brand_compile
  //                  produces >= 1 clarification
  //      clarify   — answer EVERY item via brand_clarify with scripted answers
  //                  derived from the fixture's own ground truth
  //                  (deriveClarifyAnswer); zero items remain
  //      promote   — .brand/approval.json records human_confirmed_local
  //      recompile — brand_compile again; brand-runtime.json carries
  //                  approval === "human_confirmed_local"
  //      context   — brand_context succeeds on the promoted runtime
  //      check     — brand_check passes an on-brand snippet (governed color,
  //                  brand font, shadow-free CSS)
  // -------------------------------------------------------------------------

  async function runE2EJobScenario() {
    const dir = await copyBrandFixture();
    const identityPath = join(dir, ".brand", "core-identity.yaml");

    // Ground truth = the fixture's identity BEFORE the engineered degradation.
    const groundTruth = parseYaml(await readFile(identityPath, "utf-8"));
    const degraded = parseYaml(await readFile(identityPath, "utf-8"));
    const target =
      degraded.colors.find((c) => c.role !== "primary") ??
      degraded.colors[degraded.colors.length - 1];
    target.confidence = "low";
    await writeFile(identityPath, stringifyYaml(degraded), "utf-8");

    await withServer(dir, "core", async (client) => {
      // adopt
      let clarificationCount = 0;
      let adoptOk = false;
      let adoptDetail;
      try {
        const compile = await client.callTool({ name: "brand_compile", arguments: {} });
        const sc = compile.structuredContent ?? {};
        clarificationCount = sc.clarifications?.total ?? 0;
        adoptOk =
          !compile.isError &&
          envelopeOk(compile) === null &&
          !("error" in sc) &&
          clarificationCount >= 1;
        if (!adoptOk) adoptDetail = `clarifications=${clarificationCount}`;
      } catch (err) {
        adoptDetail = String(err).slice(0, 200);
      }
      record(
        "e2e: adopt (compile w/ engineered clarification)",
        adoptOk ? `ok (${clarificationCount} clarification(s))` : "failed",
        ">= 1 clarification",
        adoptOk,
        adoptDetail
      );

      // clarify — answer every item deterministically from ground truth
      let clarifyOk = false;
      let clarifyDetail;
      const answered = [];
      try {
        const pending = parseYaml(
          await readFile(join(dir, ".brand", "needs-clarification.yaml"), "utf-8")
        );
        let remaining = pending.items.length;
        for (const item of pending.items) {
          const answer = deriveClarifyAnswer(item, groundTruth);
          const result = await client.callTool({
            name: "brand_clarify",
            arguments: { id: item.id, answer },
          });
          const sc = result.structuredContent ?? {};
          if (result.isError || "error" in sc) {
            throw new Error(`brand_clarify ${item.id} failed: ${sc.error ?? "protocol error"}`);
          }
          remaining = sc.remaining_clarifications ?? remaining;
          answered.push(`${item.id}="${answer}"`);
        }
        clarifyOk = pending.items.length >= 1 && remaining === 0;
        if (!clarifyOk) clarifyDetail = `items=${pending.items.length}, remaining=${remaining}`;
      } catch (err) {
        clarifyDetail = String(err).slice(0, 200);
      }
      record(
        "e2e: clarify (scripted ground-truth answers)",
        clarifyOk ? `ok (${answered.join("; ")})` : "failed",
        "all items resolved",
        clarifyOk,
        clarifyDetail
      );

      // promote — approval.json written by the clarify flow
      let promoteOk = false;
      let promoteDetail;
      try {
        const approval = JSON.parse(
          await readFile(join(dir, ".brand", "approval.json"), "utf-8")
        );
        promoteOk = approval.level === "human_confirmed_local";
        if (!promoteOk) promoteDetail = `level=${approval.level}`;
      } catch (err) {
        promoteDetail = String(err).slice(0, 200);
      }
      record(
        "e2e: promote (approval.json)",
        promoteOk ? "human_confirmed_local" : "failed",
        "human_confirmed_local",
        promoteOk,
        promoteDetail
      );

      // recompile — the runtime picks up the promoted approval level
      let recompileOk = false;
      let recompileDetail;
      try {
        const compile = await client.callTool({ name: "brand_compile", arguments: {} });
        const compiledOk = !compile.isError && envelopeOk(compile) === null;
        const runtime = JSON.parse(
          await readFile(join(dir, ".brand", "brand-runtime.json"), "utf-8")
        );
        recompileOk = compiledOk && runtime.approval === "human_confirmed_local";
        if (!recompileOk) {
          recompileDetail = `compile=${compiledOk}, runtime.approval=${runtime.approval}`;
        }
      } catch (err) {
        recompileDetail = String(err).slice(0, 200);
      }
      record(
        "e2e: recompile (runtime approval)",
        recompileOk ? "approval=human_confirmed_local" : "failed",
        "brand-runtime.json approval === human_confirmed_local",
        recompileOk,
        recompileDetail
      );

      // context — the promoted runtime serves task context
      let ctxOk = false;
      let ctxDetail;
      try {
        const ctx = await client.callTool({
          name: "brand_context",
          arguments: { task_type: "social-post" },
        });
        const sc = ctx.structuredContent ?? {};
        ctxOk = !ctx.isError && envelopeOk(ctx) === null && !("error" in sc);
        if (!ctxOk) ctxDetail = String(sc.error ?? "envelope problem");
      } catch (err) {
        ctxDetail = String(err).slice(0, 200);
      }
      record("e2e: context (brand_context succeeds)", ctxOk ? "ok" : "failed", "succeeds", ctxOk, ctxDetail);

      // check — an on-brand snippet passes the inline gate
      let checkOk = false;
      let checkDetail;
      try {
        const check = await client.callTool({
          name: "brand_check",
          arguments: {
            color: "#2a4494",
            font: "Inter",
            css: "background:#2a4494;color:#ffffff;font-family:Inter,sans-serif",
          },
        });
        const sc = check.structuredContent ?? {};
        checkOk = !check.isError && envelopeOk(check) === null && sc.pass === true;
        if (!checkOk) {
          checkDetail = `pass=${sc.pass}, flags=${JSON.stringify(sc.flags ?? []).slice(0, 200)}`;
        }
      } catch (err) {
        checkDetail = String(err).slice(0, 200);
      }
      record(
        "e2e: check (on-brand snippet passes)",
        checkOk ? "pass" : "failed",
        "pass === true",
        checkOk,
        checkDetail
      );
    });
  }

  // -------------------------------------------------------------------------
  // F. MODEL-DEPENDENT: first-tool selection (--with-llm + provider key)
  //    One API call per prompt case via the selected adapter. Positive cases
  //    are exact-matched against expected_tools; negative cases (correct
  //    behavior = NO brandsystem tool) expect a NONE reply. Results are
  //    stamped with provider + model + date + set label; never run in CI and
  //    never affect the exit code. The negative-case FALSE-POSITIVE INVOCATION
  //    RATE is reported prominently — it gates nothing yet.
  // -------------------------------------------------------------------------

  const LLM_SYSTEM =
    "You are choosing which MCP tool to call first for the user's request. " +
    "Reply with ONLY the tool name. If none of the listed tools applies to the " +
    "request, reply with exactly NONE.";

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

  async function runFirstToolSelection(adapter, fixture, setLabel) {
    const toolLists = {};
    for (const profile of new Set(fixture.cases.map((c) => c.profile))) {
      toolLists[profile] = await buildToolList(profile);
    }

    const caseResults = [];
    for (const c of fixture.cases) {
      const negative = isNegativeCase(c);
      try {
        const text = await adapter.complete({
          system: LLM_SYSTEM,
          user: `${c.prompt}\n\nAvailable tools (JSON):\n${JSON.stringify(toolLists[c.profile])}`,
          maxTokens: 100,
        });
        const selected = normalizeToolReply(text);
        const declinedTool = isNoToolReply(text);
        const invokedTool = toolLists[c.profile].some((t) => t.name === selected);
        const correct = negative
          ? declinedTool
          : c.expected_tools.includes(selected);
        caseResults.push({
          id: c.id,
          category: c.category ?? (negative ? "negative" : "unspecified"),
          negative,
          expected: negative ? ["NONE"] : c.expected_tools,
          selected: declinedTool ? "NONE" : selected,
          false_invocation: negative && invokedTool,
          correct,
        });
      } catch (err) {
        caseResults.push({
          id: c.id,
          category: c.category ?? (negative ? "negative" : "unspecified"),
          negative,
          expected: negative ? ["NONE"] : c.expected_tools,
          selected: null,
          false_invocation: false,
          correct: false,
          error: String(err).slice(0, 200),
        });
      }
    }

    const positives = caseResults.filter((r) => !r.negative);
    const negatives = caseResults.filter((r) => r.negative);
    const posCorrect = positives.filter((r) => r.correct).length;
    const negCorrect = negatives.filter((r) => r.correct).length;
    const falseInvocations = negatives.filter((r) => r.false_invocation).length;
    const overallCorrect = posCorrect + negCorrect;

    const pct = (num, den) => (den === 0 ? null : (num / den) * 100);

    return {
      set: setLabel,
      provider: adapter.provider,
      model: adapter.model,
      date: new Date().toISOString(),
      metric: "first_tool_selection",
      overall_accuracy: pct(overallCorrect, caseResults.length),
      overall_value: `${(pct(overallCorrect, caseResults.length) ?? 0).toFixed(1)}% (${overallCorrect}/${caseResults.length})`,
      positive: {
        total: positives.length,
        correct: posCorrect,
        accuracy: pct(posCorrect, positives.length),
      },
      negative: {
        total: negatives.length,
        correct: negCorrect,
        false_invocations: falseInvocations,
        false_invocation_rate: pct(falseInvocations, negatives.length),
      },
      cases: caseResults,
    };
  }

  // -------------------------------------------------------------------------
  // Run
  // -------------------------------------------------------------------------

  try {
    await runBudgetChecks();
    await runEnvelopeChecks();
    await runSecondAgentChecks();
    const complianceCases = await runComplianceChecks();
    await runE2EJobScenario();

    let modelDependent = null;
    let llmRan = false;
    if (args.withLlm) {
      const adapter = createAdapter(provider, model, { baseUrl });
      const hasKey = Boolean(process.env[adapter.requiredKeyEnv]) || adapter.keyOptional;
      if (!hasKey) {
        modelDependent = {
          skipped: `${adapter.requiredKeyEnv} not set — model-dependent tier not run (provider: ${provider})`,
        };
      } else {
        llmRan = true;
        const devFixture = JSON.parse(
          readFileSync(join(EVAL_DIR, "fixtures", "prompts.json"), "utf-8")
        );
        const sets = [
          await runFirstToolSelection(
            adapter,
            devFixture,
            devFixture.set ?? "development"
          ),
        ];

        let holdout = null;
        if (holdoutPath) {
          const holdoutDoc = JSON.parse(readFileSync(holdoutPath, "utf-8"));
          validateHoldout(holdoutDoc);
          const commitment = createHoldoutCommitment(holdoutDoc);
          const holdoutRun = await runFirstToolSelection(adapter, holdoutDoc, "holdout");
          holdout = { ...holdoutRun, commitment_sha256: commitment.sha256 };
          sets.push(holdout);
        }

        modelDependent = { provider, model, sets };
      }
    }

    const mode = llmRan ? "full" : "deterministic";
    const runStamp = {
      date: new Date().toISOString(),
      mode,
      node: process.version,
      package: `${pkg.name}@${pkg.version}`,
      ...(llmRan ? { provider, model } : {}),
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
      for (const set of modelDependent.sets) {
        lines.push("");
        lines.push(
          `### Model-dependent — ${set.set.toUpperCase()} set (informational — does not gate)`
        );
        lines.push("");
        lines.push(
          `Provider: ${set.provider} | Model: ${set.model} | Run: ${set.date}` +
            (set.commitment_sha256 ? ` | Holdout commitment: \`${set.commitment_sha256}\`` : "")
        );
        lines.push("");
        lines.push("| Metric | Value |");
        lines.push("|---|---|");
        lines.push(`| first-tool selection (overall) | ${set.overall_value} |`);
        if (set.positive.total > 0) {
          lines.push(
            `| positive routing accuracy | ${(set.positive.accuracy ?? 0).toFixed(1)}% (${set.positive.correct}/${set.positive.total}) |`
          );
        }
        if (set.negative.total > 0) {
          lines.push(
            `| **NEGATIVE-CASE FALSE-POSITIVE INVOCATION RATE** | **${(set.negative.false_invocation_rate ?? 0).toFixed(1)}% (${set.negative.false_invocations}/${set.negative.total})** — a tool was invoked when NONE applied; gates nothing yet, watch it |`
          );
        }
        for (const r of set.cases) {
          lines.push(
            `| ${r.id} | ${r.correct ? "correct" : "MISS"} — selected \`${r.selected ?? "n/a"}\`, expected \`${r.expected.join("` or `")}\`${r.false_invocation ? " [FALSE INVOCATION]" : ""}${r.error ? ` (${r.error})` : ""} |`
          );
        }
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
}

// Only execute when run as a script — the pure helpers above are imported by
// test/eval-harness.test.ts without triggering a run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`eval: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
