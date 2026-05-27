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
});
