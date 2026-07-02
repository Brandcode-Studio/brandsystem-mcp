import { describe, it, expect, beforeEach, vi } from "vitest";
import { HOSTED_TOOL_ORDER } from "../../src/hosted/registrations.js";
import {
  connectHostedClient as connectClient,
  callHostedTool as call,
} from "./helpers.js";
import type {
  HostedBrandContext,
  BrandcodeMcpAuthInfo,
  HostedRateLimitSnapshot,
} from "../../src/hosted/types.js";
import type { BrandPackagePayload } from "../../src/connectors/brandcode/types.js";

const TEST_RATE_LIMIT: HostedRateLimitSnapshot = {
  status: "active_pre_release_in_process",
  enforced: true,
  enforcement: "in_process_fixed_window",
  scope: "per_key_per_brand",
  limit: 60,
  remaining: 59,
  window_ms: 60_000,
  reset_at: "2026-05-11T12:01:00.000Z",
  retry_after_seconds: null,
  release_gate: "blocked",
  blocker_owner:
    "Jason Lankow / Brandcode Studio Ops <jlankow@columnfive.com>",
  required_before_public_release:
    "Replace in-process pre-release enforcement with durable shared hosted rate-limit enforcement before broad public release",
  source: "hosted tool test",
};

const TEST_DURABLE_RATE_LIMIT: HostedRateLimitSnapshot = {
  status: "active_durable_shared",
  enforced: true,
  enforcement: "durable_shared_redis_fixed_window",
  scope: "per_key_per_brand",
  limit: 60,
  remaining: 58,
  window_ms: 60_000,
  reset_at: "2026-05-11T12:01:00.000Z",
  retry_after_seconds: null,
  release_gate: "blocked",
  blocker_owner:
    "Jason Lankow / Brandcode Studio Ops <jlankow@columnfive.com>",
  required_before_public_release:
    "Capture command-backed hosted durable/shared rate-limit proof and Jason explicit release approval before broad public release",
  source: "hosted durable tool test",
};

function buildAuth(
  overrides: Partial<BrandcodeMcpAuthInfo> = {},
): BrandcodeMcpAuthInfo {
  return {
    token: "bck_test_acme",
    keyId: "bck_test_acme",
    scopes: ["read"],
    allowedSlugs: ["acme"],
    environment: "staging",
    ...overrides,
  };
}

function buildContext(
  pkg: BrandPackagePayload | null,
  overrides: Partial<HostedBrandContext> = {},
): HostedBrandContext {
  const auth = overrides.auth ?? buildAuth();
  return {
    slug: "acme",
    auth,
    loadBrandPackage: async () => pkg,
    ucsBaseUrl: "https://www.brandcode.studio",
    ucsServiceToken: "test-token",
    rateLimit: TEST_RATE_LIMIT,
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("hosted server registers the locked hosted tools in order", () => {
  it("listTools returns the Phase 0 locked surface", async () => {
    const { client } = await connectClient(buildContext(null));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([...HOSTED_TOOL_ORDER]);
  });
});

describe("hosted tool scope enforcement", () => {
  const PACKAGE: BrandPackagePayload = {
    runtime: {
      version: "1.0.0",
      client_name: "Acme Hosted",
      identity: { colors: { primary: "#000000" } },
    },
  };

  it("brand_runtime passes with read scope", async () => {
    const { client } = await connectClient(buildContext(PACKAGE));
    const json = await call(client, "brand_runtime", { slice: "minimal" });
    expect(json.runtime_origin).toBe("hosted");
  });

  it("brand_runtime returns a structured 403-equivalent without read scope", async () => {
    const auth = buildAuth({ scopes: ["check"] });
    const { client } = await connectClient(buildContext(PACKAGE, { auth }));
    const json = await call(client, "brand_runtime", { slice: "minimal" });
    expect(json.error).toBe("insufficient_scope");
    expect(json.status).toBe(403);
    expect(json.required_scope).toBe("read");
    expect(json.granted_scopes).toEqual(["check"]);
  });

  it("brand_search returns a structured 403-equivalent without read scope", async () => {
    const auth = buildAuth({ scopes: ["check"] });
    const { client } = await connectClient(buildContext(null, { auth }));
    const json = await call(client, "brand_search", { query: "proof" });
    expect(json.error).toBe("insufficient_scope");
    expect(json.status).toBe(403);
    expect(json.required_scope).toBe("read");
  });

  it("asset tools return structured 403-equivalent responses without read scope", async () => {
    const auth = buildAuth({ scopes: ["check"] });
    const { client } = await connectClient(buildContext(null, { auth }));
    const list = await call(client, "list_brand_assets", {});
    expect(list.error).toBe("insufficient_scope");
    expect(list.status).toBe(403);
    expect(list.required_scope).toBe("read");

    const get = await call(client, "get_brand_asset", { asset_id: "logo" });
    expect(get.error).toBe("insufficient_scope");
    expect(get.status).toBe(403);
    expect(get.required_scope).toBe("read");
  });

  it("brand_history returns a structured 403-equivalent without read scope", async () => {
    const auth = buildAuth({ scopes: ["check"] });
    const { client } = await connectClient(buildContext(null, { auth }));
    const json = await call(client, "brand_history", {});
    expect(json.error).toBe("insufficient_scope");
    expect(json.status).toBe(403);
    expect(json.required_scope).toBe("read");
  });

  it("brand_check requires explicit check scope; read alone 403s", async () => {
    const readOnly = await connectClient(buildContext(null));
    const denied = await call(readOnly.client, "brand_check", { text: "hi" });
    expect(denied.error).toBe("insufficient_scope");
    expect(denied.status).toBe(403);
    expect(denied.required_scope).toBe("check");

    const auth = buildAuth({ scopes: ["check"] });
    const allowed = await connectClient(buildContext(null, { auth }));
    const json = await call(allowed.client, "brand_check", { text: "hi" });
    expect(json.verdict).toBe("review");
    expect(json.runtime_origin).toBe("hosted");
  });

  it("brand_feedback requires explicit feedback scope", async () => {
    const readOnly = await connectClient(buildContext(null));
    const denied = await call(readOnly.client, "brand_feedback", {
      summary: "test",
    });
    expect(denied.error).toBe("insufficient_scope");
    expect(denied.status).toBe(403);
    expect(denied.required_scope).toBe("feedback");

    const auth = buildAuth({ scopes: ["feedback"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, entry: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const allowed = await connectClient(buildContext(null, { auth }));
    const json = await call(allowed.client, "brand_feedback", {
      summary: "test",
    });
    expect(json.append_status).toBe("recorded");
    expect(json.canonical_mutation).toBe(false);
  });

  it("capture_taste requires explicit capture scope", async () => {
    const readOnly = await connectClient(buildContext(null));
    const denied = await call(readOnly.client, "capture_taste", {
      candidate_ref: "variant-851",
      verdict: "distinctive",
      attribute_reason: "The asymmetric crop reads as ours.",
    });
    expect(denied.error).toBe("insufficient_scope");
    expect(denied.status).toBe(403);
    expect(denied.required_scope).toBe("capture");

    const auth = buildAuth({ scopes: ["capture"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            routed: "queued",
            ref: "taste-ledger:edge-capture",
            quarantined: false,
            canonicalMutation: false,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );
    const allowed = await connectClient(buildContext(null, { auth }));
    const json = await call(allowed.client, "capture_taste", {
      candidate_ref: "variant-851",
      verdict: "distinctive",
      attribute_reason: "The asymmetric crop reads as ours.",
    });
    expect(json).toMatchObject({
      captured: true,
      routed: "queued",
      brand: "acme",
      canonical_mutation: false,
    });
  });
});

describe("capture_taste (hosted)", () => {
  const captureAuth = buildAuth({ scopes: ["capture"] });

  function stubCaptureResponse(body: unknown, init: ResponseInit = {}) {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("queues a taste capture with hosted service authority and route-scoped brand", async () => {
    const fetchMock = stubCaptureResponse({
      ok: true,
      routed: "queued",
      ref: "taste-ledger:edge-capture",
      quarantined: false,
      canonicalMutation: false,
    });
    const { client } = await connectClient(
      buildContext(null, { auth: captureAuth }),
    );

    const json = await call(client, "capture_taste", {
      candidate_ref: "variant-851",
      verdict: "distinctive",
      attribute_reason: "The asymmetric crop and editorial caption read as ours.",
      candidate_text: "Hero candidate with caption",
      surface: "studio",
    });

    expect(json).toMatchObject({
      captured: true,
      routed: "queued",
      brand: "acme",
      candidate_ref: "variant-851",
      verdict: "distinctive",
      canonical_mutation: false,
      ref: "taste-ledger:edge-capture",
    });

    // 2 calls: the tool's own UCS taste-capture POST (calls[0]), then the
    // hosted AgentRun telemetry POST fired by the server.tool wrapper after
    // the tool handler resolves (calls[1]).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.brandcode.studio/api/brand/acme/runtime/taste-capture",
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer test-token",
      "content-type": "application/json",
    });

    const body = JSON.parse(String((init as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      candidateRef: "variant-851",
      candidateText: "Hero candidate with caption",
      verdict: "distinctive",
      attributeReason: "The asymmetric crop and editorial caption read as ours.",
      surface: "studio",
      actor: "brandcode-mcp:bck_test_acme",
    });
    expect(body).not.toHaveProperty("brand");
  });

  it("refuses blank attribute reasons before reaching UCS", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { client } = await connectClient(
      buildContext(null, { auth: captureAuth }),
    );
    const result = await client.callTool({
      name: "capture_taste",
      arguments: {
        candidate_ref: "variant-852",
        verdict: "generic",
        attribute_reason: "",
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;

    expect(content[0].text).toContain("MCP error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps UCS authority failures to a hosted service-token configuration error", async () => {
    stubCaptureResponse({ error: "authority required" }, { status: 401 });
    const { client } = await connectClient(
      buildContext(null, { auth: captureAuth }),
    );
    const json = await call(client, "capture_taste", {
      candidate_ref: "variant-853",
      verdict: "flag",
      attribute_reason: "The pattern is promising but needs human review.",
    });

    expect(json).toMatchObject({
      error: "ucs_auth",
      status: 502,
      upstream_status: 401,
      brand: "acme",
      canonical_mutation: false,
    });
  });

  it("returns route refusals without claiming a capture", async () => {
    stubCaptureResponse(
      { ok: false, code: "missing_reason", message: "attributeReason required" },
      { status: 200 },
    );
    const { client } = await connectClient(
      buildContext(null, { auth: captureAuth }),
    );
    const json = await call(client, "capture_taste", {
      candidate_ref: "variant-854",
      verdict: "distinctive",
      attribute_reason: "Specific enough for the local schema.",
    });

    expect(json).toMatchObject({
      error: "missing_reason",
      brand: "acme",
      candidate_ref: "variant-854",
      canonical_mutation: false,
    });
    expect(json.captured).not.toBe(true);
  });
});

describe("brand_feedback (hosted)", () => {
  const feedbackAuth = buildAuth({ scopes: ["feedback"] });

  function stubFeedbackResponse(body: unknown, init: ResponseInit = {}) {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts a valid AgentRunHistoryEntry body for observations", async () => {
    const fetchMock = stubFeedbackResponse({ ok: true, entry: {} });
    const { client } = await connectClient(
      buildContext(null, { auth: feedbackAuth }),
    );
    const json = await call(client, "brand_feedback", {
      kind: "observation",
      summary: "Search result needs clearer provenance",
      detail: "Observed while checking a hosted package.",
      source_tool: "brand_search",
      related_run_id: "run-123",
      evidence_refs: ["package://runtime/search", "https://private-provider.example/raw"],
    });

    // 2 calls: the tool's own explicit feedback-append POST (calls[0]), then
    // the hosted AgentRun telemetry POST fired by the server.tool wrapper
    // after the tool handler resolves (calls[1]).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.brandcode.studio/api/brand/hosted/acme/agent/history",
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer test-token",
      "content-type": "application/json",
    });

    const body = JSON.parse(String((init as RequestInit).body)) as Record<
      string,
      Record<string, unknown>
    >;
    const entry = body.entry;
    const run = entry.run as Record<string, unknown>;
    expect(run.id).toMatch(/^mcp-feedback-observation-/);
    expect(run.provider).toBeUndefined();
    expect(run.status).toBe("completed");
    expect(run.surface).toBe("mcp-hosted");
    expect(run.taskPreset).toBe("mcp_feedback_observation");
    expect(run.resultSummary).toBe("Search result needs clearer provenance");
    expect(run.receiptIds).toHaveLength(1);

    const context = run.context as Record<string, unknown>;
    expect(context).toMatchObject({
      brandSlug: "acme",
      surface: "mcp-hosted",
      surfaceId: "mcp-hosted",
      freshnessState: "live",
    });

    const receipts = entry.receipts as Array<Record<string, unknown>>;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      runId: run.id,
      kind: "review_guidance_note",
      destinationHome: "runtime",
      actionKind: "review",
      runtimeVersion: "hosted",
    });
    expect(receipts[0].receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.proposal).toBeNull();
    expect(JSON.stringify(body)).not.toContain("private-provider.example");

    expect(json).toMatchObject({
      kind: "observation",
      append_status: "recorded",
      history_origin: "ucs",
      canonical_mutation: false,
      review_posture:
        "Recorded as an observation in UCS history; not approved governance and not applied to canon",
    });
  });

  it("records proposals with review posture but no canonical mutation claim", async () => {
    const fetchMock = stubFeedbackResponse({ ok: true, entry: {} });
    const { client } = await connectClient(
      buildContext(null, { auth: feedbackAuth }),
    );
    const json = await call(client, "brand_feedback", {
      kind: "proposal",
      summary: "Consider promoting the new proof point",
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body)) as Record<
      string,
      Record<string, unknown>
    >;
    const run = body.entry.run as Record<string, unknown>;
    const receipts = body.entry.receipts as Array<Record<string, unknown>>;
    expect(run.taskPreset).toBe("mcp_feedback_proposal");
    expect(run.approvalState).toBe("proposed");
    expect(receipts[0].actionKind).toBe("write_proposal");
    expect(body.entry.proposal).toBeNull();

    expect(json).toMatchObject({
      kind: "proposal",
      append_status: "recorded",
      canonical_mutation: false,
      review_posture:
        "Recorded as a review proposal in UCS history; not approved governance and not applied to canon",
    });
  });

  it("maps UCS upstream errors to structured feedback errors", async () => {
    const cases = [
      [400, "ucs_history_contract_error", 400],
      [401, "ucs_auth", 502],
      [403, "ucs_auth", 502],
      [404, "hosted_brand_not_found", 404],
      [500, "ucs_error", 502],
    ] as const;

    for (const [upstreamStatus, code, status] of cases) {
      stubFeedbackResponse({ error: `upstream ${upstreamStatus}` }, {
        status: upstreamStatus,
      });
      const { client } = await connectClient(
        buildContext(null, { auth: feedbackAuth }),
      );
      const json = await call(client, "brand_feedback", {
        summary: `case ${upstreamStatus}`,
      });
      expect(json).toMatchObject({
        error: code,
        status,
        upstream_status: upstreamStatus,
        history_origin: "ucs",
        canonical_mutation: false,
      });
    }
  });
});

describe("brand_check (hosted)", () => {
  const checkAuth = buildAuth({ scopes: ["check"] });
  const CHECK_PACKAGE: BrandPackagePayload = {
    slug: "acme",
    runtime: {
      identity: {
        colors: { primary: "#2563eb" },
        typography: { body: "Inter, system-ui, sans-serif" },
      },
    },
    brandInstance: {
      tokens: {
        colors: {
          primary: "#2563eb",
          dark: "#18181b",
        },
        typography: {
          fontFamily: "Inter, system-ui, sans-serif",
        },
      },
      fonts: {
        roles: {
          body: { fontFamily: "Inter, system-ui, sans-serif" },
          display: { fontFamily: "Merriweather, Georgia, serif" },
        },
      },
      brandPhrases: [
        {
          id: "bp-001",
          phrase: "Governed AI, ready to ship",
          status: "Active",
        },
      ],
      proofPoints: [
        {
          id: "claim-001",
          title: "91% of teams need governed AI proof",
          status: "Active",
        },
        {
          id: "claim-002",
          title: "Experimental signal",
          status: "Watch",
        },
      ],
      applicationRules: {
        rules: [
          {
            id: "ar-001",
            name: "Unsupported claims",
            rule: "Never claim instant ROI",
            status: "Active",
          },
        ],
      },
      capabilities: {
        blocked: ["autonomous trading"],
      },
      voice: {
        neverSay: ["synergy"],
        antiPatterns: ["Never use drop shadows"],
      },
    },
  };

  it("evaluates text against Active/Watch proof points and blocked capabilities", async () => {
    const { client } = await connectClient(
      buildContext(CHECK_PACKAGE, { auth: checkAuth }),
    );
    const json = await call(client, "brand_check", {
      text: "Governed AI, ready to ship. 91% of teams need governed AI proof. Experimental signal. Add autonomous trading and claim instant ROI.",
    });
    expect(json.verdict).toBe("fail");
    expect(json.runtime_origin).toBe("hosted");

    const findings = json.findings as Array<Record<string, unknown>>;
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "active_proof_point_used",
        "watch_proof_point_used",
        "blocked_capability_used",
        "brand_phrase_used",
        "forbidden_language_used",
      ]),
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "brandInstance.applicationRules" }),
      ]),
    );
    expect(JSON.stringify(json)).not.toContain("private-provider.example");
  });

  it("passes known brand colors and reviews unknown colors", async () => {
    const { client } = await connectClient(
      buildContext(CHECK_PACKAGE, { auth: checkAuth }),
    );
    const known = await call(client, "brand_check", { color: "#2563EB" });
    expect(known.verdict).toBe("pass");
    expect((known.checks as Record<string, Record<string, unknown>>).color.status).toBe(
      "pass",
    );

    const unknown = await call(client, "brand_check", { color: "#abcdef" });
    expect(unknown.verdict).toBe("review");
    expect(
      (unknown.findings as Array<Record<string, unknown>>).map(
        (finding) => finding.code,
      ),
    ).toContain("color_not_in_hosted_palette");
  });

  it("passes known brand fonts and reviews unknown fonts", async () => {
    const { client } = await connectClient(
      buildContext(CHECK_PACKAGE, { auth: checkAuth }),
    );
    const known = await call(client, "brand_check", {
      font: "Merriweather, Georgia, serif",
    });
    expect(known.verdict).toBe("pass");
    expect((known.checks as Record<string, Record<string, unknown>>).font.status).toBe(
      "pass",
    );

    const unknown = await call(client, "brand_check", {
      font: "Comic Sans MS",
    });
    expect(unknown.verdict).toBe("review");
    expect(
      (unknown.findings as Array<Record<string, unknown>>).map(
        (finding) => finding.code,
      ),
    ).toContain("font_not_in_hosted_typography");
  });

  it("detects known color and font usage in CSS", async () => {
    const { client } = await connectClient(
      buildContext(CHECK_PACKAGE, { auth: checkAuth }),
    );
    const json = await call(client, "brand_check", {
      css: ".hero { color: #2563eb; font-family: Inter, system-ui, sans-serif; }",
    });
    expect(json.verdict).toBe("pass");
    const css = (json.checks as Record<string, Record<string, unknown>>).css;
    expect(css.status).toBe("pass");
    expect(css.matched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "color" }),
        expect.objectContaining({ kind: "font" }),
      ]),
    );
  });

  it("does not crash when the hosted package is missing or malformed", async () => {
    const malformed = {
      brandInstance: {
        tokens: null,
        fonts: null,
        proofPoints: "bad shape",
      },
    } as unknown as BrandPackagePayload;
    const { client } = await connectClient(
      buildContext(malformed, { auth: checkAuth }),
    );
    const json = await call(client, "brand_check", {
      text: "Hello",
      color: "#2563eb",
      font: "Inter",
    });
    expect(json.verdict).toBe("review");
    expect(json.runtime_origin).toBe("hosted");
    expect(json.checks).toMatchObject({
      text: { status: "review" },
      color: { status: "review" },
      font: { status: "review" },
    });
  });
});

describe("brand_search (hosted)", () => {
  const SEARCH_PACKAGE: BrandPackagePayload = {
    slug: "acme",
    brandInstance: {
      narratives: [
        {
          id: "nl-001",
          name: "Flagship narrative",
          type: "Key Message",
          status: "Active",
          canonical_text: "Acme helps teams ship governed AI work.",
          usage_notes: "Lead with governed AI when trust is the topic.",
          source_label: "Narrative Library",
        },
      ],
      proofPoints: [
        {
          id: "claim-001",
          title: "91% of teams need governed AI proof",
          status: "Active",
          confidence: 0.95,
          salience: "Lead With",
          source: "Proof register",
        },
        {
          id: "claim-002",
          title: "Experimental signal",
          status: "Watch",
          confidence: 0.68,
          evidence: "Watch before using as a headline.",
          source: "https://private-provider.example/raw",
        },
      ],
      applicationRules: {
        rules: [
          {
            id: "ar-001",
            name: "Launch page",
            framework: "Problem Guide Proof",
            required_elements: ["governed AI proof", "clear next step"],
            status: "Active",
          },
        ],
      },
      brandPhrases: [
        {
          id: "bp-001",
          phrase: "Governed AI, ready to ship",
          status: "Active",
          usage_notes: "Use for product-led CTAs.",
        },
      ],
      readiness: {
        stage: "usable",
        primaryConcern: "Needs more governed proof",
      },
      capabilities: {
        enabled: ["runtime", "content"],
      },
    },
  };

  it("returns ranked hits from narratives, proof points, application rules, and brand phrases", async () => {
    const { client } = await connectClient(buildContext(SEARCH_PACKAGE));
    const json = await call(client, "brand_search", {
      query: "governed AI proof",
      limit: 10,
    });

    expect(json.total_hits).toBeGreaterThanOrEqual(4);
    const hits = json.hits as Array<Record<string, unknown>>;
    expect(hits.map((hit) => hit.source_type)).toEqual(
      expect.arrayContaining([
        "proof_point",
        "application_rule",
        "narrative",
        "brand_phrase",
      ]),
    );
    expect(hits[0]).toMatchObject({
      id: "claim-001",
      title: "91% of teams need governed AI proof",
      source_type: "proof_point",
      status: "Active",
      confidence: 0.95,
    });
    expect(hits[0].provenance).toEqual({
      source: "Proof register",
    });
  });

  it("keeps ranking deterministic for repeated queries", async () => {
    const { client } = await connectClient(buildContext(SEARCH_PACKAGE));
    const first = await call(client, "brand_search", {
      query: "governed AI proof",
      limit: 10,
    });
    const second = await call(client, "brand_search", {
      query: "governed AI proof",
      limit: 10,
    });
    expect(first.hits).toEqual(second.hits);
  });

  it("redacts URL-like provenance and stays custody-safe", async () => {
    const { client } = await connectClient(buildContext(SEARCH_PACKAGE));
    const json = await call(client, "brand_search", {
      query: "experimental signal",
    });
    const hits = json.hits as Array<Record<string, unknown>>;
    expect(hits[0].id).toBe("claim-002");
    expect(JSON.stringify(hits[0])).not.toContain("private-provider.example");
    expect(json.custody_safe).toBe(true);
    expect(json.selected_kit_artifact_support).toBe("not_implemented_in_v1");
  });

  it("returns a truthful empty result for empty or no-match queries", async () => {
    const { client } = await connectClient(buildContext(SEARCH_PACKAGE));
    const empty = await call(client, "brand_search", { query: "   " });
    expect(empty.hits).toEqual([]);
    expect(empty.total_hits).toBe(0);
    const emptyMetadata = empty._metadata as Record<string, unknown>;
    expect(emptyMetadata.what_happened).toContain(
      "No hosted brand search query",
    );
    expect(emptyMetadata.next_steps).toContain(
      "Try a more specific query about narratives, proof points, application rules, or brand phrases",
    );

    const noMatch = await call(client, "brand_search", {
      query: "nonexistent zebra",
    });
    expect(noMatch.hits).toEqual([]);
    expect(noMatch.total_hits).toBe(0);
    const noMatchMetadata = noMatch._metadata as Record<string, unknown>;
    expect(noMatchMetadata.what_happened).toContain(
      "No hosted brand knowledge matched",
    );
  });

  it("tolerates missing hosted knowledge arrays gracefully", async () => {
    const { client } = await connectClient(buildContext({ brandInstance: {} }));
    const json = await call(client, "brand_search", { query: "anything" });
    expect(json.hits).toEqual([]);
    expect(json.searched_documents).toBe(0);
  });

  it("tags the keyword fallback engine when no corpus is present", async () => {
    const { client } = await connectClient(buildContext(SEARCH_PACKAGE));
    const json = await call(client, "brand_search", { query: "governed AI" });
    expect(json.retrieval_engine).toBe("keyword_fallback");
  });
});

describe("brand_search corpus retrieval (hosted)", () => {
  const CORPUS_PACKAGE: BrandPackagePayload = {
    slug: "acme",
    runtimeVersion: "2026-06-20",
    brandKnowledgeCorpus: {
      brandSlug: "acme",
      runtimeVersion: "2026-06-20",
      generatedAt: "2026-06-20T00:00:00.000Z",
      documents: [
        {
          id: "proof:claim-001",
          sourceKind: "proof_point",
          title: "91% of teams need governed AI",
          text: "Survey shows 91% of teams need governed AI before shipping.",
          tags: ["Active", "Primary"],
          facets: { sourceClass: "governance", approvalState: "approved" },
          lineage: {
            sourcePath: "governance/valid-proof-points.yaml",
            sourceId: "claim-001",
            sourceType: "governance",
            confidence: "high",
          },
          freshness: { generatedAt: "2026-06-20T00:00:00.000Z" },
        },
        {
          id: "narrative:nl-001",
          sourceKind: "narrative",
          title: "Flagship narrative",
          text: "Acme helps teams ship governed AI work with confidence.",
          tags: ["Active"],
          facets: { sourceClass: "doctrine", approvalState: "approved" },
          lineage: {
            sourcePath: "governance/narrative-library.yaml",
            sourceId: "nl-001",
            sourceType: "governance",
            confidence: "high",
          },
          freshness: { generatedAt: "2026-06-20T00:00:00.000Z" },
        },
        {
          id: "asset:hero-1",
          sourceKind: "asset_metadata",
          title: "Runtime hero",
          text: "hero illustration governed",
          tags: ["illustration"],
          facets: { sourceClass: "asset_metadata", approvalState: "approved" },
          lineage: { sourceId: "hero-1", sourceType: "asset", confidence: "medium" },
          freshness: { generatedAt: "2026-06-20T00:00:00.000Z" },
        },
      ],
      summary: {
        documentCount: 3,
        bySourceKind: { proof_point: 1, narrative: 1, asset_metadata: 1 },
      },
    },
    retrievalManifest: {
      brandSlug: "acme",
      runtimeVersion: "2026-06-20",
      sourceCoverage: [
        { sourceClass: "governance", status: "indexed", documentCount: 1 },
        { sourceClass: "doctrine", status: "indexed", documentCount: 1 },
        { sourceClass: "asset_metadata", status: "indexed", documentCount: 1 },
        { sourceClass: "ocr", status: "missing", documentCount: 0 },
      ],
      confidenceSummary: { high: 2, medium: 1, low: 0 },
      knownBlindSpots: ["Image and slide OCR is not searchable yet."],
      warnings: [],
    },
  };

  it("ranks the prebuilt knowledge corpus with provenance and confidence", async () => {
    const { client } = await connectClient(buildContext(CORPUS_PACKAGE));
    const json = await call(client, "brand_search", {
      query: "governed AI proof",
      mode: "fact_lookup",
    });
    expect(json.retrieval_engine).toBe("knowledge_corpus");
    expect(json.retrieval_mode).toBe("fact_lookup");
    const hits = json.hits as Array<Record<string, unknown>>;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({
      id: "proof:claim-001",
      source_kind: "proof_point",
      source_class: "governance",
      confidence: "high",
      citation: "governance/valid-proof-points.yaml#claim-001",
    });
    expect(json.confidence_summary as Record<string, unknown>).toMatchObject({
      high: expect.any(Number),
    });
    expect(Array.isArray(json.coverage)).toBe(true);
    expect(json.blind_spots).toEqual(
      expect.arrayContaining(["Image and slide OCR is not searchable yet."]),
    );
  });

  it("scopes by query mode — doctrine_retrieval favors narratives and excludes proof-only kinds", async () => {
    const { client } = await connectClient(buildContext(CORPUS_PACKAGE));
    const json = await call(client, "brand_search", {
      query: "governed AI",
      mode: "doctrine_retrieval",
    });
    const hits = json.hits as Array<Record<string, unknown>>;
    const kinds = hits.map((hit) => hit.source_kind);
    expect(kinds).toContain("narrative");
    expect(kinds).not.toContain("proof_point");
  });

  it("redacts URL-like citations and stays custody-safe", async () => {
    const pkg = JSON.parse(JSON.stringify(CORPUS_PACKAGE)) as BrandPackagePayload;
    const doc = (pkg.brandKnowledgeCorpus!.documents[0].lineage as Record<string, unknown>);
    doc.sourcePath = "https://private-provider.example/raw";
    const { client } = await connectClient(buildContext(pkg));
    const json = await call(client, "brand_search", {
      query: "governed",
      mode: "fact_lookup",
    });
    expect(JSON.stringify(json)).not.toContain("private-provider.example");
    expect(json.custody_safe).toBe(true);
  });
});

describe("brand_runtime voice + strategy slices (hosted)", () => {
  const GOV_PACKAGE: BrandPackagePayload = {
    slug: "acme",
    runtimeVersion: "2026-06-20",
    brandInstance: {
      manifest: { name: "Acme", brandcodeVersion: "2026-06-20" },
      tokens: { colors: { primary: "#2563eb" }, brandName: "Acme" },
      fonts: {
        roles: {
          display: { fontFamily: "Merriweather" },
          body: { fontFamily: "Inter" },
        },
      },
      assets: [],
      verbalIdentity:
        "Acme sounds confident, plain-spoken, and specific. We never hype.",
      perspective: "Governed AI is the only durable way to scale brand work.",
      brandPhrases: [
        { phrase: "Governed AI, ready to ship", usage: "product CTAs", deploy_verbatim: true },
      ],
      narratives: [{ id: "nl-001", name: "Flagship", status: "Active", type: "Key Message" }],
      applicationRules: [
        {
          id: "ar-001",
          content_type: "Launch page",
          framework: "Problem Guide Proof",
          touchpoint: "web",
          journey_stage: "Decision",
        },
      ],
      proofPoints: [
        { id: "claim-001", claim: "91% need governed AI", tier: "Primary", status: "Active" },
      ],
      strategyMoves: [
        { move: 1, name: "Lead with governance", status: "Active", timeline: "Q3" },
      ],
    },
  };

  it("populates voice from verbal identity, perspective, and brand phrases", async () => {
    const { client } = await connectClient(buildContext(GOV_PACKAGE));
    const json = await call(client, "brand_runtime", { slice: "full" });
    const runtime = json.runtime as Record<string, unknown>;
    const voice = runtime.voice as Record<string, unknown>;
    expect(voice.verbal_identity).toContain("confident");
    expect(voice.perspective).toContain("Governed AI");
    const phrases = voice.brand_phrases as Array<Record<string, unknown>>;
    expect(phrases[0]).toMatchObject({
      phrase: "Governed AI, ready to ship",
      deploy_verbatim: true,
    });
  });

  it("populates strategy from narratives, rules, proof points, and strategy moves", async () => {
    const { client } = await connectClient(buildContext(GOV_PACKAGE));
    const json = await call(client, "brand_runtime", { slice: "full" });
    const runtime = json.runtime as Record<string, unknown>;
    const strategy = runtime.strategy as Record<string, unknown>;
    expect((strategy.narratives as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: "nl-001",
      name: "Flagship",
    });
    expect((strategy.application_rules as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: "ar-001",
      framework: "Problem Guide Proof",
    });
    expect((strategy.proof_points as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: "claim-001",
      tier: "Primary",
    });
    expect((strategy.strategy_moves as Array<Record<string, unknown>>)[0]).toMatchObject({
      move: 1,
      name: "Lead with governance",
    });
    expect(strategy.counts as Record<string, unknown>).toMatchObject({
      narratives: 1,
      application_rules: 1,
      proof_points: 1,
      strategy_moves: 1,
    });
  });

  it("voice slice carries voice + strategy", async () => {
    const { client } = await connectClient(buildContext(GOV_PACKAGE));
    const json = await call(client, "brand_runtime", { slice: "voice" });
    const runtime = json.runtime as Record<string, unknown>;
    expect(runtime.slice_type).toBe("voice");
    expect(runtime.voice).toBeTruthy();
    expect(runtime.strategy).toBeTruthy();
  });

  it("leaves voice/strategy null when the brand instance carries no governance", async () => {
    const pkg: BrandPackagePayload = {
      slug: "acme",
      brandInstance: { tokens: { colors: { primary: "#000000" } }, fonts: {}, assets: [] },
    };
    const { client } = await connectClient(buildContext(pkg));
    const json = await call(client, "brand_runtime", { slice: "full" });
    const runtime = json.runtime as Record<string, unknown>;
    expect(runtime.voice).toBeNull();
    expect(runtime.strategy).toBeNull();
    expect((runtime.identity as Record<string, unknown>).colors).toMatchObject({
      primary: "#000000",
    });
  });
});

describe("hosted asset tools", () => {
  const ASSET_PACKAGE: BrandPackagePayload = {
    slug: "acme",
    brandInstance: {
      assets: [
        {
          id: "logo-primary",
          title: "Primary logo",
          category: "logo",
          lifecycle: "official",
          format: "svg",
          width: 512,
          height: 128,
          packagePath: "acme/runtime/assets/logo-primary.svg",
          url: "https://private-provider.example/raw-logo.svg",
          tags: ["identity", "runtime"],
          official: true,
        },
        {
          id: "hero-runtime",
          title: "Runtime hero",
          category: "illustration",
          lifecycle: "runtime",
          format: "png",
          deliveryRef: {
            packagePath: "acme/runtime/assets/hero-runtime.png",
            posture: "package_safe",
          },
          inRuntimePackage: true,
        },
        {
          id: "campaign-private",
          title: "Campaign concept",
          category: "campaign",
          lifecycle: "exploratory",
          providerUrl: "https://private-provider.example/campaign.png",
          custody: "private_provider",
        },
        {
          id: "package-url-private",
          title: "Private package URL",
          category: "logo",
          lifecycle: "runtime",
          packageUrl: "https://private-provider.example/runtime-logo.svg",
        },
      ],
    },
    brandData: {
      assets: [
        {
          id: "approved-badge",
          name: "Approved badge",
          kind: "badge",
          lifecycle: "production-approved",
          productionApproved: true,
          package_path: "acme/runtime/assets/approved-badge.svg",
        },
      ],
    },
  };

  it("list_brand_assets returns package-safe asset summaries with posture", async () => {
    const { client } = await connectClient(buildContext(ASSET_PACKAGE));
    const json = await call(client, "list_brand_assets", { limit: 10 });
    expect(json.total_assets).toBe(5);
    expect(json.next_cursor).toBeNull();
    expect(json.custody_safe).toBe(true);
    expect(json.selected_kit_artifact_support).toBe("not_implemented_in_v1");

    const assets = json.assets as Array<Record<string, unknown>>;
    expect(assets.map((asset) => asset.id)).toEqual([
      "logo-primary",
      "hero-runtime",
      "campaign-private",
      "package-url-private",
      "approved-badge",
    ]);
    expect(assets[0]).toMatchObject({
      id: "logo-primary",
      category: "logo",
      lifecycle: "official",
      governance_posture: "official",
      delivery_ref: {
        posture: "package_safe",
        package_path: "acme/runtime/assets/logo-primary.svg",
      },
    });
    expect(JSON.stringify(json)).not.toContain("private-provider.example");
  });

  it("list_brand_assets filters and paginates deterministically", async () => {
    const { client } = await connectClient(buildContext(ASSET_PACKAGE));
    const first = await call(client, "list_brand_assets", { limit: 2 });
    expect((first.assets as unknown[])).toHaveLength(2);
    expect(first.next_cursor).toBe("2");

    const second = await call(client, "list_brand_assets", {
      limit: 2,
      cursor: String(first.next_cursor),
    });
    expect(
      (second.assets as Array<Record<string, unknown>>).map((asset) => asset.id),
    ).toEqual(["campaign-private", "package-url-private"]);

    const filtered = await call(client, "list_brand_assets", {
      lifecycle: "production",
    });
    expect(
      (filtered.assets as Array<Record<string, unknown>>).map((asset) => asset.id),
    ).toEqual(["approved-badge"]);
  });

  it("get_brand_asset returns full safe metadata for a package asset", async () => {
    const { client } = await connectClient(buildContext(ASSET_PACKAGE));
    const json = await call(client, "get_brand_asset", {
      asset_id: "hero-runtime",
    });
    const asset = json.asset as Record<string, unknown>;
    expect(asset).toMatchObject({
      id: "hero-runtime",
      governance_posture: "runtime",
      delivery_ref: {
        posture: "package_safe",
        package_path: "acme/runtime/assets/hero-runtime.png",
      },
      package_posture: {
        in_runtime_package: true,
        selected_kit_artifact_support: "not_implemented_in_v1",
      },
    });
    expect(JSON.stringify(json)).not.toContain("private-provider.example");
  });

  it("get_brand_asset blocks private provider URLs instead of returning them", async () => {
    const { client } = await connectClient(buildContext(ASSET_PACKAGE));
    const json = await call(client, "get_brand_asset", {
      asset_id: "campaign-private",
    });
    const asset = json.asset as Record<string, unknown>;
    expect(asset.delivery_ref).toEqual({
      posture: "blocked_private_provider_url",
      reason: "No package-safe delivery reference is available for this asset",
    });
    expect(asset.custody).toMatchObject({
      safe_for_mcp: false,
      blocked_private_provider_url: true,
    });
    expect(JSON.stringify(json)).not.toContain("private-provider.example");
  });

  it("get_brand_asset blocks private-looking package URLs instead of treating them as package-safe", async () => {
    const { client } = await connectClient(buildContext(ASSET_PACKAGE));
    const json = await call(client, "get_brand_asset", {
      asset_id: "package-url-private",
    });
    const asset = json.asset as Record<string, unknown>;
    expect(asset.delivery_ref).toEqual({
      posture: "blocked_private_provider_url",
      reason: "No package-safe delivery reference is available for this asset",
    });
    expect(asset.custody).toMatchObject({
      safe_for_mcp: false,
      blocked_private_provider_url: true,
    });
    expect(JSON.stringify(json)).not.toContain("private-provider.example");
  });

  it("get_brand_asset returns asset_not_found for unknown ids", async () => {
    const { client } = await connectClient(buildContext(ASSET_PACKAGE));
    const json = await call(client, "get_brand_asset", { asset_id: "missing" });
    expect(json.error).toBe("asset_not_found");
    expect(json.asset_id).toBe("missing");
  });

  it("asset tools tolerate missing arrays", async () => {
    const { client } = await connectClient(buildContext({ brandInstance: {} }));
    const json = await call(client, "list_brand_assets", {});
    expect(json.assets).toEqual([]);
    expect(json.total_assets).toBe(0);
  });
});

describe("brand_history (hosted)", () => {
  function stubHistoryResponse(body: unknown, init: ResponseInit = {}) {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const HISTORY_BODY = {
    ok: true,
    telemetry: {
      totalRuns: 2,
      completedRuns: 1,
      failedRuns: 1,
      successRate: 50,
      latestFailure: {
        taskLabel: "Brand Check",
        summary: "Failed with https://private-provider.example/raw",
        failureKind: "runtime_error",
      },
    },
    history: [
      {
        run: {
          id: "run-001",
          provider: "mcp",
          status: "completed",
          startedAt: "2026-05-06T10:00:00.000Z",
          completedAt: "2026-05-06T10:00:01.000Z",
          taskPreset: "brand_search",
          resultSummary:
            "Found governed guidance at https://private-provider.example/raw",
          context: {
            brandSlug: "acme",
            surface: "mcp-hosted",
            surfaceId: "mcp-hosted",
            freshnessState: "live",
          },
          runtimeVersion: "2026-05-06",
          runtimeSyncToken: null,
          receiptIds: ["receipt-001"],
          telemetry: { durationMs: 1000, failureKind: null },
        },
        replay: {
          kind: "grounded_retrieval",
          queryText: "governed guidance",
        },
        trustEnvelope: {
          id: "trust-001",
          recordedAt: "2026-05-06T10:00:01.000Z",
          confidence: {
            level: "grounded",
            summary: "Grounded in one source.",
          },
          grounding: { usedSourceCount: 1, usedSources: [] },
          coverageWarnings: [],
          blindSpots: [],
        },
        approvalRequest: {
          id: "approval-001",
          actionLabel: "Use answer",
        },
        receipts: [
          {
            id: "receipt-001",
            runId: "run-001",
            kind: "review_guidance_note",
            actionKind: "read_only_answer",
            summary: "Recorded note",
            receiptHash: "abc123",
          },
        ],
        portableReceiptChain: [
          {
            receiptId: "portable-verification-run-001",
            receiptType: "verification",
            createdAt: "2026-05-06T10:00:01.000Z",
            parentReceiptId: null,
            verification: {
              overallResult: "pass",
              checks: [
                {
                  description: "Large check blob that should not be returned",
                  evidence: "https://private-provider.example/evidence",
                },
              ],
            },
          },
          {
            receiptId: "portable-support-receipt-001",
            receiptType: "support",
            createdAt: "2026-05-06T10:00:02.000Z",
            parentReceiptId: "portable-verification-run-001",
            support: {
              diagnosisSteps: ["large support blob that should not be returned"],
            },
          },
        ],
      },
    ],
  };

  it("fetches UCS AgentRun history and returns compact receipt-aware entries", async () => {
    const fetchMock = stubHistoryResponse(HISTORY_BODY);
    const { client } = await connectClient(buildContext(null));
    const json = await call(client, "brand_history", {
      limit: 10,
      cursor: "ignored-cursor",
    });

    // 2 calls: the tool's own UCS history GET (calls[0]), then the hosted
    // AgentRun telemetry POST fired by the server.tool wrapper after the
    // tool handler resolves (calls[1]).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    const requestedUrl = new URL(String(url));
    expect(requestedUrl.pathname).toBe("/api/brand/hosted/acme/agent/history");
    // provider=mcp is intentionally not sent — UCS models provider as the
    // downstream model, not the transport; surface is the discriminator.
    expect(requestedUrl.searchParams.has("provider")).toBe(false);
    expect(requestedUrl.searchParams.get("surface")).toBe("mcp-hosted");
    expect(requestedUrl.searchParams.get("limit")).toBe("10");
    expect(requestedUrl.searchParams.has("cursor")).toBe(false);
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer test-token",
    });

    expect(json.history_origin).toBe("ucs");
    expect(json.next_cursor).toBeNull();
    expect(json.cursor_support).toBe("not_reported_by_ucs");
    expect(json.cursor_requested).toBe("ignored-cursor");
    expect(json.telemetry).toMatchObject({
      write_active: true,
      status: "active",
    });

    const history = json.history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: "run-001",
      started_at: "2026-05-06T10:00:00.000Z",
      finished_at: "2026-05-06T10:00:01.000Z",
      provider: "mcp",
      surface: "mcp-hosted",
      task_preset: "brand_search",
      outcome: "completed",
      receipt_count: 1,
      portable_receipt_chain: {
        count: 2,
        receipt_ids: [
          "portable-verification-run-001",
          "portable-support-receipt-001",
        ],
        receipt_types: ["verification", "support"],
        overall_results: ["pass"],
      },
    });
    expect(JSON.stringify(history[0])).not.toContain("diagnosisSteps");
    expect(JSON.stringify(json)).not.toContain("private-provider.example");
  });

  it("passes UCS telemetry summary through safely", async () => {
    stubHistoryResponse(HISTORY_BODY);
    const { client } = await connectClient(buildContext(null));
    const json = await call(client, "brand_history", {});
    expect(json.telemetry_summary).toMatchObject({
      totalRuns: 2,
      completedRuns: 1,
      failedRuns: 1,
      successRate: 50,
      latestFailure: {
        taskLabel: "Brand Check",
        summary: "Failed with [redacted-url]",
        failureKind: "runtime_error",
      },
    });
  });

  it("does not crash when UCS omits a usable history array", async () => {
    stubHistoryResponse({ ok: true, telemetry: null, history: { bad: true } });
    const { client } = await connectClient(buildContext(null));
    const json = await call(client, "brand_history", {});
    expect(json.history).toEqual([]);
    expect(json.malformed_history).toBe(true);
    expect(json.next_cursor).toBeNull();
    // Surfaced so AgentRun telemetry classifies this as upstream_error
    // instead of ok -- see test/hosted/server.test.ts for the telemetry
    // classification assertion.
    expect(json.error).toBe("ucs_history_contract_error");
  });

  it("returns structured errors for UCS not found and service-token failures", async () => {
    stubHistoryResponse({ error: "Hosted brand not found." }, { status: 404 });
    const notFoundClient = await connectClient(buildContext(null));
    const notFound = await call(notFoundClient.client, "brand_history", {});
    expect(notFound).toMatchObject({
      error: "hosted_brand_not_found",
      status: 404,
      upstream_status: 404,
      history_origin: "ucs",
    });

    stubHistoryResponse({ error: "Service-token auth required." }, { status: 401 });
    const authClient = await connectClient(buildContext(null));
    const authError = await call(authClient.client, "brand_history", {});
    expect(authError).toMatchObject({
      error: "ucs_auth",
      status: 502,
      upstream_status: 401,
      history_origin: "ucs",
    });
  });
});

describe("brand_runtime (hosted)", () => {
  const PACKAGE: BrandPackagePayload = {
    runtime: {
      version: "1.0.0",
      client_name: "Acme Hosted",
      compiled_at: "2026-04-19T00:00:00.000Z",
      sessions_completed: 1,
      identity: {
        colors: { primary: "#ff3b30" },
        typography: { heading: "Inter" },
        logo: null,
      },
      visual: null,
      voice: null,
      strategy: null,
    },
  };

  it("returns the hosted runtime tagged runtime_origin=hosted", async () => {
    const { client } = await connectClient(buildContext(PACKAGE));
    const json = await call(client, "brand_runtime", { slice: "full" });
    expect(json.runtime_origin).toBe("hosted");
    const runtime = json.runtime as Record<string, unknown>;
    expect(runtime.client_name).toBe("Acme Hosted");
  });

  it("supports minimal slice", async () => {
    const { client } = await connectClient(buildContext(PACKAGE));
    const json = await call(client, "brand_runtime", { slice: "minimal" });
    const runtime = json.runtime as Record<string, unknown>;
    expect((runtime.identity as Record<string, unknown>).colors).toEqual({
      primary: "#ff3b30",
    });
  });

  it("returns NOT_COMPILED when hosted package has no runtime shape", async () => {
    const { client } = await connectClient(buildContext({ unexpected: true }));
    const json = await call(client, "brand_runtime", { slice: "full" });
    expect(json.error).toBe("not_compiled");
  });

  it("returns FETCH_FAILED when upstream throws", async () => {
    const ctx = buildContext(null, {
      loadBrandPackage: async () => {
        throw new Error("upstream down");
      },
    });
    const { client } = await connectClient(ctx);
    const json = await call(client, "brand_runtime", { slice: "full" });
    expect(json.error).toBe("fetch_failed");
  });

  describe("brandInstance flat-shape normalization (G-5h)", () => {
    const FLAT_PACKAGE: BrandPackagePayload = {
      slug: "brandcode",
      runtimeVersion: "2026-04-16",
      brandInstance: {
        manifest: { name: "Brandcode", slug: "brandcode", version: "0.0" },
        tokens: {
          brandName: "Brandcode",
          colors: {
            primary: "#2563eb",
            dark: "#18181b",
            white: "#ffffff",
            lightGrey: "#f4f4f5",
          },
          typography: {
            fontFamily: "Inter, system-ui, sans-serif",
            displayWeight: 600,
            bodyWeight: 400,
          },
          action: { primary: "#2563eb" },
        },
        fonts: {
          strategy: "system_only",
          fontFamily: "Inter, system-ui, sans-serif",
          roles: {
            body: {
              fontFamily: "Inter, system-ui, sans-serif",
              fallbackStack: ["system-ui", "sans-serif"],
            },
            display: {
              fontFamily: "Merriweather, Georgia, serif",
              fallbackStack: ["Georgia", "serif"],
            },
          },
        },
        assets: [],
        verbalIdentity: "Direct, clear, generous.",
        perspective: "Tool-as-partner.",
        narratives: [],
      },
    };

    it("normalizes colors from tokens.colors into identity.colors", async () => {
      const { client } = await connectClient(buildContext(FLAT_PACKAGE));
      const json = await call(client, "brand_runtime", { slice: "full" });
      const runtime = json.runtime as Record<string, unknown>;
      const identity = runtime.identity as Record<string, unknown>;
      expect(identity.colors).toEqual({
        primary: "#2563eb",
        dark: "#18181b",
        white: "#ffffff",
        lightGrey: "#f4f4f5",
      });
    });

    it("normalizes fonts.roles with display first (minimal slice picks heading)", async () => {
      const { client } = await connectClient(buildContext(FLAT_PACKAGE));
      const full = await call(client, "brand_runtime", { slice: "full" });
      const runtime = full.runtime as Record<string, unknown>;
      const identity = runtime.identity as Record<string, unknown>;
      const typography = identity.typography as Record<string, string>;
      // display must be the first entry so minimal slice grabs it
      expect(Object.keys(typography)[0]).toBe("display");
      expect(typography.display).toContain("Merriweather");
      expect(typography.body).toContain("Inter");
    });

    it("minimal slice returns primary color + display font (not null)", async () => {
      const { client } = await connectClient(buildContext(FLAT_PACKAGE));
      const json = await call(client, "brand_runtime", { slice: "minimal" });
      const runtime = json.runtime as Record<string, unknown>;
      const identity = runtime.identity as Record<string, unknown>;
      expect((identity.colors as Record<string, string>).primary).toBe(
        "#2563eb",
      );
      const typo = identity.typography as Record<string, string>;
      expect(Object.keys(typo)).toHaveLength(1);
      expect(typo.display).toContain("Merriweather");
      expect(identity.logo).toBeNull();
    });

    it("client_name prefers manifest.name, falls back to slug", async () => {
      const { client } = await connectClient(buildContext(FLAT_PACKAGE));
      const json = await call(client, "brand_runtime", { slice: "full" });
      const runtime = json.runtime as Record<string, unknown>;
      expect(runtime.client_name).toBe("Brandcode");
    });

    it("version picks runtimeVersion from package top level", async () => {
      const { client } = await connectClient(buildContext(FLAT_PACKAGE));
      const json = await call(client, "brand_runtime", { slice: "full" });
      const runtime = json.runtime as Record<string, unknown>;
      expect(runtime.version).toBe("2026-04-16");
    });

    it("logo is detected from assets with kind=logo and svg format", async () => {
      const pkgWithLogo = {
        ...FLAT_PACKAGE,
        brandInstance: {
          ...(FLAT_PACKAGE.brandInstance as Record<string, unknown>),
          assets: [
            { kind: "logo", format: "svg", url: "https://cdn/logo.svg" },
            { kind: "headshot", format: "png" },
          ],
        },
      };
      const { client } = await connectClient(buildContext(pkgWithLogo));
      const json = await call(client, "brand_runtime", { slice: "full" });
      const runtime = json.runtime as Record<string, unknown>;
      const identity = runtime.identity as Record<string, unknown>;
      expect(identity.logo).toEqual({ type: "logo", has_svg: true });
    });

    it("falls back to tokens.typography when fonts.roles is absent", async () => {
      const pkgNoRoles = {
        ...FLAT_PACKAGE,
        brandInstance: {
          ...(FLAT_PACKAGE.brandInstance as Record<string, unknown>),
          fonts: { strategy: "system_only" },
        },
      };
      const { client } = await connectClient(buildContext(pkgNoRoles));
      const json = await call(client, "brand_runtime", { slice: "full" });
      const runtime = json.runtime as Record<string, unknown>;
      const identity = runtime.identity as Record<string, unknown>;
      const typo = identity.typography as Record<string, string>;
      expect(typo.default).toContain("Inter");
    });
  });
});

describe("brand_status (hosted)", () => {
  it("reports hosted capability, scope, package, artifact, telemetry, and rate-limit posture", async () => {
    const pkg: BrandPackagePayload = {
      runtime: { version: "1.0.0", client_name: "Acme" },
      runtimePackage: {
        packagePath: "acme/runtime/packages/acme-brand-runtime-abc123.zip",
        receiptPath:
          "acme/runtime/packages/acme-brand-runtime-abc123.receipt.json",
        latestPath: "acme/runtime/packages/latest.json",
        versionHash: "abc123",
      },
      brandInstance: {
        narratives: [{ id: "n-1" }],
        proofPoints: [{ id: "p-1" }],
        applicationRules: { rules: [{ id: "r-1" }] },
        brandPhrases: [{ id: "bp-1" }],
        readiness: { stage: "usable" },
        capabilities: { enabled: ["runtime", "content"] },
        assets: [{ id: "logo" }, { id: "hero" }],
      },
      brandData: { assets: [{ id: "badge" }] },
    };
    const { client } = await connectClient(buildContext(pkg));
    const json = await call(client, "brand_status", {});
    expect(json.slug).toBe("acme");
    expect(json.environment).toBe("staging");
    expect(json.scopes).toEqual(["read"]);
    expect(json.runtime_available).toBe(true);
    expect(json.remaining_stubs).toEqual([]);

    const implementedTools = json.implemented_tools as Array<
      Record<string, unknown>
    >;
    expect(implementedTools.map((tool) => [tool.tool, tool.implementation])).toEqual([
      ["brand_runtime", "real"],
      ["brand_search", "real"],
      ["brand_check", "real"],
      ["brand_status", "real"],
      ["list_brand_assets", "real"],
      ["get_brand_asset", "real"],
      ["brand_feedback", "real"],
      ["capture_taste", "real"],
      ["brand_history", "real"],
    ]);

    const scopeMatrix = json.scope_matrix as Array<Record<string, unknown>>;
    expect(
      scopeMatrix.find((tool) => tool.tool === "brand_runtime"),
    ).toMatchObject({ required_scope: "read", granted: true });
    expect(
      scopeMatrix.find((tool) => tool.tool === "brand_check"),
    ).toMatchObject({ required_scope: "check", granted: false });
    expect(
      scopeMatrix.find((tool) => tool.tool === "brand_feedback"),
    ).toMatchObject({ required_scope: "feedback", granted: false });
    expect(
      scopeMatrix.find((tool) => tool.tool === "capture_taste"),
    ).toMatchObject({ required_scope: "capture", granted: false });

    const availability = json.capability_availability as Record<
      string,
      Record<string, unknown>
    >;
    expect(availability.runtime).toMatchObject({
      available: true,
      source: "runtime",
    });
    expect(availability.search).toMatchObject({
      available: true,
      document_count: 6,
    });
    expect(availability.assets).toMatchObject({
      available: true,
      total_count: 3,
    });

    expect(json.full_brand_runtime_artifact).toMatchObject({
      status: "reported_by_package",
      present: true,
      package_path: "acme/runtime/packages/acme-brand-runtime-abc123.zip",
      receipt_path:
        "acme/runtime/packages/acme-brand-runtime-abc123.receipt.json",
      latest_path: "acme/runtime/packages/latest.json",
      version_hash: "abc123",
    });
    expect(json.telemetry).toMatchObject({
      active: true,
      status: "active",
    });
    expect(json.rate_limits).toEqual(TEST_RATE_LIMIT);

    const summary = json.brand_summary as Record<string, unknown>;
    expect(summary).toMatchObject({
      readiness_stage: "usable",
      capabilities_enabled: 2,
      runtime_available: true,
      search_document_count: 6,
      asset_count: 3,
    });
    expect(json.status).toContain("Real tools:");
    expect(json.status).toContain("Stubs:        ");
    expect(json.status).toContain("Telemetry:    active");
    expect(json.status).toContain(
      "Rate limits:  active_pre_release_in_process",
    );
  });

  it("keeps rate-limit posture separate from package artifact metadata", async () => {
    const { client } = await connectClient(buildContext({ brandInstance: {} }));
    const json = await call(client, "brand_status", {});
    expect(json.full_brand_runtime_artifact).toMatchObject({
      status: "not_reported_by_package",
      present: false,
    });
    expect(json.rate_limits).toEqual(TEST_RATE_LIMIT);
    const availability = json.capability_availability as Record<
      string,
      Record<string, unknown>
    >;
    expect(availability.search.available).toBe(false);
    expect(availability.assets.available).toBe(false);
  });

  it("distinguishes durable shared rate-limit enforcement in hosted status", async () => {
    const { client } = await connectClient(
      buildContext(
        { runtime: { version: "1.0.0", client_name: "Acme" } },
        { rateLimit: TEST_DURABLE_RATE_LIMIT },
      ),
    );
    const json = await call(client, "brand_status", {});
    expect(json.rate_limits).toEqual(TEST_DURABLE_RATE_LIMIT);
    expect(json.status).toContain("Rate limits:  active_durable_shared");
  });
});
