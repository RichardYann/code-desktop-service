import { execa } from "execa";
import fs from "node:fs";
import path from "node:path";

export interface FindCodexInput {
  env?: NodeJS.ProcessEnv;
  exists?: (filePath: string) => boolean;
  candidates?: string[];
}

export type FindCodexResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

function hasPathSeparator(candidate: string): boolean {
  return candidate.includes("/") || candidate.includes("\\");
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const rawPath = env.PATH ?? env.Path ?? env.path ?? "";
  const delimiter = rawPath.includes(";") ? ";" : path.delimiter;
  return rawPath.split(delimiter).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function commandExtensions(candidate: string, env: NodeJS.ProcessEnv): string[] {
  if (path.extname(candidate).length > 0) return [""];
  const rawExt = env.PATHEXT ?? env.PathExt ?? ".EXE;.CMD;.BAT;.COM";
  const extensions = rawExt.split(";").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return ["", ...extensions];
}

function resolveCandidate(candidate: string, env: NodeJS.ProcessEnv, exists: (filePath: string) => boolean): string | null {
  if (exists(candidate)) return candidate;
  if (path.isAbsolute(candidate) || hasPathSeparator(candidate)) return null;

  for (const entry of pathEntries(env)) {
    for (const extension of commandExtensions(candidate, env)) {
      const resolved = path.join(entry, `${candidate}${extension}`);
      if (exists(resolved)) return resolved;
    }
  }
  return null;
}

export function findCodexBinary(input: FindCodexInput = {}): FindCodexResult {
  const env = input.env ?? process.env;
  const exists = input.exists ?? fs.existsSync;
  const candidates = [
    env.CODEX_BIN,
    ...(input.candidates ?? [
      "/Applications/Codex.app/Contents/Resources/codex",
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex"
    ])
  ].filter((item): item is string => Boolean(item));

  const found = candidates
    .map((candidate) => resolveCandidate(candidate, env, exists))
    .find((candidate): candidate is string => Boolean(candidate));
  if (found) {
    return { ok: true, path: found };
  }

  return { ok: false, error: "未发现 Codex，请在桌面端安装 Codex 或配置 CODEX_BIN" };
}

export interface DetectCodexCliInput extends FindCodexInput {
  run?: (bin: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
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

export async function detectCodexCli(input: DetectCodexCliInput = {}): Promise<DetectCodexCliResult> {
  const run = input.run ?? (async (bin: string, args: string[]) => {
    const result = await execa(bin, args, { reject: false });
    return { stdout: result.stdout, stderr: result.stderr };
  });
  const found = findCodexBinary(input);
  if (!found.ok) {
    return { ok: false, error: found.error };
  }

  const version = await run(found.path, ["--version"]);
  const appServer = await run(found.path, ["app-server", "--help"]);
  const remoteControl = await run(found.path, ["remote-control", "--help"]);
  const appServerHelp = `${appServer.stdout}\n${appServer.stderr}`;
  const remoteControlHelp = `${remoteControl.stdout}\n${remoteControl.stderr}`;

  return {
    ok: true,
    path: found.path,
    version: version.stdout.trim() || version.stderr.trim(),
    appServerAvailable: appServerHelp.includes("Usage: codex app-server") && appServerHelp.includes("--listen <URL>"),
    remoteControlAvailable: remoteControlHelp.includes("remote-control") || remoteControlHelp.includes("headless app-server"),
    supportsUnixSocket: appServerHelp.includes("unix://"),
    supportsStdio: appServerHelp.includes("stdio://"),
    supportsWsAuth: appServerHelp.includes("--ws-auth")
  };
}
