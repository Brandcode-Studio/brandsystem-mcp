import { describe, expect, it, vi, beforeEach } from "vitest";
import net from "node:net";

// Capture what Chromium would be launched with, without launching it.
const launchMock = vi.hoisted(() => vi.fn());
vi.mock("puppeteer-core", () => ({ default: { launch: launchMock } }));

import {
  browserLaunchArgs,
  chromeLaunchArgs,
  createRemoteAddressGuard,
  egressAllowedPortsFor,
  egressLockdownArgs,
  installEgressGuards,
  BrowserEgressViolationError,
  withLockedDownBrowser,
} from "../../src/lib/visual-extractor.js";

function portIsClosed(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(true));
  });
}

function proxyPortFrom(args: string[]): number {
  const flag = args.find((a) => a.startsWith("--proxy-server="));
  return Number(/:(\d+)$/.exec(flag ?? "")?.[1]);
}

const REQUIRED_LOCKDOWN_FLAGS = [
  "--proxy-bypass-list=<-loopback>",
  "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
  "--disable-quic",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--dns-prefetch-disable",
  "--disable-background-networking",
];

describe("Chromium egress lockdown flags", () => {
  it("egressLockdownArgs routes everything through the loopback proxy and disables bypass channels", () => {
    const args = egressLockdownArgs(41234);
    expect(args).toContain("--proxy-server=http://127.0.0.1:41234");
    for (const flag of REQUIRED_LOCKDOWN_FLAGS) expect(args).toContain(flag);
  });

  it("rejects an invalid proxy port", () => {
    expect(() => egressLockdownArgs(0)).toThrow();
    expect(() => egressLockdownArgs(70000)).toThrow();
  });

  it("browserLaunchArgs keeps existing sandbox/window flags and adds the lockdown", () => {
    const args = browserLaunchArgs({}, { egressProxyPort: 5555, includeWindowSize: true });
    for (const flag of chromeLaunchArgs({}, { includeWindowSize: true })) expect(args).toContain(flag);
    expect(args).toContain("--proxy-server=http://127.0.0.1:5555");
    for (const flag of REQUIRED_LOCKDOWN_FLAGS) expect(args).toContain(flag);
    expect(args).not.toContain("--no-sandbox");
  });

  it("egressAllowedPortsFor adds only the explicit port of a validated URL", async () => {
    await expect(egressAllowedPortsFor("https://93.184.216.34/")).resolves.toEqual([80, 443]);
    await expect(egressAllowedPortsFor("http://93.184.216.34:8080/")).resolves.toEqual([80, 443, 8080]);
    await expect(egressAllowedPortsFor("http://127.0.0.1:8080/")).rejects.toThrow("SSRF blocked");
  });
});

describe("withLockedDownBrowser lifecycle", () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it("launches Chromium with the live proxy port and every lockdown flag", async () => {
    const browser = { close: vi.fn(async () => undefined) };
    launchMock.mockResolvedValue(browser);

    let seenPort = 0;
    const result = await withLockedDownBrowser(
      { chromePath: "/fake/chrome", allowedPorts: [80, 443], env: {} },
      async (_browser, proxy) => {
        seenPort = proxy.port;
        expect(await portIsClosed(proxy.port)).toBe(false);
        return "ok";
      },
    );

    expect(result).toBe("ok");
    const { args, executablePath, headless } = launchMock.mock.calls[0][0];
    expect(executablePath).toBe("/fake/chrome");
    expect(headless).toBe(true);
    expect(proxyPortFrom(args)).toBe(seenPort);
    for (const flag of REQUIRED_LOCKDOWN_FLAGS) expect(args).toContain(flag);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(await portIsClosed(seenPort)).toBe(true);
  });

  it("closes the browser and the proxy when extraction throws", async () => {
    const browser = { close: vi.fn(async () => undefined) };
    launchMock.mockResolvedValue(browser);
    let seenPort = 0;
    await expect(
      withLockedDownBrowser({ chromePath: "/fake/chrome", allowedPorts: [80, 443] }, async (_b, proxy) => {
        seenPort = proxy.port;
        throw new Error("page exploded");
      }),
    ).rejects.toThrow("page exploded");
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(await portIsClosed(seenPort)).toBe(true);
  });

  it("closes the proxy when Chromium fails to launch", async () => {
    launchMock.mockRejectedValue(new Error("no chrome"));
    await expect(
      withLockedDownBrowser({ chromePath: "/fake/chrome", allowedPorts: [80, 443] }, async () => "unreachable"),
    ).rejects.toThrow("no chrome");
    const port = proxyPortFrom(launchMock.mock.calls[0][0].args);
    expect(port).toBeGreaterThan(0);
    expect(await portIsClosed(port)).toBe(true);
  });
});

describe("page egress guards", () => {
  it("bypasses service workers before navigation and inspects every response", async () => {
    const calls: string[] = [];
    const handlers: Array<(r: unknown) => void> = [];
    const page = {
      setBypassServiceWorker: vi.fn(async (v: boolean) => {
        calls.push(`bypass:${v}`);
      }),
      on: vi.fn((event: string, handler: (r: unknown) => void) => {
        calls.push(`on:${event}`);
        handlers.push(handler);
      }),
    };
    const guard = createRemoteAddressGuard(4000);
    await installEgressGuards(page as never, guard);
    expect(calls).toEqual(["bypass:true", "on:response"]);

    handlers[0]({ url: () => "https://example.com/", remoteAddress: () => ({ ip: "127.0.0.1", port: 4000 }) });
    expect(guard.violations).toEqual([]);
    handlers[0]({ url: () => "http://internal/", remoteAddress: () => ({ ip: "10.0.0.8", port: 80 }) });
    expect(guard.violations).toHaveLength(1);
  });

  it("remote-address guard allows the proxy itself but flags any other private remote", () => {
    const guard = createRemoteAddressGuard(4000);
    guard.inspect("https://a/", { ip: "127.0.0.1", port: 4000 }); // the proxy
    guard.inspect("https://b/", undefined); // cache / data: / about:
    guard.inspect("https://c/", { ip: "" });
    guard.inspect("https://d/", { ip: "93.184.216.34", port: 443 });
    expect(() => guard.assertClean()).not.toThrow();

    guard.inspect("http://e/", { ip: "127.0.0.1", port: 8080 }); // loopback, not the proxy
    guard.inspect("http://f/", { ip: "169.254.169.254", port: 80 });
    guard.inspect("http://g/", { ip: "[::ffff:192.168.0.1]", port: 80 });
    expect(guard.violations).toHaveLength(3);
    expect(() => guard.assertClean()).toThrow(BrowserEgressViolationError);
    expect(() => guard.assertClean()).toThrow(/private or reserved address/);
  });
});
