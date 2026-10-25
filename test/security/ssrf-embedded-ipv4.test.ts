/**
 * GHSA-j3rv-rv99-hg74 regression suite: a blocked IPv4 destination must stay
 * blocked however it is spelled as IPv6, on every path that fetches — the
 * URL literal, DNS AAAA answers, redirect hops, and the headless browser's
 * request interceptor. The end-to-end case uses a real loopback listener and
 * asserts it never receives a request.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import dns from "node:dns/promises";
import {
  isPrivateIPv4,
  isPrivateIPv6,
  safeFetch,
  validateUrl,
} from "../../src/lib/url-validator.js";
import { validateBrowserRequestUrl } from "../../src/lib/visual-extractor.js";

// The advisory's two reproduction URLs, plus the hex spellings Node's WHATWG
// parser canonicalizes them to.
const ADVISORY_CASES = [
  "http://[::ffff:169.254.169.254]/latest/meta-data/",
  "http://[::ffff:a9fe:a9fe]/latest/meta-data/",
  "http://[::ffff:127.0.0.1]:9099/",
  "http://[::ffff:7f00:1]:9099/",
];

// Every IPv6 transition format that embeds a blocked IPv4 address.
const EMBEDDED_PRIVATE_V6 = [
  "::ffff:10.0.0.1", // IPv4-mapped
  "::ffff:192.168.1.1",
  "0:0:0:0:0:ffff:172.16.0.1",
  "::ffff:0:127.0.0.1", // IPv4-translated (SIIT)
  "::127.0.0.1", // IPv4-compatible (deprecated)
  "::a9fe:a9fe",
  "64:ff9b::127.0.0.1", // NAT64 well-known prefix
  "64:ff9b::a9fe:a9fe",
  "2002:7f00:1::", // 6to4 of 127.0.0.1
  "2002:a9fe:a9fe::1", // 6to4 of 169.254.169.254
];

const OTHER_NON_GLOBAL_V6 = [
  "::", "::1", "64:ff9b:1::1", "100::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2",
  "2001:db8::1", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1",
];

const PUBLIC_V6 = [
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  "::ffff:93.184.216.34",
  "64:ff9b::93.184.216.34",
  "2002:5db8:d822::1",
];

describe("isPrivateIPv6 — embedded IPv4 is re-checked", () => {
  it.each(EMBEDDED_PRIVATE_V6)("blocks %s", (ip) => {
    expect(isPrivateIPv6(ip)).toBe(true);
  });
  it.each(OTHER_NON_GLOBAL_V6)("blocks non-global %s", (ip) => {
    expect(isPrivateIPv6(ip)).toBe(true);
  });
  it.each(PUBLIC_V6)("allows public %s", (ip) => {
    expect(isPrivateIPv6(ip)).toBe(false);
  });
  it("is case-insensitive and accepts brackets", () => {
    expect(isPrivateIPv6("[::FFFF:A9FE:A9FE]")).toBe(true);
  });
  it("fails closed on unparseable input", () => {
    for (const junk of ["", "not-an-ip", "1:2:3", "::ffff:127.0.0.01", "fe80::1%eth0", ":::"]) {
      expect(isPrivateIPv6(junk)).toBe(true);
    }
  });
});

describe("isPrivateIPv4 — full non-global table", () => {
  it.each([
    "100.64.0.1", "192.0.0.8", "192.0.2.1", "192.88.99.1", "198.18.0.1",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
  ])("blocks %s", (ip) => {
    expect(isPrivateIPv4(ip)).toBe(true);
  });
  it.each(["93.184.216.34", "8.8.8.8", "100.63.255.255", "100.128.0.0", "198.20.0.1"])(
    "allows public %s",
    (ip) => {
      expect(isPrivateIPv4(ip)).toBe(false);
    },
  );
  it("fails closed on non-canonical input", () => {
    for (const junk of ["1.2.3", "01.2.3.4", "256.1.1.1", "1.2.3.4.5", ""]) {
      expect(isPrivateIPv4(junk)).toBe(true);
    }
  });
});

describe("validateUrl — advisory reproduction URLs", () => {
  it.each(ADVISORY_CASES)("rejects %s", async (url) => {
    await expect(validateUrl(url)).rejects.toThrow(/SSRF blocked/);
  });

  it("rejects a hostname whose AAAA answer is IPv4-mapped metadata", async () => {
    const spy = vi
      .spyOn(dns, "lookup")
      .mockResolvedValue([{ address: "::ffff:a9fe:a9fe", family: 6 }] as never);
    await expect(validateUrl("http://metadata.attacker.test/")).rejects.toThrow(
      /resolves to private IP ::ffff:a9fe:a9fe/,
    );
    spy.mockRestore();
  });

  it("rejects a hostname with a public A record but a mapped-loopback AAAA", async () => {
    const spy = vi.spyOn(dns, "lookup").mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "::ffff:127.0.0.1", family: 6 },
    ] as never);
    await expect(validateUrl("http://mixed.attacker.test/")).rejects.toThrow(/SSRF blocked/);
    spy.mockRestore();
  });
});

describe("headless browser request interceptor", () => {
  it.each(ADVISORY_CASES)("rejects %s", async (url) => {
    await expect(validateBrowserRequestUrl(url)).rejects.toThrow(/SSRF blocked/);
  });
});

describe("end to end against a real loopback listener", () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end("<svg><title>SYNTHETIC LOOPBACK RESPONSE</title></svg>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("the listener is reachable directly (control)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/control`);
    expect(res.status).toBe(200);
    expect(hits).toEqual(["/control"]);
    hits.length = 0;
  });

  it.each(["::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "64:ff9b::7f00:1"])(
    "safeFetch to [%s] never reaches the listener",
    async (literal) => {
      await expect(
        safeFetch(`http://[${literal}]:${port}/latest/meta-data/`, {
          signal: AbortSignal.timeout(2_000),
        }),
      ).rejects.toThrow(/SSRF blocked/);
      expect(hits).toEqual([]);
    },
  );

  it("a redirect hop to a mapped-loopback literal is blocked before connecting", async () => {
    const redirector = http.createServer((_req, res) => {
      res.writeHead(302, { location: `http://[::ffff:127.0.0.1]:${port}/via-redirect` });
      res.end();
    });
    await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
    const redirectorPort = (redirector.address() as AddressInfo).port;

    // The first hop must look public to the guard; pin it to the loopback
    // redirector so the test exercises only the redirect-hop validation.
    const spy = vi
      .spyOn(dns, "lookup")
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    const httpRequest = http.request;
    const reqSpy = vi.spyOn(http, "request").mockImplementation(((opts: http.RequestOptions, cb: never) =>
      httpRequest({ ...opts, lookup: undefined, hostname: "127.0.0.1", port: redirectorPort }, cb)) as never);

    try {
      await expect(
        safeFetch("http://public-redirector.test/", { signal: AbortSignal.timeout(2_000) }),
      ).rejects.toThrow(/SSRF blocked/);
      expect(reqSpy).toHaveBeenCalledTimes(1); // only the public hop connected
      expect(hits).toEqual([]);
    } finally {
      reqSpy.mockRestore();
      spy.mockRestore();
      await new Promise<void>((resolve) => redirector.close(() => resolve()));
    }
  });
});
