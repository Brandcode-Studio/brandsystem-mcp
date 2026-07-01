import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  emitAgentRunRecord,
  type AgentRunRecordInput,
} from "../../src/hosted/telemetry.js";
import type { BrandcodeMcpAuthInfo } from "../../src/hosted/types.js";

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

function buildInput(
  overrides: Partial<AgentRunRecordInput> = {},
): AgentRunRecordInput {
  return {
    ucsBaseUrl: "https://www.brandcode.studio",
    ucsServiceToken: "super-secret-service-token",
    slug: "acme",
    tool: "brand_runtime",
    outcome: "ok",
    latencyMs: 42,
    auth: buildAuth(),
    requestId: "req-1",
    ...overrides,
  };
}

function stubFetch(body: unknown = { ok: true }, init: ResponseInit = {}) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("emitAgentRunRecord — non-blocking contract", () => {
  it("resolves without waiting for the telemetry POST to settle", async () => {
    let resolveFetch: (() => void) | undefined;
    const neverSettles = new Promise<Response>((resolve) => {
      resolveFetch = () =>
        resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
    });
    const fetchMock = vi.fn(() => neverSettles);
    vi.stubGlobal("fetch", fetchMock);

    const start = Date.now();
    await emitAgentRunRecord(buildInput());
    const elapsed = Date.now() - start;

    // emitAgentRunRecord must resolve immediately — it must not await the
    // fetch promise, which in this test never resolves on its own.
    expect(elapsed).toBeLessThan(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Clean up the dangling promise so it doesn't leak into other tests.
    resolveFetch?.();
  });

  it("does not throw when the telemetry POST rejects with a network error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(emitAgentRunRecord(buildInput())).resolves.toBeUndefined();

    // Give the fire-and-forget POST a tick to run and hit the catch handler.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not throw when the telemetry POST resolves with a non-2xx status", async () => {
    stubFetch({ error: "server exploded" }, { status: 500 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(emitAgentRunRecord(buildInput())).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errorSpy).toHaveBeenCalled();
  });

  it("never logs the raw ucsServiceToken when the POST fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("boom");
    });
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const secretToken = "totally-secret-do-not-log-me";
    await emitAgentRunRecord(buildInput({ ucsServiceToken: secretToken }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const loggedText = errorSpy.mock.calls
      .flat()
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" ");
    expect(loggedText).not.toContain(secretToken);
  });

  it("never logs the raw bearer token when the POST fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("boom");
    });
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const secretBearer = "bck_test_super_secret_bearer_value";
    await emitAgentRunRecord(
      buildInput({ auth: buildAuth({ token: secretBearer }) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    const loggedText = errorSpy.mock.calls
      .flat()
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" ");
    expect(loggedText).not.toContain(secretBearer);
  });
});

describe("emitAgentRunRecord — request contract", () => {
  it("POSTs to the exact UCS agent history endpoint used by feedback-fetcher", async () => {
    const fetchMock = stubFetch();
    await emitAgentRunRecord(buildInput());
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.brandcode.studio/api/brand/hosted/acme/agent/history",
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer super-secret-service-token",
      "content-type": "application/json",
    });
  });

  it("sends an { entry: ... } envelope shaped like an AgentRunHistoryEntry", async () => {
    const fetchMock = stubFetch();
    await emitAgentRunRecord(buildInput({ tool: "brand_search" }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body)) as Record<
      string,
      Record<string, unknown>
    >;
    expect(body.entry).toBeDefined();
    const run = body.entry.run as Record<string, unknown>;
    expect(run).toBeDefined();
    expect(typeof run.id).toBe("string");
    expect(run.status).toBeDefined();
    expect(typeof run.startedAt).toBe("string");
    expect(typeof run.completedAt).toBe("string");
    expect(run.surface).toBe("mcp-hosted");
    expect(run.tool ?? run.taskPreset).toContain("brand_search");
  });

  it("includes surface: mcp-hosted somewhere in the entry for history filterability", async () => {
    const fetchMock = stubFetch();
    await emitAgentRunRecord(buildInput());
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body)) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(body)).toContain("mcp-hosted");
  });

  it("includes a numeric latencyMs and the requestId passed in", async () => {
    const fetchMock = stubFetch();
    await emitAgentRunRecord(buildInput({ latencyMs: 987, requestId: "req-xyz" }));
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("987");
    expect(serialized).toContain("req-xyz");
  });

  it("does not include the raw bearer token or ucsServiceToken in the POST body", async () => {
    const fetchMock = stubFetch();
    const secretBearer = "bck_test_super_secret_bearer_value";
    const secretService = "super-secret-service-token";
    await emitAgentRunRecord(
      buildInput({
        auth: buildAuth({ token: secretBearer }),
        ucsServiceToken: secretService,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [, init] = fetchMock.mock.calls[0];
    const bodyText = String((init as RequestInit).body);
    expect(bodyText).not.toContain(secretBearer);
    // The service token is also the auth header value for this call, but it
    // must never appear a second time serialized into the JSON body itself.
    expect(bodyText).not.toContain(secretService);
  });
});

describe("emitAgentRunRecord — outcome mapping", () => {
  const outcomes: AgentRunRecordInput["outcome"][] = [
    "ok",
    "auth_error",
    "upstream_error",
    "tool_error",
    "stub",
  ];

  for (const outcome of outcomes) {
    it(`sends outcome "${outcome}" through to the posted entry`, async () => {
      const fetchMock = stubFetch();
      await emitAgentRunRecord(buildInput({ outcome, errorMessage: outcome === "ok" ? undefined : `${outcome} happened` }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(String((init as RequestInit).body));
      expect(JSON.stringify(body)).toContain(outcome);
    });
  }

  it("includes the errorMessage when the outcome is not ok", async () => {
    const fetchMock = stubFetch();
    await emitAgentRunRecord(
      buildInput({ outcome: "tool_error", errorMessage: "boom detail" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(JSON.stringify(body)).toContain("boom detail");
  });
});
