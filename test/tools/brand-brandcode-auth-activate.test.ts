/**
 * brand_brandcode_auth mode="activate": the device-code flow.
 *
 * Studio's create response carries a short `user_code` (shown to the human)
 * and a high-entropy `device_code` (the only value the poll endpoint
 * accepts). The MCP must poll with the secret, keep it out of every tool
 * response, and only store a session that belongs to the requested email.
 * All HTTP goes through the injected transport — no network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { setBrandcodeTransportForTests } from "../../src/connectors/brandcode/client.js";
import { resetPendingActivationsForTests } from "../../src/tools/brand-brandcode-auth.js";

const STUDIO = "https://www.brandcode.studio";
const USER_CODE = "BRAND-7K4X";
const DEVICE_CODE = "s3cr3t-device-code-Zk9Qw2Lx7Vb4Np1Rt8Ym5Hc6";
const EMAIL = "owner@example.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionJwt(email: string): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ email, exp: 4102444800 })}.signature`;
}

function createResponse(overrides: Record<string, unknown> = {}) {
  return json({
    ok: true,
    user_code: USER_CODE,
    device_code: DEVICE_CODE,
    code: USER_CODE,
    activate_url: `${STUDIO}/activate?code=${USER_CODE}`,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    poll_interval: 3,
    ...overrides,
  });
}

/** Run git in `cwd` (throws on non-zero exit), ignoring any GIT_DIR a hook exported. */
function git(cwd: string, args: string[]): void {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  execFileSync("git", args, { cwd, env, stdio: "pipe" });
}

type Handler = (url: URL) => Response | Promise<Response>;

describe("brand_brandcode_auth activate (device code)", () => {
  let tmpDir: string;
  let prevCwd: string;
  let client: Client;
  let pollHandler: Handler;
  let createHandler: Handler;
  let trustedFetch: ReturnType<typeof vi.fn>;

  async function call(args: Record<string, unknown>) {
    const result = await client.callTool({ name: "brand_brandcode_auth", arguments: args });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    return { text, body: JSON.parse(text) as Record<string, unknown> };
  }

  function pollUrls(): URL[] {
    return trustedFetch.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((u) => u.pathname === "/api/auth/device-code/poll");
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "bc-activate-"));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
    resetPendingActivationsForTests();

    createHandler = () => createResponse();
    pollHandler = () => json({ status: "pending" });
    trustedFetch = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/api/auth/device-code") return createHandler(u);
      if (u.pathname === "/api/auth/device-code/poll") return pollHandler(u);
      return json({ error: "unexpected" }, 500);
    });
    setBrandcodeTransportForTests({ trustedFetch, untrustedFetch: vi.fn() });

    const server = createServer({ profile: "full" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "activate-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    process.chdir(prevCwd);
    setBrandcodeTransportForTests();
    resetPendingActivationsForTests();
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("shows only the short code and asks the user to check the email and click Approve", async () => {
    const { text, body } = await call({ mode: "activate", email: EMAIL });
    expect(text).not.toContain(DEVICE_CODE);
    expect(body.code).toBe(USER_CODE);
    expect(body.activate_url).toBe(`${STUDIO}/activate`);
    expect(text).toContain("Approve");
    expect(text).toContain(EMAIL);
    expect(text).toContain(`key=\\"${USER_CODE}\\"`);
  });

  it("polls with the device_code secret, never the short user code", async () => {
    await call({ mode: "activate", email: EMAIL });
    const { text, body } = await call({ mode: "activate", key: USER_CODE });

    expect(body.status).toBe("pending");
    expect(text).not.toContain(DEVICE_CODE);
    const [poll] = pollUrls();
    expect(poll.searchParams.get("device_code")).toBe(DEVICE_CODE);
    expect(poll.searchParams.has("code")).toBe(false);
    expect(poll.search).not.toContain(USER_CODE);
  });

  it("accepts the short code case-insensitively and resumes the latest activation without a key", async () => {
    await call({ mode: "activate", email: EMAIL });
    await call({ mode: "activate", key: USER_CODE.toLowerCase() });
    await call({ mode: "activate" });
    expect(pollUrls().map((u) => u.searchParams.get("device_code"))).toEqual([
      DEVICE_CODE,
      DEVICE_CODE,
    ]);
  });

  it("stores the approved session, gitignored, without echoing secrets", async () => {
    git(tmpDir, ["init", "-q"]);
    const token = sessionJwt(EMAIL);
    pollHandler = () =>
      json({ status: "complete", token, email: EMAIL, expiresAt: "2099-01-01T00:00:00.000Z" });

    await call({ mode: "activate", email: EMAIL });
    const { text, body } = await call({ mode: "activate", key: USER_CODE });

    expect(body.authenticated).toBe(true);
    expect(text).not.toContain(DEVICE_CODE);
    expect(text).not.toContain(token);
    const stored = JSON.parse(await readFile(join(tmpDir, ".brand", "brandcode-auth.json"), "utf-8"));
    expect(stored).toMatchObject({ email: EMAIL, token, studioUrl: STUDIO });
    // exit 0 == ignored; git() throws otherwise
    git(tmpDir, ["check-ignore", "-q", ".brand/brandcode-auth.json"]);
  });

  it("handles a 403 email-mismatch poll gracefully and forgets the code", async () => {
    pollHandler = () => json({ error: "Approver email does not match" }, 403);
    await call({ mode: "activate", email: EMAIL });
    const { text, body } = await call({ mode: "activate", key: USER_CODE });

    expect(body.error).toBe("auth_failed");
    expect(body.reason).toBe("email_mismatch");
    expect(text).toContain(EMAIL);
    expect(text).not.toContain(DEVICE_CODE);
    await expect(access(join(tmpDir, ".brand", "brandcode-auth.json"))).rejects.toThrow();

    trustedFetch.mockClear();
    const again = await call({ mode: "activate", key: USER_CODE });
    expect(again.body.reason).toBe("no_pending_activation");
    expect(trustedFetch).not.toHaveBeenCalled();
  });

  it("refuses a session issued for a different email than requested", async () => {
    pollHandler = () =>
      json({
        status: "complete",
        token: sessionJwt("someone-else@example.com"),
        email: EMAIL,
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
    await call({ mode: "activate", email: EMAIL });
    const { body } = await call({ mode: "activate", key: USER_CODE });
    expect(body.reason).toBe("email_mismatch");
    await expect(access(join(tmpDir, ".brand", "brandcode-auth.json"))).rejects.toThrow();
  });

  it("treats an in-band denial as not approved", async () => {
    pollHandler = () => json({ status: "denied" });
    await call({ mode: "activate", email: EMAIL });
    const { body } = await call({ mode: "activate", key: USER_CODE });
    expect(body.reason).toBe("not_approved");
    await expect(access(join(tmpDir, ".brand", "brandcode-auth.json"))).rejects.toThrow();
  });

  it("does not hit the network for an unknown short code", async () => {
    const { body } = await call({ mode: "activate", key: "BRAND-ZZZZ" });
    expect(body.reason).toBe("no_pending_activation");
    expect(trustedFetch).not.toHaveBeenCalled();
  });

  it("never shows the user an activation link off the Studio origin", async () => {
    createHandler = () => createResponse({ activate_url: "https://evil.example/activate" });
    const { text, body } = await call({ mode: "activate", email: EMAIL });
    expect(body.activate_url).toBe(`${STUDIO}/activate`);
    expect(text).not.toContain("evil.example");
  });

  it("falls back to ?code= for a Studio that predates device_code", async () => {
    createHandler = () => createResponse({ user_code: undefined, device_code: undefined });
    await call({ mode: "activate", email: EMAIL });
    await call({ mode: "activate", key: USER_CODE });
    const [poll] = pollUrls();
    expect(poll.searchParams.get("code")).toBe(USER_CODE);
    expect(poll.searchParams.has("device_code")).toBe(false);
  });
});
