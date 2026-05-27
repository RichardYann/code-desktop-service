import { describe, expect, it } from "vitest";
import {
  ClientCommandSchema,
  CodexPreflightSchema,
  LocalWebSessionSchema,
  MediaAssetSchema,
  ServerEventSchema,
  SessionAttachmentSchema
} from "../schemas.js";

describe("protocol schemas", () => {
  it("validates media asset metadata", () => {
    const parsed = MediaAssetSchema.parse({
      id: "asset-1",
      sessionId: "thread-1",
      source: "mobileUpload",
      kind: "image",
      fileName: "screen.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      sha256: "abc",
      status: "available",
      url: "/api/assets/asset-1/content",
      createdAt: "2026-05-16T00:00:00.000Z",
      expiresAt: "2026-05-23T00:00:00.000Z",
      error: ""
    });

    expect(parsed.kind).toBe("image");
  });

  it("rejects executable asset kind", () => {
    expect(() => MediaAssetSchema.parse({
      id: "asset-2",
      sessionId: "thread-1",
      source: "mobileUpload",
      kind: "executable",
      fileName: "run",
      mimeType: "application/octet-stream",
      sizeBytes: 1,
      sha256: null,
      status: "pending",
      url: null,
      createdAt: "2026-05-16T00:00:00.000Z",
      expiresAt: null,
      error: ""
    })).toThrow();
  });

  it("validates session attachment codex input status", () => {
    const parsed = SessionAttachmentSchema.parse({
      id: "attachment-1",
      sessionId: "thread-1",
      assetId: "asset-1",
      role: "userUpload",
      codexInputStatus: "sent",
      codexInputMessage: "已进入本轮上下文",
      createdAt: "2026-05-16T00:00:00.000Z"
    });

    expect(parsed.codexInputStatus).toBe("sent");
  });

  it("validates local web session metadata", () => {
    const parsed = LocalWebSessionSchema.parse({
      id: "local-web-1",
      sessionId: "thread-1",
      targetUrl: "http://127.0.0.1:5173",
      proxyUrl: "/local-web/local-web-1/",
      status: "active",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:01.000Z",
      error: ""
    });

    expect(parsed.status).toBe("active");
  });

  it("parses media client commands and server events", () => {
    expect(ClientCommandSchema.parse({
      type: "localWeb.open",
      requestId: "local-web-open-1",
      sessionId: "thread-1",
      targetUrl: "http://127.0.0.1:5173"
    }).type).toBe("localWeb.open");

    expect(ClientCommandSchema.parse({
      type: "capture.screenshot",
      requestId: "capture-1",
      sessionId: "thread-1",
      target: "localWeb",
      localWebSessionId: "local-web-1",
      userConfirmed: true
    }).type).toBe("capture.screenshot");

    expect(ServerEventSchema.parse({
      type: "session.attachments.updated",
      sessionId: "thread-1",
      attachments: [{
        id: "attachment-1",
        sessionId: "thread-1",
        assetId: "asset-1",
        role: "userUpload",
        codexInputStatus: "sent",
        codexInputMessage: "已进入本轮上下文",
        createdAt: "2026-05-16T00:00:00.000Z"
      }]
    }).type).toBe("session.attachments.updated");

    expect(ServerEventSchema.parse({
      type: "localWeb.session.updated",
      session: {
        id: "local-web-1",
        sessionId: "thread-1",
        targetUrl: "http://127.0.0.1:5173",
        proxyUrl: "/local-web/local-web-1/",
        status: "active",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:01.000Z",
        error: ""
      }
    }).type).toBe("localWeb.session.updated");

    expect(ServerEventSchema.parse({
      type: "session.artifact.created",
      sessionId: "thread-1",
      asset: {
        id: "asset-1",
        sessionId: "thread-1",
        source: "localWebCapture",
        kind: "screenshot",
        fileName: "localhost-5173.png",
        mimeType: "image/png",
        sizeBytes: 327680,
        sha256: "abc",
        status: "available",
        url: "/api/assets/asset-1/content",
        createdAt: "2026-05-16T00:00:00.000Z",
        expiresAt: "2026-05-23T00:00:00.000Z",
        error: ""
      }
    }).type).toBe("session.artifact.created");

    expect(ServerEventSchema.parse({
      type: "session.artifact.created",
      sessionId: "thread-1",
      asset: {
        id: "asset-codex-1",
        sessionId: "thread-1",
        source: "codexEvent",
        kind: "image",
        fileName: "ig_test.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        sha256: "def",
        status: "available",
        url: "/api/assets/asset-codex-1/content",
        createdAt: "2026-05-18T12:32:55.366Z",
        expiresAt: null,
        error: ""
      }
    }).type).toBe("session.artifact.created");
  });

  it("parses Codex runtime config commands and events", () => {
    const createdWithRuntimeConfig = ClientCommandSchema.parse({
      type: "session.create",
      requestId: "create-runtime-1",
      toolId: "codex-mac",
      projectPath: "/repo/code",
      text: "使用高级配置新建会话",
      runtimeConfig: {
        model: "gpt-5.5",
        effort: "high",
        permissionMode: "workspace",
        approvalMode: "on-request",
        approvalsReviewer: "auto_review"
      }
    });
    expect(createdWithRuntimeConfig).toMatchObject({
      type: "session.create",
      runtimeConfig: {
        model: "gpt-5.5",
        effort: "high",
        permissionMode: "workspace",
        approvalMode: "on-request",
        approvalsReviewer: "auto_review"
      }
    });

    const createdWithoutRuntimeConfig = ClientCommandSchema.parse({
      type: "session.create",
      requestId: "create-runtime-legacy",
      toolId: "codex-mac",
      projectPath: null,
      text: "旧客户端新建会话"
    });
    expect(createdWithoutRuntimeConfig).toMatchObject({
      type: "session.create",
      requestId: "create-runtime-legacy"
    });
    expect(createdWithoutRuntimeConfig).not.toHaveProperty("runtimeConfig");

    expect(ClientCommandSchema.parse({
      type: "codex.models.list",
      requestId: "models-1"
    }).type).toBe("codex.models.list");

    expect(ClientCommandSchema.parse({
      type: "session.runtimeConfig.read",
      requestId: "runtime-read-1",
      sessionId: "thread-1"
    }).type).toBe("session.runtimeConfig.read");

    expect(ClientCommandSchema.parse({
      type: "session.runtimeConfig.update",
      requestId: "runtime-1",
      sessionId: "thread-1",
      config: {
        model: "gpt-5.5",
        effort: "high",
        permissionMode: "workspace",
        approvalMode: "on-request",
        approvalsReviewer: "auto_review"
      }
    }).type).toBe("session.runtimeConfig.update");

    expect(ServerEventSchema.parse({
      type: "session.runtimeConfig.updated",
      requestId: "runtime-1",
      config: {
        sessionId: "thread-1",
        model: "gpt-5.5",
        effort: "high",
        permissionMode: "workspace",
        approvalMode: "on-request",
        approvalsReviewer: "auto_review",
        updatedAt: "2026-05-14T00:00:00.000Z"
      }
    }).type).toBe("session.runtimeConfig.updated");

    expect(ServerEventSchema.parse({
      type: "codex.models.snapshot",
      requestId: "models-1",
      defaultModel: "gpt-5.5",
      models: [{
        id: "gpt-5.5",
        label: "GPT-5.5",
        isDefault: true,
        hidden: false,
        isAvailable: true,
        supportedEfforts: ["low", "medium", "high", "xhigh"]
      }]
    }).type).toBe("codex.models.snapshot");
  });

  it("parses nullable session context usage fields", () => {
    const parsed = ServerEventSchema.parse({
      type: "session.updated",
      session: {
        id: "thread-context",
        toolId: "codex-mac",
        title: "上下文用量",
        projectPath: null,
        projectName: null,
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:01:00.000Z",
        isPinned: false,
        needsUserInput: false,
        waitsForNextDirection: false,
        statusLabel: "completed",
        lastMessagePreview: "",
        contextTokensUsed: 170000,
        contextWindowTokens: 258400
      }
    });

    expect(parsed.type).toBe("session.updated");
    if (parsed.type === "session.updated") {
      expect(parsed.session.contextTokensUsed).toBe(170000);
      expect(parsed.session.contextWindowTokens).toBe(258400);
    }
  });

  it("accepts send, steer and interrupt commands", () => {
    expect(ClientCommandSchema.parse({
      type: "session.read",
      requestId: "req-read",
      sessionId: "session-1"
    }).type).toBe("session.read");

    expect(ClientCommandSchema.parse({
      type: "session.sync.enable",
      requestId: "req-sync",
      sessionId: "session-1",
      activeDetail: false
    })).toMatchObject({ type: "session.sync.enable", activeDetail: false });

    expect(ClientCommandSchema.parse({
      type: "session.sync.disable",
      requestId: "req-unsync",
      sessionId: "session-1"
    }).type).toBe("session.sync.disable");

    expect(ClientCommandSchema.parse({
      type: "session.sync.unsubscribe",
      requestId: "req-unsubscribe",
      sessionId: "session-1"
    }).type).toBe("session.sync.unsubscribe");

    expect(ClientCommandSchema.parse({
      type: "session.rename",
      requestId: "req-rename",
      sessionId: "session-1",
      title: "新的标题"
    }).type).toBe("session.rename");

    expect(ClientCommandSchema.parse({
      type: "session.sendText",
      requestId: "req-1",
      sessionId: "session-1",
      clientMessageId: "client-msg-1",
      text: "继续"
    }).type).toBe("session.sendText");

    expect(ClientCommandSchema.parse({
      type: "session.steer",
      requestId: "req-2",
      sessionId: "session-1",
      text: "先停下，改用保守方案"
    }).type).toBe("session.steer");

    const command = ClientCommandSchema.parse({
      type: "session.context.compact",
      requestId: "compact-1",
      sessionId: "thread-1"
    });
    expect(command.type).toBe("session.context.compact");

    expect(ClientCommandSchema.parse({
      type: "session.interrupt",
      requestId: "req-3",
      sessionId: "session-1"
    }).type).toBe("session.interrupt");
  });

  it("parses installed capability and input queue protocol", () => {
    expect(ClientCommandSchema.parse({
      type: "codex.installedCapabilities.list",
      requestId: "capabilities-1"
    }).type).toBe("codex.installedCapabilities.list");

    const created = ClientCommandSchema.parse({
      type: "session.create",
      requestId: "create-guided",
      toolId: "codex",
      projectPath: "/repo/code",
      text: "按这个方向新建会话",
      guidance: {
        mode: "guided",
        selectedCapabilityIds: ["skill:codex-home:frontend-design"]
      }
    });
    expect(created.type).toBe("session.create");
    if (created.type === "session.create") {
      expect(created.guidance?.mode).toBe("guided");
    }

    const sent = ClientCommandSchema.parse({
      type: "session.sendText",
      requestId: "send-guided",
      sessionId: "thread-1",
      clientMessageId: "client-guided-1",
      text: "继续执行",
      guidance: {
        mode: "plain",
        selectedCapabilityIds: []
      }
    });
    expect(sent.type).toBe("session.sendText");
    if (sent.type === "session.sendText") {
      expect(sent.guidance?.selectedCapabilityIds).toEqual([]);
    }

    const steered = ClientCommandSchema.parse({
      type: "session.steer",
      requestId: "steer-guided",
      sessionId: "thread-1",
      text: "立即改用保守方案",
      guidance: {
        mode: "steer-now",
        selectedCapabilityIds: ["plugin:codex-cache:openai-curated/github"]
      }
    });
    expect(steered.type).toBe("session.steer");
    if (steered.type === "session.steer") {
      expect(steered.guidance?.mode).toBe("steer-now");
    }

    expect(ClientCommandSchema.parse({
      type: "session.inputQueue.enqueue",
      requestId: "queue-1",
      sessionId: "thread-1",
      clientMessageId: "client-queued-1",
      text: "当前结束后再检查测试",
      guidance: {
        mode: "queued",
        selectedCapabilityIds: ["skill:codex-home:frontend-design"]
      }
    }).type).toBe("session.inputQueue.enqueue");

    expect(() => ClientCommandSchema.parse({
      type: "session.inputQueue.enqueue",
      requestId: "queue-attachments-1",
      sessionId: "thread-1",
      clientMessageId: "client-queued-attachments-1",
      text: "当前结束后再看附件",
      guidance: {
        mode: "queued",
        selectedCapabilityIds: []
      },
      attachmentIds: ["asset-1"]
    })).toThrow();

    expect(() => ClientCommandSchema.parse({
      type: "session.inputQueue.enqueue",
      requestId: "queue-empty-attachments-1",
      sessionId: "thread-1",
      clientMessageId: "client-queued-empty-attachments-1",
      text: "当前结束后再看附件",
      guidance: {
        mode: "queued",
        selectedCapabilityIds: []
      },
      attachmentIds: []
    })).toThrow();

    expect(ClientCommandSchema.parse({
      type: "session.inputQueue.cancel",
      requestId: "queue-cancel-1",
      sessionId: "thread-1",
      queueItemId: "queue-item-1"
    }).type).toBe("session.inputQueue.cancel");

    expect(ClientCommandSchema.parse({
      type: "session.inputQueue.retry",
      requestId: "queue-retry-1",
      sessionId: "thread-1",
      queueItemId: "queue-item-1"
    }).type).toBe("session.inputQueue.retry");

    expect(ServerEventSchema.parse({
      type: "codex.installedCapabilities.snapshot",
      capabilities: [
        {
          id: "skill:codex-home:frontend-design",
          kind: "skill",
          name: "frontend-design",
          description: "Create production-grade frontend interfaces",
          source: "codex-home",
          isAvailable: true
        },
        {
          id: "plugin:codex-cache:openai-curated/github",
          kind: "plugin",
          name: "GitHub",
          description: "Inspect repositories and pull requests",
          source: "codex-cache",
          isAvailable: true
        }
      ]
    }).type).toBe("codex.installedCapabilities.snapshot");

    expect(ServerEventSchema.parse({
      type: "session.inputQueue.updated",
      sessionId: "thread-1",
      items: [
        {
          id: "queue-item-1",
          sessionId: "thread-1",
          clientMessageId: "client-queued-1",
          text: "当前结束后再检查测试",
          textPreview: "当前结束后再检查测试",
          textLength: 10,
          status: "queued",
          guidance: {
            mode: "queued",
            selectedCapabilityIds: ["skill:codex-home:frontend-design"]
          },
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z"
        }
      ]
    }).type).toBe("session.inputQueue.updated");
  });

  it("accepts a Mac-side Codex preflight event without credential fields", () => {
    const parsed = ServerEventSchema.parse({
      type: "codex.preflight.updated",
      preflight: {
        status: "ok",
        checkedAt: "2026-05-05T08:00:00.000Z",
        codexBin: "/Applications/Codex.app/Contents/Resources/codex",
        cliVersion: "codex-cli 0.130.0-alpha.5",
        appServerAvailable: true,
        remoteControlAvailable: true,
        provider: "custom",
        model: "gpt-5.5",
        authStatus: "api-key",
        capabilities: {
          accountRead: true,
          configRead: true,
          modelList: true,
          threadList: true,
          threadRead: true,
          turnStart: true,
          turnSteer: true,
          turnInterrupt: true,
          approvalResponse: true
        },
        message: "Codex 官方通道可用，认证由 Mac 端处理"
      }
    });

    expect(parsed.type).toBe("codex.preflight.updated");
    if (parsed.type === "codex.preflight.updated") {
      expect(parsed.preflight.provider).toBe("custom");
    }
  });

  it("rejects secret-shaped fields from Codex preflight", () => {
    const parsed = CodexPreflightSchema.safeParse({
      status: "ok",
      checkedAt: "2026-05-05T08:00:00.000Z",
      codexBin: "/bin/codex",
      cliVersion: "codex-cli 0.130.0-alpha.5",
      appServerAvailable: true,
      remoteControlAvailable: true,
      provider: "custom",
      model: "gpt-5.5",
      authStatus: "ok",
      capabilities: {
        accountRead: true,
        configRead: true,
        modelList: true,
        threadList: true,
        threadRead: true,
        turnStart: true,
        turnSteer: true,
        turnInterrupt: true,
        approvalResponse: true
      },
      message: "ok",
      apiKey: "must-not-appear"
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts a native approval event with original action labels", () => {
    const parsed = ServerEventSchema.parse({
      type: "approval.updated",
      sessionId: "session-1",
      approval: {
        id: "approval-1",
        kind: "command",
        method: "item/commandExecution/requestApproval",
        subject: "pnpm test",
        title: "Codex needs approval",
        body: "Run command",
        actions: [
          { id: "approve", label: "Approve" },
          { id: "deny", label: "Deny" }
        ],
        inputFields: [
          {
            id: "target",
            label: "目标文件",
            type: "text",
            defaultValue: "README.md",
            options: [],
            isSecret: false,
            isRequired: false
          }
        ],
        createdAt: "2026-05-05T08:00:00.000Z"
      }
    });
    expect(parsed.type).toBe("approval.updated");
    if (parsed.type === "approval.updated" && parsed.approval !== null) {
      expect(parsed.approval).toMatchObject({
        kind: "command",
        method: "item/commandExecution/requestApproval",
        subject: "pnpm test"
      });
      expect(parsed.approval.actions.map((action) => action.label)).toEqual(["Approve", "Deny"]);
      expect(parsed.approval.inputFields?.[0]?.id).toBe("target");
      expect(parsed.approval.inputFields?.[0]?.isRequired).toBe(false);
    }
  });

  it("defaults structured approval metadata for older approval events", () => {
    const parsed = ServerEventSchema.parse({
      type: "approval.updated",
      sessionId: "session-1",
      approval: {
        id: "approval-legacy",
        title: "命令审批",
        body: "pnpm test",
        actions: [
          { id: "accept", label: "同意" },
          { id: "decline", label: "拒绝" }
        ],
        createdAt: "2026-05-05T08:00:00.000Z"
      }
    });

    expect(parsed.type).toBe("approval.updated");
    if (parsed.type === "approval.updated" && parsed.approval !== null) {
      expect(parsed.approval).toMatchObject({
        kind: "command",
        method: "",
        subject: ""
      });
    }
  });

  it("accepts approval responses with optional user input answers", () => {
    const parsed = ClientCommandSchema.parse({
      type: "approval.respond",
      requestId: "req-approval",
      sessionId: "session-1",
      approvalId: "approval-1",
      actionId: "submit",
      answers: {
        reason: { answers: ["继续执行"] }
      }
    });
    expect(parsed.type).toBe("approval.respond");
    if (parsed.type === "approval.respond") {
      expect(parsed.answers?.reason.answers).toEqual(["继续执行"]);
    }
  });

  it("accepts a session message snapshot event", () => {
    const parsed = ServerEventSchema.parse({
      type: "messages.snapshot",
      sessionId: "session-1",
      messages: [
        {
          id: "msg-1",
          sessionId: "session-1",
          role: "assistant",
          text: "真实 Codex 输出",
          rawText: "真实 Codex 输出",
          createdAt: "2026-05-05T08:00:00.000Z",
          sendState: null,
          clientMessageId: null,
          canWithdraw: false
        }
      ]
    });

    expect(parsed.type).toBe("messages.snapshot");
  });

  it("accepts command failure events with a client message id", () => {
    const parsed = ServerEventSchema.parse({
      type: "command.failed",
      requestId: "send-1",
      errorCode: "CODEX_COMMAND_FAILED",
      message: "Codex 指令发送失败",
      clientMessageId: "client-message-1"
    });

    expect(parsed.type).toBe("command.failed");
    if (parsed.type === "command.failed") {
      expect(parsed.clientMessageId).toBe("client-message-1");
    }
  });

  it("accepts a project snapshot event for new session project selection", () => {
    const parsed = ServerEventSchema.parse({
      type: "projects.snapshot",
      projects: [
        {
          projectPath: "/repo/code",
          projectName: "code",
          updatedAt: "2026-05-10T00:01:00.000Z"
        },
        {
          projectPath: "/repo/older",
          projectName: "older",
          updatedAt: "2026-05-09T00:01:00.000Z"
        }
      ]
    });

    expect(parsed.type).toBe("projects.snapshot");
    if (parsed.type === "projects.snapshot") {
      expect(parsed.projects.map((project) => project.projectPath)).toEqual(["/repo/code", "/repo/older"]);
    }
  });

  it("parses workspace project commands", () => {
    expect(ClientCommandSchema.parse({
      type: "projects.list",
      requestId: "projects-1"
    }).type).toBe("projects.list");

    expect(ClientCommandSchema.parse({
      type: "projects.create",
      requestId: "projects-create-1",
      rootId: "root-dev",
      projectName: "Mobile Created"
    }).type).toBe("projects.create");

    expect(ClientCommandSchema.parse({
      type: "projects.hide",
      requestId: "projects-hide-1",
      projectPath: "/repo/old"
    }).type).toBe("projects.hide");

    expect(ClientCommandSchema.parse({
      type: "projects.unhide",
      requestId: "projects-unhide-1",
      projectPath: "/repo/old"
    }).type).toBe("projects.unhide");
  });

  it("parses workspace project snapshots with roots and hidden state", () => {
    const parsed = ServerEventSchema.parse({
      type: "projects.snapshot",
      requestId: "projects-1",
      roots: [
        {
          id: "root-dev",
          name: "Dev",
          path: "/Users/me/Dev",
          isDefault: true,
          isAvailable: true,
          isWritable: true,
          lastCheckedAt: "2026-05-18T08:00:00.000Z",
          errorMessage: ""
        }
      ],
      projects: [
        {
          projectPath: "/Users/me/Dev/Code",
          projectName: "Code",
          rootId: "root-dev",
          isHidden: false,
          exists: true,
          isInsideKnownRoot: true,
          lastUsedAt: "2026-05-18T08:01:00.000Z",
          sessionCount: 3,
          createdByMobile: true,
          updatedAt: "2026-05-18T08:01:00.000Z"
        }
      ]
    });

    expect(parsed.type).toBe("projects.snapshot");
    if (parsed.type === "projects.snapshot") {
      expect(parsed.roots?.[0]?.id).toBe("root-dev");
      expect(parsed.projects[0].isHidden).toBe(false);
    }
  });

  it("parses codex account usage refresh and snapshots", () => {
    expect(ClientCommandSchema.parse({
      type: "codex.accountUsage.refresh",
      requestId: "usage-1"
    }).type).toBe("codex.accountUsage.refresh");

    const available = ServerEventSchema.parse({
      type: "codex.accountUsage.snapshot",
      requestId: "usage-1",
      usage: {
        status: "available",
        accountLabel: "user@example.com",
        accountStatusText: "已登录",
        refreshedAt: "2026-05-18T08:00:00.000Z",
        fiveHour: {
          used: 12,
          limit: 100,
          remaining: 88,
          resetsAt: "2026-05-18T10:00:00.000Z"
        },
        weekly: {
          used: 120,
          limit: 500,
          remaining: 380,
          resetsAt: "2026-05-25T00:00:00.000Z"
        },
        message: ""
      }
    });
    expect(available.type).toBe("codex.accountUsage.snapshot");
    if (available.type === "codex.accountUsage.snapshot") {
      expect(available.usage.rateLimits).toEqual([]);
    }

    const official = ServerEventSchema.parse({
      type: "codex.accountUsage.snapshot",
      requestId: "usage-official",
      usage: {
        status: "available",
        accountLabel: "user@example.com",
        accountStatusText: "已登录",
        refreshedAt: "2026-05-18T08:00:00.000Z",
        limitId: "codex",
        limitName: "",
        primary: {
          usedPercent: 42,
          windowDurationMins: 60,
          resetsAt: "2026-05-18T10:00:00.000Z"
        },
        secondary: {
          usedPercent: 5,
          windowDurationMins: 1440,
          resetsAt: "2026-05-25T00:00:00.000Z"
        },
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: "9.99"
        },
        planType: "pro",
        rateLimitReachedType: "workspace_member_usage_limit_reached",
        rateLimits: [
          {
            limitId: "codex",
            limitName: "",
            primary: {
              usedPercent: 42,
              windowDurationMins: 60,
              resetsAt: "2026-05-18T10:00:00.000Z"
            },
            secondary: null,
            credits: null,
            planType: "pro",
            rateLimitReachedType: ""
          }
        ],
        fiveHour: null,
        weekly: null,
        message: ""
      }
    });
    expect(official.type).toBe("codex.accountUsage.snapshot");
    if (official.type === "codex.accountUsage.snapshot") {
      expect(official.usage.primary?.usedPercent).toBe(42);
      expect(official.usage.rateLimits[0].limitId).toBe("codex");
    }

    const unsupported = ServerEventSchema.parse({
      type: "codex.accountUsage.snapshot",
      requestId: "usage-2",
      usage: {
        status: "unsupported",
        accountLabel: "",
        accountStatusText: "当前通道暂不支持读取精确用量",
        refreshedAt: "2026-05-18T08:00:00.000Z",
        fiveHour: null,
        weekly: null,
        message: "当前通道暂不支持读取精确用量"
      }
    });
    expect(unsupported.type).toBe("codex.accountUsage.snapshot");

    const apiKey = ServerEventSchema.parse({
      type: "codex.accountUsage.snapshot",
      requestId: "usage-3",
      usage: {
        status: "apiKey",
        accountLabel: "",
        accountStatusText: "API 登录",
        refreshedAt: "2026-05-18T08:00:00.000Z",
        fiveHour: null,
        weekly: null,
        message: "当前为 API 登录，账号用量仅支持 Codex 账号登录后读取"
      }
    });
    expect(apiKey.type).toBe("codex.accountUsage.snapshot");
  });

  it("parses project mutation events", () => {
    const project = {
      projectPath: "/Users/me/Dev/Code",
      projectName: "Code",
      rootId: "root-dev",
      isHidden: false,
      exists: true,
      isInsideKnownRoot: true,
      lastUsedAt: null,
      sessionCount: 0,
      createdByMobile: true,
      updatedAt: "2026-05-18T08:01:00.000Z"
    };

    expect(ServerEventSchema.parse({
      type: "project.created",
      requestId: "projects-create-1",
      project
    }).type).toBe("project.created");

    expect(ServerEventSchema.parse({
      type: "project.visibility.updated",
      requestId: "projects-hide-1",
      project: { ...project, isHidden: true }
    }).type).toBe("project.visibility.updated");

    expect(ServerEventSchema.parse({
      type: "project.create.failed",
      requestId: "projects-create-2",
      message: "同名项目已存在"
    }).type).toBe("project.create.failed");
  });

  it("accepts plan, command summary and diff overview events", () => {
    expect(ServerEventSchema.parse({
      type: "session.plan.updated",
      sessionId: "session-1",
      steps: [
        { id: "p1", title: "检查失败测试", status: "in_progress", detail: "运行 pnpm test" }
      ]
    }).type).toBe("session.plan.updated");

    expect(ServerEventSchema.parse({
      type: "session.commandSummary.updated",
      sessionId: "session-1",
      command: {
        id: "cmd-1",
        turnId: "turn-1",
        title: "pnpm test",
        command: "pnpm test",
        status: "completed",
        exitCode: 0,
        summaryLines: ["2 tests passed"],
        rawOutput: "2 tests passed"
      }
    }).type).toBe("session.commandSummary.updated");

    const parsedDiffEvent = ServerEventSchema.parse({
      type: "session.diffOverview.updated",
      sessionId: "session-1",
      diff: {
        filesChanged: 1,
        insertions: 12,
        deletions: 3,
        files: [{
          path: "src/main.ts",
          status: "modified",
          insertions: 12,
          deletions: 3,
          patch: "diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old\n+new"
        }]
      }
    });
    expect(parsedDiffEvent.type).toBe("session.diffOverview.updated");
    if (parsedDiffEvent.type !== "session.diffOverview.updated") {
      throw new Error("expected diff overview event");
    }
    expect(parsedDiffEvent.diff.files[0].patch).toContain("+new");
  });

  it("accepts a thread detail snapshot with streaming timeline items", () => {
    const parsed = ServerEventSchema.parse({
      type: "thread.detail.snapshot",
      sessionId: "session-1",
      turns: [
        {
          id: "turn-1",
          sessionId: "session-1",
          status: "running",
          startedAt: "2026-05-12T08:00:00.000Z",
          completedAt: null,
          items: [
            {
              id: "item-1",
              sessionId: "session-1",
              turnId: "turn-1",
              kind: "agentMessage",
              status: "running",
              title: "",
              text: "正在处理",
              rawText: "正在处理",
              createdAt: "2026-05-12T08:00:00.000Z",
              updatedAt: "2026-05-12T08:00:01.000Z",
              isStreaming: true,
              isCollapsedByDefault: false,
              command: null,
              diff: null,
              approval: null,
              planSteps: [],
              assetIds: ["asset-codex-1"]
            }
          ]
        }
      ]
    });

    expect(parsed.type).toBe("thread.detail.snapshot");
  });

  it("accepts timeline command updates and remote-control status updates", () => {
    expect(ServerEventSchema.parse({
      type: "timeline.item.updated",
      item: {
        id: "cmd-1",
        sessionId: "session-1",
        turnId: "turn-1",
        kind: "commandExecution",
        status: "running",
        title: "pnpm test",
        text: "pnpm test",
        rawText: "stdout",
        createdAt: "2026-05-12T08:00:00.000Z",
        updatedAt: "2026-05-12T08:00:01.000Z",
        isStreaming: true,
        isCollapsedByDefault: true,
        command: {
          id: "cmd-1",
          turnId: "turn-1",
          title: "pnpm test",
          command: "pnpm test",
          status: "running",
          exitCode: null,
          summaryLines: ["running"],
          rawOutput: "stdout"
        },
        diff: null,
        approval: null,
        planSteps: []
      }
    }).type).toBe("timeline.item.updated");

    expect(ServerEventSchema.parse({
      type: "remoteControl.status.updated",
      status: "connected",
      environmentId: "env-1"
    }).type).toBe("remoteControl.status.updated");

    expect(ServerEventSchema.parse({
      type: "remoteControl.status.updated",
      status: "errored",
      environmentId: null
    }).type).toBe("remoteControl.status.updated");
  });

  it("accepts guided message acknowledgements", () => {
    const parsed = ServerEventSchema.parse({
      type: "message.updated",
      message: {
        id: "steer-1",
        sessionId: "session-1",
        role: "user",
        text: "立即按这个方向继续",
        rawText: "立即按这个方向继续",
        createdAt: "2026-05-14T00:00:00.000Z",
        sendState: "guided",
        clientMessageId: "steer-1",
        canWithdraw: false
      }
    });

    expect(parsed.type).toBe("message.updated");
    if (parsed.type === "message.updated") {
      expect(parsed.message.sendState).toBe("guided");
    }
  });
});
