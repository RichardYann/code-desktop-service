import { describe, expect, it } from "vitest";
import { CodexTimelineRuntime, type TimelineRuntimeEvent } from "../codex/codexTimelineRuntime.js";
import type { TimelineItemKind } from "../codex/codexTimelineMapper.js";

function isTimelineItemEvent(event: TimelineRuntimeEvent, kind: TimelineItemKind): event is Extract<TimelineRuntimeEvent, { item: unknown }> {
  return (event.type === "timeline.item.started" || event.type === "timeline.item.updated" || event.type === "timeline.item.completed") && event.item.kind === kind;
}

describe("codex timeline runtime", () => {
  it("preserves mobile client ids on live user items", () => {
    const runtime = new CodexTimelineRuntime();
    const started = runtime.applyNotification("item/started", {
      threadId: "thread-client-id",
      turnId: "turn-client-id",
      item: {
        id: "server-user-started",
        type: "userMessage",
        clientId: "client-started-1",
        content: [{ type: "text", text: "开始" }]
      }
    });
    const startedUser = started.find((event) => event.type === "timeline.item.started" && isTimelineItemEvent(event, "userMessage"));
    expect(startedUser?.item.clientMessageId).toBe("client-started-1");

    const completedOnlyRuntime = new CodexTimelineRuntime();
    const completed = completedOnlyRuntime.applyNotification("item/completed", {
      threadId: "thread-client-id",
      turnId: "turn-client-id",
      item: {
        id: "server-user-completed",
        type: "userMessage",
        clientUserMessageId: "client-completed-1",
        content: [{ type: "text", text: "完成" }]
      }
    });
    const completedUser = completed.find((event) => event.type === "timeline.item.completed" && isTimelineItemEvent(event, "userMessage"));
    expect(completedUser?.item.clientMessageId).toBe("client-completed-1");
  });

  it("inherits turn-level client ids for live user items when item payload omits them", () => {
    const runtime = new CodexTimelineRuntime();
    runtime.applyNotification("turn/started", {
      threadId: "thread-client-id",
      turn: {
        id: "turn-client-id",
        status: "inProgress",
        clientUserMessageId: "client-turn-level-1"
      }
    });

    const started = runtime.applyNotification("item/started", {
      threadId: "thread-client-id",
      turnId: "turn-client-id",
      item: {
        id: "server-user-started",
        type: "userMessage",
        content: [{ type: "text", text: "开始" }]
      }
    });

    const startedUser = started.find((event) => event.type === "timeline.item.started" && isTimelineItemEvent(event, "userMessage"));
    expect(startedUser?.item.clientMessageId).toBe("client-turn-level-1");
  });

  it("aggregates live Codex notifications into rich timeline events", () => {
    const runtime = new CodexTimelineRuntime();
    const events = [
      ...runtime.applyNotification("turn/started", {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "inProgress" }
      }),
      ...runtime.applyNotification("item/started", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "assistant-1", type: "agentMessage" }
      }),
      ...runtime.applyNotification("item/agentMessage/delta", {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "你好"
      }),
      ...runtime.applyNotification("item/agentMessage/delta", {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "assistant-1",
        delta: "，世界"
      }),
      ...runtime.applyNotification("turn/plan/updated", {
        threadId: "thread-1",
        turnId: "turn-1",
        plan: [{ id: "p1", title: "检查协议", status: "completed", detail: "" }]
      }),
      ...runtime.applyNotification("item/started", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "cmd-1", type: "commandExecution", command: "pnpm test", status: "running" }
      }),
      ...runtime.applyNotification("item/commandExecution/outputDelta", {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "cmd-1",
        delta: "2 tests passed"
      }),
      ...runtime.applyNotification("item/completed", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "cmd-1", type: "commandExecution", command: "pnpm test", status: "completed", exitCode: 0 }
      }),
      ...runtime.applyNotification("turn/completed", {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "completed" }
      })
    ];

    const agentEvents = events.filter((event) => event.type === "timeline.item.updated" && isTimelineItemEvent(event, "agentMessage"));
    expect(agentEvents[agentEvents.length - 1].item.text).toBe("你好，世界");

    const planEvent = events.find((event) => event.type === "timeline.item.updated" && isTimelineItemEvent(event, "plan"));
    expect(planEvent?.item.planSteps).toEqual([{ id: "p1", title: "检查协议", status: "completed", detail: "" }]);

    const commandEvents = events.filter((event) => event.type === "timeline.item.updated" && isTimelineItemEvent(event, "commandExecution"));
    expect(commandEvents[commandEvents.length - 1].item.command?.rawOutput).toContain("2 tests passed");

    expect(events).toContainEqual({
      type: "turn.updated",
      turn: expect.objectContaining({
        id: "turn-1",
        sessionId: "thread-1",
        status: "completed"
      })
    });
  });

  it("normalizes live plan status aliases and preserves steps across sparse completion payloads", () => {
    const runtime = new CodexTimelineRuntime();
    const updated = runtime.applyNotification("turn/plan/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      plan: [
        { id: "p1", title: "修复审批", status: "done", detail: "" },
        { id: "p2", title: "复测模拟器", status: "inProgress", detail: "" }
      ]
    });
    const completed = runtime.applyNotification("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { id: "turn-1:plan", type: "plan", status: "completed" }
    });

    const updatedPlan = updated.find((event) => event.type === "timeline.item.updated" && isTimelineItemEvent(event, "plan"));
    expect(updatedPlan?.item.planSteps.map((step) => step.status)).toEqual(["completed", "in_progress"]);

    const completedPlan = completed.find((event) => event.type === "timeline.item.completed" && isTimelineItemEvent(event, "plan"));
    expect(completedPlan?.item.planSteps).toEqual(updatedPlan?.item.planSteps);
  });

  it("clears live plan steps when Codex sends an empty plan update", () => {
    const runtime = new CodexTimelineRuntime();
    runtime.applyNotification("turn/plan/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      plan: [
        { id: "p1", title: "将右侧月历改成设备信息栏", status: "pending", detail: "" },
        { id: "p2", title: "压缩底部文字区并更新文案策略", status: "pending", detail: "" }
      ]
    });

    const cleared = runtime.applyNotification("turn/plan/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      plan: []
    });

    const clearedPlan = cleared.find((event) => event.type === "timeline.item.updated" && isTimelineItemEvent(event, "plan"));
    expect(clearedPlan?.item.planSteps).toEqual([]);
  });

  it("clears approval by request id when Codex resolves the server request", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("item/commandExecution/requestApproval", "approval-1", {
      threadId: "thread-1",
      title: "命令审批",
      command: "pnpm test"
    });
    const resolvedEvents = runtime.resolveServerRequest("approval-1");

    expect(approvalEvents).toEqual([{
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        id: "approval-1",
        kind: "command",
        method: "item/commandExecution/requestApproval",
        subject: "pnpm test",
        body: "$ pnpm test"
      })
    }]);
    expect(resolvedEvents).toEqual([{ type: "approval.updated", sessionId: "thread-1", approval: null }]);
  });

  it("maps approval requests that use snake case session and turn ids", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("item/commandExecution/requestApproval", "approval-snake", {
      thread_id: "thread-snake",
      turn_id: "turn-snake",
      command: "date"
    });
    const resolvedEvents = runtime.resolveServerRequest("approval-snake");

    expect(approvalEvents).toEqual([{
      type: "approval.updated",
      sessionId: "thread-snake",
      approval: expect.objectContaining({
        id: "approval-snake",
        kind: "command",
        method: "item/commandExecution/requestApproval",
        subject: "date"
      })
    }]);
    expect(resolvedEvents).toEqual([{ type: "approval.updated", sessionId: "thread-snake", approval: null }]);
  });

  it("maps legacy exec command approvals using conversation id", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("execCommandApproval", "legacy-exec-approval", {
      conversationId: "thread-legacy",
      callId: "call-1",
      command: ["touch", "/tmp/probe"],
      cwd: "/tmp",
      reason: "requires escalated permissions"
    });
    const resolvedEvents = runtime.resolveServerRequest("legacy-exec-approval");

    expect(approvalEvents).toEqual([{
      type: "approval.updated",
      sessionId: "thread-legacy",
      approval: expect.objectContaining({
        id: "legacy-exec-approval",
        kind: "command",
        method: "execCommandApproval",
        subject: "touch /tmp/probe",
        title: "命令审批",
        body: "touch /tmp/probe",
        actions: [
          { id: "accept", label: "同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "acceptForSession", label: "本会话中同意此类操作", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不执行，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    }]);
    expect(resolvedEvents).toEqual([{ type: "approval.updated", sessionId: "thread-legacy", approval: null }]);
  });

  it("maps legacy apply patch approvals", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("applyPatchApproval", "legacy-patch-approval", {
      conversationId: "thread-legacy",
      callId: "call-2",
      reason: "write access required",
      grantRoot: "/repo",
      fileChanges: {
        "/repo/README.md": { type: "modify" }
      }
    });

    expect(approvalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-legacy",
      approval: expect.objectContaining({
        kind: "file_change",
        method: "applyPatchApproval",
        subject: "write access required",
        title: "文件变更审批",
        body: "write access required\n\n/repo\n\n/repo/README.md",
        actions: [
          { id: "accept", label: "同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "acceptForSession", label: "本会话同意这些文件的修改", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不修改，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("uses official default actions for command file and permissions approvals", () => {
    const runtime = new CodexTimelineRuntime();
    const commandApprovalEvents = runtime.applyServerRequest("item/commandExecution/requestApproval", "command-approval", {
      threadId: "thread-1",
      command: "pnpm test"
    });
    const fileApprovalEvents = runtime.applyServerRequest("item/fileChange/requestApproval", "file-approval", {
      threadId: "thread-1",
      message: "修改 README.md"
    });
    const permissionsApprovalEvents = runtime.applyServerRequest("item/permissions/requestApproval", "permissions-approval", {
      threadId: "thread-1",
      message: "允许访问 api.example.com"
    });

    expect(commandApprovalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        kind: "command",
        method: "item/commandExecution/requestApproval",
        subject: "pnpm test",
        actions: [
          { id: "accept", label: "同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "acceptForSession", label: "本会话中同意此类操作", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不执行，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
    expect(fileApprovalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        kind: "file_change",
        method: "item/fileChange/requestApproval",
        subject: "修改 README.md",
        actions: [
          { id: "accept", label: "同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "acceptForSession", label: "本会话同意这些文件的修改", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不修改，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
    expect(permissionsApprovalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        kind: "permission",
        method: "item/permissions/requestApproval",
        subject: "允许访问 api.example.com",
        actions: [
          { id: "grantForTurn", label: "本轮授权这些权限", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "grantForTurnWithStrictAutoReview", label: "本轮授权并严格自动审查", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "grantForSession", label: "本会话授权这些权限", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不授权，继续", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("marks exec and network policy amendments as requiring second confirmation", () => {
    const runtime = new CodexTimelineRuntime();
    const execPolicyEvents = runtime.applyServerRequest("item/commandExecution/requestApproval", "exec-policy-approval", {
      threadId: "thread-1",
      command: "pnpm test",
      proposedExecpolicyAmendment: ["pnpm", "test"],
      availableDecisions: [
        "accept",
        { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["pnpm", "test"] } },
        "decline"
      ]
    });
    const networkPolicyEvents = runtime.applyServerRequest("item/commandExecution/requestApproval", "network-policy-approval", {
      threadId: "thread-1",
      command: "curl https://api.example.com",
      networkApprovalContext: {
        host: "api.example.com"
      },
      proposedNetworkPolicyAmendments: [
        { action: "allow", host: "api.example.com" }
      ]
    });

    expect(execPolicyEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        actions: [
          { id: "accept", label: "同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "acceptWithExecpolicyAmendment", label: "以后同意同类命令", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不执行，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
    expect(networkPolicyEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        actions: [
          { id: "accept", label: "本次同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "acceptForSession", label: "本会话允许此主机", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "applyNetworkPolicyAmendment", label: "以后允许此主机", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不执行，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("does not require second confirmation for turn-scoped actions unless explicitly requested", () => {
    const runtime = new CodexTimelineRuntime();
    const defaultEvents = runtime.applyServerRequest("item/permissions/requestApproval", "permissions-default", {
      threadId: "thread-1",
      message: "允许读取 /tmp"
    });
    const explicitEvents = runtime.applyServerRequest("item/permissions/requestApproval", "permissions-explicit", {
      threadId: "thread-1",
      message: "允许读取 /tmp",
      actions: [
        { id: "grantForTurn", label: "本轮授权这些权限", requiresSecondConfirm: true },
        { id: "grantForTurnWithStrictAutoReview", label: "本轮授权并严格自动审查" },
        { id: "decline", label: "拒绝" }
      ]
    });

    expect(defaultEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        actions: [
          { id: "grantForTurn", label: "本轮授权这些权限", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "grantForTurnWithStrictAutoReview", label: "本轮授权并严格自动审查", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "grantForSession", label: "本会话授权这些权限", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不授权，继续", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
    expect(explicitEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        actions: [
          { id: "grantForTurn", label: "本轮授权这些权限", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "grantForTurnWithStrictAutoReview", label: "本轮授权并严格自动审查", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "decline", label: "不授权，继续", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("normalizes native Codex approval actions into desktop-style choices", () => {
    const runtime = new CodexTimelineRuntime();
    const commandApprovalEvents = runtime.applyServerRequest("item/commandExecution/requestApproval", "command-approval", {
      threadId: "thread-1",
      command: "curl https://127.0.0.1",
      actions: [
        { id: "approve", label: "允许" },
        { id: "reject", label: "拒绝" },
        { id: "cancel", label: "取消" }
      ]
    });

    expect(commandApprovalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        actions: [
          { id: "approve", label: "同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "reject", label: "不执行，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "cancel", label: "取消并告知 Codex 调整", style: undefined, decisionType: "cancel", requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("uses official available decisions when command approvals provide them", () => {
    const runtime = new CodexTimelineRuntime();
    const commandApprovalEvents = runtime.applyServerRequest("item/commandExecution/requestApproval", "command-approval", {
      threadId: "thread-1",
      command: "pnpm test",
      proposedExecpolicyAmendment: ["pnpm", "test"],
      availableDecisions: [
        "accept",
        { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["pnpm", "test"] } },
        "decline"
      ]
    });

    expect(commandApprovalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        actions: [
          { id: "accept", label: "同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "acceptWithExecpolicyAmendment", label: "以后同意同类命令", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不执行，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("includes command approval context in the approval body", () => {
    const runtime = new CodexTimelineRuntime();
    const commandApprovalEvents = runtime.applyServerRequest("item/commandExecution/requestApproval", "command-approval", {
      threadId: "thread-1",
      command: "pnpm test",
      cwd: "/repo/code",
      reason: "requires escalated permissions"
    });

    expect(commandApprovalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        title: "是否允许 Codex 运行命令？",
        body: "原因: requires escalated permissions\n\n工作目录: /repo/code\n\n$ pnpm test",
        actions: [
          { id: "accept", label: "同意", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "acceptForSession", label: "本会话中同意此类操作", style: undefined, decisionType: undefined, requiresSecondConfirm: true },
          { id: "decline", label: "不执行，继续对话", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("marks user input requests as answer submit approvals", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("item/tool/requestUserInput", "input-1", {
      threadId: "thread-1",
      title: "需要补充信息",
      prompt: "请输入目标文件",
      fields: [
        {
          id: "target",
          label: "目标文件",
          type: "text",
          defaultValue: "README.md"
        }
      ]
    });

    expect(approvalEvents).toEqual([{
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        kind: "user_input",
        method: "item/tool/requestUserInput",
        subject: "请输入目标文件",
        id: "input-1",
        title: "需要补充信息",
        body: "请输入目标文件",
        inputFields: [
          {
            id: "target",
            label: "目标文件",
            type: "text",
            defaultValue: "README.md",
            options: [],
            isSecret: false
          }
        ],
        actions: [
          { id: "submit", label: "提交", style: undefined, decisionType: "user-input-submit", requiresSecondConfirm: undefined },
          { id: "cancel", label: "取消", style: undefined, decisionType: "cancel", requiresSecondConfirm: undefined }
        ]
      })
    }]);
  });

  it("maps official request_user_input questions into answer fields", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("item/tool/requestUserInput", "input-1", {
      threadId: "thread-1",
      questions: [
        {
          id: "target",
          header: "目标文件",
          question: "请输入目标文件",
          isOther: false,
          isSecret: false,
          options: [
            { label: "README.md", description: "项目说明" },
            { label: "AGENTS.md", description: "代理规则" }
          ]
        }
      ]
    });

    expect(approvalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        body: "请输入目标文件",
        inputFields: [
          {
            id: "target",
            label: "目标文件",
            type: "single-select",
            defaultValue: "",
            options: ["README.md", "AGENTS.md"],
            isSecret: false
          }
        ]
      })
    });
  });

  it("maps official MCP form elicitations into answer fields and elicitation actions", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("mcpServer/elicitation/request", "mcp-1", {
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "filesystem",
      mode: "form",
      message: "请选择目标",
      requestedSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            title: "目标",
            oneOf: [
              { const: "README.md", title: "README.md" },
              { const: "AGENTS.md", title: "AGENTS.md" }
            ],
            default: "README.md"
          }
        },
        required: ["target"]
      }
    });

    expect(approvalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        kind: "mcp_elicitation",
        method: "mcpServer/elicitation/request",
        subject: "请选择目标",
        title: "filesystem 需要确认",
        body: "请选择目标",
        inputFields: [
          {
            id: "target",
            label: "目标",
            type: "single-select",
            defaultValue: "README.md",
            options: ["README.md", "AGENTS.md"],
            isSecret: false
          }
        ],
        actions: [
          { id: "accept", label: "提供请求的信息", style: undefined, decisionType: "user-input-submit", requiresSecondConfirm: undefined },
          { id: "decline", label: "不提供，但继续", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "cancel", label: "取消请求", style: undefined, decisionType: "cancel", requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("maps message-only MCP elicitations to desktop-like decisions without answer fields", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("mcpServer/elicitation/request", "mcp-simple", {
      threadId: "thread-1",
      turnId: "turn-1",
      serverName: "filesystem",
      message: "filesystem MCP 需要确认。"
    });

    expect(approvalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        kind: "mcp_elicitation",
        method: "mcpServer/elicitation/request",
        subject: "filesystem MCP 需要确认。",
        title: "filesystem 需要确认",
        body: "filesystem MCP 需要确认。",
        inputFields: undefined,
        actions: [
          { id: "accept", label: "提供请求的信息", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "decline", label: "不提供，但继续", style: undefined, decisionType: undefined, requiresSecondConfirm: undefined },
          { id: "cancel", label: "取消请求", style: undefined, decisionType: "cancel", requiresSecondConfirm: undefined }
        ]
      })
    });
  });

  it("uses user-facing MCP metadata for title and body instead of raw schema", () => {
    const runtime = new CodexTimelineRuntime();
    const describedEvents = runtime.applyServerRequest("mcpServer/elicitation/request", "mcp-described", {
      threadId: "thread-1",
      serverName: "filesystem",
      toolName: "write_file",
      description: "需要写入目标路径",
      requestedSchema: {
        type: "object",
        properties: {
          path: { type: "string", title: "目标路径" }
        }
      }
    });
    const fieldOnlyEvents = runtime.applyServerRequest("mcpServer/elicitation/request", "mcp-field-only", {
      threadId: "thread-1",
      serverName: "filesystem",
      toolName: "write_file",
      requestedSchema: {
        type: "object",
        properties: {
          path: { type: "string", title: "目标路径" },
          overwrite: { type: "boolean", description: "是否覆盖" }
        }
      }
    });

    expect(describedEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        title: "filesystem / write_file 需要确认",
        subject: "需要写入目标路径",
        body: "需要写入目标路径"
      })
    });
    expect(fieldOnlyEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        title: "filesystem / write_file 需要确认",
        subject: "目标路径\n是否覆盖",
        body: "目标路径\n是否覆盖"
      })
    });
  });

  it("maps MCP boolean and optional schema fields into mobile input controls", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("mcpServer/elicitation/request", "mcp-boolean", {
      threadId: "thread-1",
      serverName: "guardian",
      mode: "form",
      message: "确认风险处理方式",
      requestedSchema: {
        type: "object",
        properties: {
          confirmed: {
            type: "boolean",
            title: "确认",
            description: "是否允许继续",
            default: true
          },
          note: {
            type: "string",
            title: "备注",
            description: "可选说明"
          }
        },
        required: ["confirmed"]
      }
    });

    expect(approvalEvents[0]).toEqual({
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        kind: "mcp_elicitation",
        inputFields: [
          {
            id: "confirmed",
            label: "确认",
            type: "single-select",
            defaultValue: "True",
            options: ["True", "False"],
            isSecret: false
          },
          {
            id: "note",
            label: "备注",
            type: "text",
            defaultValue: "",
            options: [],
            isSecret: false,
            isRequired: false
          }
        ]
      })
    });
  });

  it("uses the default answer field when user input requests have no field metadata", () => {
    const runtime = new CodexTimelineRuntime();
    const approvalEvents = runtime.applyServerRequest("item/tool/requestUserInput", "input-1", {
      threadId: "thread-1",
      id: "request-object-id",
      prompt: "请输入原因"
    });

    expect(approvalEvents).toEqual([{
      type: "approval.updated",
      sessionId: "thread-1",
      approval: expect.objectContaining({
        id: "input-1",
        inputFields: [
          {
            id: "answer",
            label: "请输入原因",
            type: "text",
            defaultValue: "",
            options: [],
            isSecret: false
          }
        ]
      })
    }]);
  });

  it("preserves live tool progress labels instead of generic tool call rows", () => {
    const runtime = new CodexTimelineRuntime();
    const started = runtime.applyNotification("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      startedAtMs: Date.parse("2026-05-12T00:00:00.000Z"),
      item: {
        id: "tool-1",
        type: "mcpToolCall",
        server: "computer-use",
        tool: "get_app_state",
        status: "inProgress",
        arguments: { app: "Visual Studio Code" },
        result: null,
        error: null,
        durationMs: null
      }
    });
    const progress = runtime.applyNotification("item/mcpToolCall/progress", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "tool-1",
      message: "已查看 Visual Studio Code"
    });

    expect(started[0]).toEqual({
      type: "timeline.item.started",
      item: expect.objectContaining({
        kind: "toolProgress",
        title: "Computer Use",
        text: "已查看 Visual Studio Code"
      })
    });
    expect(progress[0]).toEqual({
      type: "timeline.item.updated",
      item: expect.objectContaining({
        kind: "toolProgress",
        title: "Computer Use",
        text: "已查看 Visual Studio Code"
      })
    });
  });

  it("updates file change diff from patch notifications", () => {
    const runtime = new CodexTimelineRuntime();
    const events = runtime.applyNotification("item/fileChange/patchUpdated", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "file-1",
      changes: [
        { path: "app/code/src/main/ets/components/TurnBlockView.ets", kind: "update", diff: "+ok" },
        { path: "mac-service/src/codex/codexTimelineRuntime.ts", kind: "update", diff: "+ok" }
      ]
    });

    expect(events[0]).toEqual({
      type: "timeline.item.updated",
      item: expect.objectContaining({
        id: "file-1",
        kind: "fileChange",
        title: "文件修改",
        diff: expect.objectContaining({
          filesChanged: 2
        })
      })
    });
    const event = events[0];
    expect(event.type).toBe("timeline.item.updated");
    if (event.type !== "timeline.item.updated") throw new Error("expected timeline item update");
    const item = event.item;
    expect(item.diff?.files[0].patch).toBe("+ok");
  });

  it("keeps per-file patches from unified diff notifications", () => {
    const runtime = new CodexTimelineRuntime();
    const diff = [
      "diff --git a/src/alpha.ts b/src/alpha.ts",
      "index 111..222 100644",
      "--- a/src/alpha.ts",
      "+++ b/src/alpha.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/src/beta.ts b/src/beta.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/beta.ts",
      "@@ -0,0 +1 @@",
      "+beta"
    ].join("\n");

    const events = runtime.applyNotification("turn/diff/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      diff
    });

    const event = events[0];
    expect(event.type).toBe("timeline.item.updated");
    if (event.type !== "timeline.item.updated") throw new Error("expected timeline item update");
    const item = event.item;
    expect(item.diff?.files).toHaveLength(2);
    expect(item.diff?.files[0].patch).toContain("diff --git a/src/alpha.ts b/src/alpha.ts");
    expect(item.diff?.files[0].patch).toContain("-old");
    expect(item.diff?.files[1].patch).toContain("new file mode 100644");
  });

  it("uses unified diff counts when file summaries disagree with patch text", () => {
    const runtime = new CodexTimelineRuntime();
    const diff = [
      "diff --git a/app/code/src/main/ets/components/SessionListView.ets b/app/code/src/main/ets/components/SessionListView.ets",
      "index 111..222 100644",
      "--- a/app/code/src/main/ets/components/SessionListView.ets",
      "+++ b/app/code/src/main/ets/components/SessionListView.ets",
      ...Array.from({ length: 145 }, (_, index) => `+session add ${index}`),
      ...Array.from({ length: 36 }, (_, index) => `-session remove ${index}`),
      "diff --git a/app/code/src/main/ets/pages/Index.ets b/app/code/src/main/ets/pages/Index.ets",
      "index 333..444 100644",
      "--- a/app/code/src/main/ets/pages/Index.ets",
      "+++ b/app/code/src/main/ets/pages/Index.ets",
      ...Array.from({ length: 70 }, (_, index) => `+index add ${index}`),
      ...Array.from({ length: 44 }, (_, index) => `-index remove ${index}`)
    ].join("\n");

    const events = runtime.applyNotification("turn/diff/updated", {
      threadId: "thread-1",
      turnId: "turn-1",
      diff,
      files: [
        {
          path: "app/code/src/main/ets/components/SessionListView.ets",
          status: "modified",
          insertions: 80,
          deletions: 44
        },
        {
          path: "app/code/src/main/ets/pages/Index.ets",
          status: "modified",
          insertions: 70,
          deletions: 0
        }
      ]
    });

    const event = events[0];
    expect(event.type).toBe("timeline.item.updated");
    if (event.type !== "timeline.item.updated") throw new Error("expected timeline item update");
    expect(event.item.diff?.filesChanged).toBe(2);
    expect(event.item.diff?.insertions).toBe(215);
    expect(event.item.diff?.deletions).toBe(80);
    expect(event.item.diff?.files[0].insertions).toBe(145);
    expect(event.item.diff?.files[1].deletions).toBe(44);
  });

  it("streams plan and reasoning text deltas like the Codex VSCode client", () => {
    const runtime = new CodexTimelineRuntime();

    const planEvents = [
      ...runtime.applyNotification("item/started", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "plan-1", type: "plan", status: "inProgress" }
      }),
      ...runtime.applyNotification("item/plan/delta", {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "plan-1",
        delta: "1. 读取实现\n"
      }),
      ...runtime.applyNotification("item/plan/delta", {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "plan-1",
        delta: "2. 补齐流式事件"
      })
    ];

    const reasoningEvents = [
      ...runtime.applyNotification("item/started", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "reason-1", type: "reasoning", status: "inProgress" }
      }),
      ...runtime.applyNotification("item/reasoning/textDelta", {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "reason-1",
        contentIndex: 0,
        delta: "正在检查 VSCode 的折叠事件"
      })
    ];

    const lastPlan = planEvents.filter((event) => event.type === "timeline.item.updated" && isTimelineItemEvent(event, "plan")).at(-1);
    expect(lastPlan?.item.text).toBe("1. 读取实现\n2. 补齐流式事件");

    const lastReasoning = reasoningEvents.filter((event) => event.type === "timeline.item.updated" && isTimelineItemEvent(event, "reasoningSummary")).at(-1);
    expect(lastReasoning?.item.text).toBe("正在检查 VSCode 的折叠事件");
    expect(lastReasoning?.item.isCollapsedByDefault).toBe(true);
  });

  it("uses completed agent message payload when no final delta arrives", () => {
    const runtime = new CodexTimelineRuntime();

    const events = runtime.applyNotification("item/completed", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: {
        id: "assistant-1",
        type: "agentMessage",
        status: "completed",
        text: "最终摘要只在完成事件里出现"
      }
    });

    expect(events[0]).toEqual({
      type: "timeline.item.completed",
      item: expect.objectContaining({
        kind: "agentMessage",
        status: "completed",
        text: "最终摘要只在完成事件里出现",
        isStreaming: false
      })
    });
  });

  it("keeps official imageGeneration started and completed events on one timeline owner", () => {
    const runtime = new CodexTimelineRuntime();
    runtime.applyNotification("item/started", {
      threadId: "thread-image",
      turnId: "turn-image",
      item: {
        id: "imagegen-call-1",
        type: "imageGeneration",
        status: "inProgress",
        prompt: "画一只可爱的耶耶"
      }
    });

    const completed = runtime.applyNotification("item/completed", {
      threadId: "thread-image",
      turnId: "turn-image",
      item: {
        id: "imagegen-call-1",
        type: "imageGeneration",
        status: "completed",
        revisedPrompt: "一只可爱的萨摩耶幼犬",
        assetIds: ["asset-image-1"],
        savedPath: "/tmp/yeye.png"
      }
    });

    const event = completed[0];
    expect(event.type).toBe("timeline.item.completed");
    if (event.type !== "timeline.item.completed") throw new Error("expected completed timeline item");
    expect(event.item).toEqual(expect.objectContaining({
      id: "imagegen-call-1",
      kind: "imageGeneration",
      status: "completed",
      title: "imagegen",
      text: "一只可爱的萨摩耶幼犬",
      assetIds: ["asset-image-1"],
      isStreaming: false
    }));
  });

  it("preserves official turn itemsView and agent message phase in live runtime events", () => {
    const runtime = new CodexTimelineRuntime();
    const events = [
      ...runtime.applyNotification("turn/started", {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "inProgress", itemsView: "full", durationMs: 42 }
      }),
      ...runtime.applyNotification("item/started", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "assistant-1", type: "agentMessage", phase: "commentary" }
      }),
      ...runtime.applyNotification("item/completed", {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: "assistant-1", type: "agentMessage", status: "completed", text: "过程说明", phase: "commentary" }
      })
    ];

    const turnEvent = events.find((event) => event.type === "turn.updated");
    expect(turnEvent).toEqual(expect.objectContaining({
      turn: expect.objectContaining({ itemsView: "full", durationMs: 42 })
    }));
    const agentEvent = events.find((event) => event.type === "timeline.item.completed" && isTimelineItemEvent(event, "agentMessage"));
    expect(agentEvent).toEqual(expect.objectContaining({
      item: expect.objectContaining({ phase: "commentary", text: "过程说明" })
    }));
  });

  it("maps live Codex runtime errors into visible failed timeline items", () => {
    const runtime = new CodexTimelineRuntime();

    const events = runtime.applyNotification("error", {
      threadId: "thread-1",
      turnId: "turn-1",
      message: "exceeded retry limit, last status: 429 Too Many Requests"
    });

    expect(events).toEqual([{
      type: "timeline.item.completed",
      item: expect.objectContaining({
        id: "turn-1:error",
        sessionId: "thread-1",
        turnId: "turn-1",
        kind: "error",
        status: "failed",
        title: "错误",
        text: "exceeded retry limit, last status: 429 Too Many Requests",
        isStreaming: false
      })
    }]);
  });

  it("parses terminal interaction stdin into meaningful command rows", () => {
    const runtime = new CodexTimelineRuntime();
    runtime.applyNotification("item/started", {
      threadId: "thread-1",
      turnId: "turn-1",
      item: { id: "cmd-1", type: "commandExecution", command: "bash", status: "running" }
    });

    const events = runtime.applyNotification("item/commandExecution/terminalInteraction", {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "cmd-1",
      stdin: "git status --short\n"
    });

    expect(events[0]).toEqual({
      type: "timeline.item.updated",
      item: expect.objectContaining({
        kind: "commandExecution",
        title: "git status --short",
        text: "git status --short",
        command: expect.objectContaining({
          title: "git status --short",
          command: "git status --short"
        })
      })
    });
  });

  it("honors turn started and completed timestamps from Codex notifications", () => {
    const runtime = new CodexTimelineRuntime();

    runtime.applyNotification("turn/started", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "inProgress",
        startedAtMs: Date.parse("2026-05-12T00:00:00.000Z")
      }
    });
    const events = runtime.applyNotification("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        completedAtMs: Date.parse("2026-05-12T00:00:07.000Z")
      }
    });

    expect(events[0]).toEqual({
      type: "turn.updated",
      turn: expect.objectContaining({
        startedAt: "2026-05-12T00:00:00.000Z",
        completedAt: "2026-05-12T00:00:07.000Z"
      })
    });
  });

  it("treats numeric Codex turn timestamps as unix seconds when needed", () => {
    const runtime = new CodexTimelineRuntime();

    runtime.applyNotification("turn/started", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "inProgress",
        startedAtMs: 1778589697
      }
    });
    const events = runtime.applyNotification("turn/completed", {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "completed",
        completedAtMs: 1778589714
      }
    });

    expect(events[0]).toEqual({
      type: "turn.updated",
      turn: expect.objectContaining({
        startedAt: "2026-05-12T12:41:37.000Z",
        completedAt: "2026-05-12T12:41:54.000Z"
      })
    });
  });
});
