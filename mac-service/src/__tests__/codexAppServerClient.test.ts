import { describe, expect, it, vi } from "vitest";
import { createCodexAppServerClient, type AppServerTransport } from "../codex/codexAppServerClient.js";

class FakeTransport implements AppServerTransport {
  sent: string[] = [];
  private onData: ((chunk: string) => void) | null = null;

  send(chunk: string): void {
    this.sent.push(chunk);
    const request = JSON.parse(chunk) as { id?: string; method: string };
    if (request.id) {
      this.onData?.(JSON.stringify({ id: request.id, result: { method: request.method } }));
    }
  }

  onMessage(handler: (chunk: string) => void): void {
    this.onData = handler;
  }

  emit(packet: object): void {
    this.onData?.(JSON.stringify(packet));
  }
}

class DelayedTransport implements AppServerTransport {
  sent: string[] = [];
  private onData: ((chunk: string) => void) | null = null;

  constructor(private readonly delayMs: number) {}

  send(chunk: string): void {
    this.sent.push(chunk);
    const request = JSON.parse(chunk) as { id?: string; method: string };
    if (!request.id) return;
    setTimeout(() => {
      this.onData?.(JSON.stringify({ id: request.id, result: { method: request.method } }));
    }, this.delayMs);
  }

  onMessage(handler: (chunk: string) => void): void {
    this.onData = handler;
  }
}

describe("codex app server client", () => {
  it("sends Codex app-server requests without a JSON-RPC envelope", async () => {
    const transport = new FakeTransport();
    const client = createCodexAppServerClient(transport);

    const result = await client.request("thread/list", {});

    expect(result).toEqual({ method: "thread/list" });
    expect(JSON.parse(transport.sent[0])).toMatchObject({ method: "thread/list", params: {} });
    expect(transport.sent[0]).not.toContain("jsonrpc");
  });

  it("omits params when a Codex app-server request has no params", async () => {
    const transport = new FakeTransport();
    const client = createCodexAppServerClient(transport);

    const result = await client.request("account/rateLimits/read");

    expect(result).toEqual({ method: "account/rateLimits/read" });
    expect(JSON.parse(transport.sent[0])).toMatchObject({ method: "account/rateLimits/read" });
    expect(JSON.parse(transport.sent[0])).not.toHaveProperty("params");
  });

  it("initializes the app-server before business requests", async () => {
    const transport = new FakeTransport();
    const client = createCodexAppServerClient(transport);

    const result = await client.initialize();

    expect(result).toEqual({ method: "initialize" });
    expect(JSON.parse(transport.sent[0])).toMatchObject({ method: "initialize" });
    expect(JSON.parse(transport.sent[1])).toEqual({ method: "initialized" });
  });

  it("rejects requests that do not receive a response", async () => {
    const transport: AppServerTransport = {
      send: () => undefined,
      onMessage: () => undefined
    };
    const client = createCodexAppServerClient(transport, { requestTimeoutMs: 5 });

    await expect(client.request("thread/list", {})).rejects.toThrow("Codex App Server request timed out: thread/list");
  });

  it("keeps long-running Codex requests pending past a normal model turn", async () => {
    vi.useFakeTimers();
    try {
      const transport = new DelayedTransport(12_000);
      const client = createCodexAppServerClient(transport);

      const request = client.request("turn/start", {});
      const assertion = expect(request).resolves.toEqual({ method: "turn/start" });

      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps thread start pending while Codex creates a fresh conversation", async () => {
    vi.useFakeTimers();
    try {
      const transport = new DelayedTransport(12_000);
      const client = createCodexAppServerClient(transport);

      const request = client.request("thread/start", { cwd: "/tmp/code-mobile-demo" });
      const assertion = expect(request).resolves.toEqual({ method: "thread/start" });

      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps historical thread resume pending past the default request timeout", async () => {
    vi.useFakeTimers();
    try {
      const transport = new DelayedTransport(12_000);
      const client = createCodexAppServerClient(transport);

      const request = client.request("thread/resume", { threadId: "thread-1" });
      const assertion = expect(request).resolves.toEqual({ method: "thread/resume" });

      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches rich timeline notifications from the app-server", () => {
    const transport = new FakeTransport();
    const client = createCodexAppServerClient(transport);
    const received: Array<Record<string, unknown>> = [];

    client.onNotification("item/started", (params) => {
      received.push({ method: "item/started", params });
    });
    client.onNotification("item/agentMessage/delta", (params) => {
      received.push({ method: "item/agentMessage/delta", params });
    });
    client.onNotification("serverRequest/resolved", (params) => {
      received.push({ method: "serverRequest/resolved", params });
    });

    transport.emit({ method: "item/started", params: { itemId: "item-1" } });
    transport.emit({ method: "item/agentMessage/delta", params: { itemId: "item-1", delta: "hello" } });
    transport.emit({ method: "serverRequest/resolved", params: { requestId: "approval-1" } });

    expect(received).toEqual([
      { method: "item/started", params: { itemId: "item-1" } },
      { method: "item/agentMessage/delta", params: { itemId: "item-1", delta: "hello" } },
      { method: "serverRequest/resolved", params: { requestId: "approval-1" } }
    ]);
  });

  it("responds to server requests with the original JSON-RPC id type", () => {
    const transport = new FakeTransport();
    const client = createCodexAppServerClient(transport);
    const received: string[] = [];

    client.onServerRequest("item/commandExecution/requestApproval", (request) => {
      received.push(request.id);
      client.respond(request.id, { decision: "accept" });
    });

    transport.emit({
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: { command: "rm -rf /tmp/demo" }
    });

    expect(received).toEqual(["42"]);
    expect(JSON.parse(transport.sent[0])).toEqual({ id: 42, result: { decision: "accept" } });
  });
});
