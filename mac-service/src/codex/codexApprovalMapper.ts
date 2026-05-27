import type { CodexServerRequestMethod } from "./codexAppServerProtocol.js";

type JsonRecord = Record<string, unknown>;

export type CodexApprovalDecision =
  | "accept"
  | "acceptForSession"
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: unknown } }
  | { applyNetworkPolicyAmendment: { network_policy_amendment: unknown } }
  | "decline"
  | "cancel";
export type CodexApprovalAnswers = Record<string, { answers: string[] }>;

export interface CodexApprovalResponseInput {
  method: CodexServerRequestMethod;
  actionId: string;
  answers?: CodexApprovalAnswers;
  params?: JsonRecord;
}

const ACCEPT_ACTIONS = new Set([
  "accept",
  "approve",
  "allow",
  "yes",
  "acceptForSession",
  "acceptWithExecpolicyAmendment",
  "applyNetworkPolicyAmendment"
]);
const PERMISSION_TURN_ACTIONS = new Set(["accept", "approve", "allow", "yes", "grantForTurn"]);
const PERMISSION_STRICT_TURN_ACTIONS = new Set(["grantForTurnWithStrictAutoReview", "acceptWithStrictAutoReview"]);
const PERMISSION_SESSION_ACTIONS = new Set(["acceptForSession", "grantForSession", "applyNetworkPolicyAmendment"]);
const DECLINE_ACTIONS = new Set(["decline", "reject", "deny", "disallow", "no"]);
const CANCEL_ACTIONS = new Set(["cancel", "dismiss", "abort"]);

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringFromValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function firstStringField(record: JsonRecord, fieldNames: string[]): string {
  for (const fieldName of fieldNames) {
    const value = stringFromValue(record[fieldName]);
    if (value.length > 0) return value;
  }
  return "";
}

function firstPresentField(record: JsonRecord, fieldNames: string[]): unknown {
  for (const fieldName of fieldNames) {
    if (Object.prototype.hasOwnProperty.call(record, fieldName)) return record[fieldName];
  }
  return undefined;
}

function hasUsefulFields(record: JsonRecord): boolean {
  for (const value of Object.values(record)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(asRecord(value)).length === 0) continue;
    return true;
  }
  return false;
}

function normalizeCommandDecision(input: CodexApprovalResponseInput): CodexApprovalDecision {
  if (input.actionId === "acceptWithExecpolicyAmendment") {
    const params = input.params ?? {};
    const amendment = firstPresentField(params, ["proposedExecpolicyAmendment", "proposed_execpolicy_amendment"]);
    if (amendment === undefined || amendment === null) throw new Error("当前审批请求缺少 execpolicy 修正内容");
    return { acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } };
  }
  if (input.actionId === "applyNetworkPolicyAmendment") {
    const params = input.params ?? {};
    const amendments = asArray(firstPresentField(params, ["proposedNetworkPolicyAmendments", "proposed_network_policy_amendments"]));
    const amendment = amendments.find((item) => asRecord(item).action === "allow") ?? amendments[0];
    if (amendment === undefined || amendment === null) throw new Error("当前审批请求缺少网络策略修正内容");
    return { applyNetworkPolicyAmendment: { network_policy_amendment: amendment } };
  }
  if (input.actionId === "acceptForSession") return "acceptForSession";
  if (ACCEPT_ACTIONS.has(input.actionId)) return "accept";
  if (DECLINE_ACTIONS.has(input.actionId)) return "decline";
  if (CANCEL_ACTIONS.has(input.actionId)) return "cancel";
  throw new Error("暂不支持此审批动作");
}

function normalizeFileDecision(input: CodexApprovalResponseInput): "accept" | "acceptForSession" | "decline" | "cancel" {
  if (input.actionId === "acceptForSession") return "acceptForSession";
  if (ACCEPT_ACTIONS.has(input.actionId)) return "accept";
  if (DECLINE_ACTIONS.has(input.actionId)) return "decline";
  if (CANCEL_ACTIONS.has(input.actionId)) return "cancel";
  throw new Error("暂不支持此审批动作");
}

function mapDecisionResponse(input: CodexApprovalResponseInput): { decision: CodexApprovalDecision } {
  return { decision: normalizeCommandDecision(input) };
}

function mapFileDecisionResponse(input: CodexApprovalResponseInput): { decision: ReturnType<typeof normalizeFileDecision> } {
  return { decision: normalizeFileDecision(input) };
}

function fileSystemEntry(path: unknown, access: "read" | "write"): JsonRecord {
  return {
    path: {
      type: "path",
      path: stringFromValue(path)
    },
    access
  };
}

function normalizeFileSystemPermissions(value: unknown): JsonRecord {
  const fileSystem = asRecord(value);
  const entries = asArray(fileSystem.entries);
  const readEntries = asArray(fileSystem.read).map((path) => fileSystemEntry(path, "read"));
  const writeEntries = asArray(fileSystem.write).map((path) => fileSystemEntry(path, "write"));
  const normalized: JsonRecord = {
    read: null,
    write: null
  };
  if (typeof fileSystem.globScanMaxDepth === "number") normalized.globScanMaxDepth = fileSystem.globScanMaxDepth;
  if (typeof fileSystem.glob_scan_max_depth === "number") normalized.globScanMaxDepth = fileSystem.glob_scan_max_depth;
  const mergedEntries = entries.concat(readEntries, writeEntries);
  if (mergedEntries.length > 0) normalized.entries = mergedEntries;
  return normalized;
}

function grantedPermissionProfileFromRequest(params: JsonRecord): JsonRecord {
  const requestPermissions = asRecord(params.permissions);
  const network = firstPresentField(requestPermissions, ["network"]);
  const fileSystem = firstPresentField(requestPermissions, ["fileSystem", "file_system"]);
  const granted: JsonRecord = {};
  if (network !== undefined && network !== null && hasUsefulFields(asRecord(network))) {
    granted.network = network;
  }
  if (fileSystem !== undefined && fileSystem !== null) {
    const normalizedFileSystem = normalizeFileSystemPermissions(fileSystem);
    if (hasUsefulFields(normalizedFileSystem)) granted.fileSystem = normalizedFileSystem;
  }
  return granted;
}

function mapPermissionsResponse(input: CodexApprovalResponseInput): { permissions: JsonRecord; scope: "turn" | "session"; strictAutoReview?: boolean } {
  const params = input.params ?? {};
  if (PERMISSION_TURN_ACTIONS.has(input.actionId)) {
    return { permissions: grantedPermissionProfileFromRequest(params), scope: "turn" };
  }
  if (PERMISSION_STRICT_TURN_ACTIONS.has(input.actionId)) {
    return { permissions: grantedPermissionProfileFromRequest(params), scope: "turn", strictAutoReview: true };
  }
  if (PERMISSION_SESSION_ACTIONS.has(input.actionId)) {
    return { permissions: grantedPermissionProfileFromRequest(params), scope: "session" };
  }
  if (DECLINE_ACTIONS.has(input.actionId) || CANCEL_ACTIONS.has(input.actionId)) {
    return { permissions: {}, scope: "turn" };
  }
  throw new Error("暂不支持此权限审批动作");
}

function mapUserInputResponse(input: CodexApprovalResponseInput): { answers: CodexApprovalAnswers } {
  if (CANCEL_ACTIONS.has(input.actionId)) return { answers: {} };
  if (input.answers === undefined) {
    throw new Error("此审批需要填写输入答案");
  }
  return { answers: input.answers };
}

function mcpAnswerFieldSchema(params: JsonRecord, fieldId: string): JsonRecord {
  const schemaInput = firstPresentField(params, ["requestedSchema", "requested_schema", "inputSchema", "schema", "jsonSchema"]);
  const schema = asRecord(schemaInput);
  const properties = asRecord(schema.properties);
  const schemaField = asRecord(properties[fieldId]);
  if (Object.keys(schemaField).length > 0) return schemaField;

  const fieldGroups = [
    asArray(params.fields),
    asArray(params.inputFields),
    asArray(params.inputs)
  ];
  for (const fields of fieldGroups) {
    for (const fieldInput of fields) {
      const field = asRecord(fieldInput);
      const id = firstStringField(field, ["id", "key", "name", "fieldId", "inputId"]);
      if (id !== fieldId) continue;
      return field;
    }
  }
  return {};
}

function mcpAnswerFieldType(fieldSchema: JsonRecord): string {
  return firstStringField(fieldSchema, ["type", "inputType", "format"]).toLowerCase();
}

function coerceMcpAnswerValue(fieldId: string, value: string, fieldSchema: JsonRecord): unknown {
  const fieldType = mcpAnswerFieldType(fieldSchema);
  if (fieldType === "boolean" || fieldType === "bool") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    throw new Error(`MCP 字段 ${fieldId} 需要 boolean 类型答案`);
  }
  if (fieldType === "number") {
    const trimmed = value.trim();
    const numberValue = trimmed.length > 0 ? Number(trimmed) : NaN;
    if (Number.isFinite(numberValue)) return numberValue;
    throw new Error(`MCP 字段 ${fieldId} 需要 number 类型答案`);
  }
  if (fieldType === "integer") {
    const trimmed = value.trim();
    const numberValue = trimmed.length > 0 ? Number(trimmed) : NaN;
    if (Number.isInteger(numberValue)) return numberValue;
    throw new Error(`MCP 字段 ${fieldId} 需要 integer 类型答案`);
  }
  if (fieldType === "object") {
    throw new Error(`MCP 字段 ${fieldId} 暂不支持 object 类型答案`);
  }
  return value;
}

function contentFromAnswers(answers: CodexApprovalAnswers | undefined, params: JsonRecord): JsonRecord | null {
  if (!answers || Object.keys(answers).length === 0) return null;
  const content: JsonRecord = {};
  for (const [fieldId, answer] of Object.entries(answers)) {
    const fieldSchema = mcpAnswerFieldSchema(params, fieldId);
    const fieldType = mcpAnswerFieldType(fieldSchema);
    if (fieldType === "array") {
      const itemSchema = asRecord(fieldSchema.items);
      content[fieldId] = answer.answers.map((value) => coerceMcpAnswerValue(fieldId, value, itemSchema));
    } else if (answer.answers.length === 0) {
      throw new Error(`MCP 字段 ${fieldId} 缺少答案`);
    } else if (answer.answers.length <= 1) {
      content[fieldId] = coerceMcpAnswerValue(fieldId, answer.answers[0], fieldSchema);
    } else {
      content[fieldId] = answer.answers.map((value) => coerceMcpAnswerValue(fieldId, value, fieldSchema));
    }
  }
  return content;
}

function mapMcpElicitationResponse(input: CodexApprovalResponseInput): { action: "accept" | "decline" | "cancel"; content: JsonRecord | null; _meta: null } {
  if (CANCEL_ACTIONS.has(input.actionId)) return { action: "cancel", content: null, _meta: null };
  if (DECLINE_ACTIONS.has(input.actionId)) return { action: "decline", content: null, _meta: null };
  if (!ACCEPT_ACTIONS.has(input.actionId) && input.actionId !== "submit") throw new Error("暂不支持此 MCP 审批动作");
  return { action: "accept", content: contentFromAnswers(input.answers, input.params ?? {}), _meta: null };
}

function mapLegacyReviewDecisionResponse(input: CodexApprovalResponseInput): { decision: "approved" | "approved_for_session" | "denied" | "abort" } {
  if (input.actionId === "acceptForSession" || input.actionId === "approved_for_session") return { decision: "approved_for_session" };
  if (ACCEPT_ACTIONS.has(input.actionId) || input.actionId === "approved") return { decision: "approved" };
  if (DECLINE_ACTIONS.has(input.actionId) || input.actionId === "denied") return { decision: "denied" };
  if (CANCEL_ACTIONS.has(input.actionId)) return { decision: "abort" };
  throw new Error("暂不支持此审批动作");
}

export function mapCodexApprovalResponse(input: CodexApprovalResponseInput): unknown {
  if (input.method === "item/commandExecution/requestApproval") return mapDecisionResponse(input);
  if (input.method === "item/fileChange/requestApproval") return mapFileDecisionResponse(input);
  if (input.method === "item/permissions/requestApproval") return mapPermissionsResponse(input);
  if (input.method === "item/tool/requestUserInput") return mapUserInputResponse(input);
  if (input.method === "mcpServer/elicitation/request") return mapMcpElicitationResponse(input);
  if (input.method === "execCommandApproval" || input.method === "applyPatchApproval") return mapLegacyReviewDecisionResponse(input);
  throw new Error("移动端暂不支持直接处理此类权限审批");
}
