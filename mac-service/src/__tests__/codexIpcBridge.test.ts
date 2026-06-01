import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCodexDesktopFollowerBridge,
  createCodexIpcClient,
  startCodexIpcRouter
} from "../codex/codexIpcBridge.js";

async function waitForExpectation(check: () => void): Promise<void> {
  const deadline = Date.now() + 1000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("timed out waiting for expectation");
}

describe("codex ipc bridge", () => {
  it("starts an owned codex-ipc router and initializes a client", async () => {
    const socketPath = path.join(os.tmpdir(), `code-codex-ipc-${process.pid}-${Date.now()}.sock`);
    const router = await startCodexIpcRouter(socketPath);
    const client = await createCodexIpcClient({ socketPath, clientType: "code-mobile-test" });

    expect(client.clientId).toMatch(/[0-9a-f-]{36}/);

    client.close();
    await router.stop();
  });

  it("lets a code-owned client answer desktop follower start-turn requests", async () => {
    const socketPath = path.join(os.tmpdir(), `code-codex-ipc-${process.pid}-${Date.now()}-owner.sock`);
    const router = await startCodexIpcRouter(socketPath);
    const handledParams: unknown[] = [];
    const owner = await createCodexIpcClient({
      socketPath,
      clientType: "code-mobile-owner",
      requestHandlers: {
        "thread-follower-start-turn": {
          canHandle: async (params) => params.conversationId === "thread-owned",
          handle: async (request) => {
            handledParams.push(request.params);
            return { turnId: "turn-from-owner", status: "running" };
          }
        }
      }
    });
    const follower = await createCodexIpcClient({ socketPath, clientType: "codex-desktop-follower" });

    const response = await follower.sendRequest("thread-follower-start-turn", {
      conversationId: "thread-owned",
      input: [{ type: "text", text: "继续", text_elements: [] }]
    });

    expect(response).toEqual(expect.objectContaining({
      type: "response",
      resultType: "success",
      method: "thread-follower-start-turn",
      result: { turnId: "turn-from-owner", status: "running" }
    }));
    expect(handledParams).toEqual([
      {
        conversationId: "thread-owned",
        input: [{ type: "text", text: "继续", text_elements: [] }]
      }
    ]);

    follower.close();
    owner.close();
    await router.stop();
  });

  it("does not create a shared codex-ipc router when follower-only desktop bridge cannot connect", async () => {
    const socketPath = path.join(os.tmpdir(), `code-missing-codex-ipc-${process.pid}-${Date.now()}.sock`);

    const bridge = await createCodexDesktopFollowerBridge({
      socketPath,
      onConversationStateChanged: () => undefined
    });

    expect(bridge).toBeNull();
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it("mirrors desktop owner snapshots and forwards mobile start-turn through follower requests", async () => {
    const socketPath = path.join(os.tmpdir(), `code-codex-ipc-${process.pid}-${Date.now()}-follower.sock`);
    const router = await startCodexIpcRouter(socketPath);
    const ownerRequests: unknown[] = [];
    const observedBroadcasts: unknown[] = [];
    const owner = await createCodexIpcClient({
      socketPath,
      clientType: "codex-desktop-owner",
      requestHandlers: {
        "thread-follower-start-turn": {
          canHandle: async (params) => params.conversationId === "thread-desktop",
          handle: async (request) => {
            ownerRequests.push(request.params);
            return { turnId: "turn-from-desktop-owner", status: "running" };
          }
        }
      }
    });
    const observer = await createCodexIpcClient({
      socketPath,
      clientType: "codex-observer",
      onBroadcast: (message) => {
        observedBroadcasts.push(message);
      }
    });
    const mirroredStates: unknown[] = [];
    const bridge = await createCodexDesktopFollowerBridge({
      socketPath,
      onConversationStateChanged: (state) => {
        mirroredStates.push(state);
      }
    });
    expect(bridge).not.toBeNull();

    owner.sendBroadcast("thread-stream-state-changed", {
      conversationId: "thread-desktop",
      hostId: "local",
      change: {
        type: "snapshot",
        conversationState: {
          id: "thread-desktop",
          title: "Desktop thread",
          hostId: "local",
          createdAt: 1778600000000,
          updatedAt: 1778600001000,
          threadRuntimeStatus: { type: "idle" },
          turns: []
        }
      }
    });
    await waitForExpectation(() => {
      expect(bridge?.getConversationState("thread-desktop")).toEqual(expect.objectContaining({
        id: "thread-desktop",
        title: "Desktop thread"
      }));
      expect(mirroredStates).toEqual([
        expect.objectContaining({ id: "thread-desktop", title: "Desktop thread" })
      ]);
    });

    const response = await bridge?.startTurn({ threadId: "thread-desktop", text: "来自移动端", clientUserMessageId: "client-start-1" });

    expect(response).toEqual(expect.objectContaining({
      resultType: "success",
      method: "thread-follower-start-turn",
      result: { turnId: "turn-from-desktop-owner", status: "running" }
    }));
    expect(ownerRequests).toEqual([
      expect.objectContaining({
        conversationId: "thread-desktop",
        turnStartParams: expect.objectContaining({
          threadId: "thread-desktop",
          clientUserMessageId: "client-start-1",
          input: [{ type: "text", text: "来自移动端", text_elements: [] }]
        })
      })
    ]);
    expect(observedBroadcasts).toHaveLength(1);

    bridge?.stop();
    observer.close();
    owner.close();
    await router.stop();
  });

  it("forwards structured localImage input items through follower requests", async () => {
    const socketPath = path.join(os.tmpdir(), `code-codex-ipc-${process.pid}-${Date.now()}-image-follower.sock`);
    const router = await startCodexIpcRouter(socketPath);
    const ownerRequests: unknown[] = [];
    const owner = await createCodexIpcClient({
      socketPath,
      clientType: "codex-desktop-owner",
      requestHandlers: {
        "thread-follower-start-turn": {
          canHandle: async (params) => params.conversationId === "thread-desktop-image",
          handle: async (request) => {
            ownerRequests.push({ method: request.method, params: request.params });
            return { turnId: "turn-from-desktop-owner", status: "running" };
          }
        },
        "thread-follower-steer-turn": {
          canHandle: async (params) => params.conversationId === "thread-desktop-image",
          handle: async (request) => {
            ownerRequests.push({ method: request.method, params: request.params });
            return { ok: true };
          }
        }
      }
    });
    const bridge = await createCodexDesktopFollowerBridge({
      socketPath,
      onConversationStateChanged: () => undefined
    });
    expect(bridge).not.toBeNull();

    owner.sendBroadcast("thread-stream-state-changed", {
      conversationId: "thread-desktop-image",
      hostId: "local",
      change: {
        type: "snapshot",
        conversationState: {
          id: "thread-desktop-image",
          title: "Desktop image thread",
          hostId: "local",
          threadRuntimeStatus: { type: "idle" },
          turns: []
        }
      }
    });
    await waitForExpectation(() => {
      expect(bridge?.getConversationState("thread-desktop-image")).toEqual(expect.objectContaining({
        id: "thread-desktop-image"
      }));
    });

    await bridge?.startTurn({
      threadId: "thread-desktop-image",
      clientUserMessageId: "client-start-image",
      inputItems: [
        { type: "text", text: "看图", text_elements: [] },
        { type: "localImage", path: "/tmp/pixel.png" },
        { type: "mention", name: "notes.md", path: "/tmp/notes.md" }
      ]
    });
    await bridge?.steerTurn({
      threadId: "thread-desktop-image",
      turnId: "turn-from-desktop-owner",
      clientUserMessageId: "client-steer-image",
      inputItems: [
        { type: "text", text: "补充图片", text_elements: [] },
        { type: "localImage", path: "/tmp/pixel-2.png" },
        { type: "mention", name: "notes-2.md", path: "/tmp/notes-2.md" }
      ]
    });

    expect(ownerRequests).toEqual([
      {
        method: "thread-follower-start-turn",
        params: expect.objectContaining({
          conversationId: "thread-desktop-image",
          turnStartParams: expect.objectContaining({
            clientUserMessageId: "client-start-image",
            input: [
              { type: "text", text: "看图", text_elements: [] },
              { type: "localImage", path: "/tmp/pixel.png" },
              { type: "mention", name: "notes.md", path: "/tmp/notes.md" }
            ]
          })
        })
      },
      {
        method: "thread-follower-steer-turn",
        params: expect.objectContaining({
          conversationId: "thread-desktop-image",
          clientUserMessageId: "client-steer-image",
          input: [
            { type: "text", text: "补充图片", text_elements: [] },
            { type: "localImage", path: "/tmp/pixel-2.png" },
            { type: "mention", name: "notes-2.md", path: "/tmp/notes-2.md" }
          ]
        })
      }
    ]);

    bridge?.stop();
    owner.close();
    await router.stop();
  });

  it("forwards startup interrupt requests with an empty turn id", async () => {
    const socketPath = path.join(os.tmpdir(), `code-codex-ipc-${process.pid}-${Date.now()}-interrupt-follower.sock`);
    const router = await startCodexIpcRouter(socketPath);
    const ownerRequests: unknown[] = [];
    const owner = await createCodexIpcClient({
      socketPath,
      clientType: "codex-desktop-owner",
      requestHandlers: {
        "thread-follower-interrupt-turn": {
          canHandle: async (params) => params.conversationId === "thread-desktop-startup",
          handle: async (request) => {
            ownerRequests.push(request.params);
            return { ok: true };
          }
        }
      }
    });
    const bridge = await createCodexDesktopFollowerBridge({
      socketPath,
      onConversationStateChanged: () => undefined
    });
    expect(bridge).not.toBeNull();

    const response = await bridge?.interruptTurn({ threadId: "thread-desktop-startup", turnId: "" });

    expect(response).toEqual(expect.objectContaining({
      resultType: "success",
      method: "thread-follower-interrupt-turn",
      result: { ok: true }
    }));
    expect(ownerRequests).toEqual([
      {
        conversationId: "thread-desktop-startup",
        turnId: ""
      }
    ]);

    bridge?.stop();
    owner.close();
    await router.stop();
  });

  it("applies desktop owner stream patches including array append operations", async () => {
    const socketPath = path.join(os.tmpdir(), `code-codex-ipc-${process.pid}-${Date.now()}-patch.sock`);
    const router = await startCodexIpcRouter(socketPath);
    const owner = await createCodexIpcClient({ socketPath, clientType: "codex-desktop-owner" });
    const mirroredStates: unknown[] = [];
    const bridge = await createCodexDesktopFollowerBridge({
      socketPath,
      onConversationStateChanged: (state) => {
        mirroredStates.push(state);
      }
    });

    owner.sendBroadcast("thread-stream-state-changed", {
      conversationId: "thread-patch",
      hostId: "local",
      change: {
        type: "snapshot",
        conversationState: {
          id: "thread-patch",
          title: "Before patch",
          turns: []
        }
      }
    });
    await waitForExpectation(() => {
      expect(bridge?.getConversationState("thread-patch")).toEqual(expect.objectContaining({
        title: "Before patch",
        turns: []
      }));
      expect(mirroredStates).toHaveLength(1);
    });
    owner.sendBroadcast("thread-stream-state-changed", {
      conversationId: "thread-patch",
      hostId: "local",
      change: {
        type: "patches",
        patches: [
          { op: "replace", path: "/title", value: "After patch" },
          { op: "add", path: "/turns/-", value: { turnId: "turn-1", status: "inProgress", items: [] } }
        ]
      }
    });
    await waitForExpectation(() => {
      expect(bridge?.getConversationState("thread-patch")).toEqual(expect.objectContaining({
        title: "After patch",
        turns: [{ turnId: "turn-1", status: "inProgress", items: [] }]
      }));
      expect(mirroredStates).toHaveLength(2);
    });

    bridge?.stop();
    owner.close();
    await router.stop();
  });

});
