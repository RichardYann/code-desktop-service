import fs from "node:fs";
import os from "node:os";
import type { ServiceConfig } from "../config.js";
import type { CaptureRunner } from "../domain/captureService.js";
import { createDarwinPlatform } from "./darwinPlatform.js";
import { createWindowsPlatform } from "./windowsPlatform.js";

export type DesktopPlatformKind = "darwin" | "win32" | NodeJS.Platform;

export interface DesktopPlatformInput {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  hostname?: () => string;
  exists?: (filePath: string) => boolean;
}

export interface DesktopPlatformDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  hostname: () => string;
  exists: (filePath: string) => boolean;
}

export interface DesktopStartupStatus {
  supported: boolean;
  enabled: boolean;
  label: string;
  path: string;
  message: string;
}

export interface DesktopStartupService {
  status(): Promise<DesktopStartupStatus>;
  setEnabled(enabled: boolean): Promise<DesktopStartupStatus>;
}

export interface DesktopPlatform {
  kind: DesktopPlatformKind;
  defaultDataDir(): string;
  defaultStartupDir(): string;
  defaultCodexBinaryCandidates(): string[];
  resolveDisplayName(): string;
  createStartupService(options: {
    startupDir: string;
    serviceRoot: string;
    nodePath: string;
    startupCommand: string;
    config: ServiceConfig;
  }): DesktopStartupService;
  createCaptureRunner(): CaptureRunner | undefined;
}

export function createDesktopPlatform(input: DesktopPlatformInput = {}): DesktopPlatform {
  const deps: DesktopPlatformDeps = {
    platform: input.platform ?? process.platform,
    env: input.env ?? process.env,
    homedir: input.homedir ?? os.homedir,
    hostname: input.hostname ?? os.hostname,
    exists: input.exists ?? fs.existsSync
  };

  if (deps.platform === "win32") {
    return createWindowsPlatform(deps);
  }
  return createDarwinPlatform(deps);
}
