import path from "node:path";
import type {
  DesktopPlatform,
  DesktopPlatformDeps,
  DesktopStartupStatus
} from "./desktopPlatform.js";

const STARTUP_LABEL = "Windows user Startup folder";
const CODEX_COMMAND_CANDIDATES = ["codex.exe", "codex.cmd", "codex"];

function cleanName(value: string | undefined): string {
  return (value ?? "").trim();
}

function windowsDataRoot(deps: DesktopPlatformDeps): string {
  return cleanName(deps.env.APPDATA) || cleanName(deps.env.LOCALAPPDATA) || path.win32.join(deps.homedir(), "AppData", "Roaming");
}

function startupStatus(startupDir: string): DesktopStartupStatus {
  return {
    supported: false,
    enabled: false,
    label: STARTUP_LABEL,
    path: startupDir,
    message: "Windows 用户级 Startup 文件夹自启动尚未启用。"
  };
}

export function createWindowsPlatform(deps: DesktopPlatformDeps): DesktopPlatform {
  return {
    kind: "win32",
    defaultDataDir: () => path.win32.join(windowsDataRoot(deps), "code"),
    defaultStartupDir: () => path.win32.join(
      windowsDataRoot(deps),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup"
    ),
    defaultCodexBinaryCandidates: () => [...CODEX_COMMAND_CANDIDATES],
    resolveDisplayName: () => cleanName(deps.env.COMPUTERNAME) || cleanName(deps.hostname()) || "Windows PC",
    createStartupService: (options) => ({
      status: async () => startupStatus(options.startupDir),
      setEnabled: async () => startupStatus(options.startupDir)
    }),
    createCaptureRunner: () => undefined
  };
}
