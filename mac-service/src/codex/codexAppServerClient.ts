import { nanoid } from "nanoid";
import type { CodexNotificationMethod, CodexRequestMethod, CodexServerRequestMethod } from "./codexAppServerProtocol.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const LONG_RUNNING_REQUEST_TIMEOUT_MS = 120_000;

export interface AppServerTransport {
  send(chunk: string): void;
  onMessage(handler: (chunk: string) => void): void;
  close?(): void;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface ServerRequest {
  id: string;
  method: CodexServerRequestMethod;
  params: Record<string, unknown>;
}

export interface CodexAppServerClientOptions {
  requestTimeoutMs?: number;
}

function parseError(error: unknown): Error {
  if (typeof error === "string") return new Error(error);
  if (error !== null && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return new Error(record.message);
  }
  return new Error("Codex App Server request failed");
}

function asPacket(chunk: string): { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown } {
  return JSON.parse(chunk) as { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
}

function traceProtocolPacket(direction: string, packet: unknown): void {
  if (process.env.CODE_TRACE_CODEX_APP_SERVER !== "1") return;
  process.stderr.write(`[codex-app-server:${direction}] ${JSON.stringify(packet)}\n`);
}

export function createCodexAppServerClient(transport: AppServerTransport, options: CodexAppServerClientOptions = {}) {
  const pending = new Map<string, PendingRequest>();
  const serverRequestIds = new Map<string, string | number>();
  const notificationHandlers = new Map<CodexNotificationMethod, Array<(params: Record<string, unknown>) => void>>();
  const serverRequestHandlers = new Map<CodexServerRequestMethod, Array<(request: ServerRequest) => void>>();
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  function timeoutMsForMethod(method: "initialize" | CodexRequestMethod): number {
    if (options.requestTimeoutMs !== undefined) return requestTimeoutMs;
    if (
      method === "turn/start" ||
      method === "turn/steer" ||
      method === "thread/start" ||
      method === "thread/resume" ||
      method === "thread/compact/start" ||
      method === "thread/read" ||
      method === "thread/turns/list" ||
      method === "thread/turns/items/list"
    ) {
      return LONG_RUNNING_REQUEST_TIMEOUT_MS;
    }
    return requestTimeoutMs;
  }

  transport.onMessage((chunk) => {
    const packet = asPacket(chunk);
    traceProtocolPacket("recv", packet);

    if (packet.id !== undefined && (Object.prototype.hasOwnProperty.call(packet, "result") || packet.error)) {
      const requestId = String(packet.id);
      const waiter = pending.get(requestId);
      if (!waiter) return;
      pending.delete(requestId);
      clearTimeout(waiter.timeout);
      if (packet.error) waiter.reject(parseError(packet.error));
      else waiter.resolve(packet.result);
      return;
    }

    if (packet.id !== undefined && packet.method) {
      const method = packet.method as CodexServerRequestMethod;
      const requestId = String(packet.id);
      serverRequestIds.set(requestId, packet.id);
      const handlers = serverRequestHandlers.get(method) ?? [];
      for (const handler of handlers) {
        handler({ id: requestId, method, params: packet.params ?? {} });
      }
      return;
    }

    if (packet.method) {
      const method = packet.method as CodexNotificationMethod;
      const handlers = notificationHandlers.get(method) ?? [];
      for (const handler of handlers) {
        handler(packet.params ?? {});
      }
    }
  });

  function requestRaw(method: "initialize" | CodexRequestMethod, params?: Record<string, unknown>): Promise<unknown> {
    const id = nanoid(12);
    const packet = params === undefined ? { id, method } : { id, method, params };
    const payload = JSON.stringify(packet);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMsForMethod(method));
      pending.set(id, { resolve, reject, timeout });
      traceProtocolPacket("send", packet);
      transport.send(payload);
    });
  }

  return {
    async initialize(): Promise<unknown> {
      const result = await requestRaw("initialize", {
        clientInfo: {
          name: "code",
          title: "code Codex Direct",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
        }
      });
      transport.send(JSON.stringify({ method: "initialized" }));
      return result;
    },

    request(method: CodexRequestMethod, params?: Record<string, unknown>): Promise<unknown> {
      return requestRaw(method, params);
    },

    respond(id: string, result: unknown): void {
      const rawId = serverRequestIds.get(id) ?? id;
      serverRequestIds.delete(id);
      const packet = { id: rawId, result };
      traceProtocolPacket("send", packet);
      transport.send(JSON.stringify(packet));
    },

    onNotification(method: CodexNotificationMethod, handler: (params: Record<string, unknown>) => void): void {
      notificationHandlers.set(method, [...(notificationHandlers.get(method) ?? []), handler]);
    },

    onServerRequest(method: CodexServerRequestMethod, handler: (request: ServerRequest) => void): void {
      serverRequestHandlers.set(method, [...(serverRequestHandlers.get(method) ?? []), handler]);
    },

    close(): void {
      for (const [id, waiter] of pending.entries()) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("Codex App Server client closed"));
        pending.delete(id);
      }
      transport.close?.();
    }
  };
}

export type CodexAppServerClient = ReturnType<typeof createCodexAppServerClient>;
