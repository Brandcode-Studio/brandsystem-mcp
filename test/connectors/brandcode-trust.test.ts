/**
 * Connector origin trust: who may receive credentials, who may confer
 * production approval, and how redirects / non-JSON bodies are handled.
 *
 * No third-party network: untrusted-origin traffic goes through injected
 * transports or is refused before connecting, and redirect tests use local
 * listeners that are trusted via BRANDCODE_STUDIO_TRUSTED_ORIGINS.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer as createHttpServer, type Server, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  brandcodeRequest,
  fetchHostedBrandDetails,
  pullHostedBrand,
  saveBrandToStudio,
  setBrandcodeTransportForTests,
  BrandcodeClientError,
} from "../../src/connectors/brandcode/client.js";
import {
  BrandcodeTrustError,
  DEFAULT_TRUSTED_BRANDCODE_ORIGINS,
  TRUSTED_ORIGINS_ENV,
  getTrustedBrandcodeOrigins,
  isTrustedBrandcodeOrigin,
  normalizeTrustedOriginEntry,
} from "../../src/connectors/brandcode/trust.js";
import { resolveBrandcodeHostedUrl } from "../../src/connectors/brandcode/resolve.js";
import { writePackagePayload } from "../../src/connectors/brandcode/persistence.js";
import { resolveEffectiveApproval } from "../../src/lib/approval-state.js";
import { BrandDir } from "../../src/lib/brand-dir.js";

const ENV = TRUSTED_ORIGINS_ENV;
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV];
  delete process.env[ENV];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
  setBrandcodeTransportForTests();
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── Allowlist + env override ─────────────────────────────────────────────

describe("trusted origin allowlist", () => {
  it("trusts only the Brandcode Studio origins by default", () => {
    expect(getTrustedBrandcodeOrigins({})).toEqual([...DEFAULT_TRUSTED_BRANDCODE_ORIGINS]);
    expect(isTrustedBrandcodeOrigin("https://www.brandcode.studio/start/brands/x", {})).toBe(true);
    expect(isTrustedBrandcodeOrigin("https://brandcode.studio", {})).toBe(true);
    expect(isTrustedBrandcodeOrigin("https://evil.example/start/brands/x", {})).toBe(false);
    expect(isTrustedBrandcodeOrigin("http://www.brandcode.studio", {})).toBe(false);
    expect(isTrustedBrandcodeOrigin("https://www.brandcode.studio.evil.example", {})).toBe(false);
  });

  it("adds https origins and explicit loopback http origins from the env override", () => {
    const env = {
      [ENV]: "https://staging.brandcode.studio, http://localhost:3000,http://127.0.0.1:4100",
    };
    expect(isTrustedBrandcodeOrigin("https://staging.brandcode.studio/api", env)).toBe(true);
    expect(isTrustedBrandcodeOrigin("http://localhost:3000/x", env)).toBe(true);
    expect(isTrustedBrandcodeOrigin("http://127.0.0.1:4100", env)).toBe(true);
    // Not listed: other loopback ports are still untrusted.
    expect(isTrustedBrandcodeOrigin("http://localhost:3001", env)).toBe(false);
    // Defaults stay trusted.
    expect(isTrustedBrandcodeOrigin("https://www.brandcode.studio", env)).toBe(true);
  });

  it("rejects plain http for non-loopback hosts and malformed entries", () => {
    expect(normalizeTrustedOriginEntry("http://staging.brandcode.studio")).toBeNull();
    expect(normalizeTrustedOriginEntry("http://10.0.0.5:3000")).toBeNull();
    expect(normalizeTrustedOriginEntry("https://x.example/path")).toBeNull();
    expect(normalizeTrustedOriginEntry("https://user:pw@x.example")).toBeNull();
    expect(normalizeTrustedOriginEntry("ftp://x.example")).toBeNull();
    expect(normalizeTrustedOriginEntry("not a url")).toBeNull();
    expect(normalizeTrustedOriginEntry("https://x.example/")).toBe("https://x.example");
    const env = { [ENV]: "http://staging.brandcode.studio,https://ok.example" };
    expect(isTrustedBrandcodeOrigin("http://staging.brandcode.studio", env)).toBe(false);
    expect(isTrustedBrandcodeOrigin("https://ok.example", env)).toBe(true);
  });
});

// ── Credentials never leave the trusted origin ───────────────────────────

describe("credential routing", () => {
  it("never sends a share token to a non-trusted origin", async () => {
    const trustedFetch = vi.fn();
    const untrustedFetch = vi.fn();
    setBrandcodeTransportForTests({ trustedFetch, untrustedFetch });

    const evil = resolveBrandcodeHostedUrl("https://evil.example/start/brands/acme");
    await expect(
      fetchHostedBrandDetails(evil, { shareToken: "share-secret" }),
    ).rejects.toBeInstanceOf(BrandcodeTrustError);
    await expect(
      pullHostedBrand(evil, undefined, { shareToken: "share-secret" }),
    ).rejects.toBeInstanceOf(BrandcodeTrustError);
    expect(trustedFetch).not.toHaveBeenCalled();
    expect(untrustedFetch).not.toHaveBeenCalled();
  });

  it("never sends a session token to a non-trusted origin", async () => {
    const trustedFetch = vi.fn();
    const untrustedFetch = vi.fn();
    setBrandcodeTransportForTests({ trustedFetch, untrustedFetch });

    await expect(
      saveBrandToStudio("https://evil.example", { slug: "x" }, "session-secret"),
    ).rejects.toBeInstanceOf(BrandcodeTrustError);
    expect(trustedFetch).not.toHaveBeenCalled();
    expect(untrustedFetch).not.toHaveBeenCalled();
  });

  it("refuses credentials for a trusted origin other than the one they were issued for", async () => {
    const trustedFetch = vi.fn();
    setBrandcodeTransportForTests({ trustedFetch });
    await expect(
      brandcodeRequest("https://www.brandcode.studio/api/brand/repo/connect", {
        adminToken: "admin-secret",
        credentialOrigin: "https://brandcode.studio",
      }, { method: "POST", body: "{}" }),
    ).rejects.toThrow(/issued for https:\/\/brandcode\.studio/);
    expect(trustedFetch).not.toHaveBeenCalled();
  });

  it("refuses stored credentials that were issued for an untrusted origin", async () => {
    const trustedFetch = vi.fn();
    setBrandcodeTransportForTests({ trustedFetch });
    await expect(
      brandcodeRequest("https://www.brandcode.studio/api/x", {
        authToken: "t",
        credentialOrigin: "https://evil.example",
      }),
    ).rejects.toThrow(/untrusted origin/);
    expect(trustedFetch).not.toHaveBeenCalled();
  });

  it("sends credentials to the trusted origin they were issued for", async () => {
    const trustedFetch = vi.fn().mockResolvedValue(json({ slug: "acme", syncToken: "s", ownerEmail: "a@b.c" }));
    setBrandcodeTransportForTests({ trustedFetch });
    await saveBrandToStudio("https://www.brandcode.studio", { slug: "acme" }, "session-secret");
    expect(trustedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = trustedFetch.mock.calls[0];
    expect(url).toBe("https://www.brandcode.studio/api/brand/save");
    expect(init.headers.authorization).toBe("Bearer session-secret");
    expect(init.redirect).toBe("manual");
  });

  it("reads public packages from untrusted https custom domains without credentials", async () => {
    const trustedFetch = vi.fn();
    const untrustedFetch = vi.fn().mockResolvedValue(json({ brand: { name: "x" } }));
    setBrandcodeTransportForTests({ trustedFetch, untrustedFetch });

    const custom = resolveBrandcodeHostedUrl("https://custom.example/start/brands/acme");
    await fetchHostedBrandDetails(custom);
    expect(trustedFetch).not.toHaveBeenCalled();
    expect(untrustedFetch).toHaveBeenCalledTimes(1);
    const [, init] = untrustedFetch.mock.calls[0];
    const headerNames = Object.keys(init.headers).map((h) => h.toLowerCase());
    expect(headerNames).not.toContain("authorization");
    expect(headerNames).not.toContain("x-brand-share-token");
    expect(headerNames).not.toContain("x-brand-session-admin-token");
  });

  it("refuses plain http for untrusted custom domains", async () => {
    const untrustedFetch = vi.fn();
    setBrandcodeTransportForTests({ untrustedFetch });
    const custom = resolveBrandcodeHostedUrl("http://custom.example/start/brands/acme");
    await expect(fetchHostedBrandDetails(custom)).rejects.toThrow(/must use https/);
    expect(untrustedFetch).not.toHaveBeenCalled();
  });

  it("untrusted custom domains go through the SSRF guard (loopback refused)", async () => {
    // Default transport: safeFetch validates before connecting, so no
    // socket is opened to 127.0.0.1.
    const custom = resolveBrandcodeHostedUrl("https://127.0.0.1/start/brands/acme");
    await expect(fetchHostedBrandDetails(custom)).rejects.toThrow(/SSRF blocked/);
  });
});

// ── Redirect handling against local listeners ───────────────────────────

interface Listener {
  server: Server;
  origin: string;
  hits: Array<{ url: string; headers: IncomingHttpHeaders }>;
}

async function listen(
  handler: (req: { url: string }, res: import("node:http").ServerResponse) => void,
): Promise<Listener> {
  const hits: Listener["hits"] = [];
  const server = createHttpServer((req, res) => {
    hits.push({ url: req.url ?? "", headers: req.headers });
    handler({ url: req.url ?? "" }, res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}`, hits };
}

describe("redirects", () => {
  const listeners: Listener[] = [];

  afterEach(async () => {
    await Promise.all(
      listeners.splice(0).map((l) => new Promise<void>((r) => l.server.close(() => r()))),
    );
  });

  it("refuses a redirect from a trusted origin to an untrusted loopback/metadata address", async () => {
    const target = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const studio = await listen((req, res) => {
      const to = req.url.includes("meta")
        ? "http://169.254.169.254/latest/meta-data/"
        : `${target.origin}/internal`;
      res.writeHead(302, { location: to });
      res.end();
    });
    listeners.push(target, studio);
    process.env[ENV] = studio.origin; // only the studio listener is trusted

    await expect(brandcodeRequest(`${studio.origin}/api/brand/hosted/x`)).rejects.toThrow(
      /redirected to an untrusted origin/,
    );
    await expect(brandcodeRequest(`${studio.origin}/api/meta`)).rejects.toThrow(
      /redirected to an untrusted origin/,
    );
    expect(target.hits).toHaveLength(0);
  });

  it("refuses a cross-origin redirect of a credentialed request (token never forwarded)", async () => {
    const other = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    const studio = await listen((_req, res) => {
      res.writeHead(307, { location: `${other.origin}/api/brand/hosted/x` });
      res.end();
    });
    listeners.push(other, studio);
    // Both listeners trusted: the hop is still refused because credentials
    // are bound to the origin they were sent to.
    process.env[ENV] = `${studio.origin},${other.origin}`;

    await expect(
      brandcodeRequest(`${studio.origin}/api/brand/hosted/x`, { shareToken: "share-secret" }),
    ).rejects.toThrow(/redirected a credentialed request/);
    expect(studio.hits).toHaveLength(1);
    expect(studio.hits[0].headers["x-brand-share-token"]).toBe("share-secret");
    expect(other.hits).toHaveLength(0);
  });

  it("follows an uncredentialed redirect between trusted origins", async () => {
    const other = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const studio = await listen((_req, res) => {
      res.writeHead(301, { location: `${other.origin}/final` });
      res.end();
    });
    listeners.push(other, studio);
    process.env[ENV] = `${studio.origin},${other.origin}`;

    const res = await brandcodeRequest<{ ok: boolean }>(`${studio.origin}/start`);
    expect(res.data).toEqual({ ok: true });
    expect(res.origin).toBe(other.origin);
    expect(res.trusted).toBe(true);
  });

  it("never echoes a non-JSON response body in the error message", async () => {
    const studio = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>SECRET-INTERNAL-CONTENT root:x:0:0</html>");
    });
    listeners.push(studio);
    process.env[ENV] = studio.origin;

    const err = await brandcodeRequest(`${studio.origin}/api/brand/hosted/x`).catch((e) => e);
    expect(err).toBeInstanceOf(BrandcodeClientError);
    expect(String(err.message)).not.toMatch(/SECRET|root:x|<html/);
    expect(err.message).toMatch(/non-JSON/);
  });

  it("never echoes an error body or status text in the error message", async () => {
    const studio = await listen((_req, res) => {
      res.writeHead(500, "Injected Reason Phrase", { "content-type": "text/plain" });
      res.end("SECRET-STACK-TRACE");
    });
    listeners.push(studio);
    process.env[ENV] = studio.origin;

    const err = await brandcodeRequest(`${studio.origin}/x`).catch((e) => e);
    expect(err).toBeInstanceOf(BrandcodeClientError);
    expect(err.message).toBe("Brandcode API returned HTTP 500");
  });
});

// ── Approval: only trusted origins can confer production_approved ────────

describe("approval conferral", () => {
  let cwd: string;
  const pkg = { slug: "acme", approval: "production_approved", identity: { name: "Acme" } };

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "bc-trust-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function scaffold(): Promise<void> {
    await new BrandDir(cwd).initBrand({
      schema_version: "0.1.0",
      session: 1,
      client_name: "acme",
      created_at: "2026-10-01T00:00:00Z",
    });
  }

  it("an evil origin cannot confer production_approved", async () => {
    await scaffold();
    const outcome = await writePackagePayload(cwd, pkg, { origin: "https://evil.example" });
    expect(outcome).toBe("untrusted_origin");
    await expect(access(join(cwd, ".brand", "approval.json"))).rejects.toThrow();
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("fails closed when the source is omitted", async () => {
    await scaffold();
    // @ts-expect-error — exercising the runtime guard for untyped callers
    expect(await writePackagePayload(cwd, pkg)).toBe("untrusted_origin");
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("a trusted origin confers production_approved bound to the package", async () => {
    await scaffold();
    const outcome = await writePackagePayload(cwd, pkg, {
      origin: "https://www.brandcode.studio",
    });
    expect(outcome).toBe("conferred");
    expect(await resolveEffectiveApproval(cwd)).toBe("production_approved");

    // Swapping in a different package (e.g. a later pull from an untrusted
    // mirror that declares nothing) drops the approval.
    await writePackagePayload(cwd, { slug: "acme", identity: { name: "Other" } }, {
      origin: "https://evil.example",
    });
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("website-extracted local sources cannot inherit a Studio approval", async () => {
    await scaffold();
    await writeFile(
      join(cwd, ".brand", "core-identity.yaml"),
      "schema_version: 0.1.0\ncolors:\n  - value: '#ff0000'\n    role: primary\ntypography: []\nlogo: []\nspacing: null\n",
    );
    const outcome = await writePackagePayload(cwd, pkg, {
      origin: "https://www.brandcode.studio",
    });
    expect(outcome).toBe("local_sources_present");
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("additional source YAMLs also block conferral", async () => {
    await scaffold();
    await mkdir(join(cwd, ".brand"), { recursive: true });
    await writeFile(join(cwd, ".brand", "messaging.yaml"), "voice: {}\n");
    expect(
      await writePackagePayload(cwd, pkg, { origin: "https://brandcode.studio" }),
    ).toBe("local_sources_present");
  });
});
