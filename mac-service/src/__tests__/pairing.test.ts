import { describe, expect, it } from "vitest";
import { createPairingService, type PairedDevice, type PairingDeviceStore } from "../security/pairing.js";

describe("pairing service", () => {
  it("claims a pairing code once and rejects reuse", () => {
    const service = createPairingService();
    const code = service.createPairingCode("MacBook Pro");
    const claimed = service.claimPairingCode(code.value, "Mate 60 Pro");

    expect(claimed.device.deviceName).toBe("Mate 60 Pro");
    expect(claimed.authToken.length).toBeGreaterThan(24);
    expect(() => service.claimPairingCode(code.value, "MatePad")).toThrow("配对码无效或已过期");
  });

  it("creates a scan payload from the same one-time pairing ticket", () => {
    const service = createPairingService();
    const code = service.createPairingCode("MacBook Pro");

    expect(code.value.length).toBeGreaterThan(6);
    expect(code.macName).toBe("MacBook Pro");
    expect(code.expiresAt).toBeGreaterThan(Date.now());
  });

  it("revokes a paired device token", () => {
    const service = createPairingService();
    const code = service.createPairingCode("MacBook Pro");
    const claimed = service.claimPairingCode(code.value, "Mate 60 Pro");

    expect(service.validateToken(claimed.authToken)).toBeTruthy();
    expect(service.isDeviceActive(claimed.device.id)).toBe(true);
    service.revokeDevice(claimed.device.id);
    expect(service.validateToken(claimed.authToken)).toBeNull();
    expect(service.isDeviceActive(claimed.device.id)).toBe(false);
  });

  it("restores paired devices from persistent storage", () => {
    const savedDevices: PairedDevice[] = [];
    const store: PairingDeviceStore = {
      saveDevice(device) {
        savedDevices.push(device);
      },
      revokeDevice(id) {
        const device = savedDevices.find((item) => item.id === id);
        if (device) device.revokedAt = new Date().toISOString();
      },
      listDevices() {
        return savedDevices;
      }
    };

    const service = createPairingService(store);
    const code = service.createPairingCode("MacBook Pro");
    const claimed = service.claimPairingCode(code.value, "Mate 60 Pro");
    const reloaded = createPairingService(store);

    expect(reloaded.validateToken(claimed.authToken)?.id).toBe(claimed.device.id);
    expect(Date.parse(claimed.device.expiresAt)).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });
});
