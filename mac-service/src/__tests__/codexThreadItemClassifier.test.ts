import { describe, expect, it } from "vitest";
import { classifyCodexThreadItem } from "../codex/codexThreadItemClassifier.js";

describe("codex thread item classifier", () => {
  it("classifies official ThreadItem variants into canonical timeline kinds", () => {
    const samples: Array<[Record<string, unknown>, string]> = [
      [{ type: "userMessage", text: "hello" }, "userMessage"],
      [{ type: "hookPrompt", text: "hook" }, "hookPrompt"],
      [{ type: "agentMessage", text: "answer" }, "agentMessage"],
      [{ type: "reasoning", summary: "thinking" }, "reasoning"],
      [{ type: "plan", steps: [] }, "plan"],
      [{ type: "commandExecution", command: "pnpm test" }, "commandExecution"],
      [{ type: "fileChange", files: [] }, "fileChange"],
      [{ type: "mcpToolCall", server: "filesystem", tool: "read_file" }, "mcpToolCall"],
      [{ type: "dynamicToolCall", namespace: "web", tool: "search" }, "dynamicToolCall"],
      [{ type: "collabAgentToolCall", agent: "worker" }, "collabAgentToolCall"],
      [{ type: "webSearch", query: "codex" }, "webSearch"],
      [{ type: "imageView", path: "/tmp/a.png" }, "imageView"],
      [{ type: "imageGeneration", status: "completed" }, "imageGeneration"],
      [{ type: "enteredReviewMode", review: "on" }, "reviewStatus"],
      [{ type: "exitedReviewMode", review: "off" }, "reviewStatus"],
      [{ type: "contextCompaction" }, "contextCompaction"]
    ];

    expect(samples.map(([item]) => classifyCodexThreadItem(item)?.kind)).toEqual(samples.map(([, kind]) => kind));
  });

  it("rejects raw response user messages unless they are legacy IDE visible requests", () => {
    expect(classifyCodexThreadItem({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "plain raw role user text" }]
    })).toBeNull();

    expect(classifyCodexThreadItem({
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: "# Context from my IDE setup:\n\n## My request for Codex:\nlegacy visible"
      }]
    })).toMatchObject({
      kind: "userMessage",
      visibleText: "legacy visible"
    });
  });

  it("hides private mobile input guidance from official user messages", () => {
    const classified = classifyCodexThreadItem({
      type: "userMessage",
      text: [
        "<mobile-input-guidance>",
        "The mobile user selected Codex capabilities for this turn.",
        "- Selected skill for this turn: imagegen",
        "</mobile-input-guidance>",
        "",
        "按照这个设计帮我生成一张效果图"
      ].join("\n")
    });

    expect(classified).toMatchObject({
      kind: "userMessage",
      visibleText: "按照这个设计帮我生成一张效果图"
    });
    expect(classified?.visibleText).not.toContain("<mobile-input-guidance>");
    expect(classified?.visibleText).not.toContain("Selected skill");
    expect(classified?.visibleText).not.toContain("Installed skill");
  });
});
