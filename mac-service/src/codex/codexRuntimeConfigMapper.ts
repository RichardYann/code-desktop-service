import type {
  CodexApprovalMode,
  CodexApprovalsReviewer,
  CodexPermissionMode,
  CodexReasoningEffort,
  SessionRuntimeConfig,
  SessionRuntimeConfigInput
} from "../domain/sessionRuntimeConfigService.js";

export interface CodexRuntimeCapabilities {
  supportsPermissionsProfile: boolean;
}

function approvalPolicyFor(mode: CodexApprovalMode): "on-request" | "on-failure" | "never" {
  if (mode === "on-failure") return "on-failure";
  if (mode === "full-access-never") return "never";
  return "on-request";
}

function effectivePermissionMode(config: SessionRuntimeConfig): CodexPermissionMode {
  if (config.approvalMode === "manual") return "readonly";
  return config.permissionMode;
}

function permissionsProfileId(mode: CodexPermissionMode): string {
  if (mode === "readonly") return ":read-only";
  if (mode === "full-access") return ":danger-full-access";
  return ":workspace";
}

function sandboxPolicy(mode: CodexPermissionMode): Record<string, unknown> {
  if (mode === "readonly") return { type: "readOnly" };
  if (mode === "full-access") return { type: "dangerFullAccess" };
  return { type: "workspaceWrite" };
}

export function mapRuntimeConfigToTurnParams(
  config: SessionRuntimeConfig,
  capabilities: CodexRuntimeCapabilities
): Record<string, unknown> {
  if (config.approvalMode === "full-access-never" && config.permissionMode !== "full-access") {
    throw new Error("Full Access 免审批只能用于 Full Access 权限");
  }

  const params: Record<string, unknown> = {
    approvalPolicy: approvalPolicyFor(config.approvalMode)
  };
  if ((config.approvalsReviewer ?? "user") !== "user") {
    params.approvalsReviewer = config.approvalsReviewer;
  }
  if (config.model !== null) {
    params.model = config.model;
  }
  if (config.effort !== "default") {
    params.effort = config.effort;
  }

  const permissionMode = effectivePermissionMode(config);
  if (capabilities.supportsPermissionsProfile) {
    params.permissions = { type: "profile", id: permissionsProfileId(permissionMode) };
  } else {
    params.sandboxPolicy = sandboxPolicy(permissionMode);
  }
  return params;
}

export function isRuntimeConfigParameterUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("invalid params") ||
    normalized.includes("unknown field") ||
    normalized.includes("unsupported field") ||
    normalized.includes("unknown variant") ||
    normalized.includes("invalid type") ||
    normalized.includes("missing field");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function reasoningEffortFromConfig(value: unknown): CodexReasoningEffort {
  const effort = stringValue(value);
  if (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh") return effort;
  return "default";
}

function permissionModeFromConfig(value: unknown): CodexPermissionMode {
  const mode = stringValue(value)?.toLowerCase();
  if (!mode) return "workspace";
  if (mode === "readonly" || mode === "read-only" || mode === "read_only" || mode === "readOnly".toLowerCase()) {
    return "readonly";
  }
  if (
    mode === "full-access" ||
    mode === "full_access" ||
    mode === "fullaccess" ||
    mode === "danger-full-access" ||
    mode === "danger_full_access" ||
    mode === "dangerfullaccess"
  ) {
    return "full-access";
  }
  return "workspace";
}

function approvalModeFromConfig(value: unknown, permissionMode: CodexPermissionMode): CodexApprovalMode {
  const mode = stringValue(value)?.toLowerCase();
  if (mode === "on-failure" || mode === "on_failure" || mode === "onfailure") return "on-failure";
  if (mode === "never" && permissionMode === "full-access") return "full-access-never";
  return "on-request";
}

function approvalsReviewerFromConfig(value: unknown): CodexApprovalsReviewer {
  const reviewer = stringValue(value);
  if (reviewer === "auto_review" || reviewer === "guardian_subagent") return reviewer;
  return "user";
}

export function mapCodexConfigReadToRuntimeConfigInput(
  response: unknown,
  defaultModel: string | null = null
): SessionRuntimeConfigInput {
  const responseRecord = asRecord(response);
  const config = asRecord(responseRecord.config ?? responseRecord);
  const model = stringValue(config.model) ?? defaultModel;
  const effort = reasoningEffortFromConfig(
    config.model_reasoning_effort ?? config.reasoning_effort ?? config.modelReasoningEffort ?? config.effort
  );
  const permissionMode = permissionModeFromConfig(
    config.sandbox_mode ?? config.sandboxMode ?? config.permission_mode ?? config.permissionMode
  );
  const approvalMode = approvalModeFromConfig(
    config.approval_policy ?? config.approvalPolicy ?? config.approval_mode ?? config.approvalMode,
    permissionMode
  );
  const approvalsReviewer = approvalsReviewerFromConfig(
    config.approvals_reviewer ?? config.approvalsReviewer ?? config.approval_reviewer ?? config.approvalReviewer
  );
  return {
    model,
    effort,
    permissionMode,
    approvalMode,
    approvalsReviewer: approvalMode === "full-access-never" ? "user" : approvalsReviewer
  };
}
