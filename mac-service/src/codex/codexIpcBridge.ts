import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CodexTurnInputItem } from "../domain/codexTurnInputBuilder.js";

const IPC_VERSION_BY_METHOD: Record<string, number> = {
  "thread-stream-state-changed": 6,
  "thread-read-state-changed": 1,
  "thread-archived": 2,
  "thread-unarchived": 1,
  "thread-follower-start-turn": 1,
  "thread-follower-compact-thread": 1,
  "thread-follower-steer-turn": 1,
  "thread-follower-interrupt-turn": 1,
  "thread-follower-set-model-and-reasoning": 1,
  "thread-follower-set-collaboration-mode": 1,
  "thread-follower-edit-last-user-turn": 1,
  "thread-follower-command-approval-decision": 1,
  "thread-follower-file-approval-decision": 1,
  "thread-follower-permissions-request-approval-response": 1,
  "thread-follower-submit-user-input": 1,
  "thread-follower-submit-mcp-server-elicitation-response": 1,
  "thread-follower-set-queued-follow-ups-state": 1,
  "thread-queued-followups-changed": 1
};

const CLIENT_DISCOVERY_TIMEOUT_MS = 2_000;

type IpcMessage = Record<string, unknown>;
type CodexTurnInputSource =
  | { text: string; inputItems?: CodexTurnInputItem[] }
  | { text?: string; inputItems: CodexTurnInputItem[] };

interface IpcClientRecord {
  id: string;
  type: string;
  socket: net.Socket;
}

interface PendingIpcRequest {
  sourceSocket: net.Socket;
  timeout: NodeJS.Timeout;
}

interface PendingClientDiscovery {
  clientId: string;
  resolve: (client: IpcClientRecord) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface CodexIpcRouterHandle {
  socketPath: string;
  stop: () => Promise<void>;
}

export interface CodexIpcClientHandle {
  clientId: string;
  socketPath: string;
  sendBroadcast: (method: string, params: Record<string, unknown>) => void;
  sendRequest: (method: string, params: Record<string, unknown>, options?: { targetClientId?: string }) => Promise<IpcMessage>;
  close: () => void;
}

export interface CodexIpcRequestHandler {
  canHandle?: (params: Record<string, unknown>, request: IpcMessage) => boolean | Promise<boolean>;
  handle: (request: { requestId: string; method: string; params: Record<string, unknown>; raw: IpcMessage }) => unknown | Promise<unknown>;
}

export type CodexIpcRequestHandlers = Record<string, CodexIpcRequestHandler>;

export interface CodexIpcClientOptions {
  socketPath?: string;
  clientType?: string;
  requestHandlers?: CodexIpcRequestHandlers;
  onBroadcast?: (message: IpcMessage) => void | Promise<void>;
}

export interface CodexDesktopFollowerBridge {
  getConversationState: (threadId: string) => Record<string, unknown> | null;
  startTurn: (input: { threadId: string } & CodexTurnInputSource) => Promise<IpcMessage>;
  steerTurn: (input: { threadId: string; turnId: string } & CodexTurnInputSource) => Promise<IpcMessage>;
  interruptTurn: (input: { threadId: string; turnId: string }) => Promise<IpcMessage>;
  compactContext: (input: { threadId: string }) => Promise<IpcMessage>;
  respondToApproval: (input: { threadId: string; approvalId: string; actionId: string; answers?: Record<string, unknown> }) => Promise<IpcMessage>;
  stop: () => void;
}

export interface CodexDesktopFollowerBridgeOptions {
  socketPath?: string;
  onConversationStateChanged?: (conversationState: Record<string, unknown>) => void;
}

function frameMessage(message: IpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function createFrameReader(input: {
  onMessage: (message: IpcMessage) => void;
  onError?: (error: Error) => void;
}): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      const body = buffer.subarray(4, 4 + length).toString("utf8");
      buffer = buffer.subarray(4 + length);
      try {
        input.onMessage(JSON.parse(body) as IpcMessage);
      } catch (error) {
        input.onError?.(error instanceof Error ? error : new Error("Invalid codex-ipc frame"));
      }
    }
  };
}

function sendFrame(socket: net.Socket, message: IpcMessage): void {
  if (!socket.writable) return;
  socket.write(frameMessage(message));
}

export function defaultCodexIpcSocketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  return path.join(os.tmpdir(), "codex-ipc", uid === null ? "ipc.sock" : `ipc-${uid}.sock`);
}

async function canConnectToSocket(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 300);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function startCodexIpcRouter(socketPath: string = defaultCodexIpcSocketPath()): Promise<CodexIpcRouterHandle> {
  await fs.promises.mkdir(path.dirname(socketPath), { recursive: true });
  if (fs.existsSync(socketPath) && !(await canConnectToSocket(socketPath))) {
    await fs.promises.unlink(socketPath);
  }

  const clients = new Map<net.Socket, IpcClientRecord>();
  const clientsById = new Map<string, IpcClientRecord>();
  const pendingRequests = new Map<string, PendingIpcRequest>();
  const pendingClientDiscoveryRequests = new Map<string, PendingClientDiscovery>();
  const server = net.createServer((socket) => {
    const unregister = (): void => unregisterClient(socket);
    socket.on("data", createFrameReader({
      onMessage: (message) => handleMessage(socket, message),
      onError: () => socket.destroy()
    }));
    socket.on("close", unregister);
    socket.on("end", unregister);
    socket.on("error", () => undefined);
  });

  function registerClient(socket: net.Socket, requestId: string, params: Record<string, unknown>): void {
    const existing = clients.get(socket);
    if (existing) {
      sendFrame(socket, {
        type: "response",
        requestId,
        resultType: "success",
        method: "initialize",
        handledByClientId: existing.id,
        result: { clientId: existing.id }
      });
      return;
    }

    const id = randomUUID();
    const type = typeof params.clientType === "string" ? params.clientType : "unknown";
    const client = { id, type, socket };
    clients.set(socket, client);
    clientsById.set(id, client);
    sendFrame(socket, {
      type: "response",
      requestId,
      resultType: "success",
      method: "initialize",
      handledByClientId: id,
      result: { clientId: id }
    });
  }

  function unregisterClient(socket: net.Socket): void {
    const client = clients.get(socket);
    if (!client) return;
    clients.delete(socket);
    clientsById.delete(client.id);
    for (const [requestId, pending] of pendingRequests.entries()) {
      if (pending.sourceSocket === socket) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(requestId);
      }
    }
  }

  function handleMessage(socket: net.Socket, message: IpcMessage): void {
    const type = message.type;
    if (type === "broadcast") {
      handleBroadcast(socket, message);
      return;
    }
    if (type === "request") {
      void handleRequest(socket, message);
      return;
    }
    if (type === "response") {
      handleResponse(message);
      return;
    }
    if (type === "client-discovery-response") {
      handleClientDiscoveryResponse(message);
    }
  }

  function handleBroadcast(socket: net.Socket, message: IpcMessage): void {
    const sourceClientId = clients.get(socket)?.id ?? message.sourceClientId;
    const forwarded = { ...message, sourceClientId };
    for (const client of clients.values()) {
      if (client.socket !== socket) sendFrame(client.socket, forwarded);
    }
  }

  async function handleRequest(socket: net.Socket, message: IpcMessage): Promise<void> {
    if (message.method === "initialize") {
      registerClient(socket, String(message.requestId ?? randomUUID()), asRecord(message.params));
      return;
    }

    try {
      const target = await findClientForRequest(socket, message);
      forwardRequest(socket, message, target);
    } catch {
      sendFrame(socket, {
        type: "response",
        requestId: message.requestId,
        resultType: "error",
        error: "no-client-found"
      });
    }
  }

  async function findClientForRequest(sourceSocket: net.Socket, request: IpcMessage): Promise<IpcClientRecord> {
    const targetClientId = typeof request.targetClientId === "string" ? request.targetClientId : null;
    if (targetClientId) {
      const target = clientsById.get(targetClientId);
      if (!target || target.socket === sourceSocket) throw new Error("client-not-found");
      return sendClientDiscoveryRequest(request, target);
    }

    const candidates = Array.from(clients.values()).filter((client) => client.socket !== sourceSocket);
    return Promise.any(candidates.map((client) => sendClientDiscoveryRequest(request, client)));
  }

  async function sendClientDiscoveryRequest(request: IpcMessage, client: IpcClientRecord): Promise<IpcClientRecord> {
    const requestId = randomUUID();
    const discovery = { type: "client-discovery-request", requestId, request };
    const promise = new Promise<IpcClientRecord>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingClientDiscoveryRequests.delete(requestId);
        reject(new Error("timeout"));
      }, CLIENT_DISCOVERY_TIMEOUT_MS);
      pendingClientDiscoveryRequests.set(requestId, { clientId: client.id, resolve, reject, timeout });
    });
    sendFrame(client.socket, discovery);
    return promise;
  }

  function handleClientDiscoveryResponse(message: IpcMessage): void {
    const requestId = String(message.requestId ?? "");
    const pending = pendingClientDiscoveryRequests.get(requestId);
    if (!pending) return;
    pendingClientDiscoveryRequests.delete(requestId);
    clearTimeout(pending.timeout);
    const client = clientsById.get(pending.clientId);
    const response = asRecord(message.response);
    if (response.canHandle === true && client) pending.resolve(client);
    else pending.reject(new Error("client-cannot-handle-request"));
  }

  function forwardRequest(sourceSocket: net.Socket, request: IpcMessage, target: IpcClientRecord): void {
    const requestId = String(request.requestId ?? randomUUID());
    pendingRequests.set(requestId, {
      sourceSocket,
      timeout: setTimeout(() => {
        pendingRequests.delete(requestId);
        sendFrame(sourceSocket, {
          type: "response",
          requestId,
          resultType: "error",
          error: "request-timeout"
        });
      }, CLIENT_DISCOVERY_TIMEOUT_MS * 5)
    });
    sendFrame(target.socket, request);
  }

  function handleResponse(message: IpcMessage): void {
    const requestId = String(message.requestId ?? "");
    const pending = pendingRequests.get(requestId);
    if (!pending) return;
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeout);
    sendFrame(pending.sourceSocket, message);
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    socketPath,
    async stop(): Promise<void> {
      for (const pending of pendingRequests.values()) clearTimeout(pending.timeout);
      pendingRequests.clear();
      for (const pending of pendingClientDiscoveryRequests.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("server-closed"));
      }
      pendingClientDiscoveryRequests.clear();
      for (const client of clients.values()) client.socket.destroy();
      clients.clear();
      clientsById.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (fs.existsSync(socketPath) && !(await canConnectToSocket(socketPath))) {
        await fs.promises.unlink(socketPath).catch(() => undefined);
      }
    }
  };
}

export async function createCodexIpcClient(input: CodexIpcClientOptions = {}): Promise<CodexIpcClientHandle> {
  const socketPath = input.socketPath ?? defaultCodexIpcSocketPath();
  const clientType = input.clientType ?? "code-mobile";
  const requestHandlers = input.requestHandlers ?? {};
  const socket = net.createConnection(socketPath);
  let clientId = "initializing-client";
  const pending = new Map<string, (message: IpcMessage) => void>();

  async function canHandleRequest(request: IpcMessage): Promise<boolean> {
    const method = typeof request.method === "string" ? request.method : "";
    const expectedVersion = IPC_VERSION_BY_METHOD[method] ?? 0;
    if ((request.version ?? 0) !== expectedVersion) return false;
    const handler = requestHandlers[method];
    if (!handler) return false;
    return handler.canHandle ? await handler.canHandle(asRecord(request.params), request) : true;
  }

  async function handleClientDiscoveryRequest(message: IpcMessage): Promise<void> {
    const request = asRecord(message.request);
    let canHandle = false;
    try {
      canHandle = await canHandleRequest(request);
    } catch {
      canHandle = false;
    }
    sendFrame(socket, {
      type: "client-discovery-response",
      requestId: message.requestId,
      sourceClientId: clientId,
      targetClientId: message.sourceClientId,
      response: { canHandle }
    });
  }

  async function handleRequest(message: IpcMessage): Promise<void> {
    const requestId = String(message.requestId ?? randomUUID());
    const method = typeof message.method === "string" ? message.method : "";
    const expectedVersion = IPC_VERSION_BY_METHOD[method] ?? 0;
    if ((message.version ?? 0) !== expectedVersion) {
      sendFrame(socket, {
        type: "response",
        requestId,
        resultType: "error",
        error: "request-version-mismatch"
      });
      return;
    }
    const handler = requestHandlers[method];
    if (!handler) {
      sendFrame(socket, {
        type: "response",
        requestId,
        resultType: "error",
        error: "no-handler-for-request"
      });
      return;
    }
    try {
      const result = await handler.handle({ requestId, method, params: asRecord(message.params), raw: message });
      sendFrame(socket, {
        type: "response",
        requestId,
        resultType: "success",
        method,
        handledByClientId: clientId,
        result
      });
    } catch (error) {
      sendFrame(socket, {
        type: "response",
        requestId,
        resultType: "error",
        error: error instanceof Error ? error.message : "error-handling-request"
      });
    }
  }

  socket.on("data", createFrameReader({
    onMessage: (message) => {
      if (message.type === "client-discovery-request") {
        void handleClientDiscoveryRequest(message);
        return;
      }
      if (message.type === "request") {
        void handleRequest(message);
        return;
      }
      if (message.type === "broadcast") {
        void input.onBroadcast?.(message);
        return;
      }
      const requestId = typeof message.requestId === "string" ? message.requestId : null;
      if (requestId && pending.has(requestId)) {
        pending.get(requestId)?.(message);
        pending.delete(requestId);
      }
    },
    onError: () => socket.destroy()
  }));

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const requestId = randomUUID();
  const initialized = new Promise<IpcMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("codex-ipc initialize timed out"));
    }, CLIENT_DISCOVERY_TIMEOUT_MS);
    pending.set(requestId, (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
  });
  sendFrame(socket, {
    type: "request",
    requestId,
    sourceClientId: clientId,
    version: 0,
    method: "initialize",
    params: { clientType }
  });
  const response = await initialized;
  if (response.resultType !== "success") throw new Error("codex-ipc initialize failed");
  const result = asRecord(response.result);
  clientId = typeof result.clientId === "string" ? result.clientId : clientId;

  return {
    clientId,
    socketPath,
    sendBroadcast(method: string, params: Record<string, unknown>): void {
      sendFrame(socket, {
        type: "broadcast",
        sourceClientId: clientId,
        method,
        params,
        version: IPC_VERSION_BY_METHOD[method] ?? 0
      });
    },
    sendRequest(method: string, params: Record<string, unknown>, options: { targetClientId?: string } = {}): Promise<IpcMessage> {
      const requestId = randomUUID();
      const message: IpcMessage = {
        type: "request",
        requestId,
        sourceClientId: clientId,
        version: IPC_VERSION_BY_METHOD[method] ?? 0,
        method,
        params
      };
      if (options.targetClientId) message.targetClientId = options.targetClientId;
      return new Promise<IpcMessage>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("codex-ipc request timed out"));
        }, CLIENT_DISCOVERY_TIMEOUT_MS * 5);
        pending.set(requestId, (response) => {
          clearTimeout(timeout);
          resolve(response);
        });
        sendFrame(socket, message);
      });
    },
    close(): void {
      for (const resolver of pending.values()) resolver({ type: "response", resultType: "error", error: "client-closed" });
      pending.clear();
      socket.end();
    }
  };
}

export async function createCodexDesktopFollowerBridge(
  options: CodexDesktopFollowerBridgeOptions = {}
): Promise<CodexDesktopFollowerBridge | null> {
  const socketPath = options.socketPath ?? defaultCodexIpcSocketPath();
  if (!(await canConnectToSocket(socketPath))) return null;

  const conversationStates = new Map<string, Record<string, unknown>>();
  const ownerClientIds = new Map<string, string>();
  const client = await createCodexIpcClient({
    socketPath,
    clientType: "code-mobile-follower",
    onBroadcast: (message) => {
      if (message.method !== "thread-stream-state-changed") return;
      const params = asRecord(message.params);
      const conversationId = conversationIdFromIpcParams(params);
      if (!conversationId) return;
      const sourceClientId = stringOrNull(message.sourceClientId);
      if (sourceClientId) ownerClientIds.set(conversationId, sourceClientId);
      const change = asRecord(params.change);
      const changeType = stringOrNull(change.type);
      if (changeType === "snapshot") {
        const state = asRecord(change.conversationState);
        if (stringOrNull(state.id) !== conversationId) state.id = conversationId;
        conversationStates.set(conversationId, state);
        options.onConversationStateChanged?.(state);
        return;
      }
      if (changeType === "patches") {
        const current = conversationStates.get(conversationId);
        if (!current) return;
        const patched = applyConversationPatches(current, asArray(change.patches));
        conversationStates.set(conversationId, patched);
        options.onConversationStateChanged?.(patched);
      }
    }
  });

  function targetFor(threadId: string): { targetClientId?: string } {
    const targetClientId = ownerClientIds.get(threadId);
    return targetClientId ? { targetClientId } : {};
  }

  return {
    getConversationState(threadId: string): Record<string, unknown> | null {
      return conversationStates.get(threadId) ?? null;
    },
    startTurn(input: { threadId: string } & CodexTurnInputSource): Promise<IpcMessage> {
      return client.sendRequest("thread-follower-start-turn", {
        conversationId: input.threadId,
        turnStartParams: {
          threadId: input.threadId,
          input: inputItemsFromTextOrItems(input)
        }
      }, targetFor(input.threadId));
    },
    steerTurn(input: { threadId: string; turnId: string } & CodexTurnInputSource): Promise<IpcMessage> {
      return client.sendRequest("thread-follower-steer-turn", {
        conversationId: input.threadId,
        turnId: input.turnId,
        expectedTurnId: input.turnId,
        input: inputItemsFromTextOrItems(input)
      }, targetFor(input.threadId));
    },
    interruptTurn(input: { threadId: string; turnId: string }): Promise<IpcMessage> {
      return client.sendRequest("thread-follower-interrupt-turn", {
        conversationId: input.threadId,
        turnId: input.turnId
      }, targetFor(input.threadId));
    },
    compactContext(input: { threadId: string }): Promise<IpcMessage> {
      return client.sendRequest("thread-follower-compact-thread", {
        conversationId: input.threadId,
        threadId: input.threadId
      }, targetFor(input.threadId));
    },
    respondToApproval(input: { threadId: string; approvalId: string; actionId: string; answers?: Record<string, unknown> }): Promise<IpcMessage> {
      return client.sendRequest("thread-follower-command-approval-decision", {
        conversationId: input.threadId,
        approvalId: input.approvalId,
        actionId: input.actionId,
        answers: input.answers ?? {}
      }, targetFor(input.threadId));
    },
    stop(): void {
      client.close();
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function conversationIdFromIpcParams(params: Record<string, unknown>): string | null {
  return stringOrNull(params.conversationId) ?? stringOrNull(params.threadId) ?? stringOrNull(params.sessionId);
}

function textInput(text: string): Array<Record<string, unknown>> {
  return [{ type: "text", text, text_elements: [] }];
}

function inputItemsFromTextOrItems(input: CodexTurnInputSource): Array<Record<string, unknown>> {
  if (input.inputItems && input.inputItems.length > 0) {
    return input.inputItems as Array<Record<string, unknown>>;
  }
  if (typeof input.text === "string" && input.text.length > 0) {
    return textInput(input.text);
  }
  throw new Error("Codex follower turn input must include text or inputItems");
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function patchPathSegments(pathInput: unknown): Array<string | number> {
  if (Array.isArray(pathInput)) return pathInput.map((segment) => typeof segment === "number" ? segment : String(segment));
  if (typeof pathInput !== "string") return [];
  return pathInput
    .split("/")
    .slice(1)
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((segment) => /^\d+$/.test(segment) ? Number(segment) : segment);
}

function applyConversationPatch(root: Record<string, unknown>, patchInput: unknown): void {
  const patch = asRecord(patchInput);
  const op = stringOrNull(patch.op);
  const pathSegments = patchPathSegments(patch.path);
  if (!op || pathSegments.length === 0) return;

  let target: unknown = root;
  for (let index = 0; index < pathSegments.length - 1; index++) {
    const segment = pathSegments[index];
    if (Array.isArray(target) && typeof segment === "number") target = target[segment];
    else if (target !== null && typeof target === "object") target = (target as Record<string, unknown>)[String(segment)];
    else return;
  }

  const finalSegment = pathSegments[pathSegments.length - 1];
  if (Array.isArray(target) && finalSegment === "-") {
    if (op === "add") target.push(patch.value);
    return;
  }
  if (Array.isArray(target) && typeof finalSegment === "number") {
    if (op === "remove") target.splice(finalSegment, 1);
    else if (op === "add") target.splice(finalSegment, 0, patch.value);
    else if (op === "replace") target[finalSegment] = patch.value;
    return;
  }
  if (target !== null && typeof target === "object") {
    const record = target as Record<string, unknown>;
    const key = String(finalSegment);
    if (op === "remove") delete record[key];
    else if (op === "add" || op === "replace") record[key] = patch.value;
  }
}

function applyConversationPatches(state: Record<string, unknown>, patches: unknown[]): Record<string, unknown> {
  const next = cloneJsonRecord(state);
  for (const patch of patches) applyConversationPatch(next, patch);
  return next;
}
