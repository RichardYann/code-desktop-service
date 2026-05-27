import os from "node:os";

export interface LocalWebTargetClassification {
  allowed: boolean;
  reason: string;
  normalizedUrl: string;
  host: string;
  port: number | null;
}

export interface LocalWebTargetPolicyOptions {
  allowedHosts?: string[];
  lanAddresses?: string[];
}

function baseResult(input: {
  allowed: boolean;
  reason: string;
  normalizedUrl?: string;
  host?: string;
  port?: number | null;
}): LocalWebTargetClassification {
  return {
    allowed: input.allowed,
    reason: input.reason,
    normalizedUrl: input.normalizedUrl ?? "",
    host: input.host ?? "",
    port: input.port ?? null
  };
}

function hasExplicitPort(rawUrl: string): boolean {
  const authority = rawUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
  return /:\d+$/.test(authority);
}

function parsePort(url: URL, rawUrl: string): number | null {
  if (url.port !== "") {
    return Number(url.port);
  }

  const authority = rawUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
  const match = authority.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isLoopbackStyleHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return true;
  }

  return false;
}

function isAllowedHost(host: string, options: LocalWebTargetPolicyOptions): boolean {
  if (isLoopbackStyleHost(host)) {
    return true;
  }

  if (!isIpv4(host)) {
    return normalizedHosts(options.allowedHosts).has(host);
  }

  return normalizedHosts(options.allowedHosts).has(host)
    || normalizedHosts(options.lanAddresses ?? currentLanAddresses()).has(host);
}

function normalizedHosts(hosts: string[] | undefined): Set<string> {
  return new Set((hosts ?? []).map((host) => host.toLowerCase()));
}

function currentLanAddresses(): string[] {
  const interfaces = Object.values(os.networkInterfaces()).flat();
  return interfaces
    .filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry))
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

export function classifyLocalWebTarget(
  rawUrl: string,
  options: LocalWebTargetPolicyOptions = {}
): LocalWebTargetClassification {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return baseResult({ allowed: false, reason: "invalid-url" });
  }

  const host = url.hostname.toLowerCase();
  const port = parsePort(url, rawUrl);
  const normalizedUrl = url.href;

  if (url.protocol !== "http:") {
    return baseResult({ allowed: false, reason: "unsupported-protocol", normalizedUrl, host, port });
  }

  if (!hasExplicitPort(rawUrl) || port === null) {
    return baseResult({ allowed: false, reason: "missing-port", normalizedUrl, host, port });
  }

  if (!isAllowedHost(host, options)) {
    return baseResult({ allowed: false, reason: "unsupported-host", normalizedUrl, host, port });
  }

  return baseResult({ allowed: true, reason: "allowed", normalizedUrl, host, port });
}
