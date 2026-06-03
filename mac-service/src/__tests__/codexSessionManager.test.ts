import { describe, expect, it } from "vitest";
import { createCodexSessionManager, mapCodexThreadToSessionSummary, normalizeCodexApproval, readCodexJsonlContextUsage, readCodexJsonlMessages, readCodexJsonlPendingApproval, readCodexJsonlPlanUpdates, type CodexThreadMetadata } from "../codex/codexSessionManager.js";

describe("codex session manager", () => {
  it("maps create session to thread/start and turn/start", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "thread/start") return { threadId: "thread-1", title: "解释项目结构", projectPath: "/repo/a" };
        if (method === "turn/start") return { turnId: "turn-1", status: "running" };
        return {};
      },
      respond: () => undefined
    });
    const created = await manager.createSession({ projectPath: "/repo/a", text: "解释项目结构" });

    expect(created.threadId).toBe("thread-1");
    expect(calls.map((call) => call.method)).toEqual(["thread/start", "turn/start"]);
  });

  it("passes mobile client message ids to official turn/start and turn/steer", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        if (method === "thread/start") return { threadId: "thread-1" };
        if (method === "turn/start") return { turnId: "turn-1", status: "running" };
        return {};
      },
      respond: () => undefined
    });

    await manager.createSession({ projectPath: null, text: "新建", clientUserMessageId: "client-create-1" });
    await manager.startTurn({ threadId: "thread-1", text: "继续", clientUserMessageId: "client-start-1", skipPreflightResume: true });
    await manager.steerTurn({ threadId: "thread-1", turnId: "turn-1", text: "补充", clientUserMessageId: "client-steer-1" });

    expect(calls.filter((call) => call.method === "turn/start").map((call) => call.params.clientUserMessageId)).toEqual([
      "client-create-1",
      "client-start-1"
    ]);
    expect(calls.find((call) => call.method === "turn/steer")?.params.clientUserMessageId).toBe("client-steer-1");
  });

  it("renames a Codex thread through the official app-server method", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        return {};
      },
      respond: () => undefined
    });

    await manager.renameSession({ threadId: "thread-1", title: "新的会话标题" });

    expect(calls).toEqual([
      { method: "thread/name/set", params: { threadId: "thread-1", name: "新的会话标题" } }
    ]);
  });

  it("compacts a Codex thread through the official app-server method", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        return {};
      },
      respond: () => undefined
    });

    await manager.compactContext({ threadId: "thread-1" });

    expect(calls).toEqual([
      { method: "thread/resume", params: { threadId: "thread-1" } },
      { method: "thread/compact/start", params: { threadId: "thread-1" } }
    ]);
  });

  it("resumes and starts historical threads with cwd and rollout path metadata", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const metadata = new Map<string, CodexThreadMetadata>([
      ["thread-1", {
        title: "历史会话",
        firstUserMessage: "起步",
        cwd: "/repo/libry",
        rolloutPath: "/Users/me/.codex/sessions/rollout-thread-1.jsonl"
      } as CodexThreadMetadata]
    ]);
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "turn/start") return { turnId: "turn-1", status: "running" };
        return {};
      },
      respond: () => undefined
    }, {
      readThreadMetadata: () => metadata
    });

    await manager.startTurn({ threadId: "thread-1", text: "继续" });

    expect(calls[0]).toEqual({
      method: "thread/resume",
      params: {
        threadId: "thread-1",
        cwd: "/repo/libry",
        path: "/Users/me/.codex/sessions/rollout-thread-1.jsonl"
      }
    });
    expect(calls[1]).toMatchObject({
      method: "turn/start",
      params: expect.objectContaining({
        threadId: "thread-1",
        cwd: "/repo/libry"
      })
    });
  });

  it("resumes historical threads before retrying context compaction when Codex reports thread not found", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let compactAttempts = 0;
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "thread/compact/start") {
          compactAttempts++;
          if (compactAttempts === 1) throw new Error("thread not found: thread-1");
        }
        return {};
      },
      respond: () => undefined
    });

    await manager.compactContext({ threadId: "thread-1" });

    expect(calls.map((call) => call.method)).toEqual([
      "thread/resume",
      "thread/compact/start",
      "thread/resume",
      "thread/compact/start"
    ]);
  });

  it("applies runtime config to turn/start but not turn/steer", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        if (method === "turn/start") return { turnId: "turn-1", status: "running" };
        return {};
      },
      respond: () => undefined
    }, {
      runtimeConfigForSession: () => ({
        sessionId: "thread-1",
        model: "gpt-5.5",
        effort: "high",
        permissionMode: "workspace",
        approvalMode: "on-request",
        approvalsReviewer: "auto_review",
        updatedAt: "2026-05-14T00:00:00.000Z"
      }),
      codexRuntimeCapabilities: { supportsPermissionsProfile: true }
    });

    await manager.startTurn({ threadId: "thread-1", text: "继续" });
    await manager.steerTurn({ threadId: "thread-1", turnId: "turn-1", text: "补充" });

    expect(calls[0]).toEqual({
      method: "thread/resume",
      params: { threadId: "thread-1" }
    });
    expect(calls[1]).toMatchObject({
      method: "turn/start",
      params: expect.objectContaining({
        model: "gpt-5.5",
        effort: "high",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        permissions: { type: "profile", id: ":workspace" }
      })
    });
    expect(calls[2].method).toBe("turn/steer");
    expect(calls[2].params).not.toHaveProperty("model");
    expect(calls[2].params).not.toHaveProperty("effort");
    expect(calls[2].params).not.toHaveProperty("permissions");
  });

  it("applies create-session runtime config to the first turn/start", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        if (method === "thread/start") return { threadId: "thread-created-runtime" };
        if (method === "turn/start") return { turnId: "turn-created-runtime", status: "running" };
        return {};
      },
      respond: () => undefined
    }, {
      codexRuntimeCapabilities: { supportsPermissionsProfile: true }
    });

    await manager.createSession({
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

    expect(calls[1]).toMatchObject({
      method: "turn/start",
      params: expect.objectContaining({
        threadId: "thread-created-runtime",
        model: "gpt-5.5",
        effort: "high",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        permissions: { type: "profile", id: ":workspace" }
      })
    });
  });

  it("passes structured input items to create-session turn/start", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        if (method === "thread/start") return { threadId: "thread-structured-create" };
        if (method === "turn/start") return { turnId: "turn-structured-create", status: "running" };
        return {};
      },
      respond: () => undefined
    });

    await manager.createSession({
      projectPath: "/repo/code",
      text: "看图",
      inputItems: [
        { type: "text", text: "看图", text_elements: [] },
        { type: "localImage", path: "/tmp/pixel.png" },
        { type: "mention", name: "notes.md", path: "/tmp/notes.md" }
      ]
    });

    expect(calls[1]).toEqual({
      method: "turn/start",
      params: {
        threadId: "thread-structured-create",
        input: [
          { type: "text", text: "看图", text_elements: [] },
          { type: "localImage", path: "/tmp/pixel.png" },
          { type: "mention", name: "notes.md", path: "/tmp/notes.md" }
        ]
      }
    });
  });

  it("resumes an existing thread before starting a new turn", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        if (method === "turn/start") return { turnId: "turn-1", status: "running" };
        return {};
      },
      respond: () => undefined
    });

    await expect(manager.startTurn({ threadId: "thread-1", text: "继续" })).resolves.toEqual({
      turnId: "turn-1",
      status: "running"
    });

    expect(calls.map((call) => call.method)).toEqual(["thread/resume", "turn/start"]);
    expect(calls[0].params).toEqual({ threadId: "thread-1" });
    expect(calls[1].params).toMatchObject({
      threadId: "thread-1",
      input: [{ type: "text", text: "继续", text_elements: [] }]
    });
  });

  it("passes structured input items to turn/start", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        if (method === "turn/start") return { turnId: "turn-1", status: "running" };
        return {};
      },
      respond: () => undefined
    });

    await manager.startTurn({
      threadId: "thread-1",
      inputItems: [
        { type: "text", text: "看图", text_elements: [] },
        { type: "localImage", path: "/tmp/pixel.png" },
        { type: "mention", name: "notes.md", path: "/tmp/notes.md" }
      ]
    });

    expect(calls[1]).toEqual({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [
          { type: "text", text: "看图", text_elements: [] },
          { type: "localImage", path: "/tmp/pixel.png" },
          { type: "mention", name: "notes.md", path: "/tmp/notes.md" }
        ]
      }
    });
  });

  it("does not block turn/start on model list validation for stored runtime config", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let modelListCalls = 0;
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        if (method === "turn/start") return { turnId: "turn-1", status: "running" };
        return {};
      },
      respond: () => undefined
    }, {
      runtimeConfigForSession: () => ({
        sessionId: "thread-1",
        model: "gpt-5.5",
        effort: "xhigh",
        permissionMode: "workspace",
        approvalMode: "on-request",
        approvalsReviewer: "user",
        updatedAt: "2026-05-14T00:00:00.000Z"
      }),
      listModels: async () => {
        modelListCalls++;
        return new Promise(() => undefined);
      },
      codexRuntimeCapabilities: { supportsPermissionsProfile: false }
    });

    const result = await Promise.race([
      manager.startTurn({ threadId: "thread-1", text: "继续" }),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 80))
    ]);

    expect(result).toEqual({ turnId: "turn-1", status: "running" });
    expect(modelListCalls).toBe(0);
    expect(calls).toEqual([
      {
        method: "thread/resume",
        params: { threadId: "thread-1" }
      },
      {
        method: "turn/start",
        params: expect.objectContaining({
          threadId: "thread-1",
          model: "gpt-5.5",
          effort: "xhigh",
          approvalPolicy: "on-request",
          sandboxPolicy: { type: "workspaceWrite" }
        })
      }
    ]);
  });

  it("adds stage context when resume fails before starting a turn", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/resume") {
          throw new Error("Codex App Server request timed out: thread/resume");
        }
        return {};
      },
      respond: () => undefined
    });

    await expect(manager.startTurn({ threadId: "thread-1", text: "继续" }))
      .rejects.toThrow("Codex thread/resume failed: Codex App Server request timed out: thread/resume");
  });

  it("adds stage context when turn start fails after resume", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "turn/start") {
          throw new Error("Codex App Server request timed out: turn/start");
        }
        return {};
      },
      respond: () => undefined
    });

    await expect(manager.startTurn({ threadId: "thread-1", text: "继续" }))
      .rejects.toThrow("Codex turn/start failed: Codex App Server request timed out: turn/start");
  });

  it("creates projectless sessions in a generated Codex conversation workspace", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const ensuredDirectories: string[] = [];
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "thread/start") return { threadId: "thread-1" };
        if (method === "turn/start") return { turnId: "turn-1", status: "running" };
        return {};
      },
      respond: () => undefined
    }, {
      projectlessWorkspaceRoot: "/tmp/codex-generated",
      now: () => new Date("2026-05-11T15:53:07.000Z"),
      ensureWorkspaceDirectory: (workspacePath) => {
        ensuredDirectories.push(workspacePath);
      }
    });

    await manager.createSession({ projectPath: null, text: "测试连接性" });

    expect(calls[0]).toEqual({
      method: "thread/start",
      params: {
        cwd: "/tmp/codex-generated/2026-05-11/code-mobile-20260511-155307-conversation",
        sessionStartSource: "startup",
        threadSource: "user"
      }
    });
    expect(ensuredDirectories).toEqual([
      "/tmp/codex-generated/2026-05-11/code-mobile-20260511-155307-conversation"
    ]);
  });

  it("maps Codex thread list entries to V1 session summaries", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/list") {
          return {
            data: [
              {
                id: "thread-1",
                preview: "继续推进 V1",
                cwd: "/Users/liuyongzhe/DevEcoStudioProjects/Code",
                createdAt: 1778415573,
                updatedAt: 1778423484,
                status: { type: "running" },
                name: "code V1"
              }
            ]
          };
        }
        return {};
      },
      respond: () => undefined
    });

    await expect(manager.listSessionSummaries()).resolves.toEqual([
      {
        id: "thread-1",
        toolId: "codex-mac",
        title: "code V1",
        projectPath: "/Users/liuyongzhe/DevEcoStudioProjects/Code",
        projectName: "Code",
        createdAt: "2026-05-10T12:19:33.000Z",
        updatedAt: "2026-05-10T14:31:24.000Z",
        isPinned: false,
        needsUserInput: false,
        waitsForNextDirection: false,
        statusLabel: "running",
        lastMessagePreview: ""
      }
    ]);
  });

  it("hydrates list titles from the local Codex state database metadata without using previews", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/list") {
          return {
            data: [
              {
                id: "thread-state-title",
                preview: "这是一段回复摘要，不应该显示在列表里",
                cwd: "/Users/liuyongzhe/DevEcoStudioProjects/Code",
                createdAt: 1778415573,
                updatedAt: 1778423484,
                status: { type: "notLoaded" }
              }
            ]
          };
        }
        return {};
      },
      respond: () => undefined
    }, {
      readThreadMetadata: (ids) => new Map(ids.map((id) => [id, {
        title: "桌面端真实标题",
        firstUserMessage: "这是一段首条用户输入"
      }]))
    });

    await expect(manager.listSessionSummaries()).resolves.toEqual([
      expect.objectContaining({
        id: "thread-state-title",
        title: "桌面端真实标题",
        lastMessagePreview: ""
      })
    ]);
  });

  it("filters archived threads from list summaries using Codex state metadata", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/list") {
          return {
            data: [
              {
                id: "thread-active",
                cwd: "/repo/code",
                createdAt: 1778415573,
                updatedAt: 1778423484,
                status: { type: "notLoaded" }
              },
              {
                id: "thread-archived",
                cwd: "/repo/code",
                createdAt: 1778415573,
                updatedAt: 1778423485,
                status: { type: "notLoaded" }
              }
            ]
          };
        }
        return {};
      },
      respond: () => undefined
    }, {
      readThreadMetadata: (ids) => new Map(ids.map((id) => [id, {
        title: id,
        firstUserMessage: null,
        archived: id === "thread-archived"
      }]))
    });

    await expect(manager.listSessionSummaries()).resolves.toEqual([
      expect.objectContaining({
        id: "thread-active",
        title: "thread-active"
      })
    ]);
  });

  it("does not promote Codex list previews into titles or list summaries", () => {
    const session = mapCodexThreadToSessionSummary({
      id: "thread-preview-only",
      preview: "这是一段最后回复摘要，不应该成为历史列表标题",
      cwd: "/repo/code",
      createdAt: 1778415573,
      updatedAt: 1778423484,
      status: { type: "notLoaded" }
    });

    expect(session).toMatchObject({
      id: "thread-preview-only",
      title: "Codex 会话",
      lastMessagePreview: ""
    });
  });

  it("maps Codex context token usage into session summaries", () => {
    const session = mapCodexThreadToSessionSummary({
      id: "thread-context",
      title: "上下文窗口",
      cwd: "/repo/code",
      createdAt: 1778415573,
      updatedAt: 1778423484,
      status: { type: "notLoaded" },
      contextTokensUsed: 170000,
      contextWindowTokens: 258400
    });

    expect(session).toMatchObject({
      id: "thread-context",
      contextTokensUsed: 170000,
      contextWindowTokens: 258400
    });
  });

  it("reads the latest context usage from Codex rollout token_count events", () => {
    const usage = readCodexJsonlContextUsage([
      JSON.stringify({
        timestamp: "2026-05-16T00:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          model_context_window: 258400
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-16T00:00:10.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              total_tokens: 590223950
            },
            last_token_usage: {
              total_tokens: 170000
            }
          },
          model_context_window: 258400
        }
      })
    ].join("\n"));

    expect(usage).toEqual({
      contextTokensUsed: 170000,
      contextWindowTokens: 258400
    });
  });

  it("does not treat Codex cumulative token totals as the active context window usage", () => {
    const usage = readCodexJsonlContextUsage([
      JSON.stringify({
        timestamp: "2026-05-16T00:00:10.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              total_tokens: 590223950
            },
            last_token_usage: {
              input_tokens: 191348,
              output_tokens: 501,
              total_tokens: 191849
            }
          },
          model_context_window: 258400
        }
      })
    ].join("\n"));

    expect(usage).toEqual({
      contextTokensUsed: 191849,
      contextWindowTokens: 258400
    });
  });

  it("does not map archived Codex thread entries into visible session summaries", () => {
    const session = mapCodexThreadToSessionSummary({
      id: "thread-archived",
      archived: 1,
      cwd: "/repo/code",
      createdAt: 1778415573,
      updatedAt: 1778423484,
      status: { type: "notLoaded" }
    });

    expect(session).toBeNull();
  });

  it("uses the Codex desktop title field for list titles", () => {
    const session = mapCodexThreadToSessionSummary({
      id: "thread-title",
      title: "test test test",
      preview: "这是一段最后回复摘要，不应该成为历史列表标题",
      cwd: "/Users/liuyongzhe/Documents/Codex/2026-05-12/code-mobile-20260512-133019-test-test-test",
      createdAt: 1778415573,
      updatedAt: 1778423484,
      status: { type: "notLoaded" }
    });

    expect(session).toMatchObject({
      id: "thread-title",
      title: "test test test",
      projectPath: null,
      projectName: null,
      lastMessagePreview: ""
    });
  });

  it("uses the generated mobile workspace title when Codex list has not produced a desktop title yet", () => {
    const session = mapCodexThreadToSessionSummary({
      id: "thread-mobile-workspace",
      preview: "这是一段最后回复摘要，不应该成为历史列表标题",
      cwd: "/Users/liuyongzhe/Documents/Codex/2026-05-12/code-mobile-20260512-133019-test-test-test",
      createdAt: 1778415573,
      updatedAt: 1778423484,
      status: { type: "notLoaded" }
    });

    expect(session).toMatchObject({
      id: "thread-mobile-workspace",
      title: "test test test",
      projectPath: null,
      projectName: null,
      lastMessagePreview: ""
    });
  });

  it("keeps Codex generated conversation workspaces out of project history", () => {
    const session = mapCodexThreadToSessionSummary({
      id: "thread-conversation",
      preview: "创建语音生成技能",
      cwd: "/Users/liuyongzhe/Documents/Codex/2026-05-09/skill-creator-users-liuyongzhe-codex-skills",
      createdAt: 1778415573,
      updatedAt: 1778423484,
      status: { type: "notLoaded" },
      name: "创建语音生成技能"
    });

    expect(session).toMatchObject({
      id: "thread-conversation",
      title: "创建语音生成技能",
      projectPath: null,
      projectName: null
    });
  });

  it("maps Codex thread detail turns to V1 messages", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-1",
              preview: "解释项目结构",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778423484,
              status: { type: "notLoaded" },
              name: "项目说明",
              turns: [
                {
                  id: "turn-1",
                  startedAt: 1780125891,
                  completedAt: 1780125907,
                  items: [
                    { id: "user-1", type: "userMessage", text: "解释项目结构" },
                    { id: "assistant-1", type: "message", role: "assistant", content: [{ type: "output_text", text: "这是一个 HarmonyOS 项目。" }] }
                  ]
                }
              ]
            }
          };
        }
        return {};
      },
      respond: () => undefined
    });

    const detail = await manager.readSessionDetail("thread-1");

    expect(detail.session.title).toBe("项目说明");
    expect(calls[0]).toEqual({ method: "thread/resume", params: { threadId: "thread-1" } });
    expect(calls[1]).toEqual({ method: "thread/read", params: { threadId: "thread-1", includeTurns: true } });
    expect(detail.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
      { role: "assistant", text: "这是一个 HarmonyOS 项目。" }
    ]);
    expect(detail.messages[0].createdAt).toBe("2026-05-30T07:24:51.000Z");
    expect(detail.turns[0].items.map((item) => item.kind)).toEqual(["userMessage", "agentMessage"]);
  });

  it("resumes Codex threads before reading detail so pending approvals replay", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const metadata = new Map<string, CodexThreadMetadata>([
      ["thread-approval", {
        title: "审批测试",
        firstUserMessage: "需要审批",
        cwd: "/tmp/approval-workspace",
        rolloutPath: "/Users/me/.codex/sessions/rollout-thread-approval.jsonl"
      }]
    ]);
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-approval",
              cwd: "/tmp/approval-workspace",
              createdAt: 1778415573,
              updatedAt: 1778423484,
              status: { type: "running" },
              turns: []
            }
          };
        }
        return {};
      },
      respond: () => undefined
    }, {
      readThreadMetadata: () => metadata
    });

    await manager.readSessionDetail("thread-approval");

    expect(calls[0]).toEqual({
      method: "thread/resume",
      params: {
        threadId: "thread-approval",
        cwd: "/tmp/approval-workspace",
        path: "/Users/me/.codex/sessions/rollout-thread-approval.jsonl"
      }
    });
    expect(calls[1]).toEqual({
      method: "thread/read",
      params: { threadId: "thread-approval", includeTurns: true }
    });
  });

  it("includes recorded pending approvals in detail snapshots", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-approval",
              title: "审批测试",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778423484,
              status: { type: "active" },
              turns: []
            }
          };
        }
        return {};
      },
      respond: () => undefined
    });

    manager.recordApprovalRequest({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-approval",
        turnId: "turn-1",
        command: "rm -rf /tmp/mobile-approval-card"
      }
    });

    const detail = await manager.readSessionDetail("thread-approval");

    expect(detail.approval).toMatchObject({
      id: "approval-1",
      title: "是否允许 Codex 运行命令？",
      body: "$ rm -rf /tmp/mobile-approval-card"
    });
  });

  it("includes recorded pending approvals in list summaries", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/list") {
          return {
            data: [{
              id: "thread-approval",
              title: "审批测试",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778423484,
              status: { type: "running" }
            }]
          };
        }
        return {};
      },
      respond: () => undefined
    });

    manager.recordApprovalRequest({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-approval",
        turnId: "turn-1",
        command: "printf mobile_pending_list"
      }
    });

    const summaries = await manager.listSessionSummaries();

    expect(summaries[0]).toMatchObject({
      id: "thread-approval",
      needsUserInput: true,
      waitsForNextDirection: false,
      statusLabel: "waiting_for_approval",
      lastMessagePreview: "是否允许 Codex 运行命令？"
    });
  });

  it("recovers pending exec approval requests from Codex jsonl function calls", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-05-23T10:08:24.837Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-approval" }
      }),
      JSON.stringify({
        timestamp: "2026-05-23T10:08:39.749Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-approval",
          arguments: JSON.stringify({
            cmd: "rm -rf /tmp/mobile-approval-probe",
            sandbox_permissions: "require_escalated",
            justification: "Need approval for destructive command"
          })
        }
      })
    ].join("\n");

    const request = readCodexJsonlPendingApproval(jsonl, "thread-approval");

    expect(request).toMatchObject({
      id: "call-approval",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-approval",
        turnId: "turn-approval",
        itemId: "call-approval",
        command: "rm -rf /tmp/mobile-approval-probe",
        reason: "Need approval for destructive command"
      }
    });
  });

  it("does not recover exec approval requests after Codex jsonl has a matching function output", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-05-23T10:08:24.837Z",
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-approval" }
      }),
      JSON.stringify({
        timestamp: "2026-05-23T10:08:39.749Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-approval",
          arguments: JSON.stringify({
            cmd: "rm -rf /tmp/mobile-approval-probe",
            sandbox_permissions: "require_escalated"
          })
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-23T10:08:40.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-approval", output: "aborted by user" }
      })
    ].join("\n");

    expect(readCodexJsonlPendingApproval(jsonl, "thread-approval")).toBeNull();
  });

  it("uses thread turns list when thread read returns a stale partial turn set", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-1",
              preview: "解释项目结构",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778423484,
              status: { type: "notLoaded" },
              name: "项目说明",
              turns: [
                {
                  id: "turn-1",
                  items: [
                    { id: "user-1", type: "userMessage", text: "第一轮" },
                    { id: "assistant-1", type: "message", role: "assistant", content: [{ type: "output_text", text: "第一轮回复" }] }
                  ]
                }
              ]
            }
          };
        }
        if (method === "thread/turns/list") {
          return {
            turns: [
              {
                id: "turn-1",
                items: [
                  { id: "user-1", type: "userMessage", text: "第一轮" },
                  { id: "assistant-1", type: "message", role: "assistant", content: [{ type: "output_text", text: "第一轮回复" }] }
                ]
              },
              {
                id: "turn-2",
                items: [
                  { id: "user-2", type: "userMessage", text: "第二轮" },
                  { id: "assistant-2", type: "message", role: "assistant", content: [{ type: "output_text", text: "第二轮回复" }] }
                ]
              }
            ]
          };
        }
        return {};
      },
      respond: () => undefined
    });

    const detail = await manager.readSessionDetail("thread-1");

    expect(calls.map((call) => call.method)).toEqual(["thread/resume", "thread/read", "thread/turns/list"]);
    expect(detail.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
      { role: "assistant", text: "第一轮回复" },
      { role: "assistant", text: "第二轮回复" }
    ]);
    expect(detail.turns.map((turn) => turn.id)).toEqual(["turn-1", "turn-2"]);
  });

  it("falls back to Codex jsonl messages when thread/read has no turns", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-1",
              preview: "继续 V1",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778423484,
              status: { type: "notLoaded" },
              path: "/codex/session.jsonl",
              turns: []
            }
          };
        }
        return {};
      },
      respond: () => undefined
    }, {
      readSessionLogMessages: () => [
        {
          id: "thread-1:log:2",
          sessionId: "thread-1",
          role: "assistant",
          text: "V1 详情输出",
          rawText: "V1 详情输出",
          createdAt: "2026-05-10T00:00:00.000Z",
          sendState: null,
          clientMessageId: null,
          canWithdraw: false
        }
      ]
    });

    const detail = await manager.readSessionDetail("thread-1");

    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0].text).toBe("V1 详情输出");
  });

  it("merges rollout assistant output into partial thread detail timelines", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-1",
              preview: "测试回复",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778415588,
              status: { type: "notLoaded" },
              path: "/codex/session.jsonl",
              turns: [
                {
                  id: "turn-1",
                  createdAt: "2026-05-14T04:21:40.000Z",
                  items: [
                    { id: "user-1", type: "message", role: "user", content: [{ type: "input_text", text: "Reply exactly" }] }
                  ]
                }
              ]
            }
          };
        }
        return {};
      },
      respond: () => undefined
    }, {
      readSessionLogMessages: () => [
        {
          id: "thread-1:log:2",
          sessionId: "thread-1",
          role: "assistant",
          text: "ui_live_ok",
          rawText: "ui_live_ok",
          createdAt: "2026-05-14T04:21:53.000Z",
          sendState: null,
          clientMessageId: null,
          canWithdraw: false
        }
      ]
    });

    const detail = await manager.readSessionDetail("thread-1");

    expect(detail.messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
      { role: "assistant", text: "ui_live_ok" }
    ]);
    expect(detail.turns[0]).toMatchObject({
      id: "turn-1",
      status: "completed",
      completedAt: "2026-05-14T04:21:53.000Z"
    });
    expect(detail.turns[0].items.map((item) => ({ kind: item.kind, text: item.text }))).toEqual([
      { kind: "agentMessage", text: "ui_live_ok" }
    ]);
  });

  it("merges rollout update_plan calls into detail timeline plans", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-1",
              preview: "继续 V2",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778415588,
              status: { type: "notLoaded" },
              path: "/codex/session.jsonl",
              turns: [
                {
                  id: "turn-1",
                  startedAt: "2026-05-17T03:19:00.000Z",
                  completedAt: "2026-05-17T03:21:00.000Z",
                  items: [
                    { id: "user-1", type: "userMessage", text: "继续推进" },
                    { id: "assistant-1", type: "agentMessage", text: "处理中" }
                  ]
                }
              ]
            }
          };
        }
        return {};
      },
      respond: () => undefined
    }, {
      readSessionLogMessages: () => [],
      readSessionLogPlanUpdates: () => [
        {
          id: "thread-1:log-plan:1",
          sessionId: "thread-1",
          createdAt: "2026-05-17T03:20:00.000Z",
          steps: [
            { id: "step-1", title: "定位计划来源", status: "completed", detail: "" },
            { id: "step-2", title: "修复计划刷新", status: "in_progress", detail: "" }
          ]
        }
      ]
    });

    const detail = await manager.readSessionDetail("thread-1");
    const planItem = detail.turns[0].items.find((item) => item.kind === "plan");

    expect(planItem?.status).toBe("completed");
    expect(planItem?.isStreaming).toBe(false);
    expect(planItem?.planSteps.map((step) => ({ title: step.title, status: step.status }))).toEqual([
      { title: "定位计划来源", status: "completed" },
      { title: "修复计划刷新", status: "in_progress" }
    ]);
  });

  it("keeps historical rollout assistant output in its own turn instead of folding it into the latest turn", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-1",
              preview: "当前回复",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778415900,
              status: { type: "notLoaded" },
              path: "/codex/session.jsonl",
              turns: [
                {
                  id: "turn-old",
                  createdAt: "2026-05-14T04:10:00.000Z",
                  items: [
                    { id: "user-old", type: "message", role: "user", content: [{ type: "input_text", text: "旧问题" }] }
                  ]
                },
                {
                  id: "turn-latest",
                  createdAt: "2026-05-14T04:20:00.000Z",
                  completedAt: "2026-05-14T04:20:20.000Z",
                  items: [
                    { id: "user-latest", type: "userMessage", text: "现在又可以连上了" },
                    { id: "assistant-latest", type: "agentMessage", text: "当前轮次回答" }
                  ]
                }
              ]
            }
          };
        }
        return {};
      },
      respond: () => undefined
    }, {
      readSessionLogMessages: () => [
        {
          id: "thread-1:log:old-answer",
          sessionId: "thread-1",
          role: "assistant",
          text: "旧轮次移动端显示优化方案",
          rawText: "旧轮次移动端显示优化方案",
          createdAt: "2026-05-14T04:10:30.000Z",
          sendState: null,
          clientMessageId: null,
          canWithdraw: false
        }
      ]
    });

    const detail = await manager.readSessionDetail("thread-1");

    expect(detail.turns.find((turn) => turn.id === "turn-old")?.items.map((item) => item.text)).toEqual([
      "旧轮次移动端显示优化方案"
    ]);
    expect(detail.turns.find((turn) => turn.id === "turn-latest")?.items.map((item) => item.text)).toEqual([
      "现在又可以连上了",
      "当前轮次回答"
    ]);
  });

  it("does not infer a completed time for interrupted turns without Codex completion timing", async () => {
    const manager = createCodexSessionManager({
      request: async (method) => {
        if (method === "thread/read") {
          return {
            thread: {
              id: "thread-1",
              preview: "中断轮次",
              cwd: "/repo/code",
              createdAt: 1778415573,
              updatedAt: 1778415588,
              status: { type: "notLoaded" },
              path: "/codex/session.jsonl",
              turns: [
                {
                  id: "turn-1",
                  status: "interrupted",
                  startedAt: 1778415573,
                  completedAt: null,
                  items: [
                    { id: "user-1", type: "userMessage", text: "继续" },
                    { id: "assistant-1", type: "agentMessage", text: "部分输出" }
                  ]
                }
              ]
            }
          };
        }
        return {};
      },
      respond: () => undefined
    }, {
      readSessionLogMessages: () => [
        {
          id: "thread-1:log:2",
          sessionId: "thread-1",
          role: "assistant",
          text: "日志里的后续输出",
          rawText: "日志里的后续输出",
          createdAt: "2026-05-10T12:20:03.000Z",
          sendState: null,
          clientMessageId: null,
          canWithdraw: false
        }
      ]
    });

    const detail = await manager.readSessionDetail("thread-1");

    expect(detail.turns[0]).toMatchObject({
      id: "turn-1",
      status: "interrupted",
      completedAt: null
    });
  });

  it("parses Codex jsonl response items without exposing developer and tool noise in the main flow", () => {
    const jsonl = [
      JSON.stringify({ timestamp: "2026-05-10T00:00:00.000Z", type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "internal" }] } }),
      JSON.stringify({ timestamp: "2026-05-10T00:00:00.500Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /repo\n<INSTRUCTIONS>internal</INSTRUCTIONS>" }] } }),
      JSON.stringify({ timestamp: "2026-05-10T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# Context from my IDE setup:\n\n## Open tabs:\n- ui-design.md\n\n## My request for Codex:\n继续" }] } }),
      JSON.stringify({ timestamp: "2026-05-10T00:00:02.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "收到" }] } }),
      JSON.stringify({ timestamp: "2026-05-10T00:00:03.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "BUILD SUCCESSFUL" } })
    ].join("\n");

    const messages = readCodexJsonlMessages(jsonl, "thread-1");

    expect(messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
      { role: "assistant", text: "收到" }
    ]);
  });

  it("parses Codex jsonl update_plan calls as plan updates", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-05-17T03:20:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "update_plan",
          arguments: JSON.stringify({
            plan: [
              { step: "定位计划来源", status: "completed" },
              { step: "修复计划刷新", status: "in_progress" }
            ]
          })
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-17T03:20:01.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: "{}"
        }
      })
    ].join("\n");

    const updates = readCodexJsonlPlanUpdates(jsonl, "thread-1");

    expect(updates).toHaveLength(1);
    expect(updates[0].steps.map((step) => ({ title: step.title, status: step.status }))).toEqual([
      { title: "定位计划来源", status: "completed" },
      { title: "修复计划刷新", status: "in_progress" }
    ]);
  });

  it("does not expose Codex environment context as a user message", () => {
    const jsonl = [
      JSON.stringify({ timestamp: "2026-05-14T01:06:14.412Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <current_date>2026-05-14</current_date>\n  <timezone>Asia/Shanghai</timezone>\n</environment_context>" }] } }),
      JSON.stringify({ timestamp: "2026-05-14T01:06:14.413Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "test" }] } }),
      JSON.stringify({ timestamp: "2026-05-14T01:06:26.085Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }], phase: "final_answer" } })
    ].join("\n");

    const messages = readCodexJsonlMessages(jsonl, "thread-1");

    expect(messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
      { role: "assistant", text: "ok" }
    ]);
  });

  it("does not expose Codex turn-aborted control messages as user messages", () => {
    const jsonl = [
      JSON.stringify({ timestamp: "2026-05-14T01:06:14.412Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<turn_aborted>interrupted by user</turn_aborted>" }] } }),
      JSON.stringify({ timestamp: "2026-05-14T01:06:14.413Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "继续" }] } }),
      JSON.stringify({ timestamp: "2026-05-14T01:06:26.085Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }], phase: "final_answer" } })
    ].join("\n");

    const messages = readCodexJsonlMessages(jsonl, "thread-1");

    expect(messages.map((message) => ({ role: message.role, text: message.text }))).toEqual([
      { role: "assistant", text: "ok" }
    ]);
  });

  it("uses turn/steer for active turns and turn/interrupt for interruption", async () => {
    const calls: string[] = [];
    const manager = createCodexSessionManager({
      request: async (method) => {
        calls.push(method);
        return {};
      },
      respond: () => undefined
    });

    await manager.steerTurn({ threadId: "thread-1", turnId: "turn-1", text: "改用保守方案" });
    await manager.interruptTurn({ threadId: "thread-1", turnId: "turn-1" });

    expect(calls).toEqual(["turn/steer", "turn/interrupt"]);
  });

  it("passes empty turn id through for startup interruption", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        return {};
      },
      respond: () => undefined
    });

    await manager.interruptTurn({ threadId: "thread-startup", turnId: "" });

    expect(calls).toEqual([
      {
        method: "turn/interrupt",
        params: {
          threadId: "thread-startup",
          turnId: ""
        }
      }
    ]);
  });

  it("passes structured input items to turn/steer", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params = {}) => {
        calls.push({ method, params });
        return {};
      },
      respond: () => undefined
    });

    await manager.steerTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      inputItems: [
        { type: "text", text: "补看这张图", text_elements: [] },
        { type: "localImage", path: "/tmp/pixel.png" },
        { type: "mention", name: "notes.md", path: "/tmp/notes.md" }
      ]
    });

    expect(calls).toEqual([
      {
        method: "turn/steer",
        params: {
          threadId: "thread-1",
          expectedTurnId: "turn-1",
          input: [
            { type: "text", text: "补看这张图", text_elements: [] },
            { type: "localImage", path: "/tmp/pixel.png" },
            { type: "mention", name: "notes.md", path: "/tmp/notes.md" }
          ]
        }
      }
    ]);
  });

  it("resumes historical threads before retrying turn/start when Codex reports thread not found", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let startAttempts = 0;
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "turn/start") {
          startAttempts++;
          if (startAttempts === 1) throw new Error("thread not found: thread-1");
          return { turnId: "turn-2", status: "running" };
        }
        if (method === "thread/resume") return { threadId: "thread-1" };
        return {};
      },
      respond: () => undefined
    });

    const started = await manager.startTurn({ threadId: "thread-1", text: "继续" });

    expect(started).toEqual({ turnId: "turn-2", status: "running" });
    expect(calls.map((call) => call.method)).toEqual(["thread/resume", "turn/start", "thread/resume", "turn/start"]);
    expect(calls[0]).toEqual({ method: "thread/resume", params: { threadId: "thread-1" } });
    expect(calls[2]).toEqual({ method: "thread/resume", params: { threadId: "thread-1" } });
  });

  it("keeps turn/start compatibility retry when the preflight resume reports thread not found", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    let resumeAttempts = 0;
    let startAttempts = 0;
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ method, params: params ?? {} });
        if (method === "thread/resume") {
          resumeAttempts++;
          if (resumeAttempts === 1) throw new Error("thread not found: thread-1");
          return { threadId: "thread-1" };
        }
        if (method === "turn/start") {
          startAttempts++;
          if (startAttempts === 1) throw new Error("thread not found: thread-1");
          return { turnId: "turn-2", status: "running" };
        }
        return {};
      },
      respond: () => undefined
    });

    const started = await manager.startTurn({ threadId: "thread-1", text: "继续" });

    expect(started).toEqual({ turnId: "turn-2", status: "running" });
    expect(calls.map((call) => call.method)).toEqual(["thread/resume", "turn/start", "thread/resume", "turn/start"]);
  });

  it("keeps native Codex approval actions", () => {
    const approval = normalizeCodexApproval({
      id: "approval-1",
      title: "命令审批",
      body: "pnpm test",
      actions: [{ id: "approve", label: "Approve" }]
    });

    expect(approval.actions).toEqual([{ id: "approve", label: "Approve" }]);
    expect(approval.createdAt).toContain("T");
  });

  it("maps recorded native approval responses before replying to Codex", async () => {
    const responses: unknown[] = [];
    const manager = createCodexSessionManager({
      request: async () => ({}),
      respond: (_id, result) => {
        responses.push(result);
      }
    });

    manager.recordApprovalRequest({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", command: "pnpm test" }
    });
    await manager.respondToApproval("approval-1", "approve");

    expect(responses).toEqual([{ decision: "accept" }]);
  });

  it("maps every mobile approval action to the native Codex response shape", async () => {
    const responses: unknown[] = [];
    const manager = createCodexSessionManager({
      request: async () => ({}),
      respond: (_id, result) => {
        responses.push(result);
      }
    });

    manager.recordApprovalRequest({
      id: "command-session",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", command: "pnpm test" }
    });
    await manager.respondToApproval("command-session", "acceptForSession");

    manager.recordApprovalRequest({
      id: "command-prefix",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        command: "pnpm test",
        proposedExecpolicyAmendment: ["pnpm", "test"]
      }
    });
    await manager.respondToApproval("command-prefix", "acceptWithExecpolicyAmendment");

    manager.recordApprovalRequest({
      id: "command-network",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        command: "curl https://example.com",
        proposedNetworkPolicyAmendments: [{ host: "example.com", action: "allow" }]
      }
    });
    await manager.respondToApproval("command-network", "applyNetworkPolicyAmendment");

    manager.recordApprovalRequest({
      id: "file-cancel",
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1", message: "edit README.md" }
    });
    await manager.respondToApproval("file-cancel", "cancel");

    manager.recordApprovalRequest({
      id: "permission-turn",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        permissions: { network: { enabled: true } }
      }
    });
    await manager.respondToApproval("permission-turn", "grantForTurn");

    manager.recordApprovalRequest({
      id: "permission-strict",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        permissions: { network: { enabled: true } }
      }
    });
    await manager.respondToApproval("permission-strict", "grantForTurnWithStrictAutoReview");

    manager.recordApprovalRequest({
      id: "permission-session",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        permissions: { fileSystem: { read: ["/tmp/readme.txt"] } }
      }
    });
    await manager.respondToApproval("permission-session", "grantForSession");

    manager.recordApprovalRequest({
      id: "permission-decline",
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        permissions: { network: { enabled: true } }
      }
    });
    await manager.respondToApproval("permission-decline", "decline");

    manager.recordApprovalRequest({
      id: "input-submit",
      method: "item/tool/requestUserInput",
      params: { threadId: "thread-1" }
    });
    await manager.respondToApproval("input-submit", "submit", {
      target: { answers: ["README.md"] }
    });

    manager.recordApprovalRequest({
      id: "input-cancel",
      method: "item/tool/requestUserInput",
      params: { threadId: "thread-1" }
    });
    await manager.respondToApproval("input-cancel", "cancel");

    manager.recordApprovalRequest({
      id: "mcp-accept",
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread-1",
        serverName: "filesystem",
        requestedSchema: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
            note: { type: "string" }
          },
          required: ["confirmed"]
        }
      }
    });
    await manager.respondToApproval("mcp-accept", "accept", {
      confirmed: { answers: ["True"] },
      note: { answers: ["继续"] }
    });

    manager.recordApprovalRequest({
      id: "mcp-decline",
      method: "mcpServer/elicitation/request",
      params: { threadId: "thread-1", serverName: "filesystem" }
    });
    await manager.respondToApproval("mcp-decline", "decline");

    manager.recordApprovalRequest({
      id: "mcp-cancel",
      method: "mcpServer/elicitation/request",
      params: { threadId: "thread-1", serverName: "filesystem" }
    });
    await manager.respondToApproval("mcp-cancel", "cancel");

    expect(responses).toEqual([
      { decision: "acceptForSession" },
      { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["pnpm", "test"] } } },
      { decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "example.com", action: "allow" } } } },
      { decision: "cancel" },
      { permissions: { network: { enabled: true } }, scope: "turn" },
      { permissions: { network: { enabled: true } }, scope: "turn", strictAutoReview: true },
      {
        permissions: {
          fileSystem: {
            read: null,
            write: null,
            entries: [{ path: { type: "path", path: "/tmp/readme.txt" }, access: "read" }]
          }
        },
        scope: "session"
      },
      { permissions: {}, scope: "turn" },
      { answers: { target: { answers: ["README.md"] } } },
      { answers: {} },
      { action: "accept", content: { confirmed: true, note: "继续" }, _meta: null },
      { action: "decline", content: null, _meta: null },
      { action: "cancel", content: null, _meta: null }
    ]);
  });

  it("responds to command approval decline and steers the provided adjustment into the active turn", async () => {
    const calls: Array<{ kind: string; id?: string; result?: unknown; method?: string; params?: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ kind: "request", method, params: params ?? {} });
        return {};
      },
      respond: (id, result) => {
        calls.push({ kind: "respond", id, result });
      }
    });

    manager.recordApprovalRequest({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turn: { id: "turn-1" }, command: "pnpm test" }
    });
    await manager.respondToApproval("approval-1", "decline", {
      reason: { answers: ["先跑定向测试，不要跑全量测试"] }
    });

    expect(calls).toEqual([
      { kind: "respond", id: "approval-1", result: { decision: "decline" } },
      {
        kind: "request",
        method: "turn/steer",
        params: {
          threadId: "thread-1",
          expectedTurnId: "turn-1",
          input: [{ type: "text", text: "先跑定向测试，不要跑全量测试", text_elements: [] }]
        }
      }
    ]);
  });

  it("responds to cancel approval reasons and steers adjustments into their active turns", async () => {
    const calls: Array<{ kind: string; id?: string; result?: unknown; method?: string; params?: Record<string, unknown> }> = [];
    const manager = createCodexSessionManager({
      request: async (method, params) => {
        calls.push({ kind: "request", method, params: params ?? {} });
        return {};
      },
      respond: (id, result) => {
        calls.push({ kind: "respond", id, result });
      }
    });

    manager.recordApprovalRequest({
      id: "command-approval",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turn: { id: "turn-1" }, command: "pnpm test" }
    });
    await manager.respondToApproval("command-approval", "cancel", {
      reason: { answers: ["改成只运行定向测试"] }
    });

    manager.recordApprovalRequest({
      id: "file-approval",
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-2", message: "edit README.md" }
    });
    await manager.respondToApproval("file-approval", "cancel", {
      reason: { answers: ["先给出补丁摘要，不要直接写文件"] }
    });

    expect(calls).toEqual([
      { kind: "respond", id: "command-approval", result: { decision: "cancel" } },
      {
        kind: "request",
        method: "turn/steer",
        params: {
          threadId: "thread-1",
          expectedTurnId: "turn-1",
          input: [{ type: "text", text: "改成只运行定向测试", text_elements: [] }]
        }
      },
      { kind: "respond", id: "file-approval", result: { decision: "cancel" } },
      {
        kind: "request",
        method: "turn/steer",
        params: {
          threadId: "thread-1",
          expectedTurnId: "turn-2",
          input: [{ type: "text", text: "先给出补丁摘要，不要直接写文件", text_elements: [] }]
        }
      }
    ]);
  });

  it("responds to decline even when a local reason is present but the request has no thread id", async () => {
    const responses: unknown[] = [];
    const manager = createCodexSessionManager({
      request: async () => ({}),
      respond: (_id, result) => {
        responses.push(result);
      }
    });

    manager.recordApprovalRequest({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { command: "pnpm test" }
    });

    await manager.respondToApproval("approval-1", "decline", {
      reason: { answers: ["请改成只读方案"] }
    });
    expect(responses).toEqual([{ decision: "decline" }]);
  });
});
