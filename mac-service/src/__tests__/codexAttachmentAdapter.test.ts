import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodexAttachmentAdapter } from "../domain/codexAttachmentAdapter.js";

describe("CodexAttachmentAdapter", () => {
  it("extracts bounded text assets into guided input when file attachment is unsupported", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "code-attachment-adapter-"));
    const filePath = path.join(tmpDir, "notes.md");
    await writeFile(filePath, "# Notes\n\nhello from attachment");
    const adapter = new CodexAttachmentAdapter({
      capability: { fileReferenceInput: false, legacyTextSnippetInput: true, imageInput: false }
    });

    const result = await adapter.buildInput({
      text: "总结这个文件",
      assets: [{
        id: "asset-1",
        kind: "text",
        fileName: "notes.md",
        mimeType: "text/markdown",
        absolutePath: filePath,
        sizeBytes: 128
      }]
    });

    expect(result.text).toContain("总结这个文件");
    expect(result.text).toContain("notes.md");
    expect(result.text).toContain("hello from attachment");
    expect(result.attachments[0].codexInputStatus).toBe("sent");
  });

  it("marks images unsupported when Codex image input is unavailable", async () => {
    const adapter = new CodexAttachmentAdapter({
      capability: { fileReferenceInput: false, legacyTextSnippetInput: true, imageInput: false }
    });
    const result = await adapter.buildInput({
      text: "看图",
      assets: [{
        id: "asset-1",
        kind: "image",
        fileName: "screen.png",
        mimeType: "image/png",
        absolutePath: "/tmp/screen.png",
        sizeBytes: 128
      }]
    });

    expect(result.attachments[0].codexInputStatus).toBe("unsupported");
    expect(result.attachments[0].codexInputMessage).toContain("当前 Codex 通道不支持图片输入");
  });
});
