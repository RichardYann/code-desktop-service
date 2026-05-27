import path from "node:path";
import { createMacOsCaptureRunner } from "../domain/macOsCaptureRunner.js";
import { createStartupLaunchAgentService } from "../system/startupLaunchAgent.js";
import type {
  DesktopPlatform,
  DesktopPlatformDeps,
  DesktopStartupService,
  DesktopStartupStatus
} from "./desktopPlatform.js";

function cleanName(value: string): string {
  return value.trim();
}

function adaptStartupService(service: ReturnType<typeof createStartupLaunchAgentService>): DesktopStartupService {
  return {
    async status(): Promise<DesktopStartupStatus> {
      const status = await service.status();
      return {
        supported: status.supported,
        enabled: status.enabled,
        label: status.label,
        path: status.plistPath,
        message: status.message ?? ""
      };
    },
    async setEnabled(enabled: boolean): Promise<DesktopStartupStatus> {
      const status = await service.setEnabled(enabled);
      return {
        supported: status.supported,
        enabled: status.enabled,
        label: status.label,
        path: status.plistPath,
        message: status.message ?? ""
      };
    }
  };
}

export function createDarwinPlatform(deps: DesktopPlatformDeps): DesktopPlatform {
  return {
    kind: "darwin",
    defaultDataDir: () => path.join(deps.homedir(), "Library", "Application Support", "code"),
    defaultStartupDir: () => path.join(deps.homedir(), "Library", "LaunchAgents"),
    defaultCodexBinaryCandidates: () => [
      "/Applications/Codex.app/Contents/Resources/codex",
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex"
    ],
    resolveDisplayName: () => cleanName(deps.hostname()) || "Mac",
    createStartupService: (options) => adaptStartupService(createStartupLaunchAgentService({
      launchAgentDir: options.startupDir,
      serviceRoot: options.serviceRoot,
      nodePath: options.nodePath,
      startupCommand: options.startupCommand,
      config: {
        ...options.config,
        launchAgentDir: options.startupDir,
        startupCommand: options.startupCommand
      }
    })),
    createCaptureRunner: () => createMacOsCaptureRunner()
  };
}
