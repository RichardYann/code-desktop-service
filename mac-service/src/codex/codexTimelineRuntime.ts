import { normalizePlanStepStatus, type CommandSummary, type DiffFileOverview, type DiffOverview, type SessionPlanStep } from "./codexEventMapper.js";
import type { SessionTurn, TimelineApprovalAction, TimelineApprovalInputField, TimelineApprovalKind, TimelineItem, TimelineItemKind, TimelineItemStatus } from "./codexTimelineMapper.js";
import { commandTitleFromItem, diffOverviewFromFileChanges, toolTextFromItem, toolTitleFromItem } from "./codexTimelineMapper.js";

export type TimelineRuntimeEvent =
  | { type: "turn.updated"; turn: SessionTurn }
  | { type: "timeline.item.started"; item: TimelineItem }
  | { type: "timeline.item.updated"; item: TimelineItem }
  | { type: "timeline.item.completed"; item: TimelineItem }
  | { type: "approval.updated"; sessionId: string; approval: TimelineItem["approval"] }
  | { type: "remoteControl.status.updated"; status: "disabled" | "connecting" | "connected" | "errored"; environmentId: string | null };

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasArrayField(record: Record<string, unknown>, fieldName: string): boolean {
  return Array.isArray(record[fieldName]);
}

function stringField(record: Record<string, unknown>, fieldName: string): string {
  const value = record[fieldName];
  return typeof value === "string" ? value : "";
}

function booleanField(record: Record<string, unknown>, fieldName: string): boolean {
  return record[fieldName] === true;
}

function firstStringField(record: Record<string, unknown>, fieldNames: string[]): string {
  for (const fieldName of fieldNames) {
    const value = stringField(record, fieldName);
    if (value.length > 0) return value;
  }
  return "";
}

function timestampField(record: Record<string, unknown>, fieldName: string): string {
  const value = record[fieldName];
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestampMs = value < 1000000000000 ? value * 1000 : value;
    return new Date(timestampMs).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return "";
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

function diffStatus(value: unknown): DiffFileOverview["status"] {
  if (value === "added" || value === "add" || value === "create" || value === "created") return "added";
  if (value === "deleted" || value === "delete" || value === "removed" || value === "remove") return "deleted";
  if (value === "renamed" || value === "rename") return "renamed";
  return "modified";
}

function sessionIdFromParams(params: Record<string, unknown>): string {
  return stringField(params, "threadId") || stringField(params, "thread_id") ||
    stringField(params, "sessionId") || stringField(params, "session_id") ||
    stringField(params, "conversationId") || stringField(params, "conversation_id");
}

function turnIdFromParams(params: Record<string, unknown>): string {
  const turn = asRecord(params.turn);
  return stringField(params, "turnId") || stringField(params, "turn_id") ||
    stringField(turn, "id") || stringField(turn, "turnId") || stringField(turn, "turn_id");
}

function itemRecordFromParams(params: Record<string, unknown>): Record<string, unknown> {
  return asRecord(params.item);
}

function itemIdFromParams(params: Record<string, unknown>, fallback: string): string {
  const item = itemRecordFromParams(params);
  return stringField(params, "itemId") || stringField(params, "messageId") || stringField(item, "id") || fallback;
}

function normalizeTurnStatus(status: unknown): SessionTurn["status"] {
  if (status === "inProgress" || status === "running") return "running";
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "interrupted" || status === "cancelled" || status === "canceled") return "interrupted";
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

function kindFromItem(item: Record<string, unknown>): TimelineItemKind {
  const type = stringField(item, "type");
  if (type === "userMessage") return "userMessage";
  if (type === "agentMessage") return "agentMessage";
  if (type === "reasoning") return "reasoningSummary";
  if (type === "plan") return "plan";
  if (type === "commandExecution") return "commandExecution";
  if (type === "fileChange") return "fileChange";
  if (type === "imageView") return "imageView";
  if (type === "imageGeneration") return "imageGeneration";
  if (type === "artifact") return "artifact";
  if (type === "contextCompaction") return "contextCompaction";
  if (type === "error") return "error";
  if (type === "mcpToolCall" || type === "webSearch" || type === "dynamicToolCall") return "toolProgress";
  return "toolProgress";
}

function mapPlanSteps(input: unknown): SessionPlanStep[] {
  return asArray(input).map((stepInput, index) => {
    const step = asRecord(stepInput);
    return {
      id: stringField(step, "id") || `step-${index + 1}`,
      title: stringField(step, "title") || stringField(step, "step") || `Step ${index + 1}`,
      status: normalizePlanStepStatus(step.status),
      detail: stringField(step, "detail")
    };
  });
}

function isUserInputRequestMethod(method: string): boolean {
  return method === "item/tool/requestUserInput";
}

function isPermissionsRequestMethod(method: string): boolean {
  return method === "item/permissions/requestApproval";
}

const ACCEPT_APPROVAL_ACTIONS = new Set(["accept", "approve", "allow", "yes", "grantForTurn", "grantForTurnWithStrictAutoReview"]);
const SESSION_APPROVAL_ACTIONS = new Set(["acceptForSession", "acceptWithExecpolicyAmendment", "applyNetworkPolicyAmendment", "grantForSession"]);
const DECLINE_APPROVAL_ACTIONS = new Set(["decline", "reject", "deny", "disallow", "no"]);
const CANCEL_APPROVAL_ACTIONS = new Set(["cancel", "dismiss", "abort"]);

function approvalActionRequiresSecondConfirm(action: TimelineApprovalAction): boolean {
  return action.requiresSecondConfirm === true || SESSION_APPROVAL_ACTIONS.has(action.id);
}

function stringFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function diagnosticTextFromValue(value: unknown): string {
  const direct = stringFromValue(value).trim();
  if (direct.length > 0) return direct;
  const record = asRecord(value);
  return firstStringField(record, ["message", "detail", "reason", "description", "title"]).trim();
}

function turnErrorMessage(turn: Record<string, unknown>): string | undefined {
  const direct = diagnosticTextFromValue(turn.error);
  if (direct.length > 0) return direct;
  return undefined;
}

function stringsFromArray(value: unknown): string[] {
  const result: string[] = [];
  for (const item of asArray(value)) {
    if (typeof item === "string") {
      result.push(item);
      continue;
    }
    const record = asRecord(item);
    const label = firstStringField(record, ["label", "title", "value", "const", "id", "name"]);
    if (label.length > 0) result.push(label);
  }
  return result;
}

function inputFieldRawType(field: Record<string, unknown>): string {
  return firstStringField(field, ["type", "inputType", "format"]).toLowerCase();
}

function inputFieldType(field: Record<string, unknown>): TimelineApprovalInputField["type"] {
  const rawType = inputFieldRawType(field);
  if (rawType === "boolean" || rawType === "bool") return "single-select";
  if (rawType === "secret" || rawType === "password") return "secret";
  if (rawType === "array") return "multi-select";
  if (rawType === "multi-select" || rawType === "multiselect" || rawType === "checkbox") return "multi-select";
  if (rawType === "single-select" || rawType === "select" || rawType === "radio") return "single-select";
  return "text";
}

function fieldOptions(field: Record<string, unknown>): string[] {
  const rawType = inputFieldRawType(field);
  if (rawType === "boolean" || rawType === "bool") return ["True", "False"];
  const items = asRecord(field.items);
  const enumNames = stringsFromArray(field.enumNames);
  if (enumNames.length > 0) return enumNames;
  return stringsFromArray(field.options)
    .concat(stringsFromArray(field.choices))
    .concat(stringsFromArray(field.enum))
    .concat(stringsFromArray(field.oneOf))
    .concat(stringsFromArray(field.anyOf))
    .concat(stringsFromArray(items.enum))
    .concat(stringsFromArray(items.anyOf));
}

function inputFieldFromRecord(field: Record<string, unknown>, fallbackId: string): TimelineApprovalInputField {
  const id = firstStringField(field, ["id", "key", "name", "fieldId", "inputId"]) || fallbackId;
  const options = fieldOptions(field);
  const fieldType = inputFieldType(field);
  const type = fieldType === "text" && options.length > 0 ? "single-select" : fieldType;
  const isSecret = booleanField(field, "isSecret") || booleanField(field, "secret") || type === "secret";
  const rawType = inputFieldRawType(field);
  const rawDefaultValue = isSecret ? "" : firstStringField(field, ["defaultValue", "default", "value", "initialValue"]) ||
    stringFromValue(field.defaultValue) ||
    stringFromValue(field.default) ||
    stringFromValue(field.value) ||
    stringFromValue(field.initialValue);
  const defaultValue = rawType === "boolean" || rawType === "bool" ?
    rawDefaultValue === "false" ? "False" : rawDefaultValue.length > 0 ? "True" : "" :
    rawDefaultValue;
  const requiredValue = firstPresentField(field, ["isRequired", "required"]);
  const isRequired = requiredValue === false ? false : undefined;
  return {
    id,
    label: firstStringField(field, ["label", "title", "description", "prompt"]) || id,
    type,
    defaultValue,
    options,
    isSecret,
    ...(isRequired === false ? { isRequired } : {})
  };
}

function inputFieldsFromQuestions(value: unknown): TimelineApprovalInputField[] {
  const result: TimelineApprovalInputField[] = [];
  const questions = asArray(value);
  for (let index = 0; index < questions.length; index++) {
    const question = asRecord(questions[index]);
    if (Object.keys(question).length === 0) continue;
    const id = firstStringField(question, ["id", "key", "name"]) || `answer-${index + 1}`;
    const options = stringsFromArray(question.options);
    const isSecret = booleanField(question, "isSecret") || booleanField(question, "secret");
    result.push({
      id,
      label: firstStringField(question, ["header", "label", "title", "question", "prompt"]) || id,
      type: isSecret ? "secret" : options.length > 0 ? "single-select" : "text",
      defaultValue: "",
      options,
      isSecret
    });
  }
  return result;
}

function inputFieldsFromArray(value: unknown): TimelineApprovalInputField[] {
  const result: TimelineApprovalInputField[] = [];
  const fields = asArray(value);
  for (let index = 0; index < fields.length; index++) {
    const field = asRecord(fields[index]);
    if (Object.keys(field).length === 0) continue;
    result.push(inputFieldFromRecord(field, `answer-${index + 1}`));
  }
  return result;
}

function inputFieldsFromSchema(value: unknown): TimelineApprovalInputField[] {
  const schema = asRecord(value);
  const properties = asRecord(schema.properties);
  const requiredIds = new Set(stringsFromArray(schema.required));
  const result: TimelineApprovalInputField[] = [];
  for (const [propertyId, propertyValue] of Object.entries(properties)) {
    const field = asRecord(propertyValue);
    result.push(inputFieldFromRecord({ ...field, id: propertyId, isRequired: requiredIds.has(propertyId) }, propertyId));
  }
  return result;
}

function fallbackInputFieldFromParams(params: Record<string, unknown>): TimelineApprovalInputField {
  const id = firstStringField(params, ["fieldId", "inputId", "answerId", "key", "name"]) || "answer";
  return inputFieldFromRecord({ ...params, id }, id);
}

function userInputFieldsFromParams(method: string, params: Record<string, unknown>): TimelineApprovalInputField[] | undefined {
  if (!isUserInputRequestMethod(method) && !isMcpElicitationRequestMethod(method)) return undefined;
  const directFields = inputFieldsFromArray(params.fields);
  if (directFields.length > 0) return directFields;
  const inputFields = inputFieldsFromArray(params.inputFields);
  if (inputFields.length > 0) return inputFields;
  const inputs = inputFieldsFromArray(params.inputs);
  if (inputs.length > 0) return inputs;
  const questionFields = inputFieldsFromQuestions(params.questions);
  if (questionFields.length > 0) return questionFields;
  const schemaFields = inputFieldsFromSchema(params.inputSchema ?? params.schema ?? params.jsonSchema ?? params.requestedSchema ?? params.requested_schema);
  if (schemaFields.length > 0) return schemaFields;
  if (isMcpElicitationRequestMethod(method)) return undefined;
  return [fallbackInputFieldFromParams(params)];
}

function isMcpElicitationRequestMethod(method: string): boolean {
  return method === "mcpServer/elicitation/request";
}

function hasPresentField(record: Record<string, unknown>, fieldNames: string[]): boolean {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (value !== undefined && value !== null) return true;
  }
  return false;
}

function firstPresentField(record: Record<string, unknown>, fieldNames: string[]): unknown {
  for (const fieldName of fieldNames) {
    if (Object.prototype.hasOwnProperty.call(record, fieldName)) return record[fieldName];
  }
  return undefined;
}

function defaultApprovalTitle(method: string, params: Record<string, unknown> = {}): string {
  if (method === "item/fileChange/requestApproval") return "文件变更审批";
  if (method === "applyPatchApproval") return "文件变更审批";
  if (isPermissionsRequestMethod(method)) return "权限审批";
  if (isMcpElicitationRequestMethod(method)) {
    const serverName = stringField(params, "serverName") || stringField(params, "server_name");
    const toolName = firstStringField(params, ["toolName", "tool_name", "tool"]);
    if (serverName.length > 0 && toolName.length > 0) return `${serverName} / ${toolName} 需要确认`;
    return serverName.length > 0 ? `${serverName} 需要确认` : "MCP 确认";
  }
  if (isUserInputRequestMethod(method)) return "需要补充信息";
  if (method === "item/commandExecution/requestApproval") {
    if (hasPresentField(params, ["networkApprovalContext", "network_approval_context"])) {
      return "是否允许 Codex 访问网络？";
    }
    return "是否允许 Codex 运行命令？";
  }
  return "命令审批";
}

function approvalTitleFromParams(method: string, params: Record<string, unknown>): string {
  const title = stringField(params, "title");
  if (method === "item/commandExecution/requestApproval" && (title.length === 0 || title === "命令审批")) {
    return defaultApprovalTitle(method, params);
  }
  return title || defaultApprovalTitle(method, params);
}

function commandTextFromParams(params: Record<string, unknown>): string {
  const direct = stringField(params, "command");
  if (direct.length > 0) return direct;
  const commandParts = asArray(params.command).map((part) => stringFromValue(part)).filter((part) => part.length > 0);
  if (commandParts.length > 0) return commandParts.join(" ");
  return "";
}

function approvalCommandBody(params: Record<string, unknown>): string {
  const command = commandTextFromParams(params);
  const reason = stringField(params, "reason");
  const cwd = stringField(params, "cwd");
  const permissionsSummary = permissionRuleSummary(firstPresentField(params, ["additionalPermissions", "additional_permissions"]));
  const parts: string[] = [];
  if (reason.length > 0) parts.push(`原因: ${reason}`);
  if (cwd.length > 0) parts.push(`工作目录: ${cwd}`);
  if (permissionsSummary.length > 0) parts.push(`权限: ${permissionsSummary}`);
  if (command.length > 0) parts.push(`$ ${command}`);
  return parts.join("\n\n");
}

function legacyPatchBodyFromParams(params: Record<string, unknown>): string {
  const reason = stringField(params, "reason");
  const grantRoot = stringField(params, "grantRoot") || stringField(params, "grant_root");
  const fileChanges = asRecord(params.fileChanges);
  const changedPaths = Object.keys(fileChanges);
  const parts: string[] = [];
  if (reason.length > 0) parts.push(reason);
  if (grantRoot.length > 0) parts.push(grantRoot);
  if (changedPaths.length > 0) parts.push(changedPaths.join("\n"));
  return parts.join("\n\n");
}

function permissionRuleSummary(permissionsInput: unknown): string {
  const permissions = asRecord(permissionsInput);
  const parts: string[] = [];
  const network = asRecord(permissions.network);
  if (network.enabled === true) parts.push("网络");
  const fileSystem = asRecord(firstPresentField(permissions, ["fileSystem", "file_system"]));
  const readPaths = stringsFromArray(fileSystem.read);
  if (readPaths.length > 0) parts.push(`读取 ${readPaths.join(", ")}`);
  const writePaths = stringsFromArray(fileSystem.write);
  if (writePaths.length > 0) parts.push(`写入 ${writePaths.join(", ")}`);
  const entries = asArray(fileSystem.entries).map((entryInput) => {
    const entry = asRecord(entryInput);
    const path = asRecord(entry.path);
    const pathText = stringField(path, "path") || stringField(path, "pattern") || stringField(path, "value");
    const access = stringField(entry, "access");
    if (pathText.length === 0 || access.length === 0) return "";
    return `${access} ${pathText}`;
  }).filter((entry) => entry.length > 0);
  if (entries.length > 0) parts.push(entries.join(", "));
  return parts.join("; ");
}

function approvalBodyFromParams(method: string, params: Record<string, unknown>): string {
  if (method === "item/commandExecution/requestApproval") {
    const commandBody = approvalCommandBody(params);
    const reason = stringField(params, "reason");
    const networkContext = asRecord(firstPresentField(params, ["networkApprovalContext", "network_approval_context"]));
    const host = stringField(networkContext, "host");
    const protocol = stringField(networkContext, "protocol");
    if (host.length > 0) {
      const target = protocol.length > 0 ? `${protocol}://${host}` : host;
      return reason.length > 0 ? `${target}\n\n${reason}` : target;
    }
    return commandBody || reason;
  }
  if (method === "item/fileChange/requestApproval") {
    return stringField(params, "reason") || stringField(params, "message") || stringField(params, "grantRoot") || stringField(params, "grant_root");
  }
  if (method === "execCommandApproval") {
    return commandTextFromParams(params) || stringField(params, "reason");
  }
  if (method === "applyPatchApproval") {
    return legacyPatchBodyFromParams(params);
  }
  if (isPermissionsRequestMethod(method)) {
    const reason = stringField(params, "reason");
    const summary = permissionRuleSummary(params.permissions);
    if (reason.length > 0 && summary.length > 0) return `${reason}\n\n${summary}`;
    return reason || summary || stringField(params, "message");
  }
  if (method === "item/tool/requestUserInput") {
    const questions = asArray(params.questions);
    const firstQuestion = asRecord(questions[0]);
    return stringField(params, "prompt") || stringField(params, "message") || firstStringField(firstQuestion, ["question", "header"]);
  }
  if (isMcpElicitationRequestMethod(method)) {
    return firstStringField(params, ["message", "description", "prompt"]) || mcpFieldLabelSummary(params);
  }
  return stringField(params, "command") || stringField(params, "message") || stringField(params, "prompt");
}

function approvalKindFromMethod(method: string): TimelineApprovalKind {
  if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") return "command";
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") return "file_change";
  if (isPermissionsRequestMethod(method)) return "permission";
  if (isMcpElicitationRequestMethod(method)) return "mcp_elicitation";
  if (method === "item/tool/requestUserInput") return "user_input";
  return "unknown";
}

function approvalSubjectFromParams(method: string, params: Record<string, unknown>): string {
  const body = approvalBodyFromParams(method, params);
  if (method === "item/commandExecution/requestApproval" || method === "execCommandApproval") {
    return commandTextFromParams(params) || body;
  }
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
    return firstStringField(params, ["message", "reason", "grantRoot", "grant_root"]) || body;
  }
  if (isPermissionsRequestMethod(method)) {
    return firstStringField(params, ["message", "reason"]) || permissionRuleSummary(params.permissions) || body;
  }
  if (method === "item/tool/requestUserInput") {
    const questions = asArray(params.questions);
    const firstQuestion = asRecord(questions[0]);
    return firstStringField(params, ["prompt", "message"]) || firstStringField(firstQuestion, ["question", "header"]) || body;
  }
  if (isMcpElicitationRequestMethod(method)) {
    return firstStringField(params, ["message", "description", "prompt"]) || mcpFieldLabelSummary(params) || body;
  }
  return body;
}

function mcpFieldLabelSummary(params: Record<string, unknown>): string {
  const fields = userInputFieldsFromParams("mcpServer/elicitation/request", params);
  if (fields === undefined) return "";
  const labels: string[] = [];
  for (const field of fields) {
    const label = field.label.trim();
    if (label.length > 0) labels.push(label);
  }
  return labels.join("\n");
}

function commandApprovalDefaultActions(params: Record<string, unknown>): TimelineApprovalAction[] {
  const actions: TimelineApprovalAction[] = [{ id: "accept", label: "本次同意" }];
  if (hasPresentField(params, ["networkApprovalContext", "network_approval_context"])) {
    actions.push({ id: "acceptForSession", label: "本会话允许此主机" });
    const amendments = asArray(firstPresentField(params, ["proposedNetworkPolicyAmendments", "proposed_network_policy_amendments"]));
    const allowAmendment = amendments.find((item) => asRecord(item).action === "allow");
    if (allowAmendment !== undefined) actions.push({ id: "applyNetworkPolicyAmendment", label: "以后允许此主机" });
    actions.push({ id: "decline", label: "不执行，继续对话" });
    return actions;
  }
  if (hasPresentField(params, ["additionalPermissions", "additional_permissions"])) {
    actions.push({ id: "decline", label: "不执行，继续对话" });
    return actions;
  }
  if (hasPresentField(params, ["proposedExecpolicyAmendment", "proposed_execpolicy_amendment"])) {
    actions.push({ id: "acceptWithExecpolicyAmendment", label: "以后同意同类命令" });
  } else {
    actions.push({ id: "acceptForSession", label: "本会话中同意此类操作" });
  }
  actions.push({ id: "decline", label: "不执行，继续对话" });
  return actions;
}

function defaultApprovalActions(method: string, params: Record<string, unknown> = {}): TimelineApprovalAction[] {
  if (method === "item/tool/requestUserInput") {
    return [
      { id: "submit", label: "提交", decisionType: "user-input-submit" },
      { id: "cancel", label: "取消", decisionType: "cancel" }
    ];
  }
  if (isMcpElicitationRequestMethod(method)) {
    const hasForm = userInputFieldsFromParams(method, params)?.length ? params.mode === "form" || hasPresentField(params, ["requestedSchema", "requested_schema", "inputSchema", "schema", "jsonSchema", "fields", "inputFields", "inputs"]) : false;
    return [
      { id: "accept", label: "提供请求的信息", decisionType: hasForm ? "user-input-submit" : undefined },
      { id: "decline", label: "不提供，但继续" },
      { id: "cancel", label: "取消请求", decisionType: "cancel" }
    ];
  }
  if (isPermissionsRequestMethod(method)) {
    return [
      { id: "grantForTurn", label: "本轮授权这些权限" },
      { id: "grantForTurnWithStrictAutoReview", label: "本轮授权并严格自动审查" },
      { id: "grantForSession", label: "本会话授权这些权限" },
      { id: "decline", label: "不授权，继续" }
    ];
  }
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
    return [
      { id: "accept", label: "同意修改" },
      { id: "acceptForSession", label: "本会话同意这些文件的修改" },
      { id: "decline", label: "不修改，继续对话" }
    ];
  }
  if (method === "execCommandApproval") {
    return [
      { id: "accept", label: "同意" },
      { id: "acceptForSession", label: "本会话中同意此类操作" },
      { id: "decline", label: "不执行，继续对话" }
    ];
  }
  return commandApprovalDefaultActions(params);
}

function isAcceptApprovalAction(action: TimelineApprovalAction): boolean {
  return ACCEPT_APPROVAL_ACTIONS.has(action.id);
}

function isSessionApprovalAction(action: TimelineApprovalAction): boolean {
  return SESSION_APPROVAL_ACTIONS.has(action.id);
}

function isDeclineApprovalAction(action: TimelineApprovalAction): boolean {
  return DECLINE_APPROVAL_ACTIONS.has(action.id);
}

function isCancelApprovalAction(action: TimelineApprovalAction): boolean {
  return action.decisionType === "cancel" || CANCEL_APPROVAL_ACTIONS.has(action.id);
}

function firstApprovalAction(actions: TimelineApprovalAction[], matcher: (action: TimelineApprovalAction) => boolean): TimelineApprovalAction | null {
  for (const action of actions) {
    if (matcher(action)) return action;
  }
  return null;
}

function relabelApprovalAction(action: TimelineApprovalAction, label: string, decisionType?: string): TimelineApprovalAction {
  return {
    id: action.id,
    label,
    style: action.style,
    decisionType: decisionType ?? action.decisionType,
    requiresSecondConfirm: approvalActionRequiresSecondConfirm(action) ? true : undefined
  };
}

function actionLabel(method: string, actionId: string, params: Record<string, unknown>, originalLabel: string = ""): string {
  if (method === "item/tool/requestUserInput") {
    if (actionId === "submit") return "提交";
    if (CANCEL_APPROVAL_ACTIONS.has(actionId)) return "取消";
  }
  if (isPermissionsRequestMethod(method)) {
    if (actionId === "grantForTurn" || actionId === "accept") return "本轮授权这些权限";
    if (actionId === "grantForTurnWithStrictAutoReview") return "本轮授权并严格自动审查";
    if (actionId === "grantForSession" || actionId === "acceptForSession" || actionId === "applyNetworkPolicyAmendment") return "本会话授权这些权限";
    if (isDeclineApprovalAction({ id: actionId, label: "" })) return "不授权，继续";
  }
  if (isMcpElicitationRequestMethod(method)) {
    if (actionId === "accept" || actionId === "submit") return "提供请求的信息";
    if (isDeclineApprovalAction({ id: actionId, label: "" })) return "不提供，但继续";
    if (CANCEL_APPROVAL_ACTIONS.has(actionId)) return "取消请求";
  }
  if (actionId === "accept" || actionId === "approve" || actionId === "allow" || actionId === "yes") {
    return hasPresentField(params, ["networkApprovalContext", "network_approval_context"]) ? "本次同意" : "同意";
  }
  if (actionId === "acceptForSession") {
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") return "本会话同意这些文件的修改";
    if (hasPresentField(params, ["networkApprovalContext", "network_approval_context"])) return "本会话允许此主机";
    return "本会话中同意此类操作";
  }
  if (actionId === "acceptWithExecpolicyAmendment") return "以后同意同类命令";
  if (actionId === "applyNetworkPolicyAmendment") return "以后允许此主机";
  if (isDeclineApprovalAction({ id: actionId, label: "" })) {
    if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") return "不修改，继续对话";
    return "不执行，继续对话";
  }
  if (CANCEL_APPROVAL_ACTIONS.has(actionId)) return "取消并告知 Codex 调整";
  if (originalLabel.length > 0) return originalLabel;
  return originalLabel || actionId;
}

function normalizedApprovalActions(method: string, actions: TimelineApprovalAction[], params: Record<string, unknown> = {}): TimelineApprovalAction[] {
  const sourceActions = actions.length > 0 ? actions : defaultApprovalActions(method, params);
  return sourceActions.map((action) => {
    const decisionType = isCancelApprovalAction(action) ? "cancel" : action.decisionType;
    return relabelApprovalAction(action, actionLabel(method, action.id, params, action.label), decisionType);
  });
}

function actionIdFromDecision(decisionInput: unknown): string {
  if (typeof decisionInput === "string") return decisionInput;
  const decision = asRecord(decisionInput);
  return Object.keys(decision)[0] ?? "";
}

function approvalActionFromDecision(method: string, decisionInput: unknown, params: Record<string, unknown>): TimelineApprovalAction | null {
  const actionId = actionIdFromDecision(decisionInput);
  if (actionId.length === 0) return null;
  return {
    id: actionId,
    label: actionLabel(method, actionId, params),
    decisionType: CANCEL_APPROVAL_ACTIONS.has(actionId) ? "cancel" : undefined
  };
}

function approvalActionsFromParams(method: string, params: Record<string, unknown>): TimelineApprovalAction[] {
  const explicitActions = asArray(params.actions).map((actionInput) => {
    const action = asRecord(actionInput);
    const actionId = stringField(action, "id");
    const mappedAction = {
      id: actionId,
      label: stringField(action, "label") || actionId,
      style: stringField(action, "style") || undefined,
      decisionType: stringField(action, "decisionType") || undefined,
      requiresSecondConfirm: action.requiresSecondConfirm === true ? true : undefined
    };
    return mappedAction;
  }).filter((action) => action.id.length > 0);
  if (explicitActions.length > 0) return explicitActions;

  const decisions = asArray(firstPresentField(params, ["availableDecisions", "available_decisions"]));
  return decisions.map((decision) => approvalActionFromDecision(method, decision, params)).filter((action): action is TimelineApprovalAction => action !== null);
}

function commandSummary(input: { id: string; turnId: string; command: string; status: CommandSummary["status"]; output: string; exitCode: number | null }): CommandSummary {
  return {
    id: input.id,
    turnId: input.turnId,
    title: input.command.split(/\s+/).filter(Boolean).slice(0, 3).join(" ") || "command",
    command: input.command,
    status: input.status,
    exitCode: input.exitCode,
    summaryLines: input.output.split("\n").filter(Boolean).slice(-6),
    rawOutput: input.output
  };
}

function emptyItem(input: { id: string; sessionId: string; turnId: string; kind: TimelineItemKind; status: TimelineItemStatus; title?: string; text?: string; rawText?: string; createdAt?: string }): TimelineItem {
  const now = input.createdAt && input.createdAt.length > 0 ? input.createdAt : new Date().toISOString();
  return {
    id: input.id,
    sessionId: input.sessionId,
    turnId: input.turnId,
    kind: input.kind,
    status: input.status,
    title: input.title ?? "",
    text: input.text ?? "",
    rawText: input.rawText ?? input.text ?? "",
    createdAt: now,
    updatedAt: now,
    isStreaming: input.status === "running",
    isCollapsedByDefault: input.kind !== "agentMessage" && input.kind !== "userMessage",
    command: null,
    diff: null,
    approval: null,
    planSteps: [],
    assetIds: []
  };
}

function userClientMessageId(record: Record<string, unknown>): string | null {
  const clientMessageId = stringField(record, "clientMessageId") ||
    stringField(record, "clientUserMessageId") ||
    stringField(record, "clientId") ||
    stringField(record, "client_id");
  return clientMessageId.length > 0 ? clientMessageId : null;
}

function itemStartedAt(params: Record<string, unknown>): string {
  return timestampField(params, "startedAtMs") || timestampField(params, "createdAtMs") || "";
}

function itemCompletedAt(params: Record<string, unknown>): string {
  return timestampField(params, "completedAtMs") || timestampField(params, "updatedAtMs") || "";
}

function textFromItemRecord(itemRecord: Record<string, unknown>, kind: TimelineItemKind): string {
  if (kind === "error") return diagnosticTextFromValue(itemRecord) || diagnosticTextFromValue(itemRecord.error);
  if (kind === "toolProgress") return toolTextFromItem(itemRecord);
  if (kind === "imageGeneration") {
    return firstStringField(itemRecord, ["revisedPrompt", "revised_prompt", "prompt", "text", "message", "summary"]);
  }
  return stringField(itemRecord, "text") ||
    stringField(itemRecord, "message") ||
    stringField(itemRecord, "summary") ||
    stringField(itemRecord, "output") ||
    stringField(itemRecord, "aggregatedOutput");
}

function titleFromItemRecord(itemRecord: Record<string, unknown>, kind: TimelineItemKind): string {
  if (kind === "toolProgress") return toolTitleFromItem(itemRecord);
  if (kind === "commandExecution") {
    const command = stringField(itemRecord, "command") || stringField(itemRecord, "cmd") || textFromItemRecord(itemRecord, kind) || "command";
    return commandTitleFromItem(itemRecord, command);
  }
  if (kind === "fileChange" || kind === "diffOverview") return "文件修改";
  if (kind === "plan") return "计划";
  if (kind === "imageGeneration") return stringField(itemRecord, "title") || "imagegen";
  if (kind === "contextCompaction") return "上下文压缩";
  if (kind === "error") return "错误";
  return stringField(itemRecord, "title");
}

function assetIdsFromItemRecord(itemRecord: Record<string, unknown>): string[] {
  const result: string[] = [];
  appendAssetId(result, stringField(itemRecord, "assetId"));
  appendAssetId(result, stringField(itemRecord, "mediaAssetId"));
  appendAssetId(result, stringField(itemRecord, "artifactAssetId"));
  appendAssetIdsFromArray(result, itemRecord.assetIds);
  appendAssetIdsFromArray(result, itemRecord.assets);
  appendAssetIdsFromArray(result, itemRecord.mediaAssets);
  appendAssetIdsFromArray(result, itemRecord.artifacts);
  const asset = asRecord(itemRecord.asset);
  appendAssetId(result, stringField(asset, "id"));
  return result;
}

function appendAssetIdsFromArray(result: string[], value: unknown): void {
  for (const item of asArray(value)) {
    if (typeof item === "string") {
      appendAssetId(result, item);
      continue;
    }
    const record = asRecord(item);
    appendAssetId(result, firstStringField(record, ["id", "assetId", "mediaAssetId"]));
  }
}

function appendAssetId(result: string[], assetId: string): void {
  if (assetId.length === 0 || result.includes(assetId)) return;
  result.push(assetId);
}

function commandStatus(status: TimelineItemStatus): CommandSummary["status"] {
  if (status === "failed") return "failed";
  if (status === "running" || status === "pending") return "running";
  return "completed";
}

function diffOverviewFromFiles(filesInput: unknown): DiffOverview | null {
  const files = asArray(filesInput).map((fileInput) => {
    const file = asRecord(fileInput);
    const path = stringField(file, "path");
    if (path.length === 0) return null;
    return {
      path,
      status: diffStatus(file.status),
      insertions: Math.max(0, numberOrNull(file.insertions) ?? 0),
      deletions: Math.max(0, numberOrNull(file.deletions) ?? 0),
      patch: firstStringField(file, ["patch", "diff"])
    };
  }).filter((file): file is DiffFileOverview => file !== null);
  if (files.length === 0) return null;
  return {
    filesChanged: files.length,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files
  };
}

function cleanDiffPath(pathText: string): string {
  if (pathText.startsWith("a/") || pathText.startsWith("b/")) return pathText.slice(2);
  return pathText;
}

function diffOverviewFromUnifiedDiff(diff: string): DiffOverview | null {
  if (diff.length === 0) return null;
  const files: DiffFileOverview[] = [];
  let current: DiffFileOverview | null = null;
  let currentPatchLines: string[] = [];
  const lines = diff.split("\n");
  for (const line of lines) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (match) {
      if (current) current.patch = currentPatchLines.join("\n");
      current = {
        path: cleanDiffPath(match[2]),
        status: "modified",
        insertions: 0,
        deletions: 0,
        patch: ""
      };
      currentPatchLines = [line];
      files.push(current);
      continue;
    }
    if (!current) continue;
    currentPatchLines.push(line);
    if (line.startsWith("new file mode")) current.status = "added";
    else if (line.startsWith("deleted file mode")) current.status = "deleted";
    else if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = cleanDiffPath(line.slice("rename to ".length));
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.insertions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
    }
  }
  if (current) current.patch = currentPatchLines.join("\n");
  if (files.length === 0) return null;
  return {
    filesChanged: files.length,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files
  };
}

function diffOverviewWithMergedPatches(primary: DiffOverview | null, patchSource: DiffOverview | null, previous: DiffOverview | null = null): DiffOverview | null {
  const base = primary ?? patchSource ?? previous;
  if (base === null) return null;
  const files = base.files.map((file) => {
    if (file.patch.length > 0) return file;
    const patchFile = patchSource?.files.find((candidate) => candidate.path === file.path);
    if (patchFile && patchFile.patch.length > 0) {
      return {
        path: file.path,
        status: file.status,
        insertions: file.insertions,
        deletions: file.deletions,
        patch: patchFile.patch
      };
    }
    const previousFile = previous?.files.find((candidate) => candidate.path === file.path);
    if (previousFile && previousFile.patch.length > 0) {
      return {
        path: file.path,
        status: file.status,
        insertions: file.insertions,
        deletions: file.deletions,
        patch: previousFile.patch
      };
    }
    return file;
  });
  return {
    filesChanged: base.filesChanged,
    insertions: base.insertions,
    deletions: base.deletions,
    files
  };
}

export function approvalUpdatedEventsFromServerRequest(method: string, id: string, params: Record<string, unknown>): TimelineRuntimeEvent[] {
  const sessionId = sessionIdFromParams(params);
  if (sessionId.length === 0) return [];
  const actions = approvalActionsFromParams(method, params);
  const approval = {
    id,
    kind: approvalKindFromMethod(method),
    method,
    subject: approvalSubjectFromParams(method, params),
    title: approvalTitleFromParams(method, params),
    body: approvalBodyFromParams(method, params),
    actions: normalizedApprovalActions(method, actions, params),
    inputFields: userInputFieldsFromParams(method, params),
    createdAt: new Date().toISOString()
  };
  return [{
    type: "approval.updated",
    sessionId,
    approval
  }];
}

export class CodexTimelineRuntime {
  private turns = new Map<string, SessionTurn>();
  private items = new Map<string, TimelineItem>();
  private approvalSessionIds = new Map<string, string>();
  private terminalInputBuffers = new Map<string, string>();
  private turnClientMessageIds = new Map<string, string>();

  applyNotification(method: string, params: Record<string, unknown>): TimelineRuntimeEvent[] {
    if (method === "remoteControl/status/changed") return [this.remoteStatusEvent(params)];
    if (method === "turn/started") return [this.turnEvent(params, "running")];
    if (method === "turn/completed") return this.turnCompleted(params);
    if (method === "item/started") return [this.itemStarted(params)];
    if (method === "item/agentMessage/delta") return [this.agentDelta(params)];
    if (method === "item/plan/delta") return [this.planDelta(params)];
    if (method === "item/reasoning/summaryTextDelta") return [this.reasoningDelta(params)];
    if (method === "item/reasoning/summaryPartAdded") return [this.reasoningPartAdded(params)];
    if (method === "item/reasoning/textDelta") return [this.reasoningContentDelta(params)];
    if (method === "turn/plan/updated") return [this.planUpdated(params)];
    if (method === "turn/diff/updated") return [this.diffUpdated(params)];
    if (method === "item/commandExecution/outputDelta") return [this.commandOutput(params)];
    if (method === "item/commandExecution/terminalInteraction") return this.terminalInteraction(params);
    if (method === "item/fileChange/patchUpdated") return [this.filePatchUpdated(params)];
    if (method === "item/fileChange/outputDelta") return [this.fileOutputDelta(params)];
    if (method === "item/mcpToolCall/progress") return [this.mcpToolProgress(params)];
    if (method === "thread/compacted") return [this.contextCompacted(params)];
    if (method === "item/completed") return [this.itemCompleted(params)];
    if (method === "error") return this.diagnosticError(params, "错误", "failed");
    if (method === "warning" || method === "guardianWarning" || method === "configWarning") {
      return this.diagnosticError(params, "警告", "failed");
    }
    return [];
  }

  applyServerRequest(method: string, id: string, params: Record<string, unknown>): TimelineRuntimeEvent[] {
    const sessionId = sessionIdFromParams(params);
    if (sessionId.length === 0) return [];
    this.approvalSessionIds.set(id, sessionId);
    return approvalUpdatedEventsFromServerRequest(method, id, params);
  }

  resolveServerRequest(requestId: string): TimelineRuntimeEvent[] {
    const sessionId = this.approvalSessionIds.get(requestId) ?? "";
    this.approvalSessionIds.delete(requestId);
    if (sessionId.length === 0) return [];
    return [{ type: "approval.updated", sessionId, approval: null }];
  }
  private turnKey(sessionId: string, turnId: string): string {
    return `${sessionId}:${turnId}`;
  }

  private clientMessageIdFromTurnParams(params: Record<string, unknown>): string | null {
    const turn = asRecord(params.turn);
    return userClientMessageId(turn) ?? userClientMessageId(params);
  }

  private rememberTurnClientMessageId(sessionId: string, turnId: string, params: Record<string, unknown>): void {
    const clientMessageId = this.clientMessageIdFromTurnParams(params);
    if (clientMessageId === null) return;
    this.turnClientMessageIds.set(this.turnKey(sessionId, turnId), clientMessageId);
  }

  private clientMessageIdForTurn(sessionId: string, turnId: string): string | null {
    return this.turnClientMessageIds.get(this.turnKey(sessionId, turnId)) ?? null;
  }

  private itemKey(sessionId: string, turnId: string, itemId: string): string {
    return `${sessionId}:${turnId}:${itemId}`;
  }

  private ensureTurn(sessionId: string, turnId: string, status: SessionTurn["status"] = "running"): SessionTurn {
    const key = this.turnKey(sessionId, turnId);
    const existing = this.turns.get(key);
    if (existing) {
      existing.status = status === "idle" ? existing.status : status;
      return existing;
    }
    const now = new Date().toISOString();
    const turn: SessionTurn = {
      id: turnId,
      sessionId,
      status,
      startedAt: now,
      completedAt: null,
      items: []
    };
    this.turns.set(key, turn);
    return turn;
  }

  private storeItem(item: TimelineItem): TimelineItem {
    const key = this.itemKey(item.sessionId, item.turnId, item.id);
    const existing = this.items.get(key);
    if (!existing) {
      this.items.set(key, item);
      this.ensureTurn(item.sessionId, item.turnId).items.push(item);
      return item;
    }
    Object.assign(existing, item, { createdAt: existing.createdAt });
    existing.updatedAt = new Date().toISOString();
    return existing;
  }

  private remoteStatusEvent(params: Record<string, unknown>): TimelineRuntimeEvent {
    const rawStatus = stringField(params, "status");
    const status = rawStatus === "disabled" || rawStatus === "connecting" || rawStatus === "connected" || rawStatus === "errored" ? rawStatus : "errored";
    const environmentId = stringField(params, "environmentId") || null;
    return { type: "remoteControl.status.updated", status, environmentId };
  }

  private turnEvent(params: Record<string, unknown>, fallback: SessionTurn["status"]): Extract<TimelineRuntimeEvent, { type: "turn.updated" }> {
    const sessionId = sessionIdFromParams(params);
    const turn = asRecord(params.turn);
    const turnId = turnIdFromParams(params);
    this.rememberTurnClientMessageId(sessionId, turnId, params);
    const nextTurn = this.ensureTurn(sessionId, turnId, normalizeTurnStatus(turn.status) === "idle" ? fallback : normalizeTurnStatus(turn.status));
    nextTurn.itemsView = normalizeItemsView(turn.itemsView);
    nextTurn.durationMs = numberOrNull(turn.durationMs);
    nextTurn.errorMessage = turnErrorMessage(turn);
    const startedAt = timestampField(params, "startedAtMs") ||
      timestampField(params, "createdAtMs") ||
      timestampField(turn, "startedAtMs") ||
      timestampField(turn, "turnStartedAtMs") ||
      timestampField(turn, "createdAtMs") ||
      timestampField(turn, "startedAt") ||
      timestampField(turn, "createdAt");
    if (startedAt.length > 0) nextTurn.startedAt = startedAt;
    if (fallback === "completed") {
      const completedAt = timestampField(params, "completedAtMs") ||
        timestampField(params, "updatedAtMs") ||
        timestampField(turn, "completedAtMs") ||
        timestampField(turn, "updatedAtMs") ||
        timestampField(turn, "completedAt") ||
        timestampField(turn, "updatedAt");
      nextTurn.completedAt = completedAt.length > 0 ? completedAt : new Date().toISOString();
    }
    return { type: "turn.updated", turn: nextTurn };
  }

  private turnCompleted(params: Record<string, unknown>): TimelineRuntimeEvent[] {
    const turnEvent = this.turnEvent(params, "completed");
    if (turnEvent.turn.status !== "failed") return [turnEvent];
    const errorEvents = this.diagnosticError(params, "错误", "failed");
    return errorEvents.length > 0 ? [turnEvent, ...errorEvents] : [turnEvent];
  }

  private diagnosticText(params: Record<string, unknown>): string {
    const direct = firstStringField(params, ["message", "detail", "reason", "description", "title"]).trim();
    if (direct.length > 0) return direct;

    const errorText = diagnosticTextFromValue(params.error);
    if (errorText.length > 0) return errorText;

    const failureText = diagnosticTextFromValue(params.failure);
    if (failureText.length > 0) return failureText;

    const statusText = diagnosticTextFromValue(asRecord(params.status));
    if (statusText.length > 0) return statusText;

    return diagnosticTextFromValue(asRecord(params.turn));
  }

  private diagnosticError(params: Record<string, unknown>, title: string, status: TimelineItemStatus): TimelineRuntimeEvent[] {
    const sessionId = sessionIdFromParams(params);
    const turnId = turnIdFromParams(params);
    const text = this.diagnosticText(params);
    if (sessionId.length === 0 || turnId.length === 0 || text.length === 0) return [];

    const createdAt = itemCompletedAt(params) || itemStartedAt(params) || timestampField(params, "createdAt") || timestampField(params, "updatedAt");
    const item = this.storeItem(emptyItem({
      id: itemIdFromParams(params, `${turnId}:error`),
      sessionId,
      turnId,
      kind: "error",
      status,
      title,
      text,
      rawText: text,
      createdAt
    }));
    item.status = status;
    item.title = title;
    item.text = text;
    item.rawText = text;
    item.isStreaming = false;
    item.isCollapsedByDefault = false;
    item.updatedAt = createdAt.length > 0 ? createdAt : new Date().toISOString();
    return [{ type: "timeline.item.completed", item }];
  }

  private itemStarted(params: Record<string, unknown>): TimelineRuntimeEvent {
    const sessionId = sessionIdFromParams(params);
    const turnId = turnIdFromParams(params);
    const itemRecord = itemRecordFromParams(params);
    const itemId = itemIdFromParams(params, `${turnId}:item`);
    const kind = kindFromItem(itemRecord);
    const text = textFromItemRecord(itemRecord, kind);
    const item = this.storeItem(emptyItem({
      id: itemId,
      sessionId,
      turnId,
      kind,
      status: normalizeItemStatus(itemRecord.status, "running"),
      title: titleFromItemRecord(itemRecord, kind),
      text,
      createdAt: itemStartedAt(params)
    }));
    if (kind === "agentMessage") {
      const phase = messagePhase(itemRecord.phase);
      if (phase) item.phase = phase;
    } else if (kind === "userMessage") {
      item.clientMessageId = userClientMessageId(itemRecord) ?? userClientMessageId(params) ?? this.clientMessageIdForTurn(sessionId, turnId);
    }
    if (kind === "commandExecution") {
      const command = stringField(itemRecord, "command") || text || "command";
      item.command = commandSummary({ id: item.id, turnId, command, status: commandStatus(item.status), output: item.rawText, exitCode: numberOrNull(itemRecord.exitCode) });
      item.command.title = titleFromItemRecord(itemRecord, kind);
    } else if (kind === "fileChange") {
      item.diff = diffOverviewFromFiles(itemRecord.files) ?? diffOverviewFromFileChanges(itemRecord.changes);
    } else if (kind === "imageGeneration") {
      item.assetIds = assetIdsFromItemRecord(itemRecord);
    }
    return { type: "timeline.item.started", item };
  }

  private getOrCreateItem(params: Record<string, unknown>, kind: TimelineItemKind): TimelineItem {
    const sessionId = sessionIdFromParams(params);
    const turnId = turnIdFromParams(params);
    const itemId = itemIdFromParams(params, `${turnId}:${kind}`);
    const key = this.itemKey(sessionId, turnId, itemId);
    const existing = this.items.get(key);
    if (existing) return existing;
    return this.storeItem(emptyItem({ id: itemId, sessionId, turnId, kind, status: "running" }));
  }

  private agentDelta(params: Record<string, unknown>): TimelineRuntimeEvent {
    const item = this.getOrCreateItem(params, "agentMessage");
    const fullText = stringField(params, "message") || stringField(params, "text");
    item.text = fullText.length > 0 ? fullText : `${item.text}${stringField(params, "delta")}`;
    item.rawText = item.text;
    item.status = "running";
    item.isStreaming = true;
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private reasoningDelta(params: Record<string, unknown>): TimelineRuntimeEvent {
    const item = this.getOrCreateItem(params, "reasoningSummary");
    item.text = `${item.text}${stringField(params, "delta")}`;
    item.rawText = item.text;
    item.isCollapsedByDefault = true;
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private reasoningContentDelta(params: Record<string, unknown>): TimelineRuntimeEvent {
    return this.reasoningDelta(params);
  }

  private reasoningPartAdded(params: Record<string, unknown>): TimelineRuntimeEvent {
    const item = this.getOrCreateItem(params, "reasoningSummary");
    if (item.text.length > 0 && !item.text.endsWith("\n")) {
      item.text = `${item.text}\n`;
      item.rawText = item.text;
    }
    item.isCollapsedByDefault = true;
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private planUpdated(params: Record<string, unknown>): TimelineRuntimeEvent {
    const turnId = turnIdFromParams(params);
    const item = this.getOrCreateItem({ ...params, itemId: `${turnId}:plan` }, "plan");
    item.status = "running";
    item.title = "计划";
    const planSteps = mapPlanSteps(params.plan);
    item.planSteps = planSteps;
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private planDelta(params: Record<string, unknown>): TimelineRuntimeEvent {
    const item = this.getOrCreateItem(params, "plan");
    item.text = `${item.text}${stringField(params, "delta")}`;
    item.rawText = item.text;
    item.status = "running";
    item.isStreaming = true;
    item.isCollapsedByDefault = true;
    if (item.title.length === 0) item.title = "计划";
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private commandOutput(params: Record<string, unknown>): TimelineRuntimeEvent {
    const item = this.getOrCreateItem(params, "commandExecution");
    const delta = stringField(params, "delta") || stringField(params, "output");
    const command = item.command?.command || stringField(params, "command") || "command";
    const output = `${item.command?.rawOutput ?? item.rawText}${delta}`;
    item.text = command;
    item.rawText = output;
    item.command = commandSummary({ id: item.id, turnId: item.turnId, command, status: "running", output, exitCode: null });
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private terminalInteraction(params: Record<string, unknown>): TimelineRuntimeEvent[] {
    const item = this.getOrCreateItem(params, "commandExecution");
    const key = this.itemKey(item.sessionId, item.turnId, item.id);
    let buffer = this.terminalInputBuffers.get(key) ?? "";
    const stdin = stringField(params, "stdin");
    const committedCommands: string[] = [];
    for (let index = 0; index < stdin.length; index++) {
      const char = stdin[index];
      if (char === "\n" || char === "\r") {
        const command = buffer.trim();
        if (command.length > 0) committedCommands.push(command);
        buffer = "";
      } else if (char === "\u0003") {
        buffer = "";
      } else if (char === "\b" || char === "\u007f") {
        buffer = buffer.slice(0, Math.max(0, buffer.length - 1));
      } else {
        buffer = `${buffer}${char}`;
      }
    }
    this.terminalInputBuffers.set(key, buffer);
    if (committedCommands.length === 0) return [];

    const command = committedCommands[committedCommands.length - 1];
    const output = item.command?.rawOutput ?? item.rawText;
    item.title = command;
    item.text = command;
    item.command = commandSummary({ id: item.id, turnId: item.turnId, command, status: commandStatus(item.status), output, exitCode: item.command?.exitCode ?? null });
    item.command.title = command;
    item.updatedAt = new Date().toISOString();
    return [{ type: "timeline.item.updated", item }];
  }

  private diffUpdated(params: Record<string, unknown>): TimelineRuntimeEvent {
    const sessionId = sessionIdFromParams(params);
    const turnId = turnIdFromParams(params);
    const diffText = stringField(params, "diff");
    const item = this.storeItem(emptyItem({ id: `${turnId}:diff`, sessionId, turnId, kind: "diffOverview", status: "running", title: "文件变更" }));
    item.text = diffText.length > 0 ? "文件变更已更新" : "";
    item.rawText = diffText;
    const fromFiles = diffOverviewFromFiles(params.files);
    const fromUnifiedDiff = diffOverviewFromUnifiedDiff(diffText);
    item.diff = diffOverviewWithMergedPatches(fromUnifiedDiff ?? fromFiles, fromFiles, item.diff);
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private filePatchUpdated(params: Record<string, unknown>): TimelineRuntimeEvent {
    const item = this.getOrCreateItem(params, "fileChange");
    item.title = "文件修改";
    item.text = "文件变更已更新";
    item.diff = diffOverviewWithMergedPatches(diffOverviewFromFileChanges(params.changes), null, item.diff);
    item.status = "running";
    item.isStreaming = true;
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private fileOutputDelta(params: Record<string, unknown>): TimelineRuntimeEvent {
    const item = this.getOrCreateItem(params, "fileChange");
    const delta = stringField(params, "delta") || stringField(params, "output");
    item.title = "文件修改";
    item.rawText = `${item.rawText}${delta}`;
    item.text = item.text.length > 0 ? item.text : "文件变更已更新";
    item.status = "running";
    item.isStreaming = true;
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private mcpToolProgress(params: Record<string, unknown>): TimelineRuntimeEvent {
    const item = this.getOrCreateItem(params, "toolProgress");
    const message = stringField(params, "message") || stringField(params, "text") || stringField(params, "delta");
    if (message.length > 0) {
      item.text = message;
      item.rawText = message;
    }
    if (item.title.length === 0 || item.title === "工具调用") {
      item.title = stringField(params, "server") || stringField(params, "tool") || item.title;
    }
    item.status = "running";
    item.isStreaming = true;
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.updated", item };
  }

  private contextCompacted(params: Record<string, unknown>): TimelineRuntimeEvent {
    const sessionId = sessionIdFromParams(params);
    const turnId = turnIdFromParams(params);
    const item = this.storeItem(emptyItem({
      id: `${turnId}:context-compaction`,
      sessionId,
      turnId,
      kind: "contextCompaction",
      status: "completed",
      title: "上下文压缩",
      text: "上下文已压缩"
    }));
    item.isStreaming = false;
    item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.completed", item };
  }

  private itemCompleted(params: Record<string, unknown>): TimelineRuntimeEvent {
    const itemRecord = itemRecordFromParams(params);
    const item = this.getOrCreateItem(params, kindFromItem(itemRecord));
    item.status = normalizeItemStatus(itemRecord.status, "completed");
    item.isStreaming = false;
    const completedAt = itemCompletedAt(params);
    if (completedAt.length > 0) item.updatedAt = completedAt;
    if (item.kind === "userMessage") {
      item.clientMessageId = userClientMessageId(itemRecord) ?? userClientMessageId(params) ?? this.clientMessageIdForTurn(item.sessionId, item.turnId) ?? item.clientMessageId;
      const text = textFromItemRecord(itemRecord, item.kind);
      if (text.length > 0) {
        item.text = text;
        item.rawText = text;
      }
      item.title = titleFromItemRecord(itemRecord, item.kind);
    } else if (item.kind === "commandExecution") {
      const command = stringField(itemRecord, "command") || item.command?.command || item.text || "command";
      item.command = commandSummary({ id: item.id, turnId: item.turnId, command, status: commandStatus(item.status), output: item.command?.rawOutput ?? item.rawText, exitCode: numberOrNull(itemRecord.exitCode) });
      item.command.title = titleFromItemRecord(itemRecord, item.kind);
      item.title = item.command.title;
      item.text = command;
    } else if (item.kind === "fileChange") {
      item.title = "文件修改";
      item.diff = diffOverviewWithMergedPatches(diffOverviewFromFiles(itemRecord.files) ?? diffOverviewFromFileChanges(itemRecord.changes), null, item.diff);
    } else if (item.kind === "toolProgress") {
      item.title = toolTitleFromItem(itemRecord);
      item.text = toolTextFromItem(itemRecord) || item.text;
      item.rawText = item.text;
    } else if (item.kind === "imageGeneration") {
      item.title = titleFromItemRecord(itemRecord, item.kind);
      const text = textFromItemRecord(itemRecord, item.kind);
      if (text.length > 0) {
        item.text = text;
        item.rawText = text;
      }
      item.assetIds = assetIdsFromItemRecord(itemRecord);
    } else if (item.kind === "error") {
      const text = textFromItemRecord(itemRecord, item.kind) || item.text || "Codex 运行出错";
      item.title = "错误";
      item.text = text;
      item.rawText = text;
      item.status = "failed";
    } else if (item.kind === "agentMessage" || item.kind === "reasoningSummary" || item.kind === "plan") {
      const text = textFromItemRecord(itemRecord, item.kind);
      if (text.length > 0) {
        item.text = text;
        item.rawText = text;
      }
      if (item.kind === "agentMessage") {
        const phase = messagePhase(itemRecord.phase);
        if (phase) item.phase = phase;
      }
      if (item.kind === "plan") {
        if (hasArrayField(itemRecord, "steps") || hasArrayField(itemRecord, "plan")) {
          const completedPlanSteps = mapPlanSteps(itemRecord.steps ?? itemRecord.plan);
          item.planSteps = completedPlanSteps;
        }
      }
    }
    if (completedAt.length === 0) item.updatedAt = new Date().toISOString();
    return { type: "timeline.item.completed", item };
  }
}
