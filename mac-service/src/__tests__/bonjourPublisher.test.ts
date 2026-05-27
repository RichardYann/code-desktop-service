import { describe, expect, it, vi } from "vitest";
import { buildBonjourPublication, startBonjourPublication, type BonjourFactory } from "../server/bonjourPublisher.js";

describe("bonjour publisher", () => {
  it("builds the _code._tcp publication with mobile discovery TXT fields", () => {
    const publication = buildBonjourPublication({
      name: "Yongzhe Mac",
      port: 37631,
      macId: "local-mac",
      tlsFingerprint: "abc123",
      tlsPublicKeyHash: "spki123"
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
        tlsPublicKeyHash: "spki123"
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
      tlsPublicKeyHash: "spki123"
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
        tlsPublicKeyHash: "spki123"
      }
    });
    expect(start).toHaveBeenCalledTimes(1);

    await publication.stop();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
