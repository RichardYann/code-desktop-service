import fs from "node:fs/promises";
import path from "node:path";
import type { ServiceConfig } from "../config.js";

const LAUNCH_AGENT_LABEL = "com.lyz1022.code.mac-service";

export interface StartupLaunchAgentOptions {
  launchAgentDir: string;
  serviceRoot: string;
  nodePath: string;
  startupCommand: string;
  config: ServiceConfig;
}

export interface StartupLaunchAgentStatus {
  supported: boolean;
  enabled: boolean;
  label: string;
  plistPath: string;
  message?: string;
}

function plistPath(launchAgentDir: string): string {
  return path.join(launchAgentDir, `${LAUNCH_AGENT_LABEL}.plist`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function envAssignment(name: string, value: string): string {
  return `${name}=${shellQuote(value)}`;
}

function startupShellCommand(options: StartupLaunchAgentOptions): string {
  const { config } = options;
  const env = [
    envAssignment("CODE_HOST", config.host),
    envAssignment("CODE_PORT", String(config.port)),
    envAssignment("CODE_DATA_DIR", config.dataDir),
    envAssignment("CODE_PROJECT_ROOTS", config.projectRoots.join(",")),
    envAssignment("CODE_LAUNCH_AGENT_DIR", options.launchAgentDir),
    envAssignment("CODE_STARTUP_COMMAND", options.startupCommand),
    envAssignment("CODE_NODE_PATH", options.nodePath)
  ];

  if (config.codexBin) {
    env.push(envAssignment("CODEX_BIN", config.codexBin));
  }
  if (config.codexIpcSocketPath) {
    env.push(envAssignment("CODEX_IPC_SOCKET", config.codexIpcSocketPath));
  }

  return `cd ${shellQuote(options.serviceRoot)} && exec env ${env.join(" ")} ${options.startupCommand}`;
}

function launchAgentPlist(options: StartupLaunchAgentOptions): string {
  const logsDir = path.join(options.config.dataDir, "logs");
  const command = startupShellCommand(options);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(LAUNCH_AGENT_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(options.serviceRoot)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logsDir, "mac-service-startup.out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logsDir, "mac-service-startup.err.log"))}</string>
</dict>
</plist>
`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function createStartupLaunchAgentService(options: StartupLaunchAgentOptions) {
  const currentPlistPath = plistPath(options.launchAgentDir);

  async function status(): Promise<StartupLaunchAgentStatus> {
    return {
      supported: true,
      enabled: await fileExists(currentPlistPath),
      label: LAUNCH_AGENT_LABEL,
      plistPath: currentPlistPath,
      message: "使用用户级 LaunchAgent，开机登录后自启动。"
    };
  }

  async function setEnabled(enabled: boolean): Promise<StartupLaunchAgentStatus> {
    if (enabled) {
      await fs.mkdir(options.launchAgentDir, { recursive: true });
      await fs.mkdir(path.join(options.config.dataDir, "logs"), { recursive: true });
      await fs.writeFile(currentPlistPath, launchAgentPlist(options), "utf8");
      return {
        supported: true,
        enabled: true,
        label: LAUNCH_AGENT_LABEL,
        plistPath: currentPlistPath,
        message: "已写入用户级 LaunchAgent，开机登录后自启动。"
      };
    }

    try {
      await fs.unlink(currentPlistPath);
    } catch (error) {
      if (!error || typeof error !== "object" || (error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    return {
      supported: true,
      enabled: false,
      label: LAUNCH_AGENT_LABEL,
      plistPath: currentPlistPath,
      message: "已关闭开机登录后自启动。"
    };
  }

  return {
    status,
    setEnabled
  };
}
