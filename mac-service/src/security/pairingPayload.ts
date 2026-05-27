import type { PairingCode } from "./pairing.js";

export interface PairingPayloadInput {
  serviceUrl: string;
  candidateServiceUrls: string[];
  macId: string;
  macName: string;
  tlsFingerprint: string;
  tlsPublicKeyHash: string;
  code: PairingCode;
}

export interface PairingPayload {
  version: 1;
  product: "code";
  serviceUrl: string;
  candidateServiceUrls: string[];
  macId: string;
  macName: string;
  pairingCode: string;
  tlsFingerprint: string;
  tlsPublicKeyHash: string;
  expiresAt: number;
}

export function createPairingPayload(input: PairingPayloadInput): PairingPayload {
  return {
    version: 1,
    product: "code",
    serviceUrl: input.serviceUrl,
    candidateServiceUrls: input.candidateServiceUrls,
    macId: input.macId,
    macName: input.macName,
    pairingCode: input.code.value,
    tlsFingerprint: input.tlsFingerprint,
    tlsPublicKeyHash: input.tlsPublicKeyHash,
    expiresAt: input.code.expiresAt
  };
}
