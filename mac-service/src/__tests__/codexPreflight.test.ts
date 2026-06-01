import { describe, expect, it } from "vitest";
import { runCodexPreflight } from "../codex/codexPreflight.js";

describe("codex preflight", () => {
  it("summarizes provider, model and official channel capabilities without secrets", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> | undefined }> = [];
    const result = await runCodexPreflight({
      detectCli: async () => ({
        ok: true,
        path: "/Applications/Codex.app/Contents/Resources/codex",
        version: "codex-cli 0.130.0-alpha.5",
        appServerAvailable: true,
        remoteControlAvailable: true,
        supportsUnixSocket: true,
        supportsStdio: true,
        supportsWsAuth: true
      }),
      client: {
        request: async (method, params) => {
          calls.push({ method, params });
          if (method === "account/read") return { ok: true, account: { type: "apiKey" }, requiresOpenaiAuth: true };
          if (method === "config/read") return { config: { model_provider: "custom", model: "gpt-5.5" }, origins: {} };
          if (method === "model/list") return { data: [{ id: "gpt-5.5" }] };
          if (method === "thread/list") return { data: [] };
          return {};
        }
      }
    });

    expect(result).toMatchObject({ status: "ok", provider: "custom", model: "gpt-5.5", authStatus: "api-key" });
    expect(JSON.stringify(result)).not.toContain("apiKey=");
    expect(calls).toEqual([
      { method: "account/read", params: { refreshToken: false } },
      { method: "config/read", params: { includeLayers: false } },
      { method: "model/list", params: { includeHidden: false } },
      { method: "thread/list", params: { limit: 20, useStateDbOnly: true } }
    ]);
  });

  it("treats a returned ChatGPT account as logged in even when the response still requests OpenAI auth", async () => {
    const result = await runCodexPreflight({
      detectCli: async () => ({
        ok: true,
        path: "/Applications/Codex.app/Contents/Resources/codex",
        version: "codex-cli 0.133.0-alpha.1",
        appServerAvailable: true,
        remoteControlAvailable: true,
        supportsUnixSocket: true,
        supportsStdio: true,
        supportsWsAuth: true
      }),
      client: {
        request: async (method) => {
          if (method === "account/read") {
            return {
              account: { type: "chatgpt", email: "user@example.com", planType: "prolite" },
              requiresOpenaiAuth: true
            };
          }
          if (method === "config/read") return { config: { model: "gpt-5.5" }, origins: {} };
          if (method === "model/list") return { data: [{ id: "gpt-5.5" }] };
          if (method === "thread/list") return { data: [] };
          return {};
        }
      }
    });

    expect(result).toMatchObject({ status: "ok", authStatus: "ok", model: "gpt-5.5" });
  });

  it("does not call app-server client methods when app-server help is unavailable", async () => {
    let requested = false;
    const result = await runCodexPreflight({
      detectCli: async () => ({
        ok: true,
        path: "C:\\bad\\codex.exe",
        version: "codex-cli 0.135.0-alpha.1",
        appServerAvailable: false,
        remoteControlAvailable: false,
        supportsUnixSocket: false,
        supportsStdio: false,
        supportsWsAuth: false
      }),
      client: {
        request: async () => {
          requested = true;
          return {};
        }
      }
    });

    expect(result.status).toBe("blocked");
    expect(result.codexBin).toBe("C:\\bad\\codex.exe");
    expect(result.cliVersion).toBe("codex-cli 0.135.0-alpha.1");
    expect(result.appServerAvailable).toBe(false);
    expect(result.message).toContain("Codex App Server");
    expect(requested).toBe(false);
  });
});
