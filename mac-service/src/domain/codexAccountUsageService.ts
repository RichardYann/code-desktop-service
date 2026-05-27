export interface UsageWindow {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: string;
}

export interface CodexCreditsSnapshot {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string;
}

export interface CodexRateLimitSnapshot {
  limitId: string;
  limitName: string;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: CodexCreditsSnapshot | null;
  planType: string;
  rateLimitReachedType: string;
}

export interface CodexAccountUsage {
  status: "available" | "apiKey" | "unsupported" | "authRequired" | "offline" | "failed";
  accountLabel: string;
  accountStatusText: string;
  refreshedAt: string;
  limitId: string;
  limitName: string;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  credits: CodexCreditsSnapshot | null;
  planType: string;
  rateLimitReachedType: string;
  rateLimits: CodexRateLimitSnapshot[];
  fiveHour: UsageWindow | null;
  weekly: UsageWindow | null;
  message: string;
}

export interface CodexAccountUsageClient {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close?(): Promise<void> | void;
}

export interface CodexAccountUsageServiceDeps {
  clientFactory: () => Promise<CodexAccountUsageClient>;
  now?: () => Date;
}

const UNSUPPORTED_MESSAGE = "当前通道暂不支持读取精确用量";
const AUTH_REQUIRED_MESSAGE = "需要在桌面端完成 Codex 登录";
const API_KEY_USAGE_MESSAGE = "当前为 API 登录，账号用量仅支持 Codex 账号登录后读取";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function readAnyNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
    }
  }
  return null;
}

function readUsageWindow(value: unknown): UsageWindow | null {
  const record = asRecord(value);
  const used = readNumber(record, ["used", "current", "consumed"]);
  const limit = readNumber(record, ["limit", "max", "quota"]);
  const remaining = readNumber(record, ["remaining", "left"]);
  const resetsAt = readString(record, ["resetsAt", "resetAt", "reset_at", "resets_at"]);
  if (used === null || limit === null || remaining === null || resetsAt.length === 0 || limit <= 0) {
    return null;
  }
  return { used, limit, remaining, resetsAt };
}

function normalizeResetTime(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const timestampMs = value < 1000000000000 ? value * 1000 : value;
    return new Date(timestampMs).toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      const timestampMs = numeric < 1000000000000 ? numeric * 1000 : numeric;
      return new Date(timestampMs).toISOString();
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
    return trimmed;
  }
  return "";
}

function readRateLimitWindow(value: unknown): CodexRateLimitWindow | null {
  const record = asRecord(value);
  const usedPercent = readAnyNumber(record, ["usedPercent", "used_percent"]);
  if (usedPercent === null) {
    return null;
  }
  const windowDurationMins = readAnyNumber(record, ["windowDurationMins", "window_duration_mins", "windowMinutes", "window_minutes"]);
  const resetsAt = normalizeResetTime(record.resetsAt ?? record.resets_at ?? record.resetAt ?? record.reset_at);
  return {
    usedPercent,
    windowDurationMins,
    resetsAt
  };
}

function readCreditsSnapshot(value: unknown): CodexCreditsSnapshot | null {
  const record = asRecord(value);
  const hasCredits = readBoolean(record, ["hasCredits", "has_credits"]);
  const unlimited = readBoolean(record, ["unlimited"]);
  if (hasCredits === null || unlimited === null) {
    return null;
  }
  return {
    hasCredits,
    unlimited,
    balance: readString(record, ["balance"])
  };
}

function readRateLimitSnapshot(value: unknown, fallbackLimitId = "codex", allowEmpty = false): CodexRateLimitSnapshot | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }
  const limitId = readString(record, ["limitId", "limit_id"]) || fallbackLimitId;
  const snapshot: CodexRateLimitSnapshot = {
    limitId,
    limitName: readString(record, ["limitName", "limit_name"]),
    primary: readRateLimitWindow(record.primary),
    secondary: readRateLimitWindow(record.secondary),
    credits: readCreditsSnapshot(record.credits),
    planType: readString(record, ["planType", "plan_type"]),
    rateLimitReachedType: readString(record, ["rateLimitReachedType", "rate_limit_reached_type"])
  };
  if (!allowEmpty && isEmptyRateLimitSnapshot(snapshot)) {
    return null;
  }
  return snapshot;
}

function isEmptyRateLimitSnapshot(snapshot: CodexRateLimitSnapshot): boolean {
  return snapshot.primary === null &&
    snapshot.secondary === null &&
    snapshot.credits === null &&
    snapshot.limitName.length === 0 &&
    snapshot.planType.length === 0 &&
    snapshot.rateLimitReachedType.length === 0;
}

function readRateLimitSnapshots(response: Record<string, unknown>): CodexRateLimitSnapshot[] {
  const snapshots: CodexRateLimitSnapshot[] = [];
  const primary = readRateLimitSnapshot(response.rateLimits ?? response.rate_limits, "codex");
  if (primary !== null) {
    snapshots.push(primary);
  }

  const byLimitId = asRecord(response.rateLimitsByLimitId ?? response.rate_limits_by_limit_id);
  for (const [limitId, value] of Object.entries(byLimitId)) {
    const snapshot = readRateLimitSnapshot(value, limitId);
    if (snapshot === null) {
      continue;
    }
    if (!snapshots.some((existing) => existing.limitId === snapshot.limitId)) {
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

function preferredRateLimitSnapshot(snapshots: CodexRateLimitSnapshot[]): CodexRateLimitSnapshot | null {
  for (const snapshot of snapshots) {
    if (snapshot.limitId === "codex") {
      return snapshot;
    }
  }
  return snapshots.length > 0 ? snapshots[0] : null;
}

function mergeRateLimitSnapshot(
  snapshot: CodexRateLimitSnapshot,
  previous: CodexRateLimitSnapshot | null
): CodexRateLimitSnapshot {
  if (previous === null) {
    return snapshot;
  }
  return {
    limitId: snapshot.limitId || previous.limitId,
    limitName: snapshot.limitName || previous.limitName,
    primary: snapshot.primary,
    secondary: snapshot.secondary,
    credits: snapshot.credits ?? previous.credits,
    planType: snapshot.planType || previous.planType,
    rateLimitReachedType: snapshot.rateLimitReachedType || previous.rateLimitReachedType
  };
}

function readAccountLabel(account: Record<string, unknown>): string {
  return readString(account, ["email", "accountEmail", "username", "label", "id"]);
}

function readAccountType(account: Record<string, unknown>, response: Record<string, unknown>): string {
  return readString(account, ["type", "authType", "loginType", "kind"]) ||
    readString(response, ["authType", "loginType", "accountType"]);
}

function isApiKeyAccount(account: Record<string, unknown>, response: Record<string, unknown>): boolean {
  const type = readAccountType(account, response).replace(/[-_\s]/g, "").toLowerCase();
  return type === "apikey" || type === "api";
}

function readExplicitWindows(response: Record<string, unknown>): { fiveHour: UsageWindow | null; weekly: UsageWindow | null } {
  const account = asRecord(response.account);
  const usage = asRecord(account.usage ?? response.usage);
  const fiveHour = readUsageWindow(
    usage.fiveHour ??
    usage.five_hour ??
    usage.fiveHours ??
    usage.five_hours ??
    usage["5h"] ??
    response.fiveHour
  );
  const weekly = readUsageWindow(
    usage.weekly ??
    usage.week ??
    usage.weeklyUsage ??
    response.weekly
  );
  return { fiveHour, weekly };
}

function unsupportedUsage(accountLabel: string, refreshedAt: string, accountKnown = false): CodexAccountUsage {
  return {
    status: "unsupported",
    accountLabel,
    accountStatusText: accountKnown || accountLabel.length > 0 ? "已登录" : UNSUPPORTED_MESSAGE,
    refreshedAt,
    limitId: "",
    limitName: "",
    primary: null,
    secondary: null,
    credits: null,
    planType: "",
    rateLimitReachedType: "",
    rateLimits: [],
    fiveHour: null,
    weekly: null,
    message: UNSUPPORTED_MESSAGE
  };
}

function authRequiredUsage(refreshedAt: string): CodexAccountUsage {
  return {
    status: "authRequired",
    accountLabel: "",
    accountStatusText: AUTH_REQUIRED_MESSAGE,
    refreshedAt,
    limitId: "",
    limitName: "",
    primary: null,
    secondary: null,
    credits: null,
    planType: "",
    rateLimitReachedType: "",
    rateLimits: [],
    fiveHour: null,
    weekly: null,
    message: AUTH_REQUIRED_MESSAGE
  };
}

function apiKeyUsage(refreshedAt: string): CodexAccountUsage {
  return {
    status: "apiKey",
    accountLabel: "",
    accountStatusText: "API 登录",
    refreshedAt,
    limitId: "",
    limitName: "",
    primary: null,
    secondary: null,
    credits: null,
    planType: "",
    rateLimitReachedType: "",
    rateLimits: [],
    fiveHour: null,
    weekly: null,
    message: API_KEY_USAGE_MESSAGE
  };
}

function sanitizeFailureReason(message: string): string {
  const value = message.replace(/\s+/g, " ").trim();
  if (value.length === 0) {
    return "";
  }
  if (/authorization|bearer|token|api[-_\s]?key|secret|password|codex config/i.test(value)) {
    return "";
  }
  return value.length > 80 ? value.slice(0, 77) + "..." : value;
}

function failedUsage(refreshedAt: string, errorMessage = ""): CodexAccountUsage {
  const reason = sanitizeFailureReason(errorMessage);
  const message = reason.length > 0 ? "读取失败：" + reason : "读取失败";
  return {
    status: "failed",
    accountLabel: "",
    accountStatusText: message,
    refreshedAt,
    limitId: "",
    limitName: "",
    primary: null,
    secondary: null,
    credits: null,
    planType: "",
    rateLimitReachedType: "",
    rateLimits: [],
    fiveHour: null,
    weekly: null,
    message
  };
}

function offlineUsage(refreshedAt: string): CodexAccountUsage {
  return {
    status: "offline",
    accountLabel: "",
    accountStatusText: "Codex 官方通道不可用",
    refreshedAt,
    limitId: "",
    limitName: "",
    primary: null,
    secondary: null,
    credits: null,
    planType: "",
    rateLimitReachedType: "",
    rateLimits: [],
    fiveHour: null,
    weekly: null,
    message: "Codex 官方通道不可用"
  };
}

function legacyAvailableUsage(
  accountLabel: string,
  refreshedAt: string,
  windows: { fiveHour: UsageWindow | null; weekly: UsageWindow | null }
): CodexAccountUsage {
  return {
    status: "available",
    accountLabel,
    accountStatusText: "已登录",
    refreshedAt,
    limitId: "",
    limitName: "",
    primary: null,
    secondary: null,
    credits: null,
    planType: "",
    rateLimitReachedType: "",
    rateLimits: [],
    fiveHour: windows.fiveHour,
    weekly: windows.weekly,
    message: ""
  };
}

function officialAvailableUsage(accountLabel: string, refreshedAt: string, snapshots: CodexRateLimitSnapshot[]): CodexAccountUsage {
  const selected = preferredRateLimitSnapshot(snapshots);
  if (selected === null) {
    return unsupportedUsage(accountLabel, refreshedAt, accountLabel.length > 0);
  }
  return {
    status: "available",
    accountLabel,
    accountStatusText: "已登录",
    refreshedAt,
    limitId: selected.limitId,
    limitName: selected.limitName,
    primary: selected.primary,
    secondary: selected.secondary,
    credits: selected.credits,
    planType: selected.planType,
    rateLimitReachedType: selected.rateLimitReachedType,
    rateLimits: snapshots,
    fiveHour: null,
    weekly: null,
    message: ""
  };
}

function isOfflineError(message: string): boolean {
  return /enoent|econnrefused|econnreset|etimedout|offline|unavailable|not available|socket/i.test(message);
}

function isUnsupportedError(message: string): boolean {
  return /unsupported|not implemented|method not found|unknown method|unknown command|no handler/i.test(message);
}

export function createCodexAccountUsageService(deps: CodexAccountUsageServiceDeps) {
  const now = deps.now ?? (() => new Date());
  let lastSnapshot: CodexAccountUsage = unsupportedUsage("", now().toISOString());

  return {
    snapshot(): CodexAccountUsage {
      return lastSnapshot;
    },

    async refresh(): Promise<CodexAccountUsage> {
      const refreshedAt = now().toISOString();
      let client: CodexAccountUsageClient | null = null;
      try {
        client = await deps.clientFactory();
        const response = asRecord(await client.request("account/read", { refreshToken: false }));
        const account = asRecord(response.account);
        if (isApiKeyAccount(account, response)) {
          lastSnapshot = apiKeyUsage(refreshedAt);
          return lastSnapshot;
        }
        if (Object.keys(account).length === 0) {
          lastSnapshot = authRequiredUsage(refreshedAt);
          return lastSnapshot;
        }

        const accountLabel = readAccountLabel(account);
        const windows = readExplicitWindows(response);
        if (windows.fiveHour === null || windows.weekly === null) {
          const accountType = readAccountType(account, response).replace(/[-_\s]/g, "").toLowerCase();
          if (accountType.length > 0 && accountType !== "chatgpt") {
            lastSnapshot = unsupportedUsage(accountLabel, refreshedAt, Object.keys(account).length > 0);
            return lastSnapshot;
          }
          const rateLimitResponse = asRecord(await client.request("account/rateLimits/read"));
          const rateLimitSnapshots = readRateLimitSnapshots(rateLimitResponse);
          lastSnapshot = officialAvailableUsage(accountLabel, refreshedAt, rateLimitSnapshots);
          return lastSnapshot;
        }

        lastSnapshot = legacyAvailableUsage(accountLabel, refreshedAt, windows);
        return lastSnapshot;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (isUnsupportedError(message)) {
          lastSnapshot = unsupportedUsage("", refreshedAt);
        } else {
          lastSnapshot = isOfflineError(message) ? offlineUsage(refreshedAt) : failedUsage(refreshedAt, message);
        }
        return lastSnapshot;
      } finally {
        await client?.close?.();
      }
    },

    applyRateLimitsNotification(params: Record<string, unknown>): CodexAccountUsage {
      const refreshedAt = now().toISOString();
      const snapshot = readRateLimitSnapshot(asRecord(params.rateLimits ?? params.rate_limits), "codex", true);
      if (snapshot === null) {
        return lastSnapshot;
      }

      const previousSnapshots = lastSnapshot.rateLimits.slice();
      const previous = previousSnapshots.find((candidate) => candidate.limitId === snapshot.limitId) ?? null;
      if (previous !== null && isEmptyRateLimitSnapshot(snapshot)) {
        lastSnapshot = {
          ...lastSnapshot,
          refreshedAt
        };
        return lastSnapshot;
      }
      const merged = mergeRateLimitSnapshot(snapshot, previous);
      let replaced = false;
      const nextSnapshots: CodexRateLimitSnapshot[] = [];
      for (const candidate of previousSnapshots) {
        if (candidate.limitId === merged.limitId) {
          nextSnapshots.push(merged);
          replaced = true;
        } else {
          nextSnapshots.push(candidate);
        }
      }
      if (!replaced) {
        nextSnapshots.push(merged);
      }

      lastSnapshot = officialAvailableUsage(lastSnapshot.accountLabel, refreshedAt, nextSnapshots);
      return lastSnapshot;
    }
  };
}
