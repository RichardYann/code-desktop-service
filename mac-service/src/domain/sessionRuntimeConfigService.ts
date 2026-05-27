import type { createRepositories, StoredSessionRuntimeConfig } from "../storage/repositories.js";

type Repositories = Pick<ReturnType<typeof createRepositories>,
  "readSessionRuntimeBaseConfig" |
  "saveSessionRuntimeBaseConfig" |
  "readSessionRuntimeConfigOverride" |
  "saveSessionRuntimeConfigOverride">;

export type CodexReasoningEffort = "default" | "low" | "medium" | "high" | "xhigh";
export type CodexPermissionMode = "readonly" | "workspace" | "full-access";
export type CodexApprovalMode = "manual" | "on-request" | "on-failure" | "full-access-never";
export type CodexApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";

export interface CodexModelOption {
  id: string;
  label: string;
  isDefault: boolean;
  hidden: boolean;
  isAvailable: boolean;
  supportedEfforts: CodexReasoningEffort[];
}

export interface SessionRuntimeConfigInput {
  model: string | null;
  effort: CodexReasoningEffort;
  permissionMode: CodexPermissionMode;
  approvalMode: CodexApprovalMode;
  approvalsReviewer?: CodexApprovalsReviewer;
}

export interface SessionRuntimeConfig extends Omit<SessionRuntimeConfigInput, "approvalsReviewer"> {
  sessionId: string;
  approvalsReviewer: CodexApprovalsReviewer;
  updatedAt: string;
}

type NormalizedSessionRuntimeConfigInput = Omit<SessionRuntimeConfig, "sessionId" | "updatedAt">;

export type SessionRuntimeBaseSource = "codex-session" | "codex-default-snapshot" | "safe-default";

export interface RuntimeConfigValidationContext {
  models?: CodexModelOption[];
}

const REASONING_EFFORTS = new Set<CodexReasoningEffort>(["default", "low", "medium", "high", "xhigh"]);
const PERMISSION_MODES = new Set<CodexPermissionMode>(["readonly", "workspace", "full-access"]);
const APPROVAL_MODES = new Set<CodexApprovalMode>(["manual", "on-request", "on-failure", "full-access-never"]);
const APPROVALS_REVIEWERS = new Set<CodexApprovalsReviewer>(["user", "auto_review", "guardian_subagent"]);
const DEFAULT_APPROVALS_REVIEWER: CodexApprovalsReviewer = "user";

const DEFAULT_CONFIG: SessionRuntimeConfigInput = {
  model: null,
  effort: "default",
  permissionMode: "workspace",
  approvalMode: "on-request",
  approvalsReviewer: DEFAULT_APPROVALS_REVIEWER
};

function nowIso(): string {
  return new Date().toISOString();
}

function assertSessionId(sessionId: string): void {
  if (sessionId.trim().length === 0) {
    throw new Error("会话 ID 不能为空");
  }
}

function normalizeModel(model: string | null): string | null {
  if (model === null) return null;
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isReasoningEffort(value: string): value is CodexReasoningEffort {
  return REASONING_EFFORTS.has(value as CodexReasoningEffort);
}

function isPermissionMode(value: string): value is CodexPermissionMode {
  return PERMISSION_MODES.has(value as CodexPermissionMode);
}

function isApprovalMode(value: string): value is CodexApprovalMode {
  return APPROVAL_MODES.has(value as CodexApprovalMode);
}

function isApprovalsReviewer(value: string): value is CodexApprovalsReviewer {
  return APPROVALS_REVIEWERS.has(value as CodexApprovalsReviewer);
}

function parseStored(row: StoredSessionRuntimeConfig): SessionRuntimeConfig | null {
  const approvalsReviewer = row.approvalsReviewer ?? DEFAULT_APPROVALS_REVIEWER;
  if (
    !isReasoningEffort(row.effort) ||
    !isPermissionMode(row.permissionMode) ||
    !isApprovalMode(row.approvalMode) ||
    !isApprovalsReviewer(approvalsReviewer)
  ) return null;
  return {
    sessionId: row.sessionId,
    model: normalizeModel(row.model),
    effort: row.effort,
    permissionMode: row.permissionMode,
    approvalMode: row.approvalMode,
    approvalsReviewer,
    updatedAt: row.updatedAt
  };
}

function defaultConfig(sessionId: string): SessionRuntimeConfig {
  return {
    sessionId,
    model: DEFAULT_CONFIG.model,
    effort: DEFAULT_CONFIG.effort,
    permissionMode: DEFAULT_CONFIG.permissionMode,
    approvalMode: DEFAULT_CONFIG.approvalMode,
    approvalsReviewer: DEFAULT_APPROVALS_REVIEWER,
    updatedAt: nowIso()
  };
}

export function validateRuntimeConfigSelection(input: SessionRuntimeConfigInput, context?: RuntimeConfigValidationContext): void {
  if (!context?.models || input.model === null) return;
  const selected = context.models.find((model) => model.id === input.model);
  if (!selected || !selected.isAvailable) {
    throw new Error("模型不可用，请重新选择模型");
  }
  if (input.effort !== "default" && selected.supportedEfforts.length > 0 && !selected.supportedEfforts.includes(input.effort)) {
    throw new Error("当前模型不支持所选思考强度");
  }
}

function normalizeInput(
  input: SessionRuntimeConfigInput,
  previous: SessionRuntimeConfig | null,
  context?: RuntimeConfigValidationContext
): NormalizedSessionRuntimeConfigInput {
  if (!isReasoningEffort(input.effort)) throw new Error("思考强度无效");
  if (!isPermissionMode(input.permissionMode)) throw new Error("执行权限无效");
  if (!isApprovalMode(input.approvalMode)) throw new Error("审批策略无效");
  const approvalsReviewer = input.approvalsReviewer ?? previous?.approvalsReviewer ?? DEFAULT_APPROVALS_REVIEWER;
  if (!isApprovalsReviewer(approvalsReviewer)) throw new Error("审批审查方式无效");

  let normalized: NormalizedSessionRuntimeConfigInput = {
    model: normalizeModel(input.model),
    effort: input.effort,
    permissionMode: input.permissionMode,
    approvalMode: input.approvalMode,
    approvalsReviewer
  };

  if (
    normalized.approvalMode === "full-access-never" &&
    normalized.permissionMode !== "full-access" &&
    previous?.approvalMode === "full-access-never"
  ) {
    normalized = { ...normalized, approvalMode: "on-request" };
  }

  if (normalized.approvalMode === "full-access-never" && normalized.permissionMode !== "full-access") {
    throw new Error("Full Access 免审批只能用于 Full Access 权限");
  }

  if (normalized.approvalMode === "manual") {
    normalized = { ...normalized, permissionMode: "readonly" };
  }

  if (normalized.approvalMode === "full-access-never") {
    normalized = { ...normalized, approvalsReviewer: "user" };
  }

  validateRuntimeConfigSelection(normalized, context);
  return {
    model: normalized.model,
    effort: normalized.effort,
    permissionMode: normalized.permissionMode,
    approvalMode: normalized.approvalMode,
    approvalsReviewer: normalized.approvalsReviewer
  };
}

export function createSessionRuntimeConfigService(repositories?: Repositories) {
  const memoryBase = new Map<string, SessionRuntimeConfig>();
  const memoryOverride = new Map<string, SessionRuntimeConfig>();

  function get(sessionId: string): SessionRuntimeConfig {
    assertSessionId(sessionId);
    const storedOverride = repositories?.readSessionRuntimeConfigOverride(sessionId);
    if (storedOverride) {
      const parsed = parseStored(storedOverride);
      if (parsed) return parsed;
    }
    const storedBase = repositories?.readSessionRuntimeBaseConfig(sessionId);
    if (storedBase) {
      const parsed = parseStored(storedBase);
      if (parsed) return parsed;
    }
    return memoryOverride.get(sessionId) ?? memoryBase.get(sessionId) ?? defaultConfig(sessionId);
  }

  function getStored(sessionId: string): SessionRuntimeConfig | null {
    assertSessionId(sessionId);
    const storedOverride = repositories?.readSessionRuntimeConfigOverride(sessionId);
    if (storedOverride) {
      const parsed = parseStored(storedOverride);
      if (parsed) return parsed;
    }
    const storedBase = repositories?.readSessionRuntimeBaseConfig(sessionId);
    if (storedBase) {
      const parsed = parseStored(storedBase);
      if (parsed) return parsed;
    }
    return memoryOverride.get(sessionId) ?? memoryBase.get(sessionId) ?? null;
  }

  function getUserOverride(sessionId: string): SessionRuntimeConfig | null {
    assertSessionId(sessionId);
    const storedOverride = repositories?.readSessionRuntimeConfigOverride(sessionId);
    if (storedOverride) {
      const parsed = parseStored(storedOverride);
      if (parsed) return parsed;
    }
    return memoryOverride.get(sessionId) ?? null;
  }

  function hasUserOverride(sessionId: string): boolean {
    assertSessionId(sessionId);
    return (repositories?.readSessionRuntimeConfigOverride(sessionId) ?? null) !== null || memoryOverride.has(sessionId);
  }

  function hasCodexSessionConfig(sessionId: string): boolean {
    assertSessionId(sessionId);
    return (repositories?.readSessionRuntimeBaseConfig(sessionId) ?? null) !== null || memoryBase.has(sessionId);
  }

  function saveCodexSessionConfig(
    sessionId: string,
    input: SessionRuntimeConfigInput,
    source: SessionRuntimeBaseSource = "codex-session",
    context?: RuntimeConfigValidationContext
  ): SessionRuntimeConfig {
    assertSessionId(sessionId);
    const normalized = normalizeInput(input, null, context);
    const saved: SessionRuntimeConfig = {
      sessionId,
      ...normalized,
      updatedAt: nowIso()
    };
    memoryBase.set(sessionId, saved);
    repositories?.saveSessionRuntimeBaseConfig({ ...saved, source });
    return saved;
  }

  function update(
    sessionId: string,
    input: SessionRuntimeConfigInput,
    context?: RuntimeConfigValidationContext
  ): SessionRuntimeConfig {
    assertSessionId(sessionId);
    const previous = repositories ? get(sessionId) : memoryOverride.get(sessionId) ?? memoryBase.get(sessionId) ?? null;
    const normalized = normalizeInput(input, previous, context);
    const saved: SessionRuntimeConfig = {
      sessionId,
      ...normalized,
      updatedAt: nowIso()
    };
    memoryOverride.set(sessionId, saved);
    repositories?.saveSessionRuntimeConfigOverride(saved);
    return saved;
  }

  return { get, getStored, getUserOverride, hasUserOverride, hasCodexSessionConfig, saveCodexSessionConfig, update };
}
