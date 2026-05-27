import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionInputQueueService } from "../domain/sessionInputQueueService.js";
import { openDatabase } from "../storage/db.js";
import { createRepositories } from "../storage/repositories.js";

describe("session input queue service", () => {
  it("enqueues, cancels, and returns the next queued item with text for automatic sending", () => {
    const service = createSessionInputQueueService();
    const first = service.enqueue({
      sessionId: "thread-1",
      clientMessageId: "client-1",
      text: "第一条",
      guidance: { mode: "queued", selectedCapabilityIds: [] }
    });
    const second = service.enqueue({
      sessionId: "thread-1",
      clientMessageId: "client-2",
      text: "第二条",
      guidance: { mode: "queued", selectedCapabilityIds: [] }
    });

    service.cancel("thread-1", first.id);

    expect(service.nextQueued("thread-1")).toMatchObject({ id: second.id, text: "第二条" });
    expect(service.list("thread-1").map((item) => item.status)).toEqual(["cancelled", "queued"]);
    expect(service.list("thread-1")[0]).toMatchObject({ text: "第一条" });
  });

  it("marks failed items as retryable queued items", () => {
    const service = createSessionInputQueueService();
    const item = service.enqueue({
      sessionId: "thread-1",
      clientMessageId: "client-1",
      text: "运行测试",
      guidance: { mode: "queued", selectedCapabilityIds: [] }
    });

    service.markSending("thread-1", item.id);
    service.markFailed("thread-1", item.id);
    service.retry("thread-1", item.id);

    expect(service.nextQueued("thread-1")?.id).toBe(item.id);
    expect(service.list("thread-1")[0].status).toBe("queued");
  });

  it("rejects retry for items that are not failed", () => {
    const service = createSessionInputQueueService();
    const item = service.enqueue({
      sessionId: "thread-1",
      clientMessageId: "client-1",
      text: "运行测试",
      guidance: { mode: "queued", selectedCapabilityIds: [] }
    });

    expect(() => service.retry("thread-1", item.id)).toThrow("只有发送失败的队列项可以重试");
  });

  it("rejects cancel for items already sending or sent", () => {
    const service = createSessionInputQueueService();
    const item = service.enqueue({
      sessionId: "thread-1",
      clientMessageId: "client-1",
      text: "发送",
      guidance: { mode: "queued", selectedCapabilityIds: [] }
    });

    service.markSending("thread-1", item.id);

    expect(() => service.cancel("thread-1", item.id)).toThrow("当前队列项状态不可取消");
  });

  it("allows failed items to be cancelled", () => {
    const service = createSessionInputQueueService();
    const item = service.enqueue({
      sessionId: "thread-1",
      clientMessageId: "client-1",
      text: "发送",
      guidance: { mode: "queued", selectedCapabilityIds: [] }
    });

    service.markSending("thread-1", item.id);
    service.markFailed("thread-1", item.id);

    expect(service.cancel("thread-1", item.id).status).toBe("cancelled");
  });

  it("marks queued items as sending and sent", () => {
    const service = createSessionInputQueueService();
    const item = service.enqueue({
      sessionId: "thread-1",
      clientMessageId: "client-1",
      text: "发送",
      guidance: { mode: "queued", selectedCapabilityIds: [] }
    });

    service.markSending("thread-1", item.id);
    expect(service.list("thread-1")[0].status).toBe("sending");
    expect(service.nextQueued("thread-1")).toBeNull();

    service.markSent("thread-1", item.id);
    expect(service.list("thread-1")[0].status).toBe("sent");
  });

  it("persists queued text privately and exposes public list metadata", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-input-queue-db-"));
    const db = openDatabase("queue.sqlite", { dataDir });
    const repositories = createRepositories(db);
    const service = createSessionInputQueueService(repositories);
    const item = service.enqueue({
      sessionId: "thread-1",
      clientMessageId: "client-1",
      text: "这是一条需要保留给自动发送的长输入",
      guidance: {
        mode: "queued",
        selectedCapabilityIds: ["skill:codex-home:frontend-design"]
      }
    });

    const reloaded = createSessionInputQueueService(repositories);
    expect(reloaded.list("thread-1")).toEqual([{
      id: item.id,
      sessionId: "thread-1",
      clientMessageId: "client-1",
      text: "这是一条需要保留给自动发送的长输入",
      textPreview: "这是一条需要保留给自动发送的长输入",
      textLength: "这是一条需要保留给自动发送的长输入".length,
      status: "queued",
      guidance: {
        mode: "queued",
        selectedCapabilityIds: ["skill:codex-home:frontend-design"]
      },
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }]);
    expect(reloaded.nextQueued("thread-1")).toMatchObject({
      id: item.id,
      text: "这是一条需要保留给自动发送的长输入"
    });

    reloaded.markSending("thread-1", item.id);
    expect(createSessionInputQueueService(repositories).list("thread-1")[0].status).toBe("sending");

    db.close();
  });
});
