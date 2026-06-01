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

  it("detects trusted Windows current-user root certificate by fingerprint", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const caSha1 = "a1b2c3d4e5f60123456789abcdef0123456789ab";
    const service = createCertificateTrustService({
      platform: "win32",
      run: async (file, args) => {
        calls.push({ file, args });
        if (args[0] === "-hashfile") {
          return {
            stdout: `SHA1 hash of C:\\code\\certs\\ca.crt:\n${caSha1.match(/.{1,2}/g)?.join(" ")}\nCertUtil: -hashfile command completed successfully.\n`,
            stderr: ""
          };
        }
        return {
          stdout: `Serial Number: demo\nCert Hash(sha1): ${caSha1.match(/.{1,2}/g)?.join(" ").toUpperCase()}\n`,
          stderr: ""
        };
      }
    });

    const result = await service.checkLocalCertificateTrust({
      serverCertPath: "C:\\code\\certs\\server.crt",
      caCertPath: "C:\\code\\certs\\ca.crt",
      caFingerprint: "sha256-fingerprint-is-not-used-for-windows-store-matching",
      hostname: "127.0.0.1"
    });

    expect(result).toMatchObject({
      supported: true,
      trusted: true,
      message: "当前用户已信任 code 本地开发 CA"
    });
    expect(calls).toEqual([{
      file: "certutil.exe",
      args: ["-hashfile", "C:\\code\\certs\\ca.crt", "SHA1"]
    }, {
      file: "certutil.exe",
      args: ["-user", "-store", "Root"]
    }]);
  });

  it("reports untrusted Windows current-user root certificate when fingerprint is absent", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const caSha1 = "a1b2c3d4e5f60123456789abcdef0123456789ab";
    const service = createCertificateTrustService({
      platform: "win32",
      run: async (file, args) => {
        calls.push({ file, args });
        if (args[0] === "-hashfile") {
          return { stdout: `${caSha1.match(/.{1,2}/g)?.join(" ")}\n`, stderr: "" };
        }
        return { stdout: "Cert Hash(sha256): 11 22 33", stderr: "" };
      }
    });

    const result = await service.checkLocalCertificateTrust({
      serverCertPath: "C:\\code\\certs\\server.crt",
      caCertPath: "C:\\code\\certs\\ca.crt",
      caFingerprint: "sha256-fingerprint-is-not-used-for-windows-store-matching",
      hostname: "127.0.0.1"
    });

    expect(result).toMatchObject({
      supported: true,
      trusted: false,
      message: "当前用户尚未信任 code 本地开发 CA"
    });
    expect(calls).toEqual([{
      file: "certutil.exe",
      args: ["-hashfile", "C:\\code\\certs\\ca.crt", "SHA1"]
    }, {
      file: "certutil.exe",
      args: ["-user", "-store", "Root"]
    }]);
  });

  it("reports unsupported Windows trust detection when certutil cannot start", async () => {
    const service = createCertificateTrustService({
      platform: "win32",
      run: async () => {
        throw new Error("spawn certutil.exe ENOENT");
      }
    });

    await expect(service.checkLocalCertificateTrust({
      serverCertPath: "C:\\code\\certs\\server.crt",
      caFingerprint: "a1b2c3d4",
      hostname: "127.0.0.1"
    })).resolves.toMatchObject({
      supported: false,
      trusted: false,
      message: "无法启动 certutil.exe 检测 Windows 当前用户证书信任状态：spawn certutil.exe ENOENT"
    });
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
