import path from "node:path";
import os from "node:os";
import { execa } from "execa";

export interface TrustLocalCertificateInput {
  caCertPath: string;
  caFingerprint: string;
}

export interface CertificateTrustResult {
  supported: boolean;
  trusted: boolean;
  message: string;
}

export interface CertificateTrustRunResult {
  stdout: string;
  stderr: string;
}

export type CertificateTrustRunner = (
  file: string,
  args: string[]
) => Promise<CertificateTrustRunResult>;

export interface CertificateTrustServiceOptions {
  platform?: NodeJS.Platform;
  homedir?: () => string;
  run?: CertificateTrustRunner;
}

export interface CertificateTrustService {
  trustLocalCertificate(input: TrustLocalCertificateInput): Promise<CertificateTrustResult>;
}

const defaultRunner: CertificateTrustRunner = async (file, args) => {
  const result = await execa(file, args);
  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
};

export function createCertificateTrustService(
  options: CertificateTrustServiceOptions = {}
): CertificateTrustService {
  const platform = options.platform ?? process.platform;
  const homedir = options.homedir ?? os.homedir;
  const run = options.run ?? defaultRunner;

  async function trustLocalCertificate(input: TrustLocalCertificateInput): Promise<CertificateTrustResult> {
    if (platform === "darwin") {
      await run("/usr/bin/security", [
        "add-trusted-cert",
        "-r",
        "trustRoot",
        "-k",
        path.join(homedir(), "Library", "Keychains", "login.keychain-db"),
        input.caCertPath
      ]);
      return {
        supported: true,
        trusted: true,
        message: "已安装 code 本地开发 CA 到 macOS 登录钥匙串"
      };
    }

    if (platform === "win32") {
      await run("certutil.exe", [
        "-user",
        "-addstore",
        "Root",
        input.caCertPath
      ]);
      return {
        supported: true,
        trusted: true,
        message: "已安装 code 本地开发 CA 到 Windows 当前用户受信任根证书"
      };
    }

    return {
      supported: false,
      trusted: false,
      message: "当前平台暂不支持自动安装本地信任证书"
    };
  }

  return {
    trustLocalCertificate
  };
}
