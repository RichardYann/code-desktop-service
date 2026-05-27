import crypto from "node:crypto";
import { nanoid } from "nanoid";

export interface PairingCode {
  value: string;
  macName: string;
  expiresAt: number;
  claimed: boolean;
}

export interface PairedDevice {
  id: string;
  deviceName: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface PairingDeviceStore {
  saveDevice(device: PairedDevice): void;
  revokeDevice(id: string): void;
  listDevices(): PairedDevice[];
}

const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function pairedDeviceIsActive(device: PairedDevice, nowMs: number): boolean {
  return !device.revokedAt && Date.parse(device.expiresAt) > nowMs;
}

function normalizeDeviceName(deviceName: string): string {
  return deviceName.trim().toLocaleLowerCase();
}

function getCreatedTime(device: PairedDevice): number {
  const createdTime = Date.parse(device.createdAt);
  if (Number.isNaN(createdTime)) {
    return 0;
  }
  return createdTime;
}

function revokeDuplicateDevice(device: PairedDevice, revokedAt: string, store: PairingDeviceStore | undefined): void {
  device.revokedAt = revokedAt;
  store?.saveDevice(device);
}

function revokeLoadedDuplicateDevices(devices: Map<string, PairedDevice>, store: PairingDeviceStore | undefined): void {
  const latestByName = new Map<string, PairedDevice>();
  const nowMs = Date.now();
  for (const device of devices.values()) {
    if (!pairedDeviceIsActive(device, nowMs)) {
      continue;
    }
    const deviceName = normalizeDeviceName(device.deviceName);
    const latest = latestByName.get(deviceName);
    if (!latest || getCreatedTime(device) > getCreatedTime(latest)) {
      latestByName.set(deviceName, device);
    }
  }

  const revokedAt = new Date().toISOString();
  for (const device of devices.values()) {
    if (!pairedDeviceIsActive(device, nowMs)) {
      continue;
    }
    const latest = latestByName.get(normalizeDeviceName(device.deviceName));
    if (latest && latest.id !== device.id) {
      revokeDuplicateDevice(device, revokedAt, store);
    }
  }
}

function revokeActiveDevicesWithSameName(
  devices: Map<string, PairedDevice>,
  deviceName: string,
  revokedAt: string,
  store: PairingDeviceStore | undefined
): string[] {
  const replacedDeviceIds: string[] = [];
  const normalizedDeviceName = normalizeDeviceName(deviceName);
  const nowMs = Date.now();
  for (const device of devices.values()) {
    if (normalizeDeviceName(device.deviceName) === normalizedDeviceName && pairedDeviceIsActive(device, nowMs)) {
      revokeDuplicateDevice(device, revokedAt, store);
      replacedDeviceIds.push(device.id);
    }
  }
  return replacedDeviceIds;
}

export function createPairingService(store?: PairingDeviceStore) {
  const codes = new Map<string, PairingCode>();
  const devices = new Map<string, PairedDevice>();
  for (const device of store?.listDevices() ?? []) {
    devices.set(device.id, device);
  }
  revokeLoadedDuplicateDevices(devices, store);

  return {
    createPairingCode(macName: string): PairingCode {
      const code: PairingCode = {
        value: nanoid(10),
        macName,
        expiresAt: Date.now() + 5 * 60 * 1000,
        claimed: false
      };
      codes.set(code.value, code);
      return code;
    },

    claimPairingCode(value: string, deviceName: string) {
      const code = codes.get(value);
      if (!code || code.claimed || code.expiresAt < Date.now()) {
        throw new Error("配对码无效或已过期");
      }

      code.claimed = true;
      const authToken = nanoid(48);
      const now = new Date();
      const replacedDeviceIds = revokeActiveDevicesWithSameName(devices, deviceName, now.toISOString(), store);
      const device: PairedDevice = {
        id: nanoid(16),
        deviceName,
        tokenHash: hashToken(authToken),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + DEVICE_TOKEN_TTL_MS).toISOString(),
        revokedAt: null
      };
      devices.set(device.id, device);
      store?.saveDevice(device);
      return { device, authToken, macName: code.macName, replacedDeviceIds };
    },

    validateToken(token: string): PairedDevice | null {
      const tokenHash = hashToken(token);
      return [...devices.values()].find((device) => device.tokenHash === tokenHash && pairedDeviceIsActive(device, Date.now())) ?? null;
    },

    isDeviceActive(deviceId: string): boolean {
      const device = devices.get(deviceId);
      return device !== undefined && pairedDeviceIsActive(device, Date.now());
    },

    revokeDevice(deviceId: string): void {
      const device = devices.get(deviceId);
      if (device) {
        device.revokedAt = new Date().toISOString();
        store?.revokeDevice(deviceId);
      }
    },

    listDevices(): PairedDevice[] {
      return [...devices.values()];
    }
  };
}

export type PairingService = ReturnType<typeof createPairingService>;
