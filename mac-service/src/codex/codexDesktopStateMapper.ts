import path from "node:path";
import type { SessionSummary } from "../domain/sessionService.js";
import { isCodexGeneratedConversationWorkspace, type SessionDetail, type SessionMessage } from "./codexSessionManager.js";
import { mapCodexThreadToTimeline, type SessionTurn } from "./codexTimelineMapper.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unixOrMsToIso(value: unknown, fallback: string): string {
  const numberValue = numberOrNull(value);
  if (numberValue !== null) {
    const millis = numberValue < 1000000000000 ? Math.round(numberValue * 1000) : Math.round(numberValue);
    return new Date(millis).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

function projectNameFromPath(projectPath: string | null): string | null {
  if (!projectPath) return null;
  const parts = projectPath.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : projectPath;
}

function projectPathFromDesktopCwd(cwd: string | null): string | null {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  if (isCodexGeneratedConversationWorkspace(cwd)) return null;
  return cwd;
}

function statusLabelFromConversationState(state: Record<string, unknown>): string {
  const runtimeStatus = asRecord(state.threadRuntimeStatus);
  return stringOrNull(runtimeStatus.type) ?? "idle";
}

function textFromContent(content: unknown): string {
  return asArray(content)
    .map((entry) => stringOrNull(asRecord(entry).text) ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function visibleTextFromDesktopItem(item: Record<string, unknown>): string {
  const type = stringOrNull(item.type);
  if (type === "userMessage") return textFromContent(item.content);
  if (type === "agentMessage") return stringOrNull(item.text) ?? "";
  return "";
}

function normalizedDesktopTurn(turnInput: unknown): Record<string, unknown> {
  const turn = asRecord(turnInput);
  const startedAt = turn.startedAt ?? turn.createdAt ?? turn.turnStartedAtMs;
  const completedAt = turn.completedAt ?? turn.completed_at;
  return {
    ...turn,
    id: stringOrNull(turn.id) ?? stringOrNull(turn.turnId),
    startedAt: startedAt === undefined ? null : unixOrMsToIso(startedAt, new Date().toISOString()),
    completedAt: completedAt === undefined || completedAt === null ? null : unixOrMsToIso(completedAt, new Date().toISOString()),
    status: turn.status ?? "idle",
    items: asArray(turn.items)
  };
}

function normalizedThreadFromConversationState(state: Record<string, unknown>): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  return {
    id: stringOrNull(state.id) ?? stringOrNull(state.conversationId),
    name: stringOrNull(state.title) ?? "Codex 会话",
    createdAt: unixOrMsToIso(state.createdAt, nowIso),
    updatedAt: unixOrMsToIso(state.updatedAt, nowIso),
    status: state.threadRuntimeStatus ?? { type: "idle" },
    cwd: stringOrNull(state.cwd) ?? null,
    path: state.rolloutPath ?? null,
    source: state.source ?? "desktop",
    modelProvider: state.modelProvider ?? null,
    gitInfo: state.gitInfo ?? null,
    turns: asArray(state.turns).map(normalizedDesktopTurn)
  };
}

function messagesFromDesktopConversationState(state: Record<string, unknown>, sessionId: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  const turns = asArray(state.turns);
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = asRecord(turns[turnIndex]);
    const turnId = stringOrNull(turn.turnId) ?? stringOrNull(turn.id) ?? `turn-${turnIndex + 1}`;
    const createdAt = unixOrMsToIso(turn.turnStartedAtMs ?? turn.startedAt ?? turn.createdAt, new Date().toISOString());
    const items = asArray(turn.items);
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = asRecord(items[itemIndex]);
      const type = stringOrNull(item.type);
      const role = type === "agentMessage" ? "assistant" : null;
      if (!role) continue;
      const text = visibleTextFromDesktopItem(item);
      if (text.length === 0) continue;
      messages.push({
        id: stringOrNull(item.id) ?? `${sessionId}:${turnId}:${itemIndex + 1}`,
        sessionId,
        role,
        text,
        rawText: text,
        createdAt,
        sendState: null,
        clientMessageId: null,
        canWithdraw: false
      });
    }
  }
  return messages;
}

export function sessionDetailFromDesktopConversationState(conversationStateInput: unknown): SessionDetail {
  const state = asRecord(conversationStateInput);
  const thread = normalizedThreadFromConversationState(state);
  const sessionId = stringOrNull(thread.id) ?? "unknown-desktop-thread";
  const messages = messagesFromDesktopConversationState(state, sessionId);
  const turns: SessionTurn[] = mapCodexThreadToTimeline(thread, sessionId);
  const cwd = stringOrNull(thread.cwd);
  const projectPath = projectPathFromDesktopCwd(cwd);
  const createdAt = unixOrMsToIso(state.createdAt, new Date().toISOString());
  const updatedAt = unixOrMsToIso(state.updatedAt, createdAt);
  const session: SessionSummary = {
    id: sessionId,
    toolId: "codex-mac",
    title: stringOrNull(state.title) ?? "Codex 会话",
    projectPath,
    projectName: projectNameFromPath(projectPath),
    createdAt,
    updatedAt,
    isPinned: false,
    needsUserInput: statusLabelFromConversationState(state).includes("approval") || statusLabelFromConversationState(state).includes("wait"),
    waitsForNextDirection: statusLabelFromConversationState(state) === "idle",
    statusLabel: statusLabelFromConversationState(state),
    lastMessagePreview: ""
  };

  return { session, messages, turns };
}
