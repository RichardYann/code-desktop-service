import { createServer as createNodeServer, type Server } from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createTestAppContext } from "./helpers.js";
import { createLocalWebProxy } from "../domain/localWebProxy.js";
import { createServer } from "../server/httpServer.js";

type TestServer = Awaited<ReturnType<typeof createServer>> & {
  injectWS(path: string, upgradeContext?: { headers?: Record<string, string> }): Promise<TestWebSocket>;
};

type TestWebSocket = {
  send(value: string): void;
  terminate(): void;
  on?(event: "message", handler: (value: { toString(encoding?: BufferEncoding): string }) => void): void;
};

describe("localWebProxy", () => {
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  let targetServer: Server | undefined;
  let targetFastify: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    await targetFastify?.close();
    targetFastify = undefined;
    if (targetServer) {
      await new Promise<void>((resolve) => targetServer?.close(() => resolve()));
    }
  });

  it("returns HTML through an authorized local web session", async () => {
    const target = await startTargetServer();
    const context = createTestAppContext();
    server = await createServer(context);
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-1",
      sessionId: "thread-1",
      targetUrl: target.baseUrl,
      proxyUrl: "/local-web/local-web-1/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const response = await server.inject({
      method: "GET",
      url: "/local-web/local-web-1/",
      headers: { authorization: `Bearer ${claimed.authToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("id=\"count\"");
    expect(response.body).toContain("/local-web/local-web-1/app.js");
  });

  it("proxies relative static resources", async () => {
    const target = await startTargetServer();
    const context = createTestAppContext();
    server = await createServer(context);
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-2",
      sessionId: "thread-1",
      targetUrl: target.baseUrl,
      proxyUrl: "/local-web/local-web-2/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const response = await server.inject({
      method: "GET",
      url: "/local-web/local-web-2/app.js",
      headers: { authorization: `Bearer ${claimed.authToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("window.count");
  });

  it("loads the exact target path for the initial proxied page", async () => {
    const target = await startPathTargetServer();
    const context = createTestAppContext();
    server = await createServer(context);
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-path",
      sessionId: "thread-1",
      targetUrl: `${target.baseUrl}/nested/page.html`,
      proxyUrl: "/local-web/local-web-path/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const response = await server.inject({
      method: "GET",
      url: "/local-web/local-web-path/",
      headers: { authorization: `Bearer ${claimed.authToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("nested page loaded");
  });

  it("does not forward the preview language query to the target app", async () => {
    targetServer = createNodeServer((request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(request.url ?? "");
    });
    await new Promise<void>((resolve) => targetServer?.listen(0, "127.0.0.1", () => resolve()));
    const address = targetServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("target server failed to listen");
    }
    const context = createTestAppContext();
    server = await createServer(context);
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-query",
      sessionId: "thread-1",
      targetUrl: `http://127.0.0.1:${address.port}/`,
      proxyUrl: "/local-web/local-web-query/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const response = await server.inject({
      method: "GET",
      url: "/local-web/local-web-query/nested/page.html?dev=1&__code_preview_lang=en",
      headers: { authorization: `Bearer ${claimed.authToken}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("/nested/page.html?dev=1");
  });

  it("accepts local web authorization from the WebView cookie", async () => {
    const target = await startTargetServer();
    const context = createTestAppContext();
    server = await createServer(context);
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-cookie",
      sessionId: "thread-1",
      targetUrl: target.baseUrl,
      proxyUrl: "/local-web/local-web-cookie/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const response = await server.inject({
      method: "GET",
      url: "/local-web/local-web-cookie/app.js",
      headers: { cookie: `code_auth=${encodeURIComponent(claimed.authToken)}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("window.count");
  });

  it("returns a readable error when the target is unavailable", async () => {
    const context = createTestAppContext();
    server = await createServer(context);
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-3",
      sessionId: "thread-1",
      targetUrl: "http://127.0.0.1:9",
      proxyUrl: "/local-web/local-web-3/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const response = await server.inject({
      method: "GET",
      url: "/local-web/local-web-3/",
      headers: { authorization: `Bearer ${claimed.authToken}` }
    });

    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("本地 Web 目标不可访问");
    expect(response.body).toContain("LOCAL_WEB_TARGET_UNAVAILABLE");
  });

  it("localizes WebView local web errors from the preview language query", async () => {
    const context = createTestAppContext();
    server = await createServer(context);
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-en",
      sessionId: "thread-1",
      targetUrl: "http://127.0.0.1:9",
      proxyUrl: "/local-web/local-web-en/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const response = await server.inject({
      method: "GET",
      url: "/local-web/local-web-en/?__code_preview_lang=en",
      headers: {
        authorization: `Bearer ${claimed.authToken}`,
        accept: "application/json"
      }
    });

    expect(response.statusCode).toBe(502);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("<html lang=\"en\">");
    expect(response.body).toContain("Local Web target unavailable");
    expect(response.body).toContain("local dev server is running");
    expect(response.body).toContain("LOCAL_WEB_TARGET_UNAVAILABLE");
    expect(response.body).not.toContain("本地 Web 目标不可访问");
  });

  it("returns event-stream responses before the target finishes the stream", async () => {
    const target = await startSseTargetServer();
    const context = createTestAppContext();
    const proxy = createLocalWebProxy({ repository: context.repositories.localWebSessions });
    context.repositories.localWebSessions.insert({
      id: "local-web-sse",
      sessionId: "thread-1",
      targetUrl: target.baseUrl,
      proxyUrl: "/local-web/local-web-sse/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const startedAt = Date.now();
    const result = await proxy.proxyRequest({
      method: "GET",
      url: "/local-web/local-web-sse/events",
      headers: {}
    } as never, "local-web-sse", "events");

    expect(Date.now() - startedAt).toBeLessThan(120);
    expect(result.headers["content-type"]).toContain("text/event-stream");
    expect(result.streaming).toBe(true);
    expect(result.body).toBeInstanceOf(Readable);

    const chunks: string[] = [];
    for await (const chunk of result.body as Readable) {
      chunks.push(Buffer.from(chunk).toString("utf8"));
    }
    expect(chunks.join("")).toBe("data: first\n\ndata: second\n\n");
  });

  it("streams SSE through the /local-web route before the target finishes", async () => {
    const target = await startSseTargetServer();
    const context = createTestAppContext();
    server = await createServer(context);
    await server.listen({ port: 0, host: "127.0.0.1" });
    const address = server.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("proxy server failed to listen");
    }
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-route-sse",
      sessionId: "thread-1",
      targetUrl: target.baseUrl,
      proxyUrl: "/local-web/local-web-route-sse/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    const startedAt = Date.now();
    const result = await readHttpsStream({
      url: `https://127.0.0.1:${address.port}/local-web/local-web-route-sse/events`,
      authorization: `Bearer ${claimed.authToken}`
    });

    expect(result.firstChunkAtMs - startedAt).toBeLessThan(160);
    expect(result.firstChunk).toContain("data: first");
    expect(result.body).toBe("data: first\n\ndata: second\n\n");
  });

  it("proxies WebSocket HMR traffic through an authorized local web session", async () => {
    const target = await startWebSocketTargetServer();
    const context = createTestAppContext();
    server = await createServer(context);
    await server.listen({ port: 0, host: "127.0.0.1" });
    const address = server.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("proxy server failed to listen");
    }
    const claimed = context.pairing.claimPairingCode(context.pairing.createPairingCode("Mac").value, "Phone");
    context.repositories.localWebSessions.insert({
      id: "local-web-ws",
      sessionId: "thread-1",
      targetUrl: target.baseUrl,
      proxyUrl: "/local-web/local-web-ws/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });
    const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const ws = new WebSocket(`wss://127.0.0.1:${address.port}/local-web/local-web-ws/hmr?code_auth=${encodeURIComponent(claimed.authToken)}`);
    const messages: string[] = [];
    ws.addEventListener("message", (event) => {
      messages.push(String(event.data));
    });

    await waitForWebSocketOpen(ws);
    ws.send("ping");

    expect(await waitForMessage(messages, "echo:ping")).toBe(true);
    ws.close();
    if (previousTlsSetting === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
    }
  });

  it("marks WebSocket upgrade proxying as unsupported in the HTTP proxy path", async () => {
    const target = await startTargetServer();
    const context = createTestAppContext();
    const proxy = createLocalWebProxy({ repository: context.repositories.localWebSessions });
    context.repositories.localWebSessions.insert({
      id: "local-web-upgrade",
      sessionId: "thread-1",
      targetUrl: target.baseUrl,
      proxyUrl: "/local-web/local-web-upgrade/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
      error: ""
    });

    await expect(proxy.proxyRequest({
      method: "GET",
      url: "/local-web/local-web-upgrade/socket",
      headers: {
        upgrade: "websocket",
        connection: "Upgrade"
      }
    } as never, "local-web-upgrade", "socket")).rejects.toMatchObject({
      code: "LOCAL_WEB_UPGRADE_UNSUPPORTED"
    });
  });

  async function startTargetServer(): Promise<{ baseUrl: string }> {
    targetServer = createNodeServer((request, response) => {
      if (request.url === "/app.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end("window.count = 1;");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<!doctype html><button id="count">0</button><script src="/app.js"></script>');
    });
    await new Promise<void>((resolve) => targetServer?.listen(0, "127.0.0.1", () => resolve()));
    const address = targetServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("target server failed to listen");
    }
    return { baseUrl: `http://127.0.0.1:${address.port}` };
  }

  async function startPathTargetServer(): Promise<{ baseUrl: string }> {
    targetServer = createNodeServer((request, response) => {
      if (request.url === "/nested/page.html") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<!doctype html><main>nested page loaded</main>");
        return;
      }
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    });
    await new Promise<void>((resolve) => targetServer?.listen(0, "127.0.0.1", () => resolve()));
    const address = targetServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("target server failed to listen");
    }
    return { baseUrl: `http://127.0.0.1:${address.port}` };
  }

  async function startSseTargetServer(): Promise<{ baseUrl: string }> {
    targetServer = createNodeServer((request, response) => {
      if (request.url === "/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache"
        });
        response.write("data: first\n\n");
        setTimeout(() => {
          response.end("data: second\n\n");
        }, 250);
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => targetServer?.listen(0, "127.0.0.1", () => resolve()));
    const address = targetServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("target server failed to listen");
    }
    return { baseUrl: `http://127.0.0.1:${address.port}` };
  }

  async function startWebSocketTargetServer(): Promise<{ baseUrl: string }> {
    targetFastify = Fastify();
    await targetFastify.register(websocket);
    targetFastify.get("/hmr", { websocket: true }, (socket) => {
      socket.on("message", (value: Buffer) => {
        socket.send("echo:" + value.toString());
      });
    });
    await targetFastify.listen({ port: 0, host: "127.0.0.1" });
    const address = targetFastify.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("websocket target failed to listen");
    }
    return { baseUrl: `http://127.0.0.1:${address.port}` };
  }

  function readHttpsStream(input: { url: string; authorization: string }): Promise<{ firstChunk: string; firstChunkAtMs: number; body: string }> {
    return new Promise((resolve, reject) => {
      let firstChunk = "";
      let firstChunkAtMs = 0;
      const chunks: string[] = [];
      const request = https.request(input.url, {
        headers: { authorization: input.authorization },
        rejectUnauthorized: false
      }, (response) => {
        response.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          if (firstChunk.length === 0) {
            firstChunk = text;
            firstChunkAtMs = Date.now();
          }
          chunks.push(text);
        });
        response.on("end", () => {
          resolve({ firstChunk, firstChunkAtMs, body: chunks.join("") });
        });
        response.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    });
  }

  async function waitForMessage(messages: string[], expected: string): Promise<boolean> {
    for (let index = 0; index < 100; index++) {
      if (messages.includes(expected)) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  }

  function waitForWebSocketOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("websocket open failed")), { once: true });
    });
  }
});
