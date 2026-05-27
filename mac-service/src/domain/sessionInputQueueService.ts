import { nanoid } from "nanoid";
import type { SessionInputGuidance } from "./inputGuidance.js";
import type {
  SessionInputQueueStatus,
  StoredSessionInputQueueItem
} from "../storage/repositories.js";

export type { SessionInputQueueStatus };

export interface SessionInputQueueItem {
  id: string;
  sessionId: string;
  clientMessageId: string;
  text: string;
  textPreview: string;
  textLength: number;
  status: SessionInputQueueStatus;
  guidance: SessionInputGuidance;
  createdAt: string;
  updatedAt: string;
}

export interface SessionInputQueueSendItem extends SessionInputQueueItem {
  text: string;
}

export interface EnqueueSessionInput {
  sessionId: string;
  clientMessageId: string;
  text: string;
  guidance: SessionInputGuidance;
}

export interface SessionInputQueueRepository {
  saveInputQueueItem(item: StoredSessionInputQueueItem): void;
  listInputQueueItems(sessionId: string): StoredSessionInputQueueItem[];
  updateInputQueueItemStatus(input: {
    sessionId: string;
    id: string;
    status: SessionInputQueueStatus;
    updatedAt: string;
  }): void;
}

function preview(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed;
}

function parseGuidance(guidanceJson: string): SessionInputGuidance {
  return JSON.parse(guidanceJson) as SessionInputGuidance;
}

function toPublicItem(item: StoredSessionInputQueueItem): SessionInputQueueItem {
  return {
    id: item.id,
    sessionId: item.sessionId,
    clientMessageId: item.clientMessageId,
    text: item.text,
    textPreview: item.textPreview,
    textLength: item.textLength,
    status: item.status,
    guidance: parseGuidance(item.guidanceJson),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

function toSendItem(item: StoredSessionInputQueueItem): SessionInputQueueSendItem {
  return {
    ...toPublicItem(item),
    text: item.text
  };
}

export function createSessionInputQueueService(repository?: SessionInputQueueRepository) {
  const memoryItems = new Map<string, StoredSessionInputQueueItem[]>();

  function listStored(sessionId: string): StoredSessionInputQueueItem[] {
    if (repository) {
      return repository.listInputQueueItems(sessionId);
    }
    return [...(memoryItems.get(sessionId) ?? [])];
  }

  function replaceStored(sessionId: string, nextItems: StoredSessionInputQueueItem[]): void {
    memoryItems.set(sessionId, nextItems);
  }

  function saveStored(item: StoredSessionInputQueueItem): void {
    if (repository) {
      repository.saveInputQueueItem(item);
      return;
    }
    replaceStored(item.sessionId, [...listStored(item.sessionId), item]);
  }

  function updateStatus(sessionId: string, id: string, status: SessionInputQueueStatus): SessionInputQueueItem {
    const existing = listStored(sessionId).find((item) => item.id === id);
    if (!existing) throw new Error("队列项不存在");
    const updatedAt = new Date().toISOString();
    if (repository) {
      repository.updateInputQueueItemStatus({ sessionId, id, status, updatedAt });
    } else {
      replaceStored(sessionId, listStored(sessionId).map((item) => (
        item.id === id ? { ...item, status, updatedAt } : item
      )));
    }
    return toPublicItem({ ...existing, status, updatedAt });
  }

  function requireStatus(sessionId: string, id: string, allowedStatuses: SessionInputQueueStatus[], message: string): void {
    const existing = listStored(sessionId).find((item) => item.id === id);
    if (!existing) throw new Error("队列项不存在");
    if (!allowedStatuses.includes(existing.status)) {
      throw new Error(message);
    }
  }

  return {
    enqueue(input: EnqueueSessionInput): SessionInputQueueItem {
      const now = new Date().toISOString();
      const item: StoredSessionInputQueueItem = {
        id: `queue-${nanoid(16)}`,
        sessionId: input.sessionId,
        clientMessageId: input.clientMessageId,
        text: input.text,
        textPreview: preview(input.text),
        textLength: input.text.length,
        status: "queued",
        guidanceJson: JSON.stringify(input.guidance),
        createdAt: now,
        updatedAt: now
      };
      saveStored(item);
      return toPublicItem(item);
    },

    list(sessionId: string): SessionInputQueueItem[] {
      return listStored(sessionId).map(toPublicItem);
    },

    nextQueued(sessionId: string): SessionInputQueueSendItem | null {
      const item = listStored(sessionId).find((queueItem) => queueItem.status === "queued");
      return item ? toSendItem(item) : null;
    },

    cancel(sessionId: string, id: string): SessionInputQueueItem {
      requireStatus(sessionId, id, ["queued", "failed"], "当前队列项状态不可取消");
      return updateStatus(sessionId, id, "cancelled");
    },

    retry(sessionId: string, id: string): SessionInputQueueItem {
      requireStatus(sessionId, id, ["failed"], "只有发送失败的队列项可以重试");
      return updateStatus(sessionId, id, "queued");
    },

    markSending(sessionId: string, id: string): SessionInputQueueItem {
      return updateStatus(sessionId, id, "sending");
    },

    markSent(sessionId: string, id: string): SessionInputQueueItem {
      return updateStatus(sessionId, id, "sent");
    },

    markFailed(sessionId: string, id: string): SessionInputQueueItem {
      return updateStatus(sessionId, id, "failed");
    }
  };
}
