import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import http from "node:http";
import https from "node:https";

// Mock dns.promises.lookup before importing the module under test
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(),
  },
}));

import dns from "node:dns/promises";
import { validateUrl, safeFetch } from "../../src/lib/url-validator.js";

const mockLookup = vi.mocked(dns.lookup);

function makeResponse(
  body: string,
  statusCode = 200,
  headers: Record<string, string> = {},
  statusMessage = "OK",
) {
  const stream = Readable.from(body) as Readable & {
    statusCode?: number;
    statusMessage?: string;
    headers?: Record<string, string>;
  };
  stream.statusCode = statusCode;
  stream.statusMessage = statusMessage;
  stream.headers = headers;
  return stream;
}

function mockTransportRequest(
  transport: typeof http | typeof https,
  responses: Array<Readable & { statusCode?: number; statusMessage?: string; headers?: Record<string, string> }>,
) {
  return vi.spyOn(transport, "request").mockImplementation(((options: any, callback: any) => {
    const response = responses.shift();
    if (!response) throw new Error("No mocked response available");

    const req = {
      on: vi.fn().mockReturnThis(),
      end: vi.fn((body?: unknown) => {
        void body;
        callback(response);
        response.resume?.();
        return req;
      }),
      destroy: vi.fn(),
    };

    return req as any;
  }) as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── validateUrl ──────────────────────────────────────────────────

describe("validateUrl", () => {
  it("allows https://example.com (public)", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
    await expect(validateUrl("https://example.com")).resolves.toBeUndefined();
  });

  it("allows http://example.com (public, non-TLS)", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
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
    mockLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as any);
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
    mockLookup.mockResolvedValue([{ address: "::1", family: 6 }] as any);
    await expect(validateUrl("http://evil.test")).rejects.toThrow(
      "SSRF blocked: evil.test resolves to private IP ::1"
    );
  });

  it("rejects http://0.0.0.0 (unspecified)", async () => {
    await expect(validateUrl("http://0.0.0.0")).rejects.toThrow(
      "SSRF blocked: 0.0.0.0 is a private IP"
    );
  });

  it("rejects hostnames when any resolved address is private", async () => {
    mockLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ] as any);
    await expect(validateUrl("https://example.com")).rejects.toThrow(
      "SSRF blocked: example.com resolves to private IP 127.0.0.1"
    );
  });
});

// ── safeFetch ────────────────────────────────────────────────────

describe("safeFetch", () => {
  it("fetches a public URL successfully", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    const requestSpy = mockTransportRequest(https, [
      makeResponse("ok", 200, { "content-type": "text/plain" }),
    ]);

    const result = await safeFetch("https://example.com");
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("ok");
    expect(requestSpy).toHaveBeenCalledOnce();
    expect(requestSpy.mock.calls[0][0]).toMatchObject({
      hostname: "example.com",
      path: "/",
      method: "GET",
      servername: "example.com",
    });
  });

  it("rejects a private IP URL without making the request", async () => {
    const requestSpy = vi.spyOn(http, "request");

    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      "SSRF blocked"
    );
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("follows redirects and validates each hop", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    const requestSpy = mockTransportRequest(https, [
      makeResponse("", 302, { location: "https://example.com/step2" }, "Found"),
      makeResponse("", 301, { location: "https://example.com/final" }, "Moved Permanently"),
      makeResponse("done", 200),
    ]);

    const result = await safeFetch("https://example.com/start");
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("done");
    expect(requestSpy).toHaveBeenCalledTimes(3);
  });

  it("blocks redirect to a private IP", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as any);

    const requestSpy = mockTransportRequest(https, [
      makeResponse("", 302, { location: "http://169.254.169.254/latest/meta-data/" }, "Found"),
    ]);

    await expect(safeFetch("https://example.com/redir")).rejects.toThrow(
      "SSRF blocked"
    );
    // Only one fetch made (the initial), the redirect target was blocked before fetching
    expect(requestSpy).toHaveBeenCalledOnce();
  });

  it("rejects after exceeding max redirect hops", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    const requestSpy = mockTransportRequest(https, [
      makeResponse("", 302, { location: "https://example.com/hop1" }, "Found"),
      makeResponse("", 302, { location: "https://example.com/hop2" }, "Found"),
      makeResponse("", 302, { location: "https://example.com/hop3" }, "Found"),
      makeResponse("", 302, { location: "https://example.com/hop4" }, "Found"),
    ]);

    await expect(safeFetch("https://example.com/start")).rejects.toThrow(
      "too many redirects"
    );
    expect(requestSpy).toHaveBeenCalledTimes(4);
  });

  it("passes through existing options including signal", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    const requestSpy = mockTransportRequest(https, [makeResponse("ok", 200)]);

    const signal = AbortSignal.timeout(5000);
    await safeFetch("https://example.com", {
      signal,
      headers: { "User-Agent": "test" },
    });

    expect(requestSpy).toHaveBeenCalledWith(expect.objectContaining({
      signal,
      headers: { "user-agent": "test" },
    }), expect.any(Function));
  });

  it("pins DNS lookup results through the request lookup callback", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    const requestSpy = mockTransportRequest(https, [makeResponse("ok", 200)]);

    await safeFetch("https://example.com/path?q=1");

    const requestOptions = requestSpy.mock.calls[0][0] as {
      lookup: (hostname: string, options: unknown, callback: (err: Error | null, address: string, family: number) => void) => void;
    };
    const callback = vi.fn();
    requestOptions.lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("returns the array lookup shape when Node requests all addresses", async () => {
    mockLookup.mockResolvedValue([{ address: "2606:4700:20::681a:a58", family: 6 }] as any);

    const requestSpy = mockTransportRequest(https, [makeResponse("ok", 200)]);

    await safeFetch("https://boothbeacon.org");

    const requestOptions = requestSpy.mock.calls[0][0] as {
      lookup: (hostname: string, options: unknown, callback: (err: Error | null, addresses: Array<{ address: string; family: number }>) => void) => void;
    };
    const callback = vi.fn();
    requestOptions.lookup("boothbeacon.org", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "2606:4700:20::681a:a58", family: 6 }]);
  });

  it("uses the http transport for plain http URLs", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);

    const requestSpy = mockTransportRequest(http, [makeResponse("ok", 200)]);

    const result = await safeFetch("http://example.com/logo.png", {
      method: "HEAD",
    });

    expect(result.status).toBe(200);
    expect(requestSpy).toHaveBeenCalledOnce();
    expect(requestSpy.mock.calls[0][0]).toMatchObject({
      method: "HEAD",
      path: "/logo.png",
    });
  });
});
