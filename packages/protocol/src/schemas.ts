import { z } from "zod";

export const IsoDateSchema = z.string().datetime();

export const ToolEntrySchema = z.object({
  id: z.string().min(1),
  type: z.literal("codex"),
  displayName: z.string().min(1),
  deviceName: z.string().min(1),
  icon: z.string().min(1),
  isOnline: z.boolean(),
  lastSeenAt: IsoDateSchema.nullable()
});
export type ToolEntry = z.infer<typeof ToolEntrySchema>;

export const SendStateSchema = z.enum(["pending", "received", "guided", "failed"]);
export type SendState = z.infer<typeof SendStateSchema>;

export const CodexPreflightSchema = z.object({
  status: z.enum(["ok", "warning", "blocked"]),
  checkedAt: IsoDateSchema,
  codexBin: z.string().min(1).nullable(),
  cliVersion: z.string().min(1).nullable(),
  appServerAvailable: z.boolean(),
  remoteControlAvailable: z.boolean(),
  provider: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  authStatus: z.enum(["ok", "api-key", "requires-openai-auth", "missing", "unknown"]),
  capabilities: z.object({
    accountRead: z.boolean(),
    configRead: z.boolean(),
    modelList: z.boolean(),
    threadList: z.boolean(),
    threadRead: z.boolean(),
    turnStart: z.boolean(),
    turnSteer: z.boolean(),
    turnInterrupt: z.boolean(),
    approvalResponse: z.boolean()
  }).strict(),
  message: z.string()
}).strict();
export type CodexPreflight = z.infer<typeof CodexPreflightSchema>;

export const CodexInstalledCapabilitySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["skill", "plugin"]),
  name: z.string().min(1),
  description: z.string(),
  source: z.string().min(1),
  isAvailable: z.boolean()
}).strict();
export type CodexInstalledCapability = z.infer<typeof CodexInstalledCapabilitySchema>;

export const CodexReasoningEffortSchema = z.enum(["default", "low", "medium", "high", "xhigh"]);
export type CodexReasoningEffort = z.infer<typeof CodexReasoningEffortSchema>;

export const CodexPermissionModeSchema = z.enum(["readonly", "workspace", "full-access"]);
export type CodexPermissionMode = z.infer<typeof CodexPermissionModeSchema>;

export const CodexApprovalModeSchema = z.enum(["manual", "on-request", "on-failure", "full-access-never"]);
export type CodexApprovalMode = z.infer<typeof CodexApprovalModeSchema>;

export const CodexApprovalsReviewerSchema = z.enum(["user", "auto_review", "guardian_subagent"]);
export type CodexApprovalsReviewer = z.infer<typeof CodexApprovalsReviewerSchema>;

export const CodexModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  isDefault: z.boolean(),
  hidden: z.boolean(),
  isAvailable: z.boolean(),
  supportedEfforts: z.array(CodexReasoningEffortSchema)
}).strict();
export type CodexModelOption = z.infer<typeof CodexModelOptionSchema>;

export const CodexRuntimeConfigSchema = z.object({
  sessionId: z.string().min(1),
  model: z.string().min(1).nullable(),
  effort: CodexReasoningEffortSchema,
  permissionMode: CodexPermissionModeSchema,
  approvalMode: CodexApprovalModeSchema,
  approvalsReviewer: CodexApprovalsReviewerSchema.default("user"),
  updatedAt: IsoDateSchema
}).strict();
export type CodexRuntimeConfig = z.infer<typeof CodexRuntimeConfigSchema>;

export const CodexRuntimeConfigInputSchema = CodexRuntimeConfigSchema
  .omit({ sessionId: true, updatedAt: true })
  .strict();
export type CodexRuntimeConfigInput = z.infer<typeof CodexRuntimeConfigInputSchema>;

export const SessionSummarySchema = z.object({
  id: z.string().min(1),
  toolId: z.string().min(1),
  title: z.string().min(1),
  projectPath: z.string().min(1).nullable(),
  projectName: z.string().min(1).nullable(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  isPinned: z.boolean(),
  needsUserInput: z.boolean(),
  waitsForNextDirection: z.boolean(),
  statusLabel: z.string().min(1),
  lastMessagePreview: z.string(),
  contextTokensUsed: z.number().int().nonnegative().nullable().optional(),
  contextWindowTokens: z.number().int().positive().nullable().optional()
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const MessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: z.enum(["user", "assistant", "system", "tool"]),
  text: z.string(),
  rawText: z.string(),
  createdAt: IsoDateSchema,
  sendState: SendStateSchema.nullable(),
  clientMessageId: z.string().min(1).nullable(),
  canWithdraw: z.boolean()
});
export type Message = z.infer<typeof MessageSchema>;

export const ApprovalActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  style: z.string().min(1).optional(),
  decisionType: z.string().min(1).optional(),
  requiresSecondConfirm: z.boolean().optional()
});
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

export const ApprovalInputFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  type: z.enum(["text", "secret", "single-select", "multi-select"]),
  defaultValue: z.string(),
  options: z.array(z.string()),
  isSecret: z.boolean(),
  isRequired: z.boolean().optional()
});
export type ApprovalInputField = z.infer<typeof ApprovalInputFieldSchema>;

export const ApprovalKindSchema = z.enum(["command", "file_change", "permission", "user_input", "mcp_elicitation", "unknown"]);
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>;

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  kind: ApprovalKindSchema.default("command"),
  method: z.string().default(""),
  subject: z.string().default(""),
  title: z.string().min(1),
  body: z.string(),
  actions: z.array(ApprovalActionSchema).min(1),
  inputFields: z.array(ApprovalInputFieldSchema).optional(),
  createdAt: IsoDateSchema
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const SessionPlanStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["pending", "in_progress", "completed", "failed"]),
  detail: z.string()
});
export type SessionPlanStep = z.infer<typeof SessionPlanStepSchema>;

export const CommandSummarySchema = z.object({
  id: z.string().min(1),
  turnId: z.string().min(1),
  title: z.string().min(1),
  command: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  exitCode: z.number().int().nullable(),
  summaryLines: z.array(z.string()),
  rawOutput: z.string()
});
export type CommandSummary = z.infer<typeof CommandSummarySchema>;

export const DiffFileOverviewSchema = z.object({
  path: z.string().min(1),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().default("")
});
export type DiffFileOverview = z.infer<typeof DiffFileOverviewSchema>;

export const DiffOverviewSchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  files: z.array(DiffFileOverviewSchema)
});
export type DiffOverview = z.infer<typeof DiffOverviewSchema>;

export const MediaAssetKindSchema = z.enum([
  "image",
  "document",
  "text",
  "code",
  "pdf",
  "office",
  "screenshot",
  "video",
  "audio",
  "other"
]);
export type MediaAssetKind = z.infer<typeof MediaAssetKindSchema>;

export const MediaAssetSourceSchema = z.enum([
  "mobileUpload",
  "macFile",
  "screenCapture",
  "localWebCapture",
  "codexEvent"
]);
export type MediaAssetSource = z.infer<typeof MediaAssetSourceSchema>;

export const MediaAssetStatusSchema = z.enum([
  "pending",
  "uploading",
  "available",
  "failed",
  "expired"
]);
export type MediaAssetStatus = z.infer<typeof MediaAssetStatusSchema>;

export const MediaAssetSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  source: MediaAssetSourceSchema,
  kind: MediaAssetKindSchema,
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().min(1).nullable(),
  status: MediaAssetStatusSchema,
  url: z.string().min(1).nullable(),
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema.nullable(),
  error: z.string()
}).strict();
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const SessionAttachmentSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  assetId: z.string().min(1),
  role: z.enum(["userUpload", "macArtifact", "codexArtifact"]),
  codexInputStatus: z.enum(["notRequired", "pending", "sent", "unsupported", "failed"]),
  codexInputMessage: z.string(),
  createdAt: IsoDateSchema
}).strict();
export type SessionAttachment = z.infer<typeof SessionAttachmentSchema>;

export const LocalWebSessionSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  targetUrl: z.string().url(),
  proxyUrl: z.string().min(1),
  status: z.enum(["opening", "active", "closed", "failed"]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  error: z.string()
}).strict();
export type LocalWebSession = z.infer<typeof LocalWebSessionSchema>;

export const TimelineItemKindSchema = z.enum([
  "userMessage",
  "agentMessage",
  "reasoningSummary",
  "plan",
  "commandExecution",
  "fileChange",
  "diffOverview",
  "approval",
  "toolProgress",
  "imageView",
  "imageGeneration",
  "contextCompaction",
  "processedSummary",
  "artifact",
  "error"
]);
export type TimelineItemKind = z.infer<typeof TimelineItemKindSchema>;

export const TimelineItemStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "declined",
  "interrupted"
]);
export type TimelineItemStatus = z.infer<typeof TimelineItemStatusSchema>;

export const TimelineItemSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  kind: TimelineItemKindSchema,
  status: TimelineItemStatusSchema,
  title: z.string(),
  text: z.string(),
  rawText: z.string(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  isStreaming: z.boolean(),
  isCollapsedByDefault: z.boolean(),
  command: CommandSummarySchema.nullable(),
  diff: DiffOverviewSchema.nullable(),
  approval: ApprovalRequestSchema.nullable(),
  planSteps: z.array(SessionPlanStepSchema),
  assetIds: z.array(z.string().min(1)).default([])
});
export type TimelineItem = z.infer<typeof TimelineItemSchema>;

export const SessionTurnSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(["idle", "running", "completed", "failed", "interrupted"]),
  startedAt: IsoDateSchema.nullable(),
  completedAt: IsoDateSchema.nullable(),
  items: z.array(TimelineItemSchema)
});
export type SessionTurn = z.infer<typeof SessionTurnSchema>;

export const RemoteControlStatusSchema = z.object({
  status: z.enum(["disabled", "connecting", "connected", "errored"]),
  environmentId: z.string().min(1).nullable()
});
export type RemoteControlStatus = z.infer<typeof RemoteControlStatusSchema>;

export const ProjectEntrySchema = z.object({
  projectPath: z.string().min(1),
  projectName: z.string().min(1),
  rootId: z.string().min(1).nullable().optional(),
  isHidden: z.boolean().optional(),
  exists: z.boolean().optional(),
  isInsideKnownRoot: z.boolean().optional(),
  lastUsedAt: IsoDateSchema.nullable().optional(),
  sessionCount: z.number().int().nonnegative().optional(),
  createdByMobile: z.boolean().optional(),
  updatedAt: IsoDateSchema
}).strict();
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

export const ProjectRootSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  isDefault: z.boolean(),
  isAvailable: z.boolean(),
  isWritable: z.boolean(),
  lastCheckedAt: IsoDateSchema,
  errorMessage: z.string()
}).strict();
export type ProjectRoot = z.infer<typeof ProjectRootSchema>;

export const UsageWindowSchema = z.object({
  used: z.number().nonnegative(),
  limit: z.number().positive(),
  remaining: z.number().nonnegative(),
  resetsAt: IsoDateSchema
}).strict();
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

export const CodexRateLimitWindowSchema = z.object({
  usedPercent: z.number().nonnegative(),
  windowDurationMins: z.number().int().nonnegative().nullable(),
  resetsAt: IsoDateSchema.or(z.literal(""))
}).strict();
export type CodexRateLimitWindow = z.infer<typeof CodexRateLimitWindowSchema>;

export const CodexCreditsSnapshotSchema = z.object({
  hasCredits: z.boolean(),
  unlimited: z.boolean(),
  balance: z.string()
}).strict();
export type CodexCreditsSnapshot = z.infer<typeof CodexCreditsSnapshotSchema>;

export const CodexRateLimitSnapshotSchema = z.object({
  limitId: z.string(),
  limitName: z.string(),
  primary: CodexRateLimitWindowSchema.nullable(),
  secondary: CodexRateLimitWindowSchema.nullable(),
  credits: CodexCreditsSnapshotSchema.nullable(),
  planType: z.string(),
  rateLimitReachedType: z.string()
}).strict();
export type CodexRateLimitSnapshot = z.infer<typeof CodexRateLimitSnapshotSchema>;

export const CodexAccountUsageSchema = z.object({
  status: z.enum(["available", "apiKey", "unsupported", "authRequired", "offline", "failed"]),
  accountLabel: z.string(),
  accountStatusText: z.string(),
  refreshedAt: IsoDateSchema,
  limitId: z.string().default(""),
  limitName: z.string().default(""),
  primary: CodexRateLimitWindowSchema.nullable().default(null),
  secondary: CodexRateLimitWindowSchema.nullable().default(null),
  credits: CodexCreditsSnapshotSchema.nullable().default(null),
  planType: z.string().default(""),
  rateLimitReachedType: z.string().default(""),
  rateLimits: z.array(CodexRateLimitSnapshotSchema).default([]),
  fiveHour: UsageWindowSchema.nullable(),
  weekly: UsageWindowSchema.nullable(),
  message: z.string()
}).strict();
export type CodexAccountUsage = z.infer<typeof CodexAccountUsageSchema>;

export const SessionInputModeSchema = z.enum(["plain", "guided", "queued", "steer-now"]);
export type SessionInputMode = z.infer<typeof SessionInputModeSchema>;

export const SessionInputGuidanceSchema = z.object({
  mode: SessionInputModeSchema,
  selectedCapabilityIds: z.array(z.string().min(1))
}).strict();
export type SessionInputGuidance = z.infer<typeof SessionInputGuidanceSchema>;

export const SessionInputQueueStatusSchema = z.enum(["queued", "sending", "sent", "failed", "cancelled"]);
export type SessionInputQueueStatus = z.infer<typeof SessionInputQueueStatusSchema>;

export const SessionInputQueueItemSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  clientMessageId: z.string().min(1),
  text: z.string(),
  textPreview: z.string(),
  textLength: z.number().int().nonnegative(),
  status: SessionInputQueueStatusSchema,
  guidance: SessionInputGuidanceSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema
}).strict();
export type SessionInputQueueItem = z.infer<typeof SessionInputQueueItemSchema>;

export const ClientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pairing.claim"), requestId: z.string(), pairingCode: z.string(), deviceName: z.string() }),
  z.object({ type: z.literal("codex.installedCapabilities.list"), requestId: z.string() }),
  z.object({ type: z.literal("codex.models.list"), requestId: z.string() }),
  z.object({ type: z.literal("projects.list"), requestId: z.string() }),
  z.object({ type: z.literal("projects.create"), requestId: z.string(), rootId: z.string().min(1), projectName: z.string().trim().min(1).max(64) }),
  z.object({ type: z.literal("projects.hide"), requestId: z.string(), projectPath: z.string().min(1) }),
  z.object({ type: z.literal("projects.unhide"), requestId: z.string(), projectPath: z.string().min(1) }),
  z.object({ type: z.literal("codex.accountUsage.refresh"), requestId: z.string() }),
  z.object({
    type: z.literal("session.create"),
    requestId: z.string(),
    toolId: z.string(),
    projectPath: z.string().nullable(),
    text: z.string().min(1),
    guidance: SessionInputGuidanceSchema.optional(),
    attachmentIds: z.array(z.string().min(1)).optional(),
    runtimeConfig: CodexRuntimeConfigInputSchema.optional()
  }),
  z.object({ type: z.literal("session.read"), requestId: z.string(), sessionId: z.string() }),
  z.object({ type: z.literal("session.runtimeConfig.read"), requestId: z.string(), sessionId: z.string().min(1) }),
  z.object({ type: z.literal("session.runtimeConfig.update"), requestId: z.string(), sessionId: z.string().min(1), config: CodexRuntimeConfigInputSchema }),
  z.object({ type: z.literal("session.sync.enable"), requestId: z.string(), sessionId: z.string(), activeDetail: z.boolean().optional() }),
  z.object({ type: z.literal("session.sync.disable"), requestId: z.string(), sessionId: z.string() }),
  z.object({ type: z.literal("session.sync.unsubscribe"), requestId: z.string(), sessionId: z.string() }),
  z.object({ type: z.literal("session.rename"), requestId: z.string(), sessionId: z.string(), title: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal("session.sendText"), requestId: z.string(), sessionId: z.string(), clientMessageId: z.string(), text: z.string().min(1), guidance: SessionInputGuidanceSchema.optional(), attachmentIds: z.array(z.string().min(1)).optional() }),
  z.object({ type: z.literal("session.steer"), requestId: z.string(), sessionId: z.string(), text: z.string().min(1), guidance: SessionInputGuidanceSchema.optional() }),
  z.object({ type: z.literal("session.context.compact"), requestId: z.string(), sessionId: z.string().min(1) }),
  z.object({ type: z.literal("session.interrupt"), requestId: z.string(), sessionId: z.string() }),
  z.object({ type: z.literal("session.withdrawPending"), requestId: z.string(), sessionId: z.string(), clientMessageId: z.string() }),
  z.object({ type: z.literal("session.retryFailed"), requestId: z.string(), sessionId: z.string(), failedMessageId: z.string(), newClientMessageId: z.string(), text: z.string().min(1) }),
  z.object({
    type: z.literal("session.inputQueue.enqueue"),
    requestId: z.string(),
    sessionId: z.string().min(1),
    clientMessageId: z.string().min(1),
    text: z.string().min(1),
    guidance: SessionInputGuidanceSchema
  }).strict(),
  z.object({
    type: z.literal("session.attachments.send"),
    requestId: z.string(),
    sessionId: z.string().min(1),
    attachmentIds: z.array(z.string().min(1))
  }),
  z.object({
    type: z.literal("localWeb.open"),
    requestId: z.string(),
    sessionId: z.string().min(1),
    targetUrl: z.string().url()
  }),
  z.object({
    type: z.literal("localWeb.close"),
    requestId: z.string(),
    localWebSessionId: z.string().min(1)
  }),
  z.object({
    type: z.literal("capture.screenshot"),
    requestId: z.string(),
    sessionId: z.string().min(1),
    target: z.enum(["localWeb", "screen"]),
    localWebSessionId: z.string().min(1).nullable(),
    userConfirmed: z.boolean()
  }),
  z.object({
    type: z.literal("session.inputQueue.cancel"),
    requestId: z.string(),
    sessionId: z.string().min(1),
    queueItemId: z.string().min(1)
  }),
  z.object({
    type: z.literal("session.inputQueue.retry"),
    requestId: z.string(),
    sessionId: z.string().min(1),
    queueItemId: z.string().min(1)
  }),
  z.object({
    type: z.literal("approval.respond"),
    requestId: z.string(),
    sessionId: z.string(),
    approvalId: z.string(),
    actionId: z.string(),
    answers: z.record(z.object({ answers: z.array(z.string()) })).optional()
  }),
  z.object({ type: z.literal("session.pin"), requestId: z.string(), sessionId: z.string(), isPinned: z.boolean() }),
  z.object({ type: z.literal("device.unbind"), requestId: z.string() })
]);
export type ClientCommand = z.infer<typeof ClientCommandSchema>;

export const ServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pairing.claimed"), deviceId: z.string(), authToken: z.string() }),
  z.object({ type: z.literal("codex.preflight.updated"), preflight: CodexPreflightSchema }),
  z.object({ type: z.literal("codex.installedCapabilities.snapshot"), capabilities: z.array(CodexInstalledCapabilitySchema) }),
  z.object({
    type: z.literal("codex.models.snapshot"),
    requestId: z.string(),
    models: z.array(CodexModelOptionSchema),
    defaultModel: z.string().min(1).nullable()
  }),
  z.object({
    type: z.literal("codex.accountUsage.snapshot"),
    requestId: z.string().optional(),
    usage: CodexAccountUsageSchema
  }),
  z.object({ type: z.literal("tool.updated"), tool: ToolEntrySchema }),
  z.object({ type: z.literal("sessions.snapshot"), sessions: z.array(SessionSummarySchema) }),
  z.object({
    type: z.literal("projects.snapshot"),
    requestId: z.string().optional(),
    roots: z.array(ProjectRootSchema).optional(),
    projects: z.array(ProjectEntrySchema)
  }),
  z.object({
    type: z.literal("project.created"),
    requestId: z.string().optional(),
    project: ProjectEntrySchema
  }),
  z.object({
    type: z.literal("project.create.failed"),
    requestId: z.string(),
    message: z.string()
  }),
  z.object({
    type: z.literal("project.visibility.updated"),
    requestId: z.string().optional(),
    project: ProjectEntrySchema
  }),
  z.object({ type: z.literal("messages.snapshot"), sessionId: z.string(), messages: z.array(MessageSchema) }),
  z.object({ type: z.literal("session.updated"), session: SessionSummarySchema }),
  z.object({ type: z.literal("session.runtimeConfig.updated"), requestId: z.string().optional(), config: CodexRuntimeConfigSchema }),
  z.object({ type: z.literal("session.inputQueue.updated"), sessionId: z.string().min(1), items: z.array(SessionInputQueueItemSchema) }),
  z.object({ type: z.literal("session.attachments.updated"), sessionId: z.string().min(1), attachments: z.array(SessionAttachmentSchema) }),
  z.object({ type: z.literal("session.assets.updated"), sessionId: z.string().min(1), assets: z.array(MediaAssetSchema) }),
  z.object({ type: z.literal("session.artifact.created"), sessionId: z.string().min(1), asset: MediaAssetSchema }),
  z.object({ type: z.literal("localWeb.session.updated"), session: LocalWebSessionSchema }),
  z.object({ type: z.literal("message.created"), message: MessageSchema }),
  z.object({ type: z.literal("message.updated"), message: MessageSchema }),
  z.object({ type: z.literal("approval.updated"), sessionId: z.string(), approval: ApprovalRequestSchema.nullable() }),
  z.object({ type: z.literal("turn.status.updated"), sessionId: z.string(), turnId: z.string(), status: z.enum(["idle", "running", "waiting_for_approval", "completed", "failed", "interrupted"]) }),
  z.object({ type: z.literal("session.plan.updated"), sessionId: z.string(), steps: z.array(SessionPlanStepSchema) }),
  z.object({ type: z.literal("session.commandSummary.updated"), sessionId: z.string(), command: CommandSummarySchema }),
  z.object({ type: z.literal("session.diffOverview.updated"), sessionId: z.string(), diff: DiffOverviewSchema }),
  z.object({ type: z.literal("thread.detail.snapshot"), sessionId: z.string().min(1), turns: z.array(SessionTurnSchema) }),
  z.object({ type: z.literal("turn.updated"), turn: SessionTurnSchema }),
  z.object({ type: z.literal("timeline.item.started"), item: TimelineItemSchema }),
  z.object({ type: z.literal("timeline.item.updated"), item: TimelineItemSchema }),
  z.object({ type: z.literal("timeline.item.completed"), item: TimelineItemSchema }),
  z.object({ type: z.literal("timeline.item.removed"), sessionId: z.string().min(1), turnId: z.string().min(1), itemId: z.string().min(1) }),
  z.object({ type: z.literal("remoteControl.status.updated"), status: RemoteControlStatusSchema.shape.status, environmentId: RemoteControlStatusSchema.shape.environmentId }),
  z.object({ type: z.literal("command.failed"), requestId: z.string(), errorCode: z.string(), message: z.string(), clientMessageId: z.string().min(1).optional() })
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
