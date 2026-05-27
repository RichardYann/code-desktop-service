import { describe, expect, it, vi } from "vitest";
import { buildBonjourPublication, startBonjourPublication, type BonjourFactory } from "../server/bonjourPublisher.js";

describe("bonjour publisher", () => {
  it("builds the _code._tcp publication with mobile discovery TXT fields", () => {
    const publication = buildBonjourPublication({
      name: "Yongzhe Mac",
      port: 37631,
      macId: "local-mac",
      tlsFingerprint: "abc123",
      tlsPublicKeyHash: "spki123",
      serviceUrl: "https://192.168.2.27:37631",
      candidateServiceUrls: ["https://192.168.2.27:37631", "https://macbook-air.local:37631"]
    });

    expect(publication).toEqual({
      name: "Yongzhe Mac",
      type: "code",
      protocol: "tcp",
      port: 37631,
      txt: {
        product: "code",
        macId: "local-mac",
        tlsFingerprint: "abc123",
        tlsPublicKeyHash: "spki123",
        serviceUrl: "https://192.168.2.27:37631",
        candidateServiceUrls: "https://192.168.2.27:37631|https://macbook-air.local:37631"
      }
    });
  });

  it("publishes using a supplied Bonjour factory and stops cleanly", async () => {
    const start = vi.fn();
    const stop = vi.fn((callback?: () => void) => callback?.());
    const destroy = vi.fn((callback?: () => void) => callback?.());
    const publish = vi.fn(() => ({ start, stop }));
    const factory = vi.fn(() => ({ publish, destroy })) satisfies BonjourFactory;

    const publication = await startBonjourPublication({
      factory,
      name: "Yongzhe Mac",
      port: 37631,
      macId: "local-mac",
      tlsFingerprint: "abc123",
      tlsPublicKeyHash: "spki123",
      serviceUrl: "https://192.168.2.27:37631",
      candidateServiceUrls: ["https://192.168.2.27:37631", "https://macbook-air.local:37631"]
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      name: "Yongzhe Mac",
      type: "code",
      protocol: "tcp",
      port: 37631,
      txt: {
        product: "code",
        macId: "local-mac",
        tlsFingerprint: "abc123",
        tlsPublicKeyHash: "spki123",
        serviceUrl: "https://192.168.2.27:37631",
        candidateServiceUrls: "https://192.168.2.27:37631|https://macbook-air.local:37631"
      }
    });
    expect(start).toHaveBeenCalledTimes(1);

    await publication.stop();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("republishes when the service certificate fingerprint changes", async () => {
    const firstStart = vi.fn();
    const secondStart = vi.fn();
    const firstStop = vi.fn((callback?: () => void) => callback?.());
    const secondStop = vi.fn((callback?: () => void) => callback?.());
    const destroy = vi.fn((callback?: () => void) => callback?.());
    const publish = vi.fn()
      .mockReturnValueOnce({ start: firstStart, stop: firstStop })
      .mockReturnValueOnce({ start: secondStart, stop: secondStop });
    const factory = vi.fn(() => ({ publish, destroy })) satisfies BonjourFactory;

    const publication = await startBonjourPublication({
      factory,
      name: "Yongzhe Mac",
      port: 37631,
      macId: "local-mac",
      tlsFingerprint: "old-cert",
      tlsPublicKeyHash: "same-spki",
      serviceUrl: "https://192.168.43.6:37631",
      candidateServiceUrls: ["https://192.168.43.6:37631"]
    });

    await publication.update({
      name: "Yongzhe Mac",
      port: 37631,
      macId: "local-mac",
      tlsFingerprint: "new-cert",
      tlsPublicKeyHash: "same-spki",
      serviceUrl: "https://192.168.2.27:37631",
      candidateServiceUrls: ["https://192.168.2.27:37631"]
    });

    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith({
      name: "Yongzhe Mac",
      type: "code",
      protocol: "tcp",
      port: 37631,
      txt: {
        product: "code",
        macId: "local-mac",
        tlsFingerprint: "new-cert",
        tlsPublicKeyHash: "same-spki",
        serviceUrl: "https://192.168.2.27:37631",
        candidateServiceUrls: "https://192.168.2.27:37631"
      }
    });
    expect(secondStart).toHaveBeenCalledTimes(1);

    await publication.stop();

    expect(secondStop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
