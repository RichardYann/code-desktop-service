import { describe, expect, it, vi } from "vitest";
import { applyTransportCertificateRefresh } from "../server/transportCertificateRuntime.js";

describe("transport certificate runtime", () => {
  it("hot-loads the HTTPS secure context when the transport certificate changes", async () => {
    const setSecureContext = vi.fn();
    const context = {
      tls: { cert: Buffer.from("new-cert"), key: Buffer.from("new-key") },
      refreshTransportCertificate: vi.fn(() => ({
        changed: true,
        previousFingerprint: "old-cert",
        nextFingerprint: "new-cert",
        previousPublicKeyHash: "same-spki",
        nextPublicKeyHash: "same-spki"
      }))
    };

    const result = await applyTransportCertificateRefresh({
      context,
      server: { setSecureContext }
    });

    expect(result.changed).toBe(true);
    expect(context.refreshTransportCertificate).toHaveBeenCalledTimes(1);
    expect(setSecureContext).toHaveBeenCalledWith(context.tls);
  });

  it("does not reload the HTTPS secure context when SANs are already current", async () => {
    const setSecureContext = vi.fn();
    const context = {
      tls: { cert: Buffer.from("same-cert"), key: Buffer.from("same-key") },
      refreshTransportCertificate: vi.fn(() => ({
        changed: false,
        previousFingerprint: "same-cert",
        nextFingerprint: "same-cert",
        previousPublicKeyHash: "same-spki",
        nextPublicKeyHash: "same-spki"
      }))
    };

    const result = await applyTransportCertificateRefresh({
      context,
      server: { setSecureContext }
    });

    expect(result.changed).toBe(false);
    expect(setSecureContext).not.toHaveBeenCalled();
  });
});
