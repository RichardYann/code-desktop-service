import { describe, expect, it } from "vitest";
import { diffOverviewFromFileChanges, mapCodexThreadToTimeline } from "../codex/codexTimelineMapper.js";

describe("codex timeline mapper", () => {
  it("does not treat Markdown bullets in added file content as deletions", () => {
    const diff = [
      "# 移动端变更审查 patch 丢失调试报告",
      "",
      "- 移动端点击最终结论下方的变更入口",
      "- 页面显示暂无完整变更记录"
    ].join("\n");
    const overview = diffOverviewFromFileChanges([
      { path: "docs/implementation/mobile-diff-review-patch-debug-report.md", kind: "add", diff }
    ]);

    expect(overview).toMatchObject({
      filesChanged: 1,
      insertions: 4,
      deletions: 0
    });
    expect(overview?.files[0]).toMatchObject({
      status: "added",
      insertions: 4,
      deletions: 0,
      patch: diff
    });
  });

  it("treats non-unified modified file content as inserted snapshot text", () => {
    const diff = [
      "# 调试记录",
      "",
      "- 这是一条 Markdown 项目符号"
    ].join("\n");
    const overview = diffOverviewFromFileChanges([
      { path: "docs/implementation/report.md", kind: "update", diff }
    ]);

    expect(overview?.files[0]).toMatchObject({
      status: "modified",
      insertions: 3,
      deletions: 0,
      patch: diff
    });
  });

  it("maps Codex turns and items into mobile timeline turns", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          status: "completed",
          itemsView: "full",
          createdAt: 1778415573,
          completedAt: 1778415588,
          durationMs: 15000,
          items: [
            { id: "user-1", type: "userMessage", text: "实现 timeline" },
            { id: "reasoning-1", type: "reasoning", summary: "检查协议和现有会话组件" },
            { id: "assistant-1", type: "agentMessage", text: "我会先映射 turn 和 item。", phase: "final_answer" },
            {
              id: "cmd-1",
              type: "commandExecution",
              command: "pnpm test",
              status: "completed",
              exitCode: 0,
              output: "2 tests passed"
            },
            {
              id: "file-1",
              type: "fileChange",
              files: [
                { path: "mac-service/src/codex/codexTimelineMapper.ts", status: "added", insertions: 120, deletions: 0 }
              ],
              patch: "diff --git a/codexTimelineMapper.ts b/codexTimelineMapper.ts"
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: "turn-1",
      sessionId: "thread-1",
      status: "completed",
      itemsView: "full",
      startedAt: "2026-05-10T12:19:33.000Z",
      completedAt: "2026-05-10T12:19:48.000Z",
      durationMs: 15000
    });
    expect(turns[0].items.map((item) => item.kind)).toEqual([
      "userMessage",
      "reasoning",
      "agentMessage",
      "commandExecution",
      "fileChange"
    ]);
    expect(turns[0].items[2]).toMatchObject({ text: "我会先映射 turn 和 item。", phase: "final_answer" });
    expect(turns[0].items[3].command).toMatchObject({
      status: "completed",
      rawOutput: "2 tests passed",
      exitCode: 0
    });
    expect(turns[0].items[4].diff).toMatchObject({
      filesChanged: 1,
      insertions: 120,
      deletions: 0
    });
    expect(turns[0].items[4].diff?.files[0].patch).toBe("diff --git a/codexTimelineMapper.ts b/codexTimelineMapper.ts");
  });

  it("preserves canonical user client ids for mobile pending-message ownership", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-client-id",
          status: "completed",
          createdAt: 1778415573,
          completedAt: 1778415588,
          items: [
            { id: "server-user-1", type: "userMessage", clientId: "client-message-1", content: [{ type: "text", text: "继续" }] }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items[0]).toMatchObject({
      id: "server-user-1",
      kind: "userMessage",
      text: "继续",
      clientMessageId: "client-message-1"
    });
  });

  it("maps canonical imageGeneration items as the image owner with asset ids", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-image",
          status: "completed",
          createdAt: 1778415573,
          completedAt: 1778415588,
          items: [
            { id: "user-image", type: "userMessage", text: "画一只可爱的耶耶" },
            {
              id: "imagegen-call-1",
              type: "imageGeneration",
              status: "completed",
              revisedPrompt: "一只可爱的萨摩耶幼犬",
              assetIds: ["asset-image-1"]
            }
          ]
        }
      ]
    }, "thread-image");

    expect(turns[0].items[1]).toMatchObject({
      id: "imagegen-call-1",
      kind: "imageGeneration",
      status: "completed",
      title: "imagegen",
      text: "一只可爱的萨摩耶幼犬",
      assetIds: ["asset-image-1"]
    });
  });

  it("inherits turn-level client user ids for canonical user items", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-client-id",
          status: "completed",
          clientUserMessageId: "client-message-turn-level",
          createdAt: 1778415573,
          completedAt: 1778415588,
          items: [
            { id: "server-user-1", type: "userMessage", content: [{ type: "text", text: "继续" }] }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items[0]).toMatchObject({
      id: "server-user-1",
      kind: "userMessage",
      text: "继续",
      clientMessageId: "client-message-turn-level"
    });
  });

  it("surfaces Codex error item messages as failed timeline errors", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-error",
          status: "failed",
          createdAt: 1778415573,
          completedAt: 1778415599,
          items: [
            {
              id: "error-1",
              type: "error",
              message: "exceeded retry limit, last status: 429 Too Many Requests"
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].status).toBe("failed");
    expect(turns[0].items[0]).toMatchObject({
      id: "error-1",
      kind: "error",
      status: "failed",
      title: "错误",
      text: "exceeded retry limit, last status: 429 Too Many Requests"
    });
  });

  it("creates a visible error item when a failed turn stores the error on the turn", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-error",
          status: "failed",
          createdAt: 1778415573,
          completedAt: 1778415599,
          error: { message: "Codex App Server disconnected while running the turn" },
          items: [
            { id: "user-1", type: "userMessage", text: "继续" }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items.map((item) => item.kind)).toEqual(["userMessage", "error"]);
    expect(turns[0].items[1]).toMatchObject({
      id: "turn-error:error",
      kind: "error",
      status: "failed",
      title: "错误",
      text: "Codex App Server disconnected while running the turn"
    });
  });

  it("normalizes historical plan status aliases", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          status: "completed",
          createdAt: 1778415573,
          items: [
            {
              id: "plan-1",
              type: "plan",
              steps: [
                { id: "p1", title: "完成实现", status: "done" },
                { id: "p2", title: "继续验证", status: "running" }
              ]
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items[0].planSteps.map((step) => step.status)).toEqual(["completed", "in_progress"]);
  });

  it("keeps IDE context out of user timeline bubbles", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          status: "completed",
          createdAt: 1778415573,
          items: [
            {
              id: "user-1",
              type: "message",
              role: "user",
              content: [{
                type: "input_text",
                text: "# Context from my IDE setup:\n\n## Open tabs:\n- plan.md\n\n## My request for Codex:\n只显示这一句"
              }]
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items[0]).toMatchObject({
      kind: "userMessage",
      text: "只显示这一句"
    });
    expect(turns[0].items[0].rawText).toContain("# Context from my IDE setup:");
  });

  it("filters Codex environment context out of user timeline bubbles", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          status: "completed",
          createdAt: 1778415573,
          items: [
            {
              id: "context-1",
              type: "message",
              role: "user",
              content: [{
                type: "input_text",
                text: "<environment_context>\n  <current_date>2026-05-14</current_date>\n  <timezone>Asia/Shanghai</timezone>\n</environment_context>"
              }]
            },
            {
              id: "user-1",
              type: "userMessage",
              text: "test"
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items.map((item) => ({ kind: item.kind, text: item.text }))).toEqual([
      { kind: "userMessage", text: "test" }
    ]);
  });

  it("filters Codex turn-aborted control messages out of user timeline bubbles", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          status: "completed",
          createdAt: 1778415573,
          items: [
            {
              id: "aborted-1",
              type: "message",
              role: "user",
              content: [{
                type: "input_text",
                text: "<turn_aborted>interrupted by user</turn_aborted>"
              }]
            },
            {
              id: "user-1",
              type: "userMessage",
              text: "继续"
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items.map((item) => ({ kind: item.kind, text: item.text }))).toEqual([
      { kind: "userMessage", text: "继续" }
    ]);
  });

  it("does not render plain raw response role=user as a normal user bubble", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          status: "completed",
          createdAt: 1778415573,
          items: [
            {
              id: "raw-user-1",
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "plain raw role user text" }]
            },
            {
              id: "assistant-1",
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "legacy assistant fallback" }]
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items.map((item) => ({ kind: item.kind, text: item.text }))).toEqual([
      { kind: "agentMessage", text: "legacy assistant fallback" }
    ]);
  });

  it("treats historical turns with assistant output as completed when status is absent", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          createdAt: 1778415573,
          items: [
            { id: "user-1", type: "userMessage", text: "打包安装" },
            { id: "assistant-1", type: "agentMessage", text: "开始构建" },
            { id: "assistant-2", type: "agentMessage", text: "构建完成" }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].status).toBe("completed");
  });

  it("keeps the latest active snapshot turn running when Codex omits turn status", () => {
    const turns = mapCodexThreadToTimeline({
      status: { type: "active", activeFlags: [] },
      turns: [
        {
          id: "turn-old",
          createdAt: 1778415500,
          completedAt: 1778415510,
          items: [
            { id: "user-old", type: "userMessage", text: "上一轮" },
            { id: "assistant-old", type: "agentMessage", text: "上一轮完成" }
          ]
        },
        {
          id: "turn-live",
          createdAt: 1778415573,
          completedAt: null,
          items: [
            { id: "user-live", type: "userMessage", text: "继续" },
            { id: "assistant-live", type: "agentMessage", text: "正在输出部分内容" }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].status).toBe("completed");
    expect(turns[1]).toMatchObject({
      id: "turn-live",
      status: "running",
      completedAt: null
    });
  });

  it("settles stale running turns when the thread is already idle", () => {
    const turns = mapCodexThreadToTimeline({
      status: { type: "idle" },
      turns: [
        {
          id: "turn-stale-running",
          status: "running",
          createdAt: 1778415573,
          completedAt: null,
          items: [
            { id: "user-stale", type: "userMessage", text: "Office attachment payload smoke. Reply ok." }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0]).toMatchObject({
      id: "turn-stale-running",
      status: "idle"
    });
  });

  it("keeps the latest active snapshot turn running even when Codex reports an interim completion time", () => {
    const turns = mapCodexThreadToTimeline({
      status: { type: "active", activeFlags: [] },
      turns: [
        {
          id: "turn-live",
          createdAt: 1778415573,
          completedAt: 1778415588,
          items: [
            { id: "user-live", type: "userMessage", text: "继续" },
            { id: "assistant-live", type: "agentMessage", text: "先处理到这里，继续推进。" },
            { id: "cmd-live", type: "commandExecution", command: "pnpm test", status: "completed", output: "passed" }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0]).toMatchObject({
      id: "turn-live",
      status: "running",
      completedAt: "2026-05-10T12:19:48.000Z"
    });
  });

  it("maps v2 tool calls to meaningful mobile process labels", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          status: "completed",
          createdAt: 1778415573,
          items: [
            {
              id: "tool-1",
              type: "mcpToolCall",
              server: "computer-use",
              tool: "get_app_state",
              status: "completed",
              arguments: { app: "Visual Studio Code" },
              result: null,
              error: null,
              durationMs: 1200
            },
            {
              id: "tool-2",
              type: "mcpToolCall",
              server: "computer-use",
              tool: "list_apps",
              status: "completed",
              arguments: {},
              result: null,
              error: null,
              durationMs: 800
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items[0]).toMatchObject({
      kind: "mcpToolCall",
      title: "Computer Use",
      text: "已查看 Visual Studio Code"
    });
    expect(turns[0].items[1]).toMatchObject({
      kind: "mcpToolCall",
      title: "Computer Use",
      text: "列出 Mac 应用"
    });
  });

  it("maps v2 file changes and command output fields", () => {
    const turns = mapCodexThreadToTimeline({
      turns: [
        {
          id: "turn-1",
          status: "completed",
          createdAt: 1778415573,
          items: [
            {
              id: "cmd-1",
              type: "commandExecution",
              command: "screencapture -x app/local-vscode-reference.png",
              cwd: "/repo",
              processId: null,
              source: "user",
              status: "completed",
              commandActions: [],
              aggregatedOutput: "saved",
              exitCode: 0,
              durationMs: 42
            },
            {
              id: "file-1",
              type: "fileChange",
              status: "applied",
              changes: [
                { path: "app/code/src/main/ets/components/TurnBlockView.ets", kind: "update", diff: "+ok" },
                { path: "mac-service/src/codex/codexTimelineMapper.ts", kind: "update", diff: "+ok" }
              ]
            }
          ]
        }
      ]
    }, "thread-1");

    expect(turns[0].items[0].command).toMatchObject({
      command: "screencapture -x app/local-vscode-reference.png",
      rawOutput: "saved",
      exitCode: 0
    });
    expect(turns[0].items[1].diff).toMatchObject({
      filesChanged: 2
    });
    expect(turns[0].items[1].diff?.files[0].patch).toBe("+ok");
    expect(turns[0].items[1].diff?.files.map((file) => file.path)).toEqual([
      "app/code/src/main/ets/components/TurnBlockView.ets",
      "mac-service/src/codex/codexTimelineMapper.ts"
    ]);
  });
});
