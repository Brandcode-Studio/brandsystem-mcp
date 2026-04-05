import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dns.promises.lookup before importing the module under test
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(),
  },
}));

import dns from "node:dns/promises";
import { validateUrl, safeFetch } from "../../src/lib/url-validator.js";

const mockLookup = vi.mocked(dns.lookup);

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── validateUrl ──────────────────────────────────────────────────

describe("validateUrl", () => {
  it("allows https://example.com (public)", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as any);
    await expect(validateUrl("https://example.com")).resolves.toBeUndefined();
  });

  it("allows http://example.com (public, non-TLS)", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as any);
    await expect(validateUrl("http://example.com")).resolves.toBeUndefined();
  });

  it("rejects ftp://example.com (wrong protocol)", async () => {
    await expect(validateUrl("ftp://example.com")).rejects.toThrow(
      'SSRF blocked: unsupported protocol "ftp:"'
    );
  });

  it("rejects file:///etc/passwd (wrong protocol)", async () => {
    await expect(validateUrl("file:///etc/passwd")).rejects.toThrow(
      'SSRF blocked: unsupported protocol "file:"'
    );
  });

  it("rejects http://127.0.0.1 (loopback)", async () => {
    await expect(validateUrl("http://127.0.0.1")).rejects.toThrow(
      "SSRF blocked: 127.0.0.1 is a private IP"
    );
  });

  it("rejects http://localhost (resolves to loopback)", async () => {
    mockLookup.mockResolvedValue({ address: "127.0.0.1", family: 4 } as any);
    await expect(validateUrl("http://localhost")).rejects.toThrow(
      "SSRF blocked: localhost resolves to private IP 127.0.0.1"
    );
  });

  it("rejects http://169.254.169.254 (cloud metadata)", async () => {
    await expect(validateUrl("http://169.254.169.254")).rejects.toThrow(
      "SSRF blocked: 169.254.169.254 is a private IP"
    );
  });

  it("rejects http://10.0.0.1 (private)", async () => {
    await expect(validateUrl("http://10.0.0.1")).rejects.toThrow(
      "SSRF blocked: 10.0.0.1 is a private IP"
    );
  });

  it("rejects http://192.168.1.1 (private)", async () => {
    await expect(validateUrl("http://192.168.1.1")).rejects.toThrow(
      "SSRF blocked: 192.168.1.1 is a private IP"
    );
  });

  it("rejects http://172.16.0.1 (private)", async () => {
    await expect(validateUrl("http://172.16.0.1")).rejects.toThrow(
      "SSRF blocked: 172.16.0.1 is a private IP"
    );
  });

  it("rejects http://[::1] (IPv6 loopback)", async () => {
    await expect(validateUrl("http://[::1]")).rejects.toThrow(
      "SSRF blocked: ::1 is a private IP"
    );
  });

  it("rejects hostname resolving to private IPv6", async () => {
    mockLookup.mockResolvedValue({ address: "::1", family: 6 } as any);
    await expect(validateUrl("http://evil.test")).rejects.toThrow(
      "SSRF blocked: evil.test resolves to private IP ::1"
    );
  });

  it("rejects http://0.0.0.0 (unspecified)", async () => {
    await expect(validateUrl("http://0.0.0.0")).rejects.toThrow(
      "SSRF blocked: 0.0.0.0 is a private IP"
    );
  });
});

// ── safeFetch ────────────────────────────────────────────────────

describe("safeFetch", () => {
  it("fetches a public URL successfully", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as any);

    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const result = await safeFetch("https://example.com");
    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();

    fetchSpy.mockRestore();
  });

  it("rejects a private IP URL without making the request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      "SSRF blocked"
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("follows redirects and validates each hop", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as any);

    const redirect1 = new Response(null, {
      status: 302,
      headers: { Location: "https://example.com/step2" },
    });
    const redirect2 = new Response(null, {
      status: 301,
      headers: { Location: "https://example.com/final" },
    });
    const finalResponse = new Response("done", { status: 200 });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(redirect1)
      .mockResolvedValueOnce(redirect2)
      .mockResolvedValueOnce(finalResponse);

    const result = await safeFetch("https://example.com/start");
    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    fetchSpy.mockRestore();
  });

  it("blocks redirect to a private IP", async () => {
    mockLookup.mockResolvedValueOnce({ address: "93.184.216.34", family: 4 } as any);

    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "http://169.254.169.254/latest/meta-data/" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(redirect);

    await expect(safeFetch("https://example.com/redir")).rejects.toThrow(
      "SSRF blocked"
    );
    // Only one fetch made (the initial), the redirect target was blocked before fetching
    expect(fetchSpy).toHaveBeenCalledOnce();

    fetchSpy.mockRestore();
  });

  it("rejects after exceeding max redirect hops", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as any);

    const makeRedirect = (n: number) =>
      new Response(null, {
        status: 302,
        headers: { Location: `https://example.com/hop${n}` },
      });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeRedirect(1))
      .mockResolvedValueOnce(makeRedirect(2))
      .mockResolvedValueOnce(makeRedirect(3))
      .mockResolvedValueOnce(makeRedirect(4));

    await expect(safeFetch("https://example.com/start")).rejects.toThrow(
      "too many redirects"
    );

    fetchSpy.mockRestore();
  });

  it("passes through existing options including signal", async () => {
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 } as any);

    const mockResponse = new Response("ok", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const signal = AbortSignal.timeout(5000);
    await safeFetch("https://example.com", {
      signal,
      headers: { "User-Agent": "test" },
    });

    expect(fetchSpy).toHaveBeenCalledWith("https://example.com", {
      signal,
      headers: { "User-Agent": "test" },
      redirect: "manual",
    });

    fetchSpy.mockRestore();
  });
});
