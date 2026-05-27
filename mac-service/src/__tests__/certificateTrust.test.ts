import { describe, expect, it } from "vitest";
import { createCertificateTrustService } from "../security/certificateTrust.js";

describe("certificate trust service", () => {
  it("installs a local CA into the macOS user trust store", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const service = createCertificateTrustService({
      platform: "darwin",
      homedir: () => "/Users/demo",
      run: async (file, args) => {
        calls.push({ file, args });
        return { stdout: "", stderr: "" };
      }
    });

    const result = await service.trustLocalCertificate({
      caCertPath: "/Users/demo/Library/Application Support/code/certs/transport-ca-cert.pem",
      caFingerprint: "abc123"
    });

    expect(result).toMatchObject({
      supported: true,
      trusted: true,
      message: "已安装 code 本地开发 CA 到 macOS 登录钥匙串"
    });
    expect(calls).toEqual([{
      file: "/usr/bin/security",
      args: [
        "add-trusted-cert",
        "-r",
        "trustRoot",
        "-p",
        "ssl",
        "-k",
        "/Users/demo/Library/Keychains/login.keychain-db",
        "/Users/demo/Library/Application Support/code/certs/transport-ca-cert.pem"
      ]
    }]);
  });

  it("checks whether the macOS user trust store trusts the service certificate for SSL", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const service = createCertificateTrustService({
      platform: "darwin",
      homedir: () => "/Users/demo",
      run: async (file, args) => {
        calls.push({ file, args });
        return { stdout: "...certificate verification successful.", stderr: "" };
      }
    });

    const result = await service.checkLocalCertificateTrust({
      serverCertPath: "/Users/demo/Library/Application Support/code/transport-cert.pem",
      hostname: "localhost"
    });

    expect(result).toMatchObject({
      supported: true,
      trusted: true,
      message: "当前用户已信任 code 本地开发 CA"
    });
    expect(calls).toEqual([{
      file: "/usr/bin/security",
      args: [
        "verify-cert",
        "-c",
        "/Users/demo/Library/Application Support/code/transport-cert.pem",
        "-p",
        "ssl",
        "-s",
        "localhost",
        "-L"
      ]
    }]);
  });

  it("reports untrusted when macOS SSL certificate verification fails", async () => {
    const service = createCertificateTrustService({
      platform: "darwin",
      homedir: () => "/Users/demo",
      run: async () => {
        throw new Error("CSSMERR_TP_NOT_TRUSTED");
      }
    });

    await expect(service.checkLocalCertificateTrust({
      serverCertPath: "/Users/demo/Library/Application Support/code/transport-cert.pem",
      hostname: "localhost"
    })).resolves.toMatchObject({
      supported: true,
      trusted: false,
      message: "当前用户尚未信任 code 本地开发 CA"
    });
  });

  it("installs a local CA into the Windows current-user Root store", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const service = createCertificateTrustService({
      platform: "win32",
      homedir: () => "C:\\Users\\demo",
      run: async (file, args) => {
        calls.push({ file, args });
        return { stdout: "", stderr: "" };
      }
    });

    const result = await service.trustLocalCertificate({
      caCertPath: "C:\\Users\\demo\\AppData\\Roaming\\code\\certs\\transport-ca-cert.pem",
      caFingerprint: "abc123"
    });

    expect(result).toMatchObject({
      supported: true,
      trusted: true,
      message: "已安装 code 本地开发 CA 到 Windows 当前用户受信任根证书"
    });
    expect(calls).toEqual([{
      file: "certutil.exe",
      args: [
        "-user",
        "-addstore",
        "Root",
        "C:\\Users\\demo\\AppData\\Roaming\\code\\certs\\transport-ca-cert.pem"
      ]
    }]);
  });

  it("reports unsupported trust installation on other platforms", async () => {
    const service = createCertificateTrustService({
      platform: "linux",
      homedir: () => "/home/demo",
      run: async () => {
        throw new Error("should not run");
      }
    });

    await expect(service.trustLocalCertificate({
      caCertPath: "/home/demo/.config/code/certs/transport-ca-cert.pem",
      caFingerprint: "abc123"
    })).resolves.toMatchObject({
      supported: false,
      trusted: false,
      message: "当前平台暂不支持自动安装本地信任证书"
    });
  });
});
