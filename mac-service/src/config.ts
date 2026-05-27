import path from "node:path";
import { createDesktopPlatform, type DesktopPlatform } from "./platform/desktopPlatform.js";

export interface ServiceConfig {
  host: string;
  port: number;
  dataDir: string;
  codexBin: string | undefined;
  codexCandidates?: string[];
  codexIpcSocketPath?: string;
  projectRoots: string[];
  launchAgentDir: string;
  startupCommand: string;
}

export interface LoadConfigInput {
  env?: NodeJS.ProcessEnv;
  platform?: Pick<DesktopPlatform, "defaultDataDir" | "defaultStartupDir" | "defaultCodexBinaryCandidates">;
}

function parseProjectRoots(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));
}

export function loadConfig(input: LoadConfigInput = {}): ServiceConfig {
  const env = input.env ?? process.env;
  const platform = input.platform ?? createDesktopPlatform({ env });

  return {
    host: env.CODE_HOST ?? "0.0.0.0",
    port: Number(env.CODE_PORT ?? "37631"),
    dataDir: env.CODE_DATA_DIR ?? platform.defaultDataDir(),
    codexBin: env.CODEX_BIN,
    codexCandidates: platform.defaultCodexBinaryCandidates(),
    codexIpcSocketPath: env.CODEX_IPC_SOCKET,
    projectRoots: parseProjectRoots(env.CODE_PROJECT_ROOTS),
    launchAgentDir: env.CODE_LAUNCH_AGENT_DIR ?? platform.defaultStartupDir(),
    startupCommand: env.CODE_STARTUP_COMMAND ?? "pnpm dev"
  };
}
