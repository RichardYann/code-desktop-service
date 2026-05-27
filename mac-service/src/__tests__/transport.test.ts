import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { collectDefaultTransportSubjectAltNames, ensureTransportCertificate } from "../security/transport.js";
import { createAppContext } from "../appContext.js";

describe("transport security", () => {
  it("creates a reusable certificate fingerprint for WSS pinning", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-"));
    const first = ensureTransportCertificate(dir);
    const second = ensureTransportCertificate(dir);

    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(fs.existsSync(first.certPath)).toBe(true);
    expect(fs.existsSync(first.keyPath)).toBe(true);
  });

  it("creates a reusable local CA and a server certificate with localhost and LAN SANs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-ca-"));
    const certificate = ensureTransportCertificate(dir, {
      dnsNames: ["localhost", "demo.local"],
      ipAddresses: ["127.0.0.1", "::1", "192.168.1.23"]
    });

    const caCert = new X509Certificate(fs.readFileSync(certificate.caCertPath, "utf8"));
    const serverCert = new X509Certificate(fs.readFileSync(certificate.certPath, "utf8"));
    const forgeServerCert = forge.pki.certificateFromPem(fs.readFileSync(certificate.certPath, "utf8"));
    const subjectAltName = forgeServerCert.getExtension({ name: "subjectAltName" }) as {
      altNames?: Array<{ type: number; ip?: string; value?: string }>;
    } | undefined;

    expect(certificate.mode).toBe("local-ca");
    expect(certificate.caFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(certificate.caFingerprint).toBe(caCert.fingerprint256.replace(/:/g, "").toLowerCase());
    expect(certificate.fingerprint).toBe(serverCert.fingerprint256.replace(/:/g, "").toLowerCase());
    expect(certificate.publicKeyHash).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(fs.existsSync(certificate.caKeyPath)).toBe(true);
    expect(serverCert.issuer).toContain("code Local Development CA");
    expect(serverCert.subject).toContain("code Desktop Service");
    expect(caCert.subject).toContain("code Local Development CA");
    expect(serverCert.subjectAltName).toContain("DNS:localhost");
    expect(serverCert.subjectAltName).toContain("DNS:demo.local");
    expect(serverCert.subjectAltName).toContain("IP Address:127.0.0.1");
    expect(serverCert.subjectAltName).toContain("IP Address:192.168.1.23");
    expect(subjectAltName?.altNames?.some((entry) => entry.type === 7 && entry.ip === "::1")).toBe(true);
  });

  it("includes IPv4 and IPv6 loopback addresses in default SANs", () => {
    const subjectAltNames = collectDefaultTransportSubjectAltNames({
      env: {},
      hostname: () => "demo-host",
      networkInterfaces: () => ({})
    });

    expect(subjectAltNames.dnsNames).toEqual(["demo-host", "demo-host.local", "localhost"]);
    expect(subjectAltNames.ipAddresses).toContain("127.0.0.1");
    expect(subjectAltNames.ipAddresses).toContain("::1");
  });

  it("includes Windows computer names and non-internal IPv4 addresses in default SANs", () => {
    const subjectAltNames = collectDefaultTransportSubjectAltNames({
      env: { COMPUTERNAME: "WIN-LAB" },
      hostname: () => "mac-studio",
      networkInterfaces: () => ({
        lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true } as os.NetworkInterfaceInfo],
        en0: [{ address: "192.168.2.42", family: "IPv4", internal: false } as os.NetworkInterfaceInfo]
      })
    });

    expect(subjectAltNames.dnsNames).toEqual([
      "localhost",
      "mac-studio",
      "mac-studio.local",
      "win-lab",
      "win-lab.local"
    ]);
    expect(subjectAltNames.ipAddresses).toContain("192.168.2.42");
  });

  it("regenerates the service certificate when subject alternative names change while keeping the same CA", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-san-"));
    const first = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });
    const second = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1", "192.168.1.24"]
    });

    expect(second.caFingerprint).toBe(first.caFingerprint);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.publicKeyHash).toBe(first.publicKeyHash);
    expect(second.subjectAltNames.ipAddresses).toContain("192.168.1.24");
  });

  it("refreshes runtime transport certificate SANs after the LAN IP changes without changing the SPKI pin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-runtime-san-"));
    let currentIp = "192.168.43.6";
    const context = createAppContext({
      host: "0.0.0.0",
      port: 37631,
      dataDir: dir,
      codexBin: undefined,
      codexIpcSocketPath: path.join(dir, "missing-codex-ipc.sock"),
      projectRoots: [],
      launchAgentDir: path.join(dir, "LaunchAgents"),
      startupCommand: "pnpm dev"
    }, {
      collectTransportSubjectAltNames: () => ({
        dnsNames: ["localhost", "macbook.local"],
        ipAddresses: ["127.0.0.1", "::1", currentIp]
      })
    });

    const firstFingerprint = context.transport.fingerprint;
    const firstPublicKeyHash = context.transport.publicKeyHash;
    expect(context.transport.subjectAltNames.ipAddresses).toContain("192.168.43.6");

    currentIp = "192.168.2.27";
    const refresh = context.refreshTransportCertificate();

    expect(refresh.changed).toBe(true);
    expect(context.transport.fingerprint).not.toBe(firstFingerprint);
    expect(context.transport.publicKeyHash).toBe(firstPublicKeyHash);
    expect(context.transport.subjectAltNames.ipAddresses).toContain("192.168.2.27");
    expect(context.transport.subjectAltNames.ipAddresses).not.toContain("192.168.43.6");
    const serverCert = new X509Certificate(fs.readFileSync(context.transport.certPath, "utf8"));
    expect(serverCert.subjectAltName).toContain("IP Address:192.168.2.27");
  });

  it("does not churn the runtime certificate for volatile local hostnames", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-runtime-hostname-"));
    let currentHost = "macbook-air-1000.local";
    let currentIp = "192.168.2.27";
    const context = createAppContext({
      host: "0.0.0.0",
      port: 37631,
      dataDir: dir,
      codexBin: undefined,
      codexIpcSocketPath: path.join(dir, "missing-codex-ipc.sock"),
      projectRoots: [],
      launchAgentDir: path.join(dir, "LaunchAgents"),
      startupCommand: "pnpm dev"
    }, {
      collectTransportSubjectAltNames: () => ({
        dnsNames: ["localhost", currentHost],
        ipAddresses: ["127.0.0.1", "::1", currentIp]
      })
    });

    const firstFingerprint = context.transport.fingerprint;

    currentHost = "macbook-air-1001.local";
    const hostnameOnlyRefresh = context.refreshTransportCertificate();

    expect(hostnameOnlyRefresh.changed).toBe(false);
    expect(context.transport.fingerprint).toBe(firstFingerprint);
    expect(context.transport.subjectAltNames.dnsNames).toContain("macbook-air-1000.local");
    expect(context.transport.subjectAltNames.dnsNames).not.toContain("macbook-air-1001.local");

    currentIp = "192.168.2.28";
    const ipRefresh = context.refreshTransportCertificate();

    expect(ipRefresh.changed).toBe(true);
    expect(context.transport.subjectAltNames.ipAddresses).toContain("192.168.2.28");
    expect(context.transport.subjectAltNames.dnsNames).toContain("macbook-air-1000.local");
  });

  it("replaces an existing local CA when the private key no longer matches the CA certificate", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-ca-mismatch-"));
    const first = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });
    const mismatchedKeys = forge.pki.rsa.generateKeyPair(2048);
    fs.writeFileSync(first.caKeyPath, forge.pki.privateKeyToPem(mismatchedKeys.privateKey), { mode: 0o600 });

    const second = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });

    expect(second.caFingerprint).not.toBe(first.caFingerprint);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    const serverCert = new X509Certificate(fs.readFileSync(second.certPath, "utf8"));
    expect(serverCert.issuer).toContain("code Local Development CA");
  });

  it("regenerates the service certificate when the service private key no longer matches", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-key-mismatch-"));
    const first = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });
    const mismatchedKeys = forge.pki.rsa.generateKeyPair(2048);
    fs.writeFileSync(first.keyPath, forge.pki.privateKeyToPem(mismatchedKeys.privateKey), { mode: 0o600 });

    const second = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });

    expect(second.caFingerprint).toBe(first.caFingerprint);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.publicKeyHash).not.toBe(first.publicKeyHash);
  });

  it("regenerates the service certificate when the service certificate is corrupted", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-cert-corrupt-"));
    const first = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });
    fs.writeFileSync(first.certPath, "not a certificate", { mode: 0o600 });

    const second = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });

    expect(second.caFingerprint).toBe(first.caFingerprint);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.publicKeyHash).toBe(first.publicKeyHash);
  });

  it("replaces an existing local CA when the certificate is not a CA certificate", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-transport-ca-invalid-"));
    const first = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });
    fs.copyFileSync(first.certPath, first.caCertPath);

    const second = ensureTransportCertificate(dir, {
      dnsNames: ["localhost"],
      ipAddresses: ["127.0.0.1"]
    });

    expect(second.caFingerprint).not.toBe(first.caFingerprint);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    const caCert = forge.pki.certificateFromPem(fs.readFileSync(second.caCertPath, "utf8"));
    const basicConstraints = caCert.getExtension({ name: "basicConstraints" }) as { cA?: boolean } | undefined;
    expect(basicConstraints?.cA).toBe(true);
  });
});
