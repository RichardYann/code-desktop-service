import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sessionDetailFromDesktopConversationState } from "../codex/codexDesktopStateMapper.js";

describe("codex desktop state mapper", () => {
  it("maps desktop conversation state snapshots into mobile session detail", () => {
    const detail = sessionDetailFromDesktopConversationState({
      id: "thread-desktop",
      title: "Desktop thread",
      createdAt: 1778600000000,
      updatedAt: 1778600012000,
      cwd: "/Users/me/project",
      threadRuntimeStatus: { type: "active" },
      turns: [{
        turnId: "turn-1",
        turnStartedAtMs: 1778600000000,
        status: "inProgress",
        items: [
          { type: "userMessage", id: "user-1", content: [{ type: "text", text: "请检查流式同步", text_elements: [] }] },
          { type: "reasoning", id: "reasoning-1", status: "running", summary: ["正在检查 IPC"], content: [] },
          { type: "agentMessage", id: "assistant-1", status: "running", text: "我正在检查", phase: "final_answer" }
        ]
      }]
    });

    expect(detail.session).toEqual(expect.objectContaining({
      id: "thread-desktop",
      title: "Desktop thread",
      projectPath: "/Users/me/project",
      projectName: "project",
      createdAt: "2026-05-12T15:33:20.000Z",
      updatedAt: "2026-05-12T15:33:32.000Z",
      statusLabel: "active",
      lastMessagePreview: ""
    }));
    expect(detail.messages).toEqual([
      expect.objectContaining({
        id: "assistant-1",
        role: "assistant",
        text: "我正在检查",
        sendState: null
      })
    ]);
    expect(detail.turns).toEqual([
      expect.objectContaining({
        id: "turn-1",
        sessionId: "thread-desktop",
        status: "running",
        startedAt: "2026-05-12T15:33:20.000Z",
        items: [
          expect.objectContaining({ id: "user-1", kind: "userMessage" }),
          expect.objectContaining({ id: "reasoning-1", kind: "reasoning", isCollapsedByDefault: true }),
          expect.objectContaining({ id: "assistant-1", kind: "agentMessage", text: "我正在检查" })
        ]
      })
    ]);
  });

  it("does not promote desktop message text into a missing conversation title", () => {
    const detail = sessionDetailFromDesktopConversationState({
      id: "thread-no-title",
      createdAt: 1778600000000,
      updatedAt: 1778600012000,
      cwd: "/Users/me/project",
      threadRuntimeStatus: { type: "idle" },
      turns: [{
        turnId: "turn-1",
        turnStartedAtMs: 1778600000000,
        status: "completed",
        items: [
          { type: "userMessage", id: "user-1", content: [{ type: "text", text: "这是一段用户消息摘要", text_elements: [] }] }
        ]
      }]
    });

    expect(detail.session.title).toBe("Codex 会话");
    expect(detail.session.lastMessagePreview).toBe("");
    expect(detail.messages).toEqual([]);
  });

  it("filters desktop internal user context out of snapshot messages", () => {
    const detail = sessionDetailFromDesktopConversationState({
      id: "thread-internal-context",
      title: "Desktop thread",
      createdAt: 1778600000000,
      updatedAt: 1778600012000,
      cwd: "/Users/me/project",
      threadRuntimeStatus: { type: "idle" },
      turns: [{
        turnId: "turn-1",
        turnStartedAtMs: 1778600000000,
        status: "completed",
        items: [
          {
            type: "userMessage",
            id: "environment-context",
            content: [{ type: "text", text: "<environment_context>\n  <current_date>2026-05-14</current_date>\n</environment_context>", text_elements: [] }]
          },
          {
            type: "userMessage",
            id: "turn-aborted",
            content: [{ type: "text", text: "<turn_aborted>interrupted by user</turn_aborted>", text_elements: [] }]
          },
          {
            type: "userMessage",
            id: "user-1",
            content: [{ type: "text", text: "继续", text_elements: [] }]
          }
        ]
      }]
    });

    expect(detail.messages).toEqual([]);
    expect(detail.turns[0].items.map((item) => ({ id: item.id, text: item.text }))).toEqual([
      { id: "user-1", text: "继续" }
    ]);
  });

  it("treats mobile-generated Codex workspaces as projectless in desktop snapshots", () => {
    const workspacePath = path.join(os.homedir(), "Documents", "Codex", "2026-05-12", "code-mobile-20260512-133019-test-test-test");
    const detail = sessionDetailFromDesktopConversationState({
      id: "thread-mobile-workspace",
      title: "test test test",
      createdAt: 1778600000000,
      updatedAt: 1778600012000,
      cwd: workspacePath,
      threadRuntimeStatus: { type: "idle" },
      turns: []
    });

    expect(detail.session.projectPath).toBeNull();
    expect(detail.session.projectName).toBeNull();
  });
});
