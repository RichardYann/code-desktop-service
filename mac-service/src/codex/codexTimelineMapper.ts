import { normalizePlanStepStatus, type CommandSummary, type DiffFileOverview, type DiffOverview, type SessionPlanStep } from "./codexEventMapper.js";
import { classifyCodexThreadItem, textFromCodexThreadItem } from "./codexThreadItemClassifier.js";

export type TimelineItemKind =
  | "userMessage"
  | "hookPrompt"
  | "agentMessage"
  | "reasoning"
  | "reasoningSummary"
  | "plan"
  | "commandExecution"
  | "fileChange"
  | "mcpToolCall"
  | "dynamicToolCall"
  | "collabAgentToolCall"
  | "webSearch"
  | "imageView"
  | "imageGeneration"
  | "reviewStatus"
  | "diffOverview"
  | "approval"
  | "toolProgress"
  | "contextCompaction"
  | "processedSummary"
  | "artifact"
  | "error";

export type TimelineItemStatus = "pending" | "running" | "completed" | "failed" | "declined" | "interrupted";

export interface TimelineApprovalAction {
  id: string;
  label: string;
  style?: string;
  decisionType?: string;
  requiresSecondConfirm?: boolean;
}

export interface TimelineApprovalInputField {
  id: string;
  label: string;
  type: "text" | "secret" | "single-select" | "multi-select";
  defaultValue: string;
  options: string[];
  isSecret: boolean;
  isRequired?: boolean;
}

export type TimelineApprovalKind = "command" | "file_change" | "permission" | "user_input" | "mcp_elicitation" | "unknown";

export interface TimelineApprovalRequest {
  id: string;
  kind: TimelineApprovalKind;
  method: string;
  subject: string;
  title: string;
  body: string;
  actions: TimelineApprovalAction[];
  inputFields?: TimelineApprovalInputField[];
  createdAt: string;
}

export interface TimelineItem {
  id: string;
  sessionId: string;
  turnId: string;
  clientMessageId?: string | null;
  kind: TimelineItemKind;
  status: TimelineItemStatus;
  title: string;
  phase?: string;
  text: string;
  rawText: string;
  createdAt: string;
  updatedAt: string;
  isStreaming: boolean;
  isCollapsedByDefault: boolean;
  command: CommandSummary | null;
  diff: DiffOverview | null;
  approval: TimelineApprovalRequest | null;
  planSteps: SessionPlanStep[];
  assetIds?: string[];
}

export interface SessionTurn {
  id: string;
  sessionId: string;
  status: "idle" | "running" | "completed" | "failed" | "interrupted";
  itemsView?: "notLoaded" | "summary" | "full";
  startedAt: string | null;
  completedAt: string | null;
  durationMs?: number | null;
  errorMessage?: string;
  items: TimelineItem[];
}

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

function normalizeItemsView(value: unknown): SessionTurn["itemsView"] | undefined {
  if (value === "notLoaded" || value === "summary" || value === "full") return value;
  return undefined;
}

function messagePhase(value: unknown): string | undefined {
  if (value === "commentary" || value === "final_answer") return value;
  return undefined;
}

function turnErrorMessage(turn: Record<string, unknown>): string | undefined {
  const error = asRecord(turn.error);
  const direct = stringOrNull(turn.error);
  if (direct) return direct;
  return stringOrNull(error.message) ?? stringOrNull(error.detail) ?? stringOrNull(error.reason) ?? stringOrNull(error.type) ?? undefined;
}

function unixSecondsToIso(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

function itemText(item: Record<string, unknown>): string {
  return textFromCodexThreadItem(item);
}

function normalizeTurnStatus(status: unknown): SessionTurn["status"] {
  if (status === "inProgress" || status === "running") return "running";
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "interrupted" || status === "cancelled" || status === "canceled") return "interrupted";
  return "idle";
}

function threadStatusType(thread: Record<string, unknown>): string {
  const status = thread.status;
  if (typeof status === "string") return status;
  return stringOrNull(asRecord(status).type) ?? "";
}

function hasCompletedAt(turn: Record<string, unknown>): boolean {
  const completedAt = turn.completedAt ?? turn.completed_at;
  return completedAt !== undefined && completedAt !== null;
}

function hasRunningItem(items: unknown[]): boolean {
  for (let index = 0; index < items.length; index++) {
    const item = asRecord(items[index]);
    if (normalizeItemStatus(item.status, "completed") === "running") {
      return true;
    }
  }
  return false;
}

function hasNonUserTimelineItem(items: unknown[]): boolean {
  for (let index = 0; index < items.length; index++) {
    const item = asRecord(items[index]);
    const classified = classifyCodexThreadItem(item);
    if (classified !== null && classified.kind !== "userMessage") return true;
  }
  return false;
}

function inferTurnStatus(input: { turn: Record<string, unknown>; items: unknown[]; isLatestTurn: boolean; isThreadActive: boolean }): SessionTurn["status"] {
  const turn = input.turn;
  const items = input.items;
  const normalized = normalizeTurnStatus(turn.status);
  if (input.isLatestTurn && input.isThreadActive && normalized !== "failed" && normalized !== "interrupted") return "running";
  if (normalized === "running" && !input.isThreadActive) return hasCompletedAt(turn) || hasNonUserTimelineItem(items) ? "completed" : "idle";
  if (normalized !== "idle") return normalized;
  if (hasCompletedAt(turn)) return "completed";
  if (hasRunningItem(items)) return "running";
  for (let index = 0; index < items.length; index++) {
    const item = asRecord(items[index]);
    if (classifyCodexThreadItem(item)?.kind === "agentMessage") return "completed";
  }
  return "idle";
}

function normalizeItemStatus(status: unknown, fallback: TimelineItemStatus): TimelineItemStatus {
  if (status === "inProgress" || status === "running") return "running";
  if (status === "completed" || status === "complete" || status === "succeeded") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "declined") return "declined";
  if (status === "interrupted" || status === "cancelled" || status === "canceled") return "interrupted";
  if (status === "pending") return "pending";
  return fallback;
}

function diffStatus(value: unknown): DiffFileOverview["status"] {
  if (value === "added" || value === "add" || value === "create" || value === "created") return "added";
  if (value === "deleted" || value === "delete" || value === "removed" || value === "remove") return "deleted";
  if (value === "renamed" || value === "rename") return "renamed";
  return "modified";
}

function diffLineCount(diff: string): number {
  if (diff.length === 0) return 0;
  const lines = diff.split("\n");
  if (lines.length > 0 && lines[lines.length - 1].length === 0) {
    return lines.length - 1;
  }
  return lines.length;
}

function isUnifiedOrLinePatch(diff: string): boolean {
  if (diff.length === 0) return false;
  const lines = diff.split("\n");
  let prefixedLineCount = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("diff --git ") || line.startsWith("@@ ")) return true;
    if (line.length === 0) continue;
    if (line.startsWith("+") || line.startsWith("-")) prefixedLineCount++;
    else return false;
  }
  return prefixedLineCount > 0;
}

function countDiffLines(diff: string, status: DiffFileOverview["status"]): { insertions: number; deletions: number } {
  if (status === "added" && !isUnifiedOrLinePatch(diff)) {
    return { insertions: diffLineCount(diff), deletions: 0 };
  }
  if (status === "deleted" && !isUnifiedOrLinePatch(diff)) {
    return { insertions: 0, deletions: diffLineCount(diff) };
  }
  if (!isUnifiedOrLinePatch(diff)) {
    return { insertions: diffLineCount(diff), deletions: 0 };
  }
  const lines = diff.split("\n");
  let insertions = 0;
  let deletions = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith("+") && !line.startsWith("+++")) insertions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { insertions, deletions };
}

function mapDiff(filesInput: unknown, fallbackPatch: string = ""): DiffOverview | null {
  const rawFiles = asArray(filesInput);
  const sharedPatch = rawFiles.length === 1 ? fallbackPatch : "";
  const files = rawFiles
    .map((fileInput) => {
      const file = asRecord(fileInput);
      const path = stringOrNull(file.path);
      if (!path) return null;
      return {
        path,
        status: diffStatus(file.status),
        insertions: Math.max(0, numberOrNull(file.insertions) ?? 0),
        deletions: Math.max(0, numberOrNull(file.deletions) ?? 0),
        patch: stringOrNull(file.patch) ?? stringOrNull(file.diff) ?? sharedPatch
      };
    })
    .filter((file): file is DiffFileOverview => file !== null);
  if (files.length === 0) return null;
  return {
    filesChanged: files.length,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files
  };
}

export function diffOverviewFromFileChanges(changesInput: unknown): DiffOverview | null {
  const files = asArray(changesInput)
    .map((changeInput) => {
      const change = asRecord(changeInput);
      const path = stringOrNull(change.path);
      if (!path) return null;
      const diff = stringOrNull(change.diff) ?? "";
      const status = diffStatus(change.kind);
      const counts = countDiffLines(diff, status);
      return {
        path,
        status,
        insertions: counts.insertions,
        deletions: counts.deletions,
        patch: diff
      };
    })
    .filter((file): file is DiffFileOverview => file !== null);
  if (files.length === 0) return null;
  return {
    filesChanged: files.length,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files
  };
}

function basename(pathText: string): string {
  const parts = pathText.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : pathText;
}

function commandActionTitle(actionInput: unknown): string {
  const action = asRecord(actionInput);
  const type = stringOrNull(action.type);
  if (type === "read") {
    const name = stringOrNull(action.name) ?? basename(stringOrNull(action.path) ?? "");
    return name.length > 0 ? `Read ${name}` : "Read file";
  }
  if (type === "listFiles") {
    const path = stringOrNull(action.path);
    return path ? `List ${basename(path)}` : "List files";
  }
  if (type === "search") {
    const query = stringOrNull(action.query);
    return query ? `Search ${query}` : "Search files";
  }
  return stringOrNull(action.command) ?? "";
}

function firstCommandActionTitle(item: Record<string, unknown>): string {
  const actions = asArray(item.commandActions);
  if (actions.length === 0) return "";
  return commandActionTitle(actions[0]);
}

export function commandTitleFromItem(item: Record<string, unknown>, command: string): string {
  const actionTitle = firstCommandActionTitle(item);
  return actionTitle.length > 0 ? actionTitle : command.split(/\s+/).filter(Boolean).slice(0, 3).join(" ") || "command";
}

function mapPlanSteps(input: unknown): SessionPlanStep[] {
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

function commandFromItem(item: Record<string, unknown>, turnId: string, id: string, text: string): CommandSummary {
  const command = stringOrNull(item.command) ?? stringOrNull(item.cmd) ?? text;
  const output = stringOrNull(item.output) ?? stringOrNull(item.rawOutput) ?? stringOrNull(item.aggregatedOutput) ?? "";
  return {
    id,
    turnId,
    title: commandTitleFromItem(item, command),
    command,
    status: normalizeItemStatus(item.status, "completed") === "failed" ? "failed" : normalizeItemStatus(item.status, "completed") === "running" ? "running" : "completed",
    exitCode: numberOrNull(item.exitCode),
    summaryLines: output.split("\n").filter(Boolean).slice(-6),
    rawOutput: output
  };
}

function titleCaseToolName(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.length === 0 ? part : part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function isComputerUseTool(server: string, tool: string): boolean {
  const label = `${server} ${tool}`.toLowerCase();
  return label.includes("computer-use") || label.includes("computer_use") || label.includes("computer use");
}

function argString(args: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = stringOrNull(args[field]);
    if (value) return value;
  }
  return "";
}

export function toolTitleFromItem(item: Record<string, unknown>): string {
  const type = stringOrNull(item.type);
  if (type === "webSearch") return "Web Search";
  const server = stringOrNull(item.server) ?? stringOrNull(item.namespace) ?? stringOrNull(item.name) ?? "";
  const tool = stringOrNull(item.tool) ?? stringOrNull(item.toolName) ?? "";
  if (isComputerUseTool(server, tool)) return "Computer Use";
  if (server.length > 0) return titleCaseToolName(server);
  if (tool.length > 0) return titleCaseToolName(tool);
  return stringOrNull(item.title) ?? stringOrNull(item.name) ?? "工具调用";
}

export function toolTextFromItem(item: Record<string, unknown>): string {
  const explicit = itemText(item).trim();
  if (explicit.length > 0) return explicit;

  const type = stringOrNull(item.type);
  if (type === "webSearch") {
    const action = asRecord(item.action);
    const query = stringOrNull(item.query) ?? stringOrNull(action.query);
    const url = stringOrNull(action.url);
    if (query) return `搜索 ${query}`;
    if (url) return `打开 ${url}`;
    return "搜索网页";
  }

  const server = stringOrNull(item.server) ?? stringOrNull(item.namespace) ?? "";
  const tool = stringOrNull(item.tool) ?? stringOrNull(item.toolName) ?? "";
  const args = asRecord(item.arguments);
  if (isComputerUseTool(server, tool)) {
    if (tool === "list_apps") return "列出 Mac 应用";
    if (tool === "get_app_state") {
      const appName = argString(args, ["app", "appName", "application", "name", "title"]);
      return appName.length > 0 ? `已查看 ${appName}` : "已查看当前应用";
    }
    if (tool === "click") return "点击界面元素";
    if (tool === "perform_secondary_action") return "打开二级操作";
    if (tool === "scroll") return "滚动界面";
    if (tool === "drag") return "拖动界面";
    if (tool === "type_text") return "输入文本";
    if (tool === "press_key") {
      const key = argString(args, ["key", "text"]);
      return key.length > 0 ? `按下 ${key}` : "按下按键";
    }
    if (tool === "set_value") return "设置输入值";
  }

  const path = argString(args, ["path", "file", "uri"]);
  if (path.length > 0 && (tool.toLowerCase().includes("read") || tool.toLowerCase().includes("open"))) {
    return `Read ${basename(path)}`;
  }
  const query = argString(args, ["query", "q", "pattern"]);
  if (query.length > 0 && tool.toLowerCase().includes("search")) {
    return `Search ${query}`;
  }
  return tool.length > 0 ? titleCaseToolName(tool) : "";
}

function baseItem(input: {
  id: string;
  sessionId: string;
  turnId: string;
  clientMessageId?: string | null;
  kind: TimelineItemKind;
  status: TimelineItemStatus;
  title: string;
  text: string;
  rawText?: string;
  createdAt: string;
  updatedAt: string;
  isCollapsedByDefault?: boolean;
}): TimelineItem {
  const item: TimelineItem = {
    id: input.id,
    sessionId: input.sessionId,
    turnId: input.turnId,
    kind: input.kind,
    status: input.status,
    title: input.title,
    text: input.text,
    rawText: input.rawText ?? input.text,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    isStreaming: input.status === "running",
    isCollapsedByDefault: input.isCollapsedByDefault ?? false,
    command: null,
    diff: null,
    approval: null,
    planSteps: [],
    assetIds: []
  };
  if (input.clientMessageId !== undefined) item.clientMessageId = input.clientMessageId;
  return item;
}

function userClientMessageId(item: Record<string, unknown>): string | null {
  return stringOrNull(item.clientMessageId) ??
    stringOrNull(item.clientUserMessageId) ??
    stringOrNull(item.clientId) ??
    stringOrNull(item.client_id);
}

function firstString(item: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = stringOrNull(item[field]);
    if (value !== null) return value;
  }
  return "";
}

function imageGenerationText(item: Record<string, unknown>, fallback: string): string {
  return firstString(item, ["revisedPrompt", "revised_prompt", "prompt", "text", "message", "summary"]) || fallback;
}

function assetIdsFromItem(item: Record<string, unknown>): string[] {
  const result: string[] = [];
  appendAssetId(result, firstString(item, ["assetId", "mediaAssetId", "artifactAssetId"]));
  appendAssetIdsFromArray(result, item.assetIds);
  appendAssetIdsFromArray(result, item.assets);
  appendAssetIdsFromArray(result, item.mediaAssets);
  appendAssetIdsFromArray(result, item.artifacts);
  const asset = asRecord(item.asset);
  appendAssetId(result, firstString(asset, ["id", "assetId", "mediaAssetId"]));
  return result;
}

function appendAssetIdsFromArray(result: string[], value: unknown): void {
  for (const entry of asArray(value)) {
    if (typeof entry === "string") {
      appendAssetId(result, entry);
      continue;
    }
    const record = asRecord(entry);
    appendAssetId(result, firstString(record, ["id", "assetId", "mediaAssetId"]));
  }
}

function appendAssetId(result: string[], assetId: string): void {
  if (assetId.length === 0 || result.includes(assetId)) return;
  result.push(assetId);
}

function mapItem(input: { itemInput: unknown; sessionId: string; turnId: string; index: number; createdAt: string; updatedAt: string; turnClientMessageId?: string | null }): TimelineItem | null {
  const item = asRecord(input.itemInput);
  const type = stringOrNull(item.type);
  const classified = classifyCodexThreadItem(item);
  if (!classified) return null;
  const id = stringOrNull(item.id) ?? `${input.turnId}:item-${input.index + 1}`;
  const status = normalizeItemStatus(item.status, "completed");
  const text = itemText(item);

  if (classified.kind === "userMessage") {
    return baseItem({ ...input, id, clientMessageId: userClientMessageId(item) ?? input.turnClientMessageId, kind: "userMessage", status, title: "", text: classified.visibleText ?? text.trim(), rawText: classified.rawText, createdAt: input.createdAt, updatedAt: input.updatedAt });
  }

  if (classified.kind === "hookPrompt") {
    return baseItem({ ...input, id, kind: "hookPrompt", status, title: "Hook Prompt", text: classified.visibleText ?? text.trim(), rawText: classified.rawText, createdAt: input.createdAt, updatedAt: input.updatedAt, isCollapsedByDefault: true });
  }

  if (classified.kind === "agentMessage") {
    const agent = baseItem({ ...input, id, kind: "agentMessage", status, title: "", text: classified.visibleText ?? text.trim(), rawText: classified.rawText, createdAt: input.createdAt, updatedAt: input.updatedAt });
    const phase = messagePhase(item.phase);
    if (phase) agent.phase = phase;
    return agent;
  }

  if (classified.kind === "reasoning") {
    return baseItem({ ...input, id, kind: "reasoning", status, title: "Reasoning", text, rawText: classified.rawText, createdAt: input.createdAt, updatedAt: input.updatedAt, isCollapsedByDefault: true });
  }

  if (classified.kind === "plan") {
    const planSteps = mapPlanSteps(item.steps ?? item.plan);
    const plan = baseItem({ ...input, id, kind: "plan", status, title: "计划", text, createdAt: input.createdAt, updatedAt: input.updatedAt, isCollapsedByDefault: true });
    plan.planSteps = planSteps;
    return plan;
  }

  if (classified.kind === "commandExecution") {
    const command = commandFromItem(item, input.turnId, id, text);
    const commandItem = baseItem({ ...input, id, kind: "commandExecution", status: normalizeItemStatus(item.status, command.status), title: command.title, text: command.command, rawText: command.rawOutput, createdAt: input.createdAt, updatedAt: input.updatedAt, isCollapsedByDefault: true });
    commandItem.command = command;
    return commandItem;
  }

  if (classified.kind === "fileChange") {
    const diff = mapDiff(item.files, stringOrNull(item.patch) ?? "") ?? diffOverviewFromFileChanges(item.changes);
    const fileItem = baseItem({ ...input, id, kind: "fileChange", status, title: "文件修改", text, rawText: stringOrNull(item.patch) ?? text, createdAt: input.createdAt, updatedAt: input.updatedAt, isCollapsedByDefault: true });
    fileItem.diff = diff;
    return fileItem;
  }

  if (classified.kind === "mcpToolCall" || classified.kind === "dynamicToolCall" || classified.kind === "collabAgentToolCall" || classified.kind === "webSearch" || classified.kind === "toolProgress") {
    return baseItem({ ...input, id, kind: classified.kind, status, title: toolTitleFromItem(item), text: toolTextFromItem(item), rawText: classified.rawText, createdAt: input.createdAt, updatedAt: input.updatedAt, isCollapsedByDefault: true });
  }

  if (classified.kind === "imageView" || classified.kind === "imageGeneration" || classified.kind === "artifact") {
    const imageText = classified.kind === "imageGeneration" ? imageGenerationText(item, text) : text;
    const imageItem = baseItem({
      ...input,
      id,
      kind: classified.kind,
      status,
      title: classified.kind === "imageGeneration" ? stringOrNull(item.title) ?? "imagegen" : stringOrNull(item.title) ?? "产物",
      text: imageText,
      rawText: classified.rawText.length > 0 ? classified.rawText : imageText,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      isCollapsedByDefault: true
    });
    imageItem.assetIds = assetIdsFromItem(item);
    return imageItem;
  }

  if (classified.kind === "reviewStatus") {
    return baseItem({ ...input, id, kind: "reviewStatus", status, title: type === "exitedReviewMode" ? "退出 Review" : "进入 Review", text, rawText: classified.rawText, createdAt: input.createdAt, updatedAt: input.updatedAt });
  }

  if (classified.kind === "contextCompaction") {
    return baseItem({ ...input, id, kind: "contextCompaction", status, title: "上下文压缩", text, createdAt: input.createdAt, updatedAt: input.updatedAt, isCollapsedByDefault: true });
  }

  if (classified.kind === "error") {
    const errorText = (classified.visibleText ?? text.trim()).trim() || "Codex 运行出错";
    return baseItem({
      ...input,
      id,
      kind: "error",
      status: "failed",
      title: "错误",
      text: errorText,
      rawText: classified.rawText.length > 0 ? classified.rawText : errorText,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      isCollapsedByDefault: false
    });
  }

  return baseItem({ ...input, id, kind: classified.kind, status, title: stringOrNull(item.title) ?? type ?? "", text, rawText: classified.rawText, createdAt: input.createdAt, updatedAt: input.updatedAt, isCollapsedByDefault: true });
}

function turnErrorText(turn: Record<string, unknown>): string {
  const direct = textFromCodexThreadItem(turn).trim();
  if (direct.length > 0) return direct;
  const status = asRecord(turn.status);
  return textFromCodexThreadItem(status).trim();
}

function hasErrorItem(items: TimelineItem[]): boolean {
  return items.some((item) => item.kind === "error");
}

export function mapCodexThreadToTimeline(threadInput: unknown, sessionId: string): SessionTurn[] {
  const thread = asRecord(threadInput);
  const turns = asArray(thread.turns);
  const nowIso = new Date().toISOString();
  const isThreadActive = threadStatusType(thread) === "active";
  return turns.map((turnInput, turnIndex) => {
    const turn = asRecord(turnInput);
    const turnId = stringOrNull(turn.id) ?? stringOrNull(turn.turnId) ?? `${sessionId}:turn-${turnIndex + 1}`;
    const startedAt = unixSecondsToIso(turn.startedAt ?? turn.createdAt, nowIso);
    const completedAtValue = turn.completedAt ?? turn.completed_at;
    const completedAt = completedAtValue === undefined || completedAtValue === null ? null : unixSecondsToIso(completedAtValue, startedAt);
    const updatedAt = completedAt ?? startedAt;
    const turnClientMessageId = userClientMessageId(turn);
    const items = asArray(turn.items);
    const mappedItems = items
      .map((itemInput, itemIndex) => mapItem({
        itemInput,
        sessionId,
        turnId,
        index: itemIndex,
        createdAt: startedAt,
        updatedAt,
        turnClientMessageId
      }))
      .filter((item): item is TimelineItem => item !== null);
    const status = inferTurnStatus({
      turn,
      items,
      isLatestTurn: turnIndex === turns.length - 1,
      isThreadActive
    });
    const errorText = status === "failed" && !hasErrorItem(mappedItems) ? turnErrorText(turn) : "";
    if (errorText.length > 0) {
      const errorAt = completedAt ?? updatedAt;
      mappedItems.push(baseItem({
        id: `${turnId}:error`,
        sessionId,
        turnId,
        kind: "error",
        status: "failed",
        title: "错误",
        text: errorText,
        rawText: errorText,
        createdAt: errorAt,
        updatedAt: errorAt,
        isCollapsedByDefault: false
      }));
    }
    const mappedTurn: SessionTurn = {
      id: turnId,
      sessionId,
      status,
      itemsView: normalizeItemsView(turn.itemsView),
      startedAt,
      completedAt,
      durationMs: numberOrNull(turn.durationMs),
      errorMessage: turnErrorMessage(turn),
      items: mappedItems
    };
    return mappedTurn;
  });
}
