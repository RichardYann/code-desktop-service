import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAppContext } from "../appContext.js";
import { loadConfig } from "../config.js";
import { createDesktopPlatform } from "../platform/desktopPlatform.js";

describe("desktop platform", () => {
  it("keeps darwin defaults compatible with the existing Mac service", () => {
    const platform = createDesktopPlatform({
      platform: "darwin",
      env: {},
      homedir: () => "/Users/demo",
      hostname: () => "demo-host",
      exists: () => false
    });

    expect(platform.kind).toBe("darwin");
    expect(platform.defaultDataDir()).toBe("/Users/demo/Library/Application Support/code");
    expect(platform.defaultStartupDir()).toBe("/Users/demo/Library/LaunchAgents");
    expect(platform.defaultCodexBinaryCandidates()).toContain("/Applications/Codex.app/Contents/Resources/codex");
    expect(platform.defaultCodexBinaryCandidates()).toContain("/opt/homebrew/bin/codex");
    expect(platform.defaultCodexBinaryCandidates()).toContain("/usr/local/bin/codex");
    expect(platform.resolveDisplayName()).toBe("demo-host");
  });

  it("uses Windows user directories and Codex command candidates on win32", () => {
    const platform = createDesktopPlatform({
      platform: "win32",
      env: {
        APPDATA: "C:\\Users\\demo\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
        COMPUTERNAME: "WIN-CODE"
      },
      homedir: () => "C:\\Users\\demo",
      hostname: () => "fallback-host",
      exists: () => false
    });

    expect(platform.kind).toBe("win32");
    expect(platform.defaultDataDir()).toBe(path.win32.join("C:\\Users\\demo\\AppData\\Roaming", "code"));
    expect(platform.defaultStartupDir()).toBe(path.win32.join(
      "C:\\Users\\demo\\AppData\\Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup"
    ));
    expect(platform.defaultCodexBinaryCandidates()).toEqual(["codex.exe", "codex.cmd", "codex"]);
    expect(platform.resolveDisplayName()).toBe("WIN-CODE");
  });

  it("uses Linux XDG directories and Codex command candidates on linux", () => {
    const platform = createDesktopPlatform({
      platform: "linux",
      env: {
        XDG_DATA_HOME: "/home/demo/.local/share",
        XDG_CURRENT_DESKTOP: "GNOME"
      },
      homedir: () => "/home/demo",
      hostname: () => "fallback-host",
      exists: () => false
    });

    expect(platform.kind).toBe("linux");
    expect(platform.defaultDataDir()).toBe("/home/demo/.local/share/code-desktop-service");
    expect(platform.defaultStartupDir()).toBe("/home/demo/.local/share/systemd/user");
    expect(platform.defaultCodexBinaryCandidates()).toEqual(["codex", "/usr/local/bin/codex", "/usr/bin/codex"]);
    expect(platform.resolveDisplayName()).toBe("GNOME");
  });

  it("returns Windows startup semantics without LaunchAgent wording", async () => {
    const platform = createDesktopPlatform({
      platform: "win32",
      env: {
        APPDATA: "C:\\Users\\demo\\AppData\\Roaming"
      },
      homedir: () => "C:\\Users\\demo",
      hostname: () => "fallback-host",
      exists: () => false
    });
    const startupDir = platform.defaultStartupDir();
    const service = platform.createStartupService({
      startupDir,
      serviceRoot: "C:\\code\\mac-service",
      nodePath: "node.exe",
      startupCommand: "pnpm dev",
      config: {
        host: "0.0.0.0",
        port: 37631,
        dataDir: platform.defaultDataDir(),
        codexBin: undefined,
        projectRoots: [],
        launchAgentDir: startupDir,
        startupCommand: "pnpm dev"
      }
    });

    const status = await service.status();

    expect(status.supported).toBe(false);
    expect(status.enabled).toBe(false);
    expect(status.label).toContain("Windows");
    expect(status.path).toBe(startupDir);
    expect(status.message).toContain("Windows");
    expect(status.message).not.toContain("LaunchAgent");
  });

  it("returns Linux startup semantics without LaunchAgent wording", async () => {
    const platform = createDesktopPlatform({
      platform: "linux",
      env: {
        XDG_DATA_HOME: "/home/demo/.local/share"
      },
      homedir: () => "/home/demo",
      hostname: () => "fallback-host",
      exists: () => false
    });
    const startupDir = platform.defaultStartupDir();
    const service = platform.createStartupService({
      startupDir,
      serviceRoot: "/home/demo/code/mac-service",
      nodePath: "/usr/bin/node",
      startupCommand: "pnpm dev",
      config: {
        host: "0.0.0.0",
        port: 37631,
        dataDir: platform.defaultDataDir(),
        codexBin: undefined,
        projectRoots: [],
        launchAgentDir: startupDir,
        startupCommand: "pnpm dev"
      }
    });

    const status = await service.status();

    expect(status.supported).toBe(false);
    expect(status.enabled).toBe(false);
    expect(status.label).toContain("Linux");
    expect(status.path).toBe(startupDir);
    expect(status.message).toContain("Linux");
    expect(status.message).not.toContain("LaunchAgent");
  });

  it("uses injected platform defaults when loading config", () => {
    const config = loadConfig({
      env: {
        CODE_PORT: "12345"
      },
      platform: {
        defaultDataDir: () => "/tmp/code-data",
        defaultStartupDir: () => "/tmp/code-startup",
        defaultCodexBinaryCandidates: () => ["codex"]
      }
    });

    expect(config.port).toBe(12345);
    expect(config.dataDir).toBe("/tmp/code-data");
    expect(config.launchAgentDir).toBe("/tmp/code-startup");
    expect(config.codexCandidates).toEqual(["codex"]);
  });

  it("wires app context host name, startup, and capture capability through the injected platform", async () => {
    const platform = createDesktopPlatform({
      platform: "win32",
      env: {
        APPDATA: "C:\\Users\\demo\\AppData\\Roaming",
        COMPUTERNAME: "WIN-CODE"
      },
      homedir: () => "C:\\Users\\demo",
      hostname: () => "fallback-host",
      exists: () => false
    });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-win-platform-"));
    const startupDir = path.join(dataDir, "Startup");
    const context = createAppContext({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      codexBin: undefined,
      codexCandidates: platform.defaultCodexBinaryCandidates(),
      projectRoots: [],
      launchAgentDir: startupDir,
      startupCommand: "pnpm dev"
    }, {
      platform,
      collectTransportSubjectAltNames: () => ({ dnsNames: ["localhost"], ipAddresses: ["127.0.0.1"] })
    });

    try {
      expect(context.localMacName).toBe("WIN-CODE");
      await expect(context.startup.status()).resolves.toMatchObject({
        supported: false,
        enabled: false,
        label: "Windows user Startup folder",
        path: startupDir
      });
      await expect(context.capture.captureScreenScreenshot({
        sessionId: "thread-1",
        deviceId: "device-1",
        userConfirmed: true
      })).rejects.toMatchObject({
        code: "CAPTURE_RUNNER_UNAVAILABLE",
        message: "桌面端屏幕截图能力尚未接入"
      });
    } finally {
      context.db.close();
    }
  });

  it("wires Linux app context defaults through the injected platform", async () => {
    const platform = createDesktopPlatform({
      platform: "linux",
      env: {
        XDG_DATA_HOME: "/home/demo/.local/share",
        XDG_CURRENT_DESKTOP: "GNOME"
      },
      homedir: () => "/home/demo",
      hostname: () => "fallback-host",
      exists: () => false
    });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-linux-platform-"));
    const startupDir = path.join(dataDir, "systemd-user");
    const context = createAppContext({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      codexBin: undefined,
      codexCandidates: platform.defaultCodexBinaryCandidates(),
      projectRoots: [],
      launchAgentDir: startupDir,
      startupCommand: "pnpm dev"
    }, {
      platform,
      collectTransportSubjectAltNames: () => ({ dnsNames: ["localhost"], ipAddresses: ["127.0.0.1"] })
    });

    try {
      expect(context.localMacName).toBe("GNOME");
      await expect(context.startup.status()).resolves.toMatchObject({
        supported: false,
        enabled: false,
        label: "Linux user service",
        path: startupDir
      });
      await expect(context.capture.captureScreenScreenshot({
        sessionId: "thread-1",
        deviceId: "device-1",
        userConfirmed: true
      })).rejects.toMatchObject({
        code: "CAPTURE_RUNNER_UNAVAILABLE",
        message: "桌面端屏幕截图能力尚未接入"
      });
      await expect(context.certificateTrust.checkLocalCertificateTrust({
        serverCertPath: path.join(dataDir, "missing.pem"),
        hostname: "localhost"
      })).resolves.toMatchObject({
        supported: false,
        trusted: false
      });
    } finally {
      context.db.close();
    }
  });

  it("keeps one stable desktop id per service data directory", () => {
    const firstDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-desktop-id-a-"));
    const secondDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-desktop-id-b-"));
    const firstContext = createAppContext({
      host: "127.0.0.1",
      port: 0,
      dataDir: firstDataDir,
      codexBin: undefined,
      codexIpcSocketPath: path.join(firstDataDir, "missing-codex-ipc.sock"),
      projectRoots: [],
      launchAgentDir: path.join(firstDataDir, "LaunchAgents"),
      startupCommand: "pnpm dev"
    }, {
      collectTransportSubjectAltNames: () => ({ dnsNames: ["localhost"], ipAddresses: ["127.0.0.1"] })
    });
    const restartedFirstContext = createAppContext({
      host: "127.0.0.1",
      port: 0,
      dataDir: firstDataDir,
      codexBin: undefined,
      codexIpcSocketPath: path.join(firstDataDir, "missing-codex-ipc.sock"),
      projectRoots: [],
      launchAgentDir: path.join(firstDataDir, "LaunchAgents"),
      startupCommand: "pnpm dev"
    }, {
      collectTransportSubjectAltNames: () => ({ dnsNames: ["localhost"], ipAddresses: ["127.0.0.1"] })
    });
    const secondContext = createAppContext({
      host: "127.0.0.1",
      port: 0,
      dataDir: secondDataDir,
      codexBin: undefined,
      codexIpcSocketPath: path.join(secondDataDir, "missing-codex-ipc.sock"),
      projectRoots: [],
      launchAgentDir: path.join(secondDataDir, "LaunchAgents"),
      startupCommand: "pnpm dev"
    }, {
      collectTransportSubjectAltNames: () => ({ dnsNames: ["localhost"], ipAddresses: ["127.0.0.1"] })
    });

    try {
      expect(firstContext.localMacId).toMatch(/^desktop-[A-Za-z0-9_-]{12,}$/);
      expect(restartedFirstContext.localMacId).toBe(firstContext.localMacId);
      expect(secondContext.localMacId).not.toBe(firstContext.localMacId);
    } finally {
      firstContext.db.close();
      restartedFirstContext.db.close();
      secondContext.db.close();
    }
  });
});
