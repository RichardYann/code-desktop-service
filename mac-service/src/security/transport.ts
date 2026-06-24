import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";

export interface TransportSubjectAltNames {
  dnsNames: string[];
  ipAddresses: string[];
}

export interface TransportCertificateOptions extends Partial<TransportSubjectAltNames> {
  forceRegenerate?: boolean;
}

export interface TransportCertificate {
  certPath: string;
  keyPath: string;
  fingerprint: string;
  publicKeyHash: string;
  mode: "local-ca";
  caCertPath: string;
  caKeyPath: string;
  caFingerprint: string;
  subjectAltNames: TransportSubjectAltNames;
}

interface TransportCertificateMetadata {
  mode: "local-ca";
  dnsNames: string[];
  ipAddresses: string[];
  caFingerprint: string;
  fingerprint: string;
  publicKeyHash: string;
  expiresAt: string;
}

interface ForgeCertificatePair {
  certPem: string;
  keyPem: string;
}

interface ForgeCaCertificatePair extends ForgeCertificatePair {
  cert: forge.pki.Certificate;
  keys: forge.pki.rsa.KeyPair;
}

const CA_COMMON_NAME = "code Local Development CA";
const SERVER_COMMON_NAME = "code Desktop Service";
const CERT_VALID_DAYS = 397;
const CA_VALID_DAYS = 3650;

function certificateFingerprintHex(certPem: string): string {
  const certificate = new crypto.X509Certificate(certPem);
  return crypto.createHash("sha256").update(certificate.raw).digest("hex");
}

function certificatePublicKeyHash(certPem: string): string {
  const certificate = new crypto.X509Certificate(certPem);
  const exported = certificate.publicKey.export({ type: "spki", format: "der" });
  const publicKeyDer = typeof exported === "string" ? Buffer.from(exported) : exported;
  return crypto.createHash("sha256").update(publicKeyDer).digest("base64");
}

function randomSerialNumber(): string {
  const serial = crypto.randomBytes(16);
  serial[0] = serial[0] & 0x7f;
  if (serial.every((byte) => byte === 0)) serial[serial.length - 1] = 1;
  return serial.toString("hex");
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeDnsNames(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values
    .map((value) => (value ?? "").trim().toLowerCase())
    .filter((value) => value.length > 0)))
    .sort();
}

function normalizeIpAddresses(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values
    .map((value) => (value ?? "").trim())
    .filter((value) => net.isIP(value) !== 0)))
    .sort();
}

function resolveSubjectAltNames(options: TransportCertificateOptions = {}): TransportSubjectAltNames {
  const dnsNames = normalizeDnsNames(options.dnsNames ?? ["localhost"]);
  const ipAddresses = normalizeIpAddresses(options.ipAddresses ?? ["127.0.0.1", "::1"]);
  return {
    dnsNames: dnsNames.length > 0 ? dnsNames : ["localhost"],
    ipAddresses: ipAddresses.length > 0 ? ipAddresses : ["127.0.0.1", "::1"]
  };
}

export function collectDefaultTransportSubjectAltNames(input: {
  env?: NodeJS.ProcessEnv;
  hostname?: () => string;
  networkInterfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
} = {}): TransportSubjectAltNames {
  const env = input.env ?? process.env;
  const hostname = input.hostname ?? os.hostname;
  const networkInterfaces = input.networkInterfaces ?? os.networkInterfaces;
  const host = hostname().trim();
  const computerName = (env.COMPUTERNAME ?? "").trim();
  const dnsCandidates = ["localhost", host, computerName];
  for (const value of [host, computerName]) {
    if (value.length > 0 && !value.toLowerCase().endsWith(".local")) {
      dnsCandidates.push(`${value}.local`);
    }
  }

  const ipCandidates = ["127.0.0.1", "::1"];
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === "IPv4" && !entry.internal) {
          ipCandidates.push(entry.address);
        }
      }
    }
  } catch {
    // Some restricted Linux environments reject interface enumeration. Loopback
    // SANs are enough to keep the local service bootable in that case.
  }

  return {
    dnsNames: normalizeDnsNames(dnsCandidates),
    ipAddresses: normalizeIpAddresses(ipCandidates)
  };
}

function writePrivateFile(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o600 });
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function isCertificateCurrent(certPath: string, metadata: TransportCertificateMetadata | null, subjectAltNames: TransportSubjectAltNames, caFingerprint: string): boolean {
  if (!metadata || metadata.mode !== "local-ca") return false;
  if (metadata.caFingerprint !== caFingerprint) return false;
  if (JSON.stringify(metadata.dnsNames) !== JSON.stringify(subjectAltNames.dnsNames)) return false;
  if (JSON.stringify(metadata.ipAddresses) !== JSON.stringify(subjectAltNames.ipAddresses)) return false;
  if (!fs.existsSync(certPath)) return false;
  const expiresAt = Date.parse(metadata.expiresAt);
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt > Date.now() + 24 * 60 * 60 * 1000;
}

function generateCaCertificate(): ForgeCaCertificatePair {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerialNumber();
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = addDays(cert.validity.notBefore, CA_VALID_DAYS);
  const attributes = [{ name: "commonName", value: CA_COMMON_NAME }];
  cert.setSubject(attributes);
  cert.setIssuer(attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" }
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    cert,
    keys,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey)
  };
}

function getCertificateExtension<T extends Record<string, unknown>>(cert: forge.pki.Certificate, name: string): T | null {
  return (cert.getExtension({ name }) as T | undefined) ?? null;
}

function rsaKeysMatch(publicKey: forge.pki.rsa.PublicKey, privateKey: forge.pki.rsa.PrivateKey): boolean {
  return publicKey.n.equals(privateKey.n) && publicKey.e.equals(privateKey.e);
}

function rsaPublicKeyFromPrivateKey(privateKey: forge.pki.rsa.PrivateKey): forge.pki.rsa.PublicKey {
  return forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
}

function isLoadedCaCertificateUsable(cert: forge.pki.Certificate, privateKey: forge.pki.rsa.PrivateKey): boolean {
  const now = Date.now();
  if (cert.validity.notBefore.getTime() > now) return false;
  if (cert.validity.notAfter.getTime() <= now + 24 * 60 * 60 * 1000) return false;

  const basicConstraints = getCertificateExtension<{ cA?: boolean }>(cert, "basicConstraints");
  if (basicConstraints?.cA !== true) return false;

  const keyUsage = getCertificateExtension<{ keyCertSign?: boolean }>(cert, "keyUsage");
  if (keyUsage?.keyCertSign !== true) return false;

  return rsaKeysMatch(cert.publicKey as forge.pki.rsa.PublicKey, privateKey);
}

function certificateSubjectAltNames(cert: forge.pki.Certificate): TransportSubjectAltNames {
  const extension = cert.getExtension({ name: "subjectAltName" }) as {
    altNames?: Array<{ type?: number; value?: string; ip?: string }>;
  } | undefined;
  const dnsNames: string[] = [];
  const ipAddresses: string[] = [];
  for (const entry of extension?.altNames ?? []) {
    if (entry.type === 2 && entry.value !== undefined) {
      dnsNames.push(entry.value);
    }
    if (entry.type === 7 && entry.ip !== undefined) {
      ipAddresses.push(entry.ip);
    }
  }
  return {
    dnsNames: normalizeDnsNames(dnsNames),
    ipAddresses: normalizeIpAddresses(ipAddresses)
  };
}

function sameSubjectAltNames(left: TransportSubjectAltNames, right: TransportSubjectAltNames): boolean {
  return JSON.stringify(left.dnsNames) === JSON.stringify(right.dnsNames) &&
    JSON.stringify(left.ipAddresses) === JSON.stringify(right.ipAddresses);
}

function isLoadedServerCertificateUsable(
  cert: forge.pki.Certificate,
  privateKey: forge.pki.rsa.PrivateKey,
  subjectAltNames: TransportSubjectAltNames
): boolean {
  const now = Date.now();
  if (cert.validity.notBefore.getTime() > now) return false;
  if (cert.validity.notAfter.getTime() <= now + 24 * 60 * 60 * 1000) return false;

  const basicConstraints = getCertificateExtension<{ cA?: boolean }>(cert, "basicConstraints");
  if (basicConstraints?.cA === true) return false;

  const keyUsage = getCertificateExtension<{ digitalSignature?: boolean; keyEncipherment?: boolean }>(cert, "keyUsage");
  if (keyUsage?.digitalSignature !== true || keyUsage.keyEncipherment !== true) return false;

  const extKeyUsage = getCertificateExtension<{ serverAuth?: boolean }>(cert, "extKeyUsage");
  if (extKeyUsage?.serverAuth !== true) return false;

  if (!rsaKeysMatch(cert.publicKey as forge.pki.rsa.PublicKey, privateKey)) return false;
  return sameSubjectAltNames(certificateSubjectAltNames(cert), subjectAltNames);
}

function loadOrCreateCaCertificate(caCertPath: string, caKeyPath: string): ForgeCaCertificatePair {
  if (fs.existsSync(caCertPath) && fs.existsSync(caKeyPath)) {
    try {
      const certPem = fs.readFileSync(caCertPath, "utf8");
      const keyPem = fs.readFileSync(caKeyPath, "utf8");
      const cert = forge.pki.certificateFromPem(certPem);
      const privateKey = forge.pki.privateKeyFromPem(keyPem);
      if (!isLoadedCaCertificateUsable(cert, privateKey as forge.pki.rsa.PrivateKey)) {
        throw new Error("Existing local CA material is not usable");
      }
      return {
        cert,
        keys: {
          publicKey: cert.publicKey as forge.pki.rsa.PublicKey,
          privateKey: privateKey as forge.pki.rsa.PrivateKey
        },
        certPem,
        keyPem
      };
    } catch {
      // Fall through and replace corrupted local CA material.
    }
  }

  const generated = generateCaCertificate();
  writePrivateFile(caCertPath, generated.certPem);
  writePrivateFile(caKeyPath, generated.keyPem);
  return generated;
}

function loadOrCreateServerPrivateKey(keyPath: string): {
  keyPem: string;
  privateKey: forge.pki.rsa.PrivateKey;
  publicKey: forge.pki.rsa.PublicKey;
} {
  if (fs.existsSync(keyPath)) {
    try {
      const keyPem = fs.readFileSync(keyPath, "utf8");
      const privateKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
      return {
        keyPem,
        privateKey,
        publicKey: rsaPublicKeyFromPrivateKey(privateKey)
      };
    } catch {
      // Fall through and replace corrupted service private key material.
    }
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  writePrivateFile(keyPath, keyPem);
  return {
    keyPem,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey
  };
}

function hasUsableServerCertificate(
  certPath: string,
  keyPath: string,
  metadata: TransportCertificateMetadata | null,
  subjectAltNames: TransportSubjectAltNames,
  caFingerprint: string
): boolean {
  if (!isCertificateCurrent(certPath, metadata, subjectAltNames, caFingerprint)) return false;
  if (!fs.existsSync(keyPath)) return false;
  try {
    const certPem = fs.readFileSync(certPath, "utf8");
    const keyPem = fs.readFileSync(keyPath, "utf8");
    const cert = forge.pki.certificateFromPem(certPem);
    const privateKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
    return isLoadedServerCertificateUsable(cert, privateKey, subjectAltNames);
  } catch {
    return false;
  }
}

function generateServerCertificate(
  ca: ForgeCaCertificatePair,
  subjectAltNames: TransportSubjectAltNames,
  serverKey: { privateKey: forge.pki.rsa.PrivateKey; publicKey: forge.pki.rsa.PublicKey; keyPem: string }
): ForgeCertificatePair & { expiresAt: string } {
  const cert = forge.pki.createCertificate();
  cert.publicKey = serverKey.publicKey;
  cert.serialNumber = randomSerialNumber();
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = addDays(cert.validity.notBefore, CERT_VALID_DAYS);
  cert.setSubject([{ name: "commonName", value: SERVER_COMMON_NAME }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false, critical: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
    { name: "extKeyUsage", serverAuth: true },
    {
      name: "subjectAltName",
      altNames: [
        ...subjectAltNames.dnsNames.map((value) => ({ type: 2, value })),
        ...subjectAltNames.ipAddresses.map((ip) => ({ type: 7, ip }))
      ]
    }
  ]);
  cert.sign(ca.keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: serverKey.keyPem,
    expiresAt: cert.validity.notAfter.toISOString()
  };
}

export function ensureTransportCertificate(dataDir: string, options: TransportCertificateOptions = {}): TransportCertificate {
  fs.mkdirSync(dataDir, { recursive: true });
  const certPath = path.join(dataDir, "transport-cert.pem");
  const keyPath = path.join(dataDir, "transport-key.pem");
  const certsDir = path.join(dataDir, "certs");
  const caCertPath = path.join(certsDir, "transport-ca-cert.pem");
  const caKeyPath = path.join(certsDir, "transport-ca-key.pem");
  const metadataPath = path.join(certsDir, "transport-cert-meta.json");
  const subjectAltNames = resolveSubjectAltNames(options);

  fs.mkdirSync(certsDir, { recursive: true });
  const ca = loadOrCreateCaCertificate(caCertPath, caKeyPath);
  const caFingerprint = certificateFingerprintHex(ca.certPem);
  const metadata = readJsonFile<TransportCertificateMetadata>(metadataPath);
  const shouldRegenerate =
    options.forceRegenerate === true ||
    !hasUsableServerCertificate(certPath, keyPath, metadata, subjectAltNames, caFingerprint);

  if (shouldRegenerate) {
    const serverKey = loadOrCreateServerPrivateKey(keyPath);
    const generated = generateServerCertificate(ca, subjectAltNames, serverKey);
    writePrivateFile(certPath, generated.certPem);
    writePrivateFile(keyPath, generated.keyPem);
    const fingerprint = certificateFingerprintHex(generated.certPem);
    const publicKeyHash = certificatePublicKeyHash(generated.certPem);
    const nextMetadata: TransportCertificateMetadata = {
      mode: "local-ca",
      dnsNames: subjectAltNames.dnsNames,
      ipAddresses: subjectAltNames.ipAddresses,
      caFingerprint,
      fingerprint,
      publicKeyHash,
      expiresAt: generated.expiresAt
    };
    writePrivateFile(metadataPath, JSON.stringify(nextMetadata, null, 2));
  }

  const cert = fs.readFileSync(certPath, "utf8");
  return {
    certPath,
    keyPath,
    fingerprint: certificateFingerprintHex(cert),
    publicKeyHash: certificatePublicKeyHash(cert),
    mode: "local-ca",
    caCertPath,
    caKeyPath,
    caFingerprint,
    subjectAltNames
  };
}
