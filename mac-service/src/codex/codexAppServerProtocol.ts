export type CodexRequestMethod =
  | "account/read"
  | "account/rateLimits/read"
  | "config/read"
  | "model/list"
  | "thread/list"
  | "thread/read"
  | "thread/turns/list"
  | "thread/turns/items/list"
  | "thread/name/set"
  | "thread/start"
  | "thread/resume"
  | "thread/inject_items"
  | "thread/compact/start"
  | "turn/start"
  | "turn/steer"
  | "turn/interrupt";

export type CodexNotificationMethod =
  | "remoteControl/status/changed"
  | "account/rateLimits/updated"
  | "thread/started"
  | "thread/status/changed"
  | "thread/name/updated"
  | "thread/tokenUsage/updated"
  | "thread/compacted"
  | "turn/started"
  | "turn/completed"
  | "turn/plan/updated"
  | "turn/diff/updated"
  | "item/started"
  | "item/completed"
  | "item/agentMessage/delta"
  | "item/plan/delta"
  | "item/reasoning/summaryTextDelta"
  | "item/reasoning/summaryPartAdded"
  | "item/reasoning/textDelta"
  | "item/commandExecution/outputDelta"
  | "item/commandExecution/terminalInteraction"
  | "item/fileChange/patchUpdated"
  | "item/fileChange/outputDelta"
  | "item/mcpToolCall/progress"
  | "serverRequest/resolved"
  | "error"
  | "warning"
  | "guardianWarning"
  | "configWarning"
  | "deprecationNotice";

export type CodexServerRequestMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval"
  | "item/permissions/requestApproval"
  | "item/tool/requestUserInput"
  | "mcpServer/elicitation/request"
  | "execCommandApproval"
  | "applyPatchApproval";

export interface CodexProtocolRequest {
  id: string;
  method: "initialize" | CodexRequestMethod | CodexServerRequestMethod;
  params?: Record<string, unknown>;
}

export interface CodexProtocolNotification {
  method: "initialized" | CodexNotificationMethod;
  params?: Record<string, unknown>;
}

export interface CodexProtocolResponse {
  id: string;
  result?: unknown;
  error?: string | { code?: number; message?: string };
}
