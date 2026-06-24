import path from "node:path";
import type {
  DesktopPlatform,
  DesktopPlatformDeps,
  DesktopStartupStatus
} from "./desktopPlatform.js";

const STARTUP_LABEL = "Linux user service";
const CODEX_COMMAND_CANDIDATES = ["codex", "/usr/local/bin/codex", "/usr/bin/codex"];

function cleanName(value: string | undefined): string {
  return (value ?? "").trim();
}

function linuxDataRoot(deps: DesktopPlatformDeps): string {
  return cleanName(deps.env.XDG_DATA_HOME) || path.join(deps.homedir(), ".local", "share");
}

function startupStatus(startupDir: string): DesktopStartupStatus {
  return {
    supported: false,
    enabled: false,
    label: STARTUP_LABEL,
    path: startupDir,
    message: "Linux 用户级自启动尚未接入，请先手动启动桌面服务。"
  };
}

export function createLinuxPlatform(deps: DesktopPlatformDeps): DesktopPlatform {
  return {
    kind: "linux",
    defaultDataDir: () => path.join(linuxDataRoot(deps), "code-desktop-service"),
    defaultStartupDir: () => path.join(linuxDataRoot(deps), "systemd", "user"),
    defaultCodexBinaryCandidates: () => [...CODEX_COMMAND_CANDIDATES],
    resolveDisplayName: () => cleanName(deps.env.XDG_CURRENT_DESKTOP) || cleanName(deps.hostname()) || "Linux PC",
    createStartupService: (options) => ({
      status: async () => startupStatus(options.startupDir),
      setEnabled: async () => startupStatus(options.startupDir)
    }),
    createCaptureRunner: () => undefined
  };
}
