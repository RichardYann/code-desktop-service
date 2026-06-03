import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodexRequestMethod, CodexServerRequestMethod } from "./codexAppServerProtocol.js";
import { mapCodexApprovalResponse, type CodexApprovalAnswers } from "./codexApprovalMapper.js";
import { normalizePlanStepStatus, type SessionPlanStep } from "./codexEventMapper.js";
import {
  isRuntimeConfigParameterUnsupportedError,
  mapRuntimeConfigToTurnParams,
  type CodexRuntimeCapabilities
} from "./codexRuntimeConfigMapper.js";
import type { CodexModelListSnapshot } from "./codexModelMapper.js";
import { mapCodexThreadToTimeline, type SessionTurn, type TimelineItem } from "./codexTimelineMapper.js";
import { approvalUpdatedEventsFromServerRequest } from "./codexTimelineRuntime.js";
import { classifyCodexThreadItem, textFromCodexThreadItem } from "./codexThreadItemClassifier.js";
import type { CodexTurnInputItem } from "../domain/codexTurnInputBuilder.js";
import type { SessionSummary } from "../domain/sessionService.js";
import type { SessionRuntimeConfig, SessionRuntimeConfigInput } from "../domain/sessionRuntimeConfigService.js";

const DETAIL_RESUME_TIMEOUT_MS = 2_000;

export interface CreateCodexSessionInput {
  projectPath: string | null;
  text: string;
  inputItems?: CodexTurnInputItem[];
  runtimeConfig?: SessionRuntimeConfigInput;
  clientUserMessageId?: string;
}

export interface CreateCodexThreadInput {
  projectPath: string | null;
  text: string;
}

export type CodexTurnInputSource =
  | { text: string; inputItems?: CodexTurnInputItem[]; clientUserMessageId?: string }
  | { text?: string; inputItems: CodexTurnInputItem[]; clientUserMessageId?: string };

export type StartTurnInput = { threadId: string; skipPreflightResume?: boolean } & CodexTurnInputSource;

export type SteerTurnInput = { threadId: string; turnId: string } & CodexTurnInputSource;

export interface InterruptTurnInput {
  threadId: string;
  turnId: string;
}

export interface RenameSessionInput {
  threadId: string;
  title: string;
}

export interface CodexSessionClient {
  request(method: CodexRequestMethod, params?: Record<string, unknown>): Promise<unknown>;
  respond(id: string, result: unknown): void;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  rawText: string;
  createdAt: string;
  sendState: "pending" | "received" | "failed" | null;
  clientMessageId: string | null;
  canWithdraw: boolean;
}

export interface SessionPlanUpdate {
  id: string;
  sessionId: string;
  createdAt: string;
  steps: SessionPlanStep[];
}

export interface SessionDetail {
  session: SessionSummary;
  messages: SessionMessage[];
  turns: SessionTurn[];
  approval?: TimelineItem["approval"] | null;
  rolloutPath?: string | null;
}

interface PendingApprovalRecord {
  id: string;
  method: CodexServerRequestMethod;
  params: Record<string, unknown>;
}

export interface CodexThreadMetadata {
  title: string | null;
  firstUserMessage: string | null;
  cwd?: string | null;
  rolloutPath?: string | null;
  archived?: boolean;
  contextTokensUsed?: number | null;
  contextWindowTokens?: number | null;
}

export interface CodexSessionManagerOptions {
  readSessionLogMessages?: (logPath: string, sessionId: string) => SessionMessage[] | Promise<SessionMessage[]>;
  readSessionLogPlanUpdates?: (logPath: string, sessionId: string) => SessionPlanUpdate[] | Promise<SessionPlanUpdate[]>;
  readThreadMetadata?: (threadIds: string[]) => Map<string, CodexThreadMetadata> | Promise<Map<string, CodexThreadMetadata>>;
  codexStateDbPath?: string;
  projectlessWorkspaceRoot?: string;
  now?: () => Date;
  ensureWorkspaceDirectory?: (workspacePath: string) => void;
  runtimeConfigForSession?: (threadId: string) => SessionRuntimeConfig | undefined | Promise<SessionRuntimeConfig | undefined>;
  codexRuntimeCapabilities?: CodexRuntimeCapabilities;
  listModels?: () => Promise<CodexModelListSnapshot>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
  throw new Error("Codex turn input must include text or inputItems");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    })
  ]);
}

function approvalThreadId(params: Record<string, unknown>): string | null {
  return stringOrNull(params.threadId) ?? stringOrNull(params.sessionId) ?? stringOrNull(params.conversationId);
}

function approvalTurnId(params: Record<string, unknown>): string | null {
  const turn = asRecord(params.turn);
  return stringOrNull(params.turnId) ?? stringOrNull(turn.id) ?? stringOrNull(turn.turnId);
}

const APPROVAL_ADJUSTMENT_ACTIONS = new Set(["decline", "reject", "deny", "disallow", "no", "cancel", "dismiss", "abort"]);

function firstApprovalAnswerText(answers: CodexApprovalAnswers | undefined, fieldId: string): string {
  if (!answers) return "";
  const field = answers[fieldId];
  if (!field) return "";
  for (const answer of field.answers) {
    const trimmed = answer.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

function approvalAdjustmentTextFromAnswers(answers: CodexApprovalAnswers | undefined): string {
  const preferred = firstApprovalAnswerText(answers, "reason") ||
    firstApprovalAnswerText(answers, "declineReason") ||
    firstApprovalAnswerText(answers, "adjustment") ||
    firstApprovalAnswerText(answers, "answer");
  if (preferred.length > 0) return preferred;
  if (!answers) return "";
  for (const key of Object.keys(answers)) {
    const value = firstApprovalAnswerText(answers, key);
    if (value.length > 0) return value;
  }
  return "";
}

function shouldSteerApprovalAdjustment(method: CodexServerRequestMethod, actionId: string, answers: CodexApprovalAnswers | undefined): boolean {
  if (method !== "item/commandExecution/requestApproval" && method !== "item/fileChange/requestApproval") return false;
  if (!APPROVAL_ADJUSTMENT_ACTIONS.has(actionId)) return false;
  return approvalAdjustmentTextFromAnswers(answers).length > 0;
}

function isInactiveTurnSteerError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("not active") ||
    message.includes("no active") ||
    message.includes("not found") ||
    message.includes("completed") ||
    message.includes("expectedturnid") ||
    message.includes("expected turn");
}

function normalizeTurnStatus(status: unknown): string {
  if (status === "inProgress") return "running";
  if (typeof status === "string") return status;
  return "running";
}

function isThreadNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("thread not found");
}

function codexErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Codex App Server request failed";
}

async function withCodexStage<T>(stage: "thread/resume" | "turn/start" | "thread/compact/start", action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw new Error(`Codex ${stage} failed: ${codexErrorMessage(error)}`);
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function nonGenericTitle(value: unknown): string | null {
  const title = stringOrNull(value);
  return title !== null && title !== "Codex 会话" ? title : null;
}

function unixSecondsToIso(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
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

function titleFromCodeMobileWorkspace(workspacePath: string | null): string | null {
  if (!workspacePath) return null;
  const directoryName = path.basename(workspacePath);
  const match = /^code-mobile-\d{8}-\d{6}-(.+)$/.exec(directoryName);
  if (!match) return null;
  const title = match[1].replace(/-/g, " ").trim();
  return title.length > 0 ? title : null;
}

export function isCodexGeneratedConversationWorkspace(projectPath: string): boolean {
  const resolvedPath = path.resolve(projectPath);
  const generatedRoot = path.resolve(path.join(os.homedir(), "Documents", "Codex"));
  return resolvedPath === generatedRoot || resolvedPath.startsWith(`${generatedRoot}${path.sep}`);
}

function slugFromText(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "conversation";
}

function timestampForWorkspace(date: Date): string {
  return date.toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
}

function projectlessWorkspacePath(input: { text: string; now: Date; root: string }): string {
  const datePart = input.now.toISOString().slice(0, 10);
  const directoryName = `code-mobile-${timestampForWorkspace(input.now)}-${slugFromText(input.text)}`;
  return path.join(input.root, datePart, directoryName);
}

function createSessionCwd(input: CreateCodexSessionInput, options: CodexSessionManagerOptions): string {
  if (input.projectPath !== null && input.projectPath.trim().length > 0) return input.projectPath;
  const workspacePath = projectlessWorkspacePath({
    text: input.text,
    now: options.now?.() ?? new Date(),
    root: options.projectlessWorkspaceRoot ?? path.join(os.homedir(), "Documents", "Codex")
  });
  const ensureWorkspaceDirectory = options.ensureWorkspaceDirectory ?? ((directoryPath: string): void => {
    fs.mkdirSync(directoryPath, { recursive: true });
  });
  ensureWorkspaceDirectory(workspacePath);
  return workspacePath;
}

function projectPathFromCodexThread(thread: Record<string, unknown>): string | null {
  const explicitProjectPath = stringOrNull(thread.projectPath);
  if (explicitProjectPath) return explicitProjectPath;

  const cwd = stringOrNull(thread.cwd);
  if (!cwd) return null;
  if (isCodexGeneratedConversationWorkspace(cwd)) return null;
  return cwd;
}

function codexStatusLabel(status: unknown): string {
  if (typeof status === "string" && status.length > 0) return status;
  const record = asRecord(status);
  const type = stringOrNull(record.type);
  return type ?? "idle";
}

function booleanFromSqliteFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function nonnegativeIntegerOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  const parsed = nonnegativeIntegerOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function firstNonnegativeInteger(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = nonnegativeIntegerOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstPositiveInteger(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = positiveIntegerOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function messageFromCodexItem(input: { sessionId: string; item: unknown; fallbackId: string; createdAt: string }): SessionMessage | null {
  const item = asRecord(input.item);
  const classified = classifyCodexThreadItem(item);
  if (!classified || classified.kind !== "agentMessage") return null;
  const text = classified.visibleText ?? textFromCodexThreadItem(item).trim();
  if (text.length === 0) return null;
  const id = stringOrNull(item.id) ?? input.fallbackId;
  return {
    id,
    sessionId: input.sessionId,
    role: "assistant",
    text,
    rawText: classified.rawText.length > 0 ? classified.rawText : text,
    createdAt: input.createdAt,
    sendState: null,
    clientMessageId: null,
    canWithdraw: false
  };
}

function mapCodexTurnsToMessages(thread: Record<string, unknown>, sessionId: string): SessionMessage[] {
  const turns = asArray(thread.turns);
  const messages: SessionMessage[] = [];
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = asRecord(turns[turnIndex]);
    const turnId = stringOrNull(turn.id) ?? stringOrNull(turn.turnId) ?? `turn-${turnIndex + 1}`;
    const createdAt = unixSecondsToIso(turn.createdAt ?? turn.startedAt ?? turn.turnStartedAtMs, new Date().toISOString());
    const items = asArray(turn.items);
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const message = messageFromCodexItem({
        sessionId,
        item: items[itemIndex],
        fallbackId: `${sessionId}:${turnId}:${itemIndex + 1}`,
        createdAt
      });
      if (message) messages.push(message);
    }
  }
  return messages;
}

function mergeSessionMessages(primary: SessionMessage[], secondary: SessionMessage[]): SessionMessage[] {
  const merged = [...primary];
  for (const message of secondary) {
    if (!hasMatchingSessionMessage(merged, message)) {
      merged.push(message);
    }
  }
  return merged.sort((left, right) => safeTimeMs(left.createdAt) - safeTimeMs(right.createdAt));
}

function hasMatchingSessionMessage(messages: SessionMessage[], target: SessionMessage): boolean {
  for (const message of messages) {
    if (message.id === target.id) return true;
    if (message.role !== target.role || message.text !== target.text) continue;
    if (target.role === "assistant") return true;
    const leftTime = Date.parse(message.createdAt);
    const rightTime = Date.parse(target.createdAt);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return true;
    if (Math.abs(leftTime - rightTime) <= 2000) return true;
  }
  return false;
}

function safeTimeMs(value: string | null): number {
  if (value === null) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeMsOrNull(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bestTimelineItemText(item: TimelineItem): string {
  return item.text.length > 0 ? item.text : item.rawText;
}

function hasTimelineAgentForMessage(turns: SessionTurn[], message: SessionMessage): boolean {
  const messageText = message.text.length > 0 ? message.text : message.rawText;
  if (messageText.length === 0) return true;
  for (const turn of turns) {
    for (const item of turn.items) {
      if (item.kind !== "agentMessage") continue;
      if (item.id === message.id) return true;
      if (bestTimelineItemText(item) === messageText) return true;
    }
  }
  return false;
}

function previousUserText(messages: SessionMessage[], messageIndex: number): string {
  for (let index = messageIndex - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant") return "";
    if (message.role === "user") {
      return message.text.length > 0 ? message.text : message.rawText;
    }
  }
  return "";
}

function earliestItemCreatedAt(items: TimelineItem[]): string | null {
  let earliest: string | null = null;
  for (const item of items) {
    const value = item.createdAt.length > 0 ? item.createdAt : item.updatedAt;
    if (earliest === null || safeTimeMs(value) < safeTimeMs(earliest)) {
      earliest = value;
    }
  }
  return earliest;
}

function turnStartTimeMs(turn: SessionTurn): number | null {
  return timeMsOrNull(turn.startedAt) ?? timeMsOrNull(earliestItemCreatedAt(turn.items));
}

function turnEndTimeMs(turn: SessionTurn): number | null {
  return timeMsOrNull(turn.completedAt) ?? timeMsOrNull(latestItemUpdatedAt(turn.items));
}

function findTurnForLogAssistantByTime(turns: SessionTurn[], message: SessionMessage): number {
  const messageTime = timeMsOrNull(message.createdAt);
  if (messageTime === null) return -1;
  const toleranceMs = 2000;
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = turns[turnIndex];
    const startTime = turnStartTimeMs(turn);
    if (startTime === null) continue;
    const nextTurn = turnIndex + 1 < turns.length ? turns[turnIndex + 1] : null;
    const nextStartTime = nextTurn ? turnStartTimeMs(nextTurn) : null;
    let endTime = turnEndTimeMs(turn);
    if (endTime === null || endTime <= startTime + toleranceMs) {
      endTime = nextStartTime !== null && nextStartTime > startTime ? nextStartTime : null;
    }
    if (endTime === null && turnIndex === turns.length - 1) {
      endTime = Number.MAX_SAFE_INTEGER;
    }
    if (endTime === null) continue;
    if (messageTime >= startTime - toleranceMs && messageTime <= endTime + toleranceMs) {
      return turnIndex;
    }
  }
  return -1;
}

function findTurnForLogAssistant(turns: SessionTurn[], messages: SessionMessage[], messageIndex: number): number {
  const userText = previousUserText(messages, messageIndex);
  if (userText.length > 0) {
    for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex--) {
      const turn = turns[turnIndex];
      for (const item of turn.items) {
        if (item.kind === "userMessage" && bestTimelineItemText(item) === userText) {
          return turnIndex;
        }
      }
    }
  }
  const message = messages[messageIndex];
  const timeMatchedTurnIndex = findTurnForLogAssistantByTime(turns, message);
  if (timeMatchedTurnIndex >= 0) return timeMatchedTurnIndex;
  if (turns.length === 1) return 0;
  return -1;
}

function logMessageToTimelineItem(message: SessionMessage, turnId: string): TimelineItem {
  return {
    id: message.id,
    sessionId: message.sessionId,
    turnId,
    kind: "agentMessage",
    status: "completed",
    title: "",
    text: message.text,
    rawText: message.rawText,
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    isStreaming: false,
    isCollapsedByDefault: false,
    command: null,
    diff: null,
    approval: null,
    planSteps: [],
    assetIds: []
  };
}

function planUpdateStatus(steps: SessionPlanUpdate["steps"]): TimelineItem["status"] {
  if (steps.length === 0) return "pending";
  let completed = 0;
  for (const step of steps) {
    if (step.status === "failed") return "failed";
    if (step.status === "in_progress") return "running";
    if (step.status === "completed") completed++;
  }
  return completed === steps.length ? "completed" : "pending";
}

function logPlanUpdateToTimelineItem(update: SessionPlanUpdate, turnId: string): TimelineItem {
  const status = planUpdateStatus(update.steps);
  return {
    id: update.id,
    sessionId: update.sessionId,
    turnId,
    kind: "plan",
    status,
    title: "计划",
    text: "",
    rawText: "",
    createdAt: update.createdAt,
    updatedAt: update.createdAt,
    isStreaming: status === "running",
    isCollapsedByDefault: true,
    command: null,
    diff: null,
    approval: null,
    planSteps: update.steps
  };
}

function isTerminalTimelineTurn(turn: SessionTurn): boolean {
  if (turn.status === "completed" || turn.status === "failed" || turn.status === "interrupted") {
    return true;
  }
  return typeof turn.completedAt === "string" && turn.completedAt.length > 0;
}

function settledLogPlanItemForTurn(item: TimelineItem, turn: SessionTurn): TimelineItem {
  if (!isTerminalTimelineTurn(turn)) return item;
  if (item.status !== "running" && !item.isStreaming) return item;
  return {
    ...item,
    status: item.status === "failed" ? "failed" : "completed",
    isStreaming: false
  };
}

function latestItemUpdatedAt(items: TimelineItem[]): string | null {
  let latest: string | null = null;
  for (const item of items) {
    const value = item.updatedAt.length > 0 ? item.updatedAt : item.createdAt;
    if (latest === null || safeTimeMs(value) > safeTimeMs(latest)) {
      latest = value;
    }
  }
  return latest;
}

function findTurnForLogPlanUpdate(turns: SessionTurn[], update: SessionPlanUpdate): number {
  const updateTime = timeMsOrNull(update.createdAt);
  if (updateTime === null) return turns.length === 1 ? 0 : -1;
  const toleranceMs = 2000;
  let latestStartedTurnIndex = -1;
  let latestStartedAt = Number.NEGATIVE_INFINITY;
  for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
    const turn = turns[turnIndex];
    const startTime = turnStartTimeMs(turn);
    if (startTime === null) continue;
    const nextTurn = turnIndex + 1 < turns.length ? turns[turnIndex + 1] : null;
    const nextStartTime = nextTurn ? turnStartTimeMs(nextTurn) : null;
    let endTime = turnEndTimeMs(turn);
    if (endTime === null || endTime <= startTime + toleranceMs) {
      endTime = nextStartTime !== null && nextStartTime > startTime ? nextStartTime : null;
    }
    if (endTime === null && turnIndex === turns.length - 1) {
      endTime = Number.MAX_SAFE_INTEGER;
    }
    if (updateTime >= startTime - toleranceMs && endTime !== null && updateTime <= endTime + toleranceMs) {
      return turnIndex;
    }
    if (startTime <= updateTime && startTime > latestStartedAt) {
      latestStartedAt = startTime;
      latestStartedTurnIndex = turnIndex;
    }
  }
  if (latestStartedTurnIndex >= 0) return latestStartedTurnIndex;
  return turns.length === 1 ? 0 : -1;
}

function mergeLogPlanUpdatesIntoTimelineTurns(turns: SessionTurn[], updates: SessionPlanUpdate[]): SessionTurn[] {
  const merged = turns.map((turn) => ({
    ...turn,
    items: [...turn.items]
  }));
  if (merged.length === 0) return merged;

  for (const update of updates) {
    if (update.steps.length === 0) continue;
    const turnIndex = findTurnForLogPlanUpdate(merged, update);
    if (turnIndex < 0) continue;
    const turn = merged[turnIndex];
    const item = settledLogPlanItemForTurn(logPlanUpdateToTimelineItem(update, turn.id), turn);
    const existingIndex = turn.items.findIndex((candidate) => candidate.id === item.id);
    if (existingIndex >= 0) {
      turn.items[existingIndex] = item;
    } else {
      turn.items.push(item);
    }
    turn.items.sort((left, right) => safeTimeMs(left.createdAt) - safeTimeMs(right.createdAt));
    merged[turnIndex] = turn;
  }
  return merged;
}

function mergeLogMessagesIntoTimelineTurns(turns: SessionTurn[], messages: SessionMessage[]): SessionTurn[] {
  const merged = turns.map((turn) => ({
    ...turn,
    items: [...turn.items]
  }));
  if (merged.length === 0) return merged;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") continue;
    if (hasTimelineAgentForMessage(merged, message)) continue;
    const turnIndex = findTurnForLogAssistant(merged, messages, messageIndex);
    if (turnIndex < 0) continue;

    const turn = merged[turnIndex];
    turn.items.push(logMessageToTimelineItem(message, turn.id));
    turn.items.sort((left, right) => safeTimeMs(left.createdAt) - safeTimeMs(right.createdAt));
    if (turn.status !== "failed" && turn.status !== "interrupted") {
      turn.status = "completed";
    }
    if (turn.startedAt === null || turn.startedAt.length === 0) {
      const firstItem = turn.items.length > 0 ? turn.items[0] : null;
      turn.startedAt = firstItem ? firstItem.createdAt : message.createdAt;
    }
    const completedAt = latestItemUpdatedAt(turn.items);
    if (completedAt !== null && turn.status === "completed") {
      turn.completedAt = completedAt;
    }
    merged[turnIndex] = turn;
  }
  return merged;
}

function mapUpdatePlanSteps(input: unknown): SessionPlanUpdate["steps"] {
  return asArray(input).map((stepInput, index) => {
    const step = asRecord(stepInput);
    return {
      id: stringOrNull(step.id) ?? `step-${index + 1}`,
      title: stringOrNull(step.title) ?? stringOrNull(step.step) ?? `Step ${index + 1}`,
      status: normalizePlanStepStatus(step.status),
      detail: stringOrNull(step.detail) ?? ""
    };
  });
}

function updatePlanArguments(payload: Record<string, unknown>): Record<string, unknown> {
  const argumentsText = stringOrNull(payload.arguments) ?? stringOrNull(payload.input);
  if (argumentsText === null) return {};
  try {
    return asRecord(JSON.parse(argumentsText) as unknown);
  } catch {
    return {};
  }
}

function functionCallArguments(payload: Record<string, unknown>): Record<string, unknown> {
  const argumentsText = stringOrNull(payload.arguments) ?? stringOrNull(payload.input);
  if (argumentsText === null) return {};
  try {
    return asRecord(JSON.parse(argumentsText) as unknown);
  } catch {
    return {};
  }
}

function isoTimeMs(value: string | null): number {
  if (value === null) return Date.now();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function commandTextFromExecArguments(args: Record<string, unknown>): string {
  const direct = stringOrNull(args.cmd) ?? stringOrNull(args.command);
  if (direct !== null) return direct;
  const argv = asArray(args.command);
  if (argv.length > 0) {
    return argv.map((part) => String(part)).join(" ");
  }
  return "";
}

export function readCodexJsonlPendingApproval(jsonl: string, sessionId: string): PendingApprovalRecord | null {
  const pending = new Map<string, PendingApprovalRecord>();
  let latestTurnId = "";
  const lines = jsonl.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length === 0) continue;

    try {
      const entry = asRecord(JSON.parse(line) as unknown);
      const timestamp = stringOrNull(entry.timestamp);
      const entryType = stringOrNull(entry.type);
      const payload = asRecord(entry.payload);
      if (entryType === "event_msg") {
        const payloadType = stringOrNull(payload.type);
        const turnId = stringOrNull(payload.turn_id) ?? stringOrNull(payload.turnId);
        if ((payloadType === "task_started" || payloadType === "turn_aborted") && turnId !== null) {
          latestTurnId = turnId;
          if (payloadType === "turn_aborted") {
            for (const [id, request] of pending.entries()) {
              if (approvalTurnId(request.params) === turnId) pending.delete(id);
            }
          }
        }
        continue;
      }

      if (entryType !== "response_item") continue;
      const payloadType = stringOrNull(payload.type);
      if (payloadType === "function_call_output") {
        const callId = stringOrNull(payload.call_id) ?? stringOrNull(payload.callId);
        if (callId !== null) pending.delete(callId);
        continue;
      }
      if (payloadType !== "function_call" || stringOrNull(payload.name) !== "exec_command") continue;
      const callId = stringOrNull(payload.call_id) ?? stringOrNull(payload.callId);
      if (callId === null) continue;
      const args = functionCallArguments(payload);
      if (stringOrNull(args.sandbox_permissions) !== "require_escalated" &&
        stringOrNull(args.sandboxPermissions) !== "require_escalated") {
        continue;
      }
      const command = commandTextFromExecArguments(args);
      if (command.length === 0) continue;
      pending.set(callId, {
        id: callId,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: sessionId,
          turnId: latestTurnId,
          itemId: callId,
          startedAtMs: isoTimeMs(timestamp),
          reason: stringOrNull(args.justification) ?? stringOrNull(args.reason),
          command,
          cwd: stringOrNull(args.cwd)
        }
      });
    } catch {
      continue;
    }
  }
  let latest: PendingApprovalRecord | null = null;
  for (const request of pending.values()) {
    latest = request;
  }
  return latest;
}

export function readCodexJsonlPlanUpdates(jsonl: string, sessionId: string): SessionPlanUpdate[] {
  const updates: SessionPlanUpdate[] = [];
  const lines = jsonl.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length === 0) continue;

    try {
      const entry = asRecord(JSON.parse(line) as unknown);
      if (stringOrNull(entry.type) !== "response_item") continue;
      const payload = asRecord(entry.payload);
      if (stringOrNull(payload.type) !== "function_call" || stringOrNull(payload.name) !== "update_plan") continue;
      const args = updatePlanArguments(payload);
      const steps = mapUpdatePlanSteps(args.plan);
      if (steps.length === 0) continue;
      updates.push({
        id: `${sessionId}:log-plan:${index + 1}`,
        sessionId,
        createdAt: stringOrNull(entry.timestamp) ?? new Date().toISOString(),
        steps
      });
    } catch {
      continue;
    }
  }
  return updates;
}

export function readCodexJsonlMessages(jsonl: string, sessionId: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  const lines = jsonl.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length === 0) continue;

    try {
      const entry = asRecord(JSON.parse(line) as unknown);
      if (stringOrNull(entry.type) !== "response_item") continue;
      const payload = asRecord(entry.payload);
      const payloadRole = stringOrNull(payload.role);
      if (payloadRole === "developer") continue;

      const createdAt = stringOrNull(entry.timestamp) ?? new Date().toISOString();
      const message = messageFromCodexItem({
        sessionId,
        item: payload,
        fallbackId: `${sessionId}:log:${index + 1}`,
        createdAt
      });
      if (message) messages.push(message);
    } catch {
      continue;
    }
  }
  return messages;
}

export function readCodexJsonlContextUsage(jsonl: string): { contextTokensUsed: number | null; contextWindowTokens: number | null } {
  let contextTokensUsed: number | null = null;
  let contextWindowTokens: number | null = null;
  const lines = jsonl.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length === 0) continue;

    try {
      const entry = asRecord(JSON.parse(line) as unknown);
      if (stringOrNull(entry.type) !== "event_msg") continue;
      const payload = asRecord(entry.payload);
      const payloadType = stringOrNull(payload.type);
      const info = asRecord(payload.info);
      const lastTokenUsage = asRecord(info.last_token_usage ?? info.lastTokenUsage);
      const used = firstNonnegativeInteger([
        lastTokenUsage.total_tokens,
        lastTokenUsage.totalTokens,
        lastTokenUsage.input_tokens,
        lastTokenUsage.inputTokens,
        info.total_tokens,
        info.totalTokens,
        payload.contextTokensUsed
      ]);
      const total = firstPositiveInteger([
        payload.model_context_window,
        payload.modelContextWindow,
        info.model_context_window,
        info.modelContextWindow
      ]);

      if (payloadType === "token_count" && used !== null) {
        contextTokensUsed = used;
      }
      if ((payloadType === "token_count" || payloadType === "task_started") && total !== null) {
        contextWindowTokens = total;
      }
    } catch {
      continue;
    }
  }
  return { contextTokensUsed, contextWindowTokens };
}

function isSafeCodexSessionPath(logPath: string): boolean {
  const resolved = path.resolve(logPath);
  const sessionsRoot = path.join(os.homedir(), ".codex", "sessions");
  const resolvedRoot = path.resolve(sessionsRoot);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function readMessagesFromCodexSessionFile(logPath: string, sessionId: string): SessionMessage[] {
  if (!isSafeCodexSessionPath(logPath)) return [];
  if (!fs.existsSync(logPath)) return [];
  return readCodexJsonlMessages(fs.readFileSync(logPath, "utf8"), sessionId);
}

function readPlanUpdatesFromCodexSessionFile(logPath: string, sessionId: string): SessionPlanUpdate[] {
  if (!isSafeCodexSessionPath(logPath)) return [];
  if (!fs.existsSync(logPath)) return [];
  return readCodexJsonlPlanUpdates(fs.readFileSync(logPath, "utf8"), sessionId);
}

function readContextUsageFromCodexSessionFile(logPath: string): { contextTokensUsed: number | null; contextWindowTokens: number | null } {
  if (!isSafeCodexSessionPath(logPath)) return { contextTokensUsed: null, contextWindowTokens: null };
  if (!fs.existsSync(logPath)) return { contextTokensUsed: null, contextWindowTokens: null };
  let fd: number | null = null;
  try {
    const fileSize = fs.statSync(logPath).size;
    const maxBytes = 512 * 1024;
    const readSize = Math.min(fileSize, maxBytes);
    fd = fs.openSync(logPath, "r");
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, fileSize - readSize);
    const text = buffer.toString("utf8");
    const firstNewline = fileSize > readSize ? text.indexOf("\n") : -1;
    return readCodexJsonlContextUsage(firstNewline >= 0 ? text.slice(firstNewline + 1) : text);
  } catch {
    return { contextTokensUsed: null, contextWindowTokens: null };
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }
}

function defaultCodexStateDbPath(): string {
  return path.join(os.homedir(), ".codex", "state_5.sqlite");
}

export function readCodexThreadMetadataFromStateDb(threadIds: string[], dbPath: string = defaultCodexStateDbPath()): Map<string, CodexThreadMetadata> {
  const ids = [...new Set(threadIds.filter((id) => id.trim().length > 0))];
  const metadata = new Map<string, CodexThreadMetadata>();
  if (ids.length === 0 || !fs.existsSync(dbPath)) return metadata;

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT
        id,
        title,
        first_user_message AS firstUserMessage,
        cwd,
        archived,
        rollout_path AS rolloutPath
      FROM threads
      WHERE id IN (${placeholders})
    `).all(...ids) as Array<{
      id: string;
      title: string | null;
      firstUserMessage: string | null;
      cwd: string | null;
      archived: number | null;
      rolloutPath: string | null;
    }>;
    for (const row of rows) {
      const rolloutUsage = stringOrNull(row.rolloutPath) !== null
        ? readContextUsageFromCodexSessionFile(row.rolloutPath ?? "")
        : { contextTokensUsed: null, contextWindowTokens: null };
      metadata.set(row.id, {
        title: stringOrNull(row.title),
        firstUserMessage: stringOrNull(row.firstUserMessage),
        cwd: stringOrNull(row.cwd),
        rolloutPath: stringOrNull(row.rolloutPath),
        archived: booleanFromSqliteFlag(row.archived),
        contextTokensUsed: rolloutUsage.contextTokensUsed,
        contextWindowTokens: rolloutUsage.contextWindowTokens
      });
    }
  } catch {
    return metadata;
  } finally {
    db?.close();
  }
  return metadata;
}

function metadataForThread(thread: Record<string, unknown>, metadata: Map<string, CodexThreadMetadata>): CodexThreadMetadata | null {
  const id = stringOrNull(thread.id) ?? stringOrNull(thread.threadId) ?? stringOrNull(thread.sessionId);
  return id ? metadata.get(id) ?? null : null;
}

function isArchivedThread(thread: Record<string, unknown>, metadata: CodexThreadMetadata | null): boolean {
  return booleanFromSqliteFlag(thread.archived) || metadata?.archived === true;
}

function contextTokensUsedFromThread(thread: Record<string, unknown>, metadata: CodexThreadMetadata | null): number | null {
  const usage = asRecord(thread.usage ?? thread.tokenUsage ?? thread.contextUsage);
  const lastUsage = asRecord(usage.lastTokenUsage ?? usage.last_token_usage);
  return firstNonnegativeInteger([
    thread.contextTokensUsed,
    usage.contextTokensUsed,
    usage.lastTokensUsed,
    lastUsage.totalTokens,
    lastUsage.total_tokens,
    lastUsage.inputTokens,
    lastUsage.input_tokens,
    metadata?.contextTokensUsed
  ]);
}

function contextWindowTokensFromThread(thread: Record<string, unknown>, metadata: CodexThreadMetadata | null): number | null {
  const usage = asRecord(thread.usage ?? thread.tokenUsage ?? thread.contextUsage);
  return firstPositiveInteger([
    thread.contextWindowTokens,
    thread.modelContextWindow,
    thread.model_context_window,
    usage.contextWindowTokens,
    usage.modelContextWindow,
    usage.model_context_window,
    usage.totalWindowTokens,
    usage.total_window_tokens,
    metadata?.contextWindowTokens
  ]);
}

export function mapCodexThreadToSessionSummary(threadInput: unknown, nowIso: string = new Date().toISOString(), metadata: CodexThreadMetadata | null = null): SessionSummary | null {
  const thread = asRecord(threadInput);
  const id = stringOrNull(thread.id) ?? stringOrNull(thread.threadId) ?? stringOrNull(thread.sessionId);
  if (!id) return null;
  if (isArchivedThread(thread, metadata)) return null;

  const rawCwd = stringOrNull(thread.cwd);
  const title = nonGenericTitle(thread.title) ??
    nonGenericTitle(thread.name) ??
    nonGenericTitle(metadata?.title) ??
    nonGenericTitle(metadata?.firstUserMessage) ??
    titleFromCodeMobileWorkspace(rawCwd) ??
    "Codex 会话";
  const projectPath = projectPathFromCodexThread(thread);
  const createdAt = unixSecondsToIso(thread.createdAt, nowIso);
  const updatedAt = unixSecondsToIso(thread.updatedAt, createdAt);
  const statusLabel = codexStatusLabel(thread.status);
  const contextTokensUsed = contextTokensUsedFromThread(thread, metadata);
  const contextWindowTokens = contextWindowTokensFromThread(thread, metadata);

  const session: SessionSummary = {
    id,
    toolId: "codex-mac",
    title,
    projectPath,
    projectName: projectNameFromPath(projectPath),
    createdAt,
    updatedAt,
    isPinned: false,
    needsUserInput: statusLabel.includes("approval") || statusLabel.includes("wait"),
    waitsForNextDirection: statusLabel.includes("idle") || statusLabel.includes("complete"),
    statusLabel,
    lastMessagePreview: ""
  };
  if (contextTokensUsed !== null) {
    session.contextTokensUsed = contextTokensUsed;
  }
  if (contextWindowTokens !== null) {
    session.contextWindowTokens = contextWindowTokens;
  }
  return session;
}

export function normalizeCodexApproval(input: { id: string; title: string; body: string; actions: Array<{ id: string; label: string }> }) {
  return {
    id: input.id,
    title: input.title,
    body: input.body,
    actions: input.actions,
    createdAt: new Date().toISOString()
  };
}

function createRuntimeConfigForNewSession(sessionId: string, input: SessionRuntimeConfigInput): SessionRuntimeConfig {
  return {
    sessionId,
    model: input.model,
    effort: input.effort,
    permissionMode: input.permissionMode,
    approvalMode: input.approvalMode,
    approvalsReviewer: input.approvalsReviewer ?? "user",
    updatedAt: new Date().toISOString()
  };
}

export function createCodexSessionManager(client: CodexSessionClient, options: CodexSessionManagerOptions = {}) {
  const readLogMessages = options.readSessionLogMessages ?? readMessagesFromCodexSessionFile;
  const readLogPlanUpdates = options.readSessionLogPlanUpdates ?? readPlanUpdatesFromCodexSessionFile;
  const readThreadMetadata = options.readThreadMetadata ?? ((threadIds: string[]): Map<string, CodexThreadMetadata> => {
    return readCodexThreadMetadataFromStateDb(threadIds, options.codexStateDbPath);
  });
  const pendingApprovals = new Map<string, { method: CodexServerRequestMethod; params: Record<string, unknown> }>();
  const defaultRuntimeCapabilities: CodexRuntimeCapabilities = { supportsPermissionsProfile: false };
  const runtimeCapabilities = options.codexRuntimeCapabilities ?? defaultRuntimeCapabilities;
  const runtimeParamsForSession = async (
    threadId: string,
    capabilities: CodexRuntimeCapabilities,
    createSessionConfig?: SessionRuntimeConfigInput
  ): Promise<Record<string, unknown>> => {
    const config = createSessionConfig ? createRuntimeConfigForNewSession(threadId, createSessionConfig) :
      await options.runtimeConfigForSession?.(threadId);
    if (!config) return {};
    return mapRuntimeConfigToTurnParams(config, capabilities);
  };
  const requestTurnStartWithRuntimeConfig = async (
    baseParams: Record<string, unknown>,
    threadId: string,
    createSessionConfig?: SessionRuntimeConfigInput
  ): Promise<unknown> => {
    const requestWithCapabilities = async (capabilities: CodexRuntimeCapabilities): Promise<unknown> => {
      const runtimeParams = await runtimeParamsForSession(threadId, capabilities, createSessionConfig);
      const params = { ...baseParams, ...runtimeParams };
      try {
        return await client.request("turn/start", params);
      } catch (error) {
        if (!isRuntimeConfigParameterUnsupportedError(error) || !("approvalsReviewer" in runtimeParams)) {
          throw error;
        }
        const fallbackParams = { ...runtimeParams };
        delete fallbackParams.approvalsReviewer;
        return client.request("turn/start", { ...baseParams, ...fallbackParams });
      }
    };
    try {
      return await requestWithCapabilities(runtimeCapabilities);
    } catch (error) {
      if (!runtimeCapabilities.supportsPermissionsProfile || !isRuntimeConfigParameterUnsupportedError(error)) {
        throw error;
      }
      return requestWithCapabilities({ supportsPermissionsProfile: false });
    }
  };
  const readRawThread = async (threadId: string): Promise<unknown> => {
    const response = asRecord(await client.request("thread/read", { threadId, includeTurns: true }));
    return response.thread ?? response;
  };
  const resumeThreadForDetail = async (threadId: string, metadata: CodexThreadMetadata | null): Promise<void> => {
    const params: Record<string, unknown> = { threadId };
    if (metadata?.cwd) params.cwd = metadata.cwd;
    if (metadata?.rolloutPath) params.path = metadata.rolloutPath;
    try {
      const resume = client.request("thread/resume", params);
      resume.catch(() => undefined);
      await withTimeout(resume, DETAIL_RESUME_TIMEOUT_MS);
    } catch (error) {
      if (isThreadNotFoundError(error)) return;
    }
  };
  const readFullTurns = async (threadId: string): Promise<unknown[]> => {
    try {
      const turnsResponse = asRecord(await client.request("thread/turns/list", {
        threadId,
        sortDirection: "asc",
        itemsView: "full"
      }));
      return asArray(turnsResponse.turns ?? turnsResponse.data);
    } catch {
      return [];
    }
  };
  const pendingApprovalForSession = (threadId: string): TimelineItem["approval"] | null => {
    for (const [id, request] of pendingApprovals.entries()) {
      if (approvalThreadId(request.params) !== threadId) continue;
      const event = approvalUpdatedEventsFromServerRequest(request.method, id, request.params)[0];
      if (event?.type === "approval.updated") return event.approval;
    }
    return null;
  };
  const sessionWithPendingApproval = (session: SessionSummary): SessionSummary => {
    const approval = pendingApprovalForSession(session.id);
    if (!approval) return session;
    return {
      ...session,
      updatedAt: new Date().toISOString(),
      needsUserInput: true,
      waitsForNextDirection: false,
      statusLabel: "waiting_for_approval",
      lastMessagePreview: approval.title.length > 0 ? approval.title : approval.body
    };
  };
  const startTurnInternal = async (input: StartTurnInput) => {
    const metadata = (await readThreadMetadata([input.threadId])).get(input.threadId) ?? null;
    const resumeParams: Record<string, unknown> = { threadId: input.threadId };
    if (metadata?.cwd) resumeParams.cwd = metadata.cwd;
    if (metadata?.rolloutPath) resumeParams.path = metadata.rolloutPath;
    const params: Record<string, unknown> = { threadId: input.threadId, input: inputItemsFromTextOrItems(input) };
    if (input.clientUserMessageId && input.clientUserMessageId.length > 0) params.clientUserMessageId = input.clientUserMessageId;
    if (metadata?.cwd) params.cwd = metadata.cwd;
    let turnResponse: Record<string, unknown>;
    const resumeThread = () => withCodexStage("thread/resume", () => client.request("thread/resume", resumeParams));
    const startThreadTurn = () => withCodexStage("turn/start", () => requestTurnStartWithRuntimeConfig(params, input.threadId));
    const shouldResumeBeforeStart = input.skipPreflightResume !== true;
    try {
      if (shouldResumeBeforeStart) {
        try {
          await resumeThread();
        } catch (error) {
          if (!isThreadNotFoundError(error)) throw error;
        }
      }
      turnResponse = asRecord(await startThreadTurn());
    } catch (error) {
      if (!isThreadNotFoundError(error) || !shouldResumeBeforeStart) throw error;
      await resumeThread();
      turnResponse = asRecord(await startThreadTurn());
    }
    const turn = asRecord(turnResponse.turn ?? turnResponse);
    return { turnId: String(turn.id ?? turn.turnId), status: normalizeTurnStatus(turn.status) };
  };
  const steerApprovalAdjustment = async (
    request: { method: CodexServerRequestMethod; params: Record<string, unknown> },
    answers: CodexApprovalAnswers | undefined
  ): Promise<void> => {
    const text = approvalAdjustmentTextFromAnswers(answers);
    if (text.length === 0) return;
    const threadId = approvalThreadId(request.params);
    if (threadId === null || threadId.length === 0) return;
    const turnId = approvalTurnId(request.params);
    if (turnId !== null && turnId.length > 0) {
      try {
        await client.request("turn/steer", {
          threadId,
          expectedTurnId: turnId,
          input: textInput(text)
        });
        return;
      } catch (error) {
        if (!isInactiveTurnSteerError(error)) throw error;
      }
    }
    await startTurnInternal({ threadId, text });
  };
  const createThread = async (input: CreateCodexThreadInput): Promise<{ threadId: string }> => {
    const threadResponse = asRecord(await client.request("thread/start", {
      cwd: createSessionCwd({ projectPath: input.projectPath, text: input.text }, options),
      sessionStartSource: "startup",
      threadSource: "user"
    }));
    const thread = asRecord(threadResponse.thread ?? threadResponse);
    return { threadId: String(thread.id ?? thread.threadId) };
  };

  return {
    async createThread(input: CreateCodexThreadInput) {
      return createThread(input);
    },

    async createSession(input: CreateCodexSessionInput) {
      const createdThread = await createThread({ projectPath: input.projectPath, text: input.text });
      const threadId = createdThread.threadId;
      const turnResponse = asRecord(await requestTurnStartWithRuntimeConfig({
        threadId,
        input: inputItemsFromTextOrItems(input),
        ...(input.clientUserMessageId && input.clientUserMessageId.length > 0 ? { clientUserMessageId: input.clientUserMessageId } : {})
      }, threadId, input.runtimeConfig));
      const turn = asRecord(turnResponse.turn ?? turnResponse);
      return { threadId, turnId: String(turn.id ?? turn.turnId), status: normalizeTurnStatus(turn.status) };
    },

    async resumeSession(threadId: string) {
      return client.request("thread/resume", { threadId });
    },

    async readSession(threadId: string) {
      return client.request("thread/read", { threadId });
    },

    readPendingApproval(threadId: string): TimelineItem["approval"] | null {
      return pendingApprovalForSession(threadId);
    },

    async readRawThread(threadId: string) {
      return readRawThread(threadId);
    },

    async readSessionDetail(threadId: string): Promise<SessionDetail> {
      const metadata = await readThreadMetadata([threadId]);
      const threadMetadataBeforeRead = metadata.get(threadId) ?? null;
      await resumeThreadForDetail(threadId, threadMetadataBeforeRead);
      const thread = asRecord(await readRawThread(threadId));
      const threadMetadata = metadataForThread({ ...thread, id: threadId }, metadata);
      const session = mapCodexThreadToSessionSummary(thread, new Date().toISOString(), threadMetadata) ?? {
        id: threadId,
        toolId: "codex-mac",
        title: "Codex 会话",
        projectPath: null,
        projectName: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPinned: false,
        needsUserInput: false,
        waitsForNextDirection: false,
        statusLabel: "notLoaded",
        lastMessagePreview: ""
      };
      const readTurns = asArray(thread.turns);
      const listedTurns = await readFullTurns(threadId);
      if (listedTurns.length >= readTurns.length && listedTurns.length > 0) {
        thread.turns = listedTurns;
      }
      let turns = mapCodexThreadToTimeline(thread, session.id);
      let messages = mapCodexTurnsToMessages(thread, session.id);
      const logPath = stringOrNull(thread.path) ?? threadMetadata?.rolloutPath ?? null;
      if (logPath) {
        const logMessages = await readLogMessages(logPath, session.id);
        const logPlanUpdates = await readLogPlanUpdates(logPath, session.id);
        messages = mergeSessionMessages(messages, logMessages);
        turns = mergeLogMessagesIntoTimelineTurns(turns, logMessages);
        turns = mergeLogPlanUpdatesIntoTimelineTurns(turns, logPlanUpdates);
      }
      const approval = pendingApprovalForSession(session.id);
      return { session, messages, turns, approval, rolloutPath: logPath };
    },

    async listSessions() {
      return client.request("thread/list", {});
    },

    async listSessionSummaries(limit = 50): Promise<SessionSummary[]> {
      const response = asRecord(await client.request("thread/list", { limit, useStateDbOnly: true }));
      const threads = asArray(response.data);
      const threadIds = threads
        .map((thread) => {
          const record = asRecord(thread);
          return stringOrNull(record.id) ?? stringOrNull(record.threadId) ?? stringOrNull(record.sessionId);
        })
        .filter((id): id is string => id !== null);
      const metadata = await readThreadMetadata(threadIds);
      return threads
        .map((thread) => {
          const record = asRecord(thread);
          const session = mapCodexThreadToSessionSummary(record, new Date().toISOString(), metadataForThread(record, metadata));
          return session === null ? null : sessionWithPendingApproval(session);
        })
        .filter((session): session is SessionSummary => session !== null);
    },

    async startTurn(input: StartTurnInput) {
      return startTurnInternal(input);
    },

    async steerTurn(input: SteerTurnInput) {
      return client.request("turn/steer", {
        threadId: input.threadId,
        ...(input.clientUserMessageId && input.clientUserMessageId.length > 0 ? { clientUserMessageId: input.clientUserMessageId } : {}),
        expectedTurnId: input.turnId,
        input: inputItemsFromTextOrItems(input)
      });
    },

    async interruptTurn(input: InterruptTurnInput) {
      return client.request("turn/interrupt", { threadId: input.threadId, turnId: input.turnId });
    },

    async compactContext(input: { threadId: string }) {
      const resumeThread = () => withCodexStage("thread/resume", () => client.request("thread/resume", { threadId: input.threadId }));
      const compactThread = () => withCodexStage("thread/compact/start", () => client.request("thread/compact/start", { threadId: input.threadId }));
      try {
        try {
          await resumeThread();
        } catch (error) {
          if (!isThreadNotFoundError(error)) throw error;
        }
        return await compactThread();
      } catch (error) {
        if (!isThreadNotFoundError(error)) throw error;
        await resumeThread();
        return compactThread();
      }
    },

    async renameSession(input: RenameSessionInput) {
      return client.request("thread/name/set", { threadId: input.threadId, name: input.title });
    },

    recordApprovalRequest(input: { id: string; method: CodexServerRequestMethod; params: Record<string, unknown> }): void {
      pendingApprovals.set(input.id, { method: input.method, params: input.params });
    },

    forgetApprovalRequest(requestId: string): void {
      pendingApprovals.delete(requestId);
    },

    async respondToApproval(requestId: string, actionId: string, answers?: CodexApprovalAnswers) {
      const request = pendingApprovals.get(requestId);
      if (!request) throw new Error("审批请求不存在或已处理");
      const response = mapCodexApprovalResponse({ method: request.method, actionId, answers, params: request.params });
      client.respond(requestId, response);
      if (shouldSteerApprovalAdjustment(request.method, actionId, answers)) {
        await steerApprovalAdjustment(request, answers);
      }
    }
  };
}

export type CodexSessionManager = ReturnType<typeof createCodexSessionManager>;
