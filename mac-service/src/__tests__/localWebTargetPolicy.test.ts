import { describe, expect, it } from "vitest";
import { classifyLocalWebTarget } from "../domain/localWebTargetPolicy.js";

describe("localWebTargetPolicy", () => {
  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://0.0.0.0:5173"
  ])("allows loopback-style target %s", (target) => {
    const result = classifyLocalWebTarget(target);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("allowed");
    expect(result.normalizedUrl).toBe(`${target}/`);
    expect(result.port).not.toBeNull();
  });

  it.each([
    "http://192.168.1.2:3000",
    "http://10.0.0.8:3000",
    "http://172.16.0.2:8080"
  ])("rejects arbitrary RFC1918 private address by default %s", (target) => {
    const result = classifyLocalWebTarget(target);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("unsupported-host");
  });

  it.each([
    "http://192.168.1.2:3000",
    "http://10.0.0.8:3000",
    "http://172.16.0.2:8080"
  ])("allows explicitly allowlisted private address %s", (target) => {
    const result = classifyLocalWebTarget(target, {
      allowedHosts: [new URL(target).hostname]
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("allowed");
    expect(result.normalizedUrl).toBe(`${target}/`);
    expect(result.port).not.toBeNull();
  });

  it("allows injected Mac LAN address", () => {
    const result = classifyLocalWebTarget("http://192.168.2.27:5173", {
      lanAddresses: ["192.168.2.27"]
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("allowed");
    expect(result.normalizedUrl).toBe("http://192.168.2.27:5173/");
  });

  it.each([
    ["https://example.com", "unsupported-protocol"],
    ["file:///Users/a/index.html", "unsupported-protocol"],
    ["ftp://127.0.0.1:21", "unsupported-protocol"],
    ["http://127.0.0.1", "missing-port"],
    ["http://169.254.1.1:3000", "unsupported-host"],
    ["http://8.8.8.8:3000", "unsupported-host"],
    ["not a url", "invalid-url"]
  ])("rejects %s", (target, reason) => {
    const result = classifyLocalWebTarget(target);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it("returns normalized host and numeric port for allowed targets", () => {
    expect(classifyLocalWebTarget("HTTP://LOCALHOST:5173/")).toEqual({
      allowed: true,
      reason: "allowed",
      normalizedUrl: "http://localhost:5173/",
      host: "localhost",
      port: 5173
    });
  });
});
