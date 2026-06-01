import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";

export interface FindCodexInput {
  env?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => boolean;
  readdir?: (dirPath: string) => string[];
  candidates?: string[];
  platform?: NodeJS.Platform;
}

export type FindCodexResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

function hasPathSeparator(candidate: string): boolean {
  return candidate.includes("/") || candidate.includes("\\");
}

function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const rawPath = env.PATH ?? env.Path ?? env.path ?? "";
  const delimiter = platform === "win32" || rawPath.includes(";") ? ";" : path.delimiter;
  return rawPath.split(delimiter).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function commandExtensions(candidate: string, env: NodeJS.ProcessEnv): string[] {
  if (path.extname(candidate).length > 0) return [""];
  const rawExt = env.PATHEXT ?? env.PathExt ?? ".EXE;.CMD;.BAT;.COM";
  const extensions = rawExt.split(";").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return ["", ...extensions];
}

function joinPath(basePath: string, childPath: string, platform: NodeJS.Platform): string {
  return platform === "win32" || basePath.includes("\\")
    ? path.win32.join(basePath, childPath)
    : path.join(basePath, childPath);
}

function defaultCandidates(platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    return ["codex.exe", "codex.cmd", "codex"];
  }
  return [
    "/Applications/Codex.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ];
}

function shouldScanWindowsLocalAppData(input: FindCodexInput, platform: NodeJS.Platform): boolean {
  const localAppData = input.env?.LOCALAPPDATA ?? input.env?.LocalAppData;
  return platform === "win32" || Boolean(localAppData?.includes("\\"));
}

function windowsLocalAppDataCandidates(input: FindCodexInput, platform: NodeJS.Platform): string[] {
  if (!shouldScanWindowsLocalAppData(input, platform)) return [];
  const env = input.env ?? process.env;
  const localAppData = env.LOCALAPPDATA ?? env.LocalAppData;
  if (!localAppData) return [];

  const readdir = input.readdir ?? fs.readdirSync;
  const binDir = path.win32.join(localAppData, "OpenAI", "Codex", "bin");
  let versions: string[];
  try {
    versions = readdir(binDir);
  } catch {
    return [];
  }

  return versions
    .filter((entry) => entry.trim().length > 0)
    .sort((a, b) => b.localeCompare(a))
    .map((entry) => path.win32.join(binDir, entry, "codex.exe"));
}

function candidateList(input: FindCodexInput, includeExplicit: boolean): string[] {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const candidates = input.candidates ?? defaultCandidates(platform);
  return [
    ...(includeExplicit ? [env.CODEX_BIN] : []),
    ...candidates,
    ...windowsLocalAppDataCandidates(input, platform)
  ].filter((item): item is string => Boolean(item));
}

function resolveCandidate(candidate: string, env: NodeJS.ProcessEnv, exists: (filePath: string) => boolean, platform: NodeJS.Platform): string | null {
  if (exists(candidate)) return candidate;
  if (path.isAbsolute(candidate) || hasPathSeparator(candidate)) return null;

  for (const entry of pathEntries(env, platform)) {
    for (const extension of commandExtensions(candidate, env)) {
      const resolved = joinPath(entry, `${candidate}${extension}`, platform);
      if (exists(resolved)) return resolved;
    }
  }
  return null;
}

export function findCodexBinary(input: FindCodexInput = {}): FindCodexResult {
  const env = input.env ?? process.env;
  const exists = input.exists ?? fs.existsSync;
  const platform = input.platform ?? process.platform;

  if (env.CODEX_BIN) {
    const explicit = resolveCandidate(env.CODEX_BIN, env, exists, platform);
    if (explicit) {
      return { ok: true, path: explicit };
    }
    return { ok: false, error: `CODEX_BIN=${env.CODEX_BIN} 不存在或不可访问` };
  }

  const found = candidateList(input, false)
    .map((candidate) => resolveCandidate(candidate, env, exists, platform))
    .find((candidate): candidate is string => Boolean(candidate));
  if (found) {
    return { ok: true, path: found };
  }

  return { ok: false, error: "未发现 Codex，请在桌面端安装 Codex 或配置 CODEX_BIN" };
}

export interface DetectCodexCliInput extends FindCodexInput {
  run?: (bin: string, args: string[]) => Promise<{ stdout?: string; stderr?: string }>;
}

export type DetectCodexCliResult =
  | {
      ok: true;
      path: string;
      version: string;
      appServerAvailable: boolean;
      remoteControlAvailable: boolean;
      supportsUnixSocket: boolean;
      supportsStdio: boolean;
      supportsWsAuth: boolean;
    }
  | { ok: false; error: string };

function outputText(output: { stdout?: string; stderr?: string }): { stdout: string; stderr: string } {
  return {
    stdout: output.stdout ?? "",
    stderr: output.stderr ?? ""
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAccessDeniedError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const message = errorText(error);
  return code === "EACCES" || code === "EPERM" || message.includes("Access is denied");
}

async function validateCodexCli(
  bin: string,
  run: (bin: string, args: string[]) => Promise<{ stdout?: string; stderr?: string }>
): Promise<Extract<DetectCodexCliResult, { ok: true }>> {
  const version = outputText(await run(bin, ["--version"]));
  const appServer = outputText(await run(bin, ["app-server", "--help"]));
  const remoteControl = outputText(await run(bin, ["remote-control", "--help"]));
  const appServerHelp = `${appServer.stdout}\n${appServer.stderr}`;
  const remoteControlHelp = `${remoteControl.stdout}\n${remoteControl.stderr}`;

  return {
    ok: true,
    path: bin,
    version: version.stdout.trim() || version.stderr.trim(),
    appServerAvailable: appServerHelp.includes("Usage: codex app-server") && appServerHelp.includes("--listen <URL>"),
    remoteControlAvailable: remoteControlHelp.includes("remote-control") || remoteControlHelp.includes("headless app-server"),
    supportsUnixSocket: appServerHelp.includes("unix://"),
    supportsStdio: appServerHelp.includes("stdio://"),
    supportsWsAuth: appServerHelp.includes("--ws-auth")
  };
}

export async function detectCodexCli(input: DetectCodexCliInput = {}): Promise<DetectCodexCliResult> {
  const run = input.run ?? (async (bin: string, args: string[]) => {
    const result = await execa(bin, args, { reject: false });
    return { stdout: result.stdout, stderr: result.stderr };
  });
  const env = input.env ?? process.env;
  const exists = input.exists ?? fs.existsSync;
  const platform = input.platform ?? process.platform;

  if (env.CODEX_BIN) {
    const explicit = resolveCandidate(env.CODEX_BIN, env, exists, platform);
    if (!explicit) {
      return { ok: false, error: `CODEX_BIN=${env.CODEX_BIN} 不存在或不可访问` };
    }
    try {
      return await validateCodexCli(explicit, run);
    } catch (error) {
      return { ok: false, error: `CODEX_BIN=${explicit} 验证失败：${errorText(error)}` };
    }
  }

  const failures: string[] = [];
  const tried = new Set<string>();

  for (const candidate of candidateList(input, false)) {
    const resolved = resolveCandidate(candidate, env, exists, platform);
    if (!resolved || tried.has(resolved)) continue;
    tried.add(resolved);

    try {
      return await validateCodexCli(resolved, run);
    } catch (error) {
      const message = `${resolved}: ${errorText(error)}`;
      failures.push(message);
      if (isAccessDeniedError(error)) continue;
    }
  }

  return {
    ok: false,
    error: failures[0] ?? "未发现 Codex，请在桌面端安装 Codex 或配置 CODEX_BIN"
  };
}
