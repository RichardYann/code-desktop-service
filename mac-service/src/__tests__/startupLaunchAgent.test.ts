import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStartupLaunchAgentService } from "../system/startupLaunchAgent.js";

describe("startup launch agent service", () => {
  it("writes and removes a user LaunchAgent for the Mac service", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-startup-root-"));
    const launchAgentDir = path.join(root, "LaunchAgents");
    const dataDir = path.join(root, "data");
    const service = createStartupLaunchAgentService({
      launchAgentDir,
      serviceRoot: "/repo/Code/mac-service",
      nodePath: "/usr/local/bin/node",
      startupCommand: "pnpm dev",
      config: {
        host: "127.0.0.1",
        port: 37631,
        dataDir,
        codexBin: "/opt/homebrew/bin/codex",
        codexIpcSocketPath: "/tmp/codex.sock",
        projectRoots: ["/repo/Code", "/repo/Mobile"],
        launchAgentDir,
        startupCommand: "pnpm dev"
      }
    });

    expect(await service.status()).toMatchObject({
      supported: true,
      enabled: false,
      label: "com.lyz1022.code.mac-service"
    });

    const enabled = await service.setEnabled(true);

    expect(enabled).toMatchObject({ supported: true, enabled: true });
    expect(fs.existsSync(enabled.plistPath)).toBe(true);
    const plist = fs.readFileSync(enabled.plistPath, "utf8");
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<string>/bin/zsh</string>");
    expect(plist).toContain("cd '/repo/Code/mac-service'");
    expect(plist).toContain("exec env");
    expect(plist).toContain("CODE_PORT='37631'");
    expect(plist).toContain(`CODE_DATA_DIR='${dataDir}'`);
    expect(plist).toContain("CODE_PROJECT_ROOTS='/repo/Code,/repo/Mobile'");
    expect(plist).toContain("CODEX_BIN='/opt/homebrew/bin/codex'");
    expect(plist).toContain("CODEX_IPC_SOCKET='/tmp/codex.sock'");
    expect(plist).toContain("pnpm dev");

    const disabled = await service.setEnabled(false);

    expect(disabled).toMatchObject({ supported: true, enabled: false });
    expect(fs.existsSync(enabled.plistPath)).toBe(false);
  });
});
