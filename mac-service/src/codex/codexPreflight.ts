import { detectCodexCli } from "./codexBinary.js";

export interface CodexPreflight {
  status: "ok" | "warning" | "blocked";
  checkedAt: string;
  codexBin: string | null;
  cliVersion: string | null;
  appServerAvailable: boolean;
  remoteControlAvailable: boolean;
  provider: string | null;
  model: string | null;
  authStatus: "ok" | "api-key" | "requires-openai-auth" | "missing" | "unknown";
  capabilities: {
    accountRead: boolean;
    configRead: boolean;
    modelList: boolean;
    threadList: boolean;
    threadRead: boolean;
    turnStart: boolean;
    turnSteer: boolean;
    turnInterrupt: boolean;
    approvalResponse: boolean;
  };
  message: string;
}

export interface CodexPreflightClient {
  request(method: "account/read" | "config/read" | "model/list" | "thread/list", params?: Record<string, unknown>): Promise<unknown>;
}

export interface RunCodexPreflightInput {
  detectCli?: typeof detectCodexCli;
  client: CodexPreflightClient;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function isApiKeyAccount(account: Record<string, unknown>, response: Record<string, unknown>): boolean {
  const rawType = readString(account, ["type", "authType", "loginType", "kind"]) ||
    readString(response, ["authType", "loginType", "accountType"]);
  const normalized = rawType.replace(/[-_\s]/g, "").toLowerCase();
  return normalized === "apikey" || normalized === "api";
}

function blockedPreflight(checkedAt: string, message: string): CodexPreflight {
  return {
    status: "blocked",
    checkedAt,
    codexBin: null,
    cliVersion: null,
    appServerAvailable: false,
    remoteControlAvailable: false,
    provider: null,
    model: null,
    authStatus: "missing",
    capabilities: {
      accountRead: false,
      configRead: false,
      modelList: false,
      threadList: false,
      threadRead: false,
      turnStart: false,
      turnSteer: false,
      turnInterrupt: false,
      approvalResponse: false
    },
    message
  };
}

export async function runCodexPreflight(input: RunCodexPreflightInput): Promise<CodexPreflight> {
  const checkedAt = new Date().toISOString();
  const detected = await (input.detectCli ?? detectCodexCli)();
  if (!detected.ok) {
    return blockedPreflight(checkedAt, detected.error);
  }

  try {
    const account = asRecord(await input.client.request("account/read", { refreshToken: false }));
    const configResponse = asRecord(await input.client.request("config/read", { includeLayers: false }));
    await input.client.request("model/list", { includeHidden: false });
    await input.client.request("thread/list", { limit: 20, useStateDbOnly: true });

    const config = asRecord(configResponse.config ?? configResponse);
    const accountRecord = asRecord(account.account);
    const provider = typeof config.model_provider === "string" ? config.model_provider : null;
    const model = typeof config.model === "string" ? config.model : null;
    const requiresOpenaiAuth = account.requiresOpenaiAuth === true;
    const hasAccount = Object.keys(accountRecord).length > 0;
    const authStatus: CodexPreflight["authStatus"] = isApiKeyAccount(accountRecord, account)
      ? "api-key"
      : hasAccount ? "ok" : (requiresOpenaiAuth ? "requires-openai-auth" : "missing");

    return {
      status: detected.appServerAvailable ? "ok" : "blocked",
      checkedAt,
      codexBin: detected.path,
      cliVersion: detected.version,
      appServerAvailable: detected.appServerAvailable,
      remoteControlAvailable: detected.remoteControlAvailable,
      provider,
      model,
      authStatus,
      capabilities: {
        accountRead: true,
        configRead: true,
        modelList: true,
        threadList: true,
        threadRead: true,
        turnStart: true,
        turnSteer: true,
        turnInterrupt: true,
        approvalResponse: true
      },
      message: "Codex 官方接入通道可用；登录、provider 和 model 由桌面端处理"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Codex 预检失败";
    return { ...blockedPreflight(checkedAt, message), codexBin: detected.path, cliVersion: detected.version };
  }
}
