import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCodexAppServerConnectionFromConfig } from "../codex/codexAppServer.js";
import { detectCodexCli, findCodexBinary } from "../codex/codexBinary.js";

describe("findCodexBinary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("prefers explicit CODEX_BIN", () => {
    const result = findCodexBinary({
      env: { CODEX_BIN: "/tmp/codex" },
      exists: (filePath) => filePath === "/tmp/codex"
    });

    expect(result).toEqual({ ok: true, path: "/tmp/codex" });
  });

  it("uses CODEX_BIN before injected candidates", () => {
    const result = findCodexBinary({
      env: { CODEX_BIN: "/tmp/codex" },
      candidates: ["codex.exe", "codex.cmd", "codex"],
      exists: (filePath) => filePath === "/tmp/codex" || filePath === "codex.cmd"
    });

    expect(result).toEqual({ ok: true, path: "/tmp/codex" });
  });

  it("uses Windows Codex command candidates after CODEX_BIN", () => {
    const result = findCodexBinary({
      env: {},
      candidates: ["codex.exe", "codex.cmd", "codex"],
      exists: (filePath) => filePath === "codex.cmd"
    });

    expect(result).toEqual({ ok: true, path: "codex.cmd" });
  });

  it("resolves Windows command candidates from PATH", () => {
    const result = findCodexBinary({
      env: {
        PATH: "/Users/demo/AppData/Roaming/npm",
        PATHEXT: ".EXE;.CMD"
      },
      candidates: ["codex.exe", "codex.cmd", "codex"],
      exists: (filePath) => filePath === path.join("/Users/demo/AppData/Roaming/npm", "codex.cmd")
    });

    expect(result).toEqual({
      ok: true,
      path: path.join("/Users/demo/AppData/Roaming/npm", "codex.cmd")
    });
  });

  it("keeps existing macOS default candidates", () => {
    const result = findCodexBinary({
      env: {},
      exists: (filePath) => filePath === "/opt/homebrew/bin/codex"
    });

    expect(result).toEqual({ ok: true, path: "/opt/homebrew/bin/codex" });
  });

  it("uses platform-neutral install guidance when Codex is unavailable", () => {
    const result = findCodexBinary({ env: {}, exists: () => false });
    expect(result).toEqual({ ok: false, error: "未发现 Codex，请在桌面端安装 Codex 或配置 CODEX_BIN" });
  });

  it("finds LOCALAPPDATA Codex bin candidates on Windows", () => {
    const localCodex = "C:\\Users\\demo\\AppData\\Local\\OpenAI\\Codex\\bin\\abc123\\codex.exe";
    const result = findCodexBinary({
      env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
      platform: "win32",
      exists: (filePath) => filePath === localCodex,
      readdir: () => ["abc123"]
    });

    expect(result).toEqual({ ok: true, path: localCodex });
  });

  it("uses platform-neutral install guidance from app-server config discovery", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    await expect(createCodexAppServerConnectionFromConfig({})).rejects.toThrow(
      "未发现 Codex，请在桌面端安装 Codex 或配置 CODEX_BIN"
    );
  });

  it("uses app-server config candidates instead of hardcoded macOS paths", async () => {
    vi.stubEnv("PATH", "");
    vi.spyOn(fs, "existsSync").mockImplementation((filePath) =>
      filePath === "/Applications/Codex.app/Contents/Resources/codex"
    );

    await expect(createCodexAppServerConnectionFromConfig({
      codexCandidates: ["codex.exe", "codex.cmd", "codex"]
    })).rejects.toThrow("未发现 Codex，请在桌面端安装 Codex 或配置 CODEX_BIN");
  });

  it("detects app-server and remote-control help capabilities through injected candidates", async () => {
    const calls: Array<{ bin: string; args: string[] }> = [];
    const detected = await detectCodexCli({
      env: {},
      candidates: ["codex.exe", "codex.cmd", "codex"],
      exists: (filePath) => filePath === "codex.cmd",
      run: async (bin, args) => {
        calls.push({ bin, args });
        return {
          stdout: args[0] === "--version"
          ? "codex-cli 0.130.0-alpha.5"
          : "Usage: codex app-server\n--listen <URL>\n--ws-auth capability-token|signed-bearer-token\nstdio:// unix:// remote-control",
          stderr: ""
        };
      }
    });

    expect(detected).toMatchObject({
      ok: true,
      path: "codex.cmd",
      version: "codex-cli 0.130.0-alpha.5",
      appServerAvailable: true,
      remoteControlAvailable: true,
      supportsUnixSocket: true,
      supportsStdio: true,
      supportsWsAuth: true
    });
    expect(calls).toEqual([
      { bin: "codex.cmd", args: ["--version"] },
      { bin: "codex.cmd", args: ["app-server", "--help"] },
      { bin: "codex.cmd", args: ["remote-control", "--help"] }
    ]);
  });

  it("skips inaccessible WindowsApps Codex candidates and uses LOCALAPPDATA Codex bin", async () => {
    const windowsApps = "C:\\Program Files\\WindowsApps\\codex.exe";
    const localCodex = "C:\\Users\\demo\\AppData\\Local\\OpenAI\\Codex\\bin\\abc123\\codex.exe";
    const calls: string[] = [];

    const result = await detectCodexCli({
      env: {
        LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
        PATH: "C:\\Program Files\\WindowsApps",
        PATHEXT: ".EXE;.CMD"
      },
      platform: "win32",
      exists: (filePath) => filePath === windowsApps || filePath === localCodex,
      readdir: (dirPath) => dirPath.endsWith("\\OpenAI\\Codex\\bin") ? ["abc123"] : [],
      run: async (bin, args) => {
        calls.push(`${bin} ${args.join(" ")}`);
        if (bin === windowsApps) {
          throw Object.assign(new Error("Access is denied"), { code: "EACCES" });
        }
        if (args.join(" ") === "--version") {
          return { stdout: "codex-cli 0.135.0-alpha.1", stderr: "" };
        }
        if (args.join(" ") === "app-server --help") {
          return { stdout: "Usage: codex app-server\n--listen <URL>\nstdio:// unix:// ws://\n--ws-auth", stderr: "" };
        }
        if (args.join(" ") === "remote-control --help") {
          return { stdout: "Usage: codex remote-control", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(localCodex);
      expect(result.appServerAvailable).toBe(true);
      expect(result.supportsStdio).toBe(true);
    }
    expect(calls[0]).toContain("WindowsApps");
    expect(calls.some((call) => call.includes("abc123"))).toBe(true);
  });

  it("tries newer LOCALAPPDATA Codex bin directories first", async () => {
    const oldCodex = "C:\\Users\\demo\\AppData\\Local\\OpenAI\\Codex\\bin\\aaa111\\codex.exe";
    const newCodex = "C:\\Users\\demo\\AppData\\Local\\OpenAI\\Codex\\bin\\zzz999\\codex.exe";
    const calls: string[] = [];

    const result = await detectCodexCli({
      env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
      platform: "win32",
      exists: (filePath) => filePath === oldCodex || filePath === newCodex,
      readdir: () => ["aaa111", "zzz999"],
      run: async (bin, args) => {
        calls.push(`${bin} ${args.join(" ")}`);
        if (args[0] === "--version") return { stdout: "codex-cli 0.135.0-alpha.1", stderr: "" };
        return { stdout: "Usage: codex app-server\n--listen <URL>\nstdio://", stderr: "Usage: codex remote-control" };
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe(newCodex);
    }
    expect(calls[0]).toContain("zzz999");
  });

  it("reports explicit CODEX_BIN execution failure without falling through silently", async () => {
    const explicit = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26\\app\\resources\\codex.exe";
    const result = await detectCodexCli({
      env: { CODEX_BIN: explicit },
      platform: "win32",
      exists: (filePath) => filePath === explicit,
      run: async () => {
        throw Object.assign(new Error("Access is denied"), { code: "EACCES" });
      }
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("CODEX_BIN");
      expect(result.error).toContain(explicit);
      expect(result.error).toContain("Access is denied");
    }
  });

  it("handles missing stdout and stderr from command runners", async () => {
    const result = await detectCodexCli({
      env: { CODEX_BIN: "/tmp/codex" },
      exists: () => true,
      run: async (_bin, args) => {
        if (args[0] === "--version") return {};
        return { stdout: "", stderr: "" };
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe("");
    }
  });
});
