import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodexTurnInputBuilder } from "../domain/codexTurnInputBuilder.js";

describe("CodexTurnInputBuilder", () => {
  it("builds official localImage input for image assets", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "code-image-input-"));
    const imagePath = path.join(tmpDir, "pixel.png");
    await writeFile(imagePath, Buffer.from("not-a-real-png-for-unit-test"));
    const builder = new CodexTurnInputBuilder({
      capability: { fileReferenceInput: false, legacyTextSnippetInput: true, imageInput: true }
    });

    const result = await builder.build({
      text: "请看这张图",
      assets: [{
        id: "asset-image-1",
        kind: "image",
        fileName: "pixel.png",
        mimeType: "image/png",
        absolutePath: imagePath,
        sizeBytes: 24
      }]
    });

    expect(result.items).toEqual([
      { type: "text", text: "请看这张图", text_elements: [] },
      { type: "localImage", path: imagePath }
    ]);
    expect(result.attachments).toMatchObject([{
      assetId: "asset-image-1",
      codexInputStatus: "sent"
    }]);
  });

  it("keeps images unsupported when official image input is disabled", async () => {
    const builder = new CodexTurnInputBuilder({
      capability: { fileReferenceInput: false, legacyTextSnippetInput: true, imageInput: false }
    });
    const result = await builder.build({
      text: "请看这张图",
      assets: [{
        id: "asset-image-1",
        kind: "image",
        fileName: "pixel.png",
        mimeType: "image/png",
        absolutePath: "/tmp/pixel.png",
        sizeBytes: 24
      }]
    });

    expect(result.items).toEqual([{ type: "text", text: "请看这张图", text_elements: [] }]);
    expect(result.attachments[0].codexInputStatus).toBe("unsupported");
  });

  it("builds mention input for text attachments when file reference input is enabled", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "code-file-reference-"));
    const filePath = path.join(tmpDir, "notes.md");
    await writeFile(filePath, "# Notes\n\n" + "A".repeat(70 * 1024) + "\nmarker-after-64kb");
    const builder = new CodexTurnInputBuilder({
      capability: { fileReferenceInput: true, legacyTextSnippetInput: false, imageInput: true }
    });

    const result = await builder.build({
      text: "总结附件",
      assets: [{
        id: "asset-text-1",
        kind: "text",
        fileName: "notes.md",
        mimeType: "text/markdown",
        absolutePath: filePath,
        sizeBytes: 70 * 1024 + 32
      }]
    });

    expect(result.items).toEqual([
      { type: "text", text: "总结附件", text_elements: [] },
      { type: "mention", name: "notes.md", path: filePath }
    ]);
    expect(JSON.stringify(result.items)).not.toContain("[附件文本片段:");
    expect(result.attachments).toMatchObject([{
      assetId: "asset-text-1",
      codexInputStatus: "sent",
      codexInputMessage: "已通过 Codex 文件引用通道发送"
    }]);
  });

  it("builds mention input for pdf office and document attachments", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "code-file-reference-"));
    const pdfPath = path.join(tmpDir, "report.pdf");
    const docxPath = path.join(tmpDir, "report.docx");
    const rtfPath = path.join(tmpDir, "notes.rtf");
    await writeFile(pdfPath, "fake pdf bytes");
    await writeFile(docxPath, "fake docx bytes");
    await writeFile(rtfPath, "{\\rtf1 notes}");
    const builder = new CodexTurnInputBuilder({
      capability: { fileReferenceInput: true, legacyTextSnippetInput: false, imageInput: true }
    });

    const result = await builder.build({
      text: "读取这些文件",
      assets: [
        { id: "asset-pdf", kind: "pdf", fileName: "report.pdf", mimeType: "application/pdf", absolutePath: pdfPath, sizeBytes: 14 },
        { id: "asset-office", kind: "office", fileName: "report.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", absolutePath: docxPath, sizeBytes: 15 },
        { id: "asset-document", kind: "document", fileName: "notes.rtf", mimeType: "application/rtf", absolutePath: rtfPath, sizeBytes: 13 }
      ]
    });

    expect(result.items).toEqual([
      { type: "text", text: "读取这些文件", text_elements: [] },
      { type: "mention", name: "report.pdf", path: pdfPath },
      { type: "mention", name: "report.docx", path: docxPath },
      { type: "mention", name: "notes.rtf", path: rtfPath }
    ]);
    expect(result.attachments.map((attachment) => attachment.codexInputStatus)).toEqual(["sent", "sent", "sent"]);
  });

  it("fails unreadable file references without falling back to snippets", async () => {
    const missingPath = path.join(os.tmpdir(), "missing-native-file-reference.md");
    const builder = new CodexTurnInputBuilder({
      capability: { fileReferenceInput: true, legacyTextSnippetInput: false, imageInput: true }
    });

    const result = await builder.build({
      text: "读取附件",
      assets: [{
        id: "asset-missing",
        kind: "text",
        fileName: "missing.md",
        mimeType: "text/markdown",
        absolutePath: missingPath,
        sizeBytes: 10
      }]
    });

    expect(result.items).toEqual([{ type: "text", text: "读取附件", text_elements: [] }]);
    expect(result.attachments[0].codexInputStatus).toBe("failed");
    expect(result.attachments[0].codexInputMessage).toBe("文件附件不可读取");
  });

  it("merges text attachments into the text input item only in legacy snippet mode", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "code-text-input-"));
    const filePath = path.join(tmpDir, "notes.md");
    await writeFile(filePath, "# Notes\n\nhello from attachment");
    const builder = new CodexTurnInputBuilder({
      capability: { fileReferenceInput: false, legacyTextSnippetInput: true, imageInput: true }
    });

    const result = await builder.build({
      text: "总结附件",
      assets: [{
        id: "asset-text-1",
        kind: "text",
        fileName: "notes.md",
        mimeType: "text/markdown",
        absolutePath: filePath,
        sizeBytes: 128
      }]
    });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.type).toBe("text");
    if (item.type !== "text") {
      throw new Error("expected text input item");
    }
    expect(item.text).toContain("总结附件");
    expect(item.text).toContain("[附件文本片段: notes.md]");
    expect(item.text).toContain("hello from attachment");
    expect(result.attachments[0].codexInputStatus).toBe("sent");
  });

  it("limits merged text attachments by UTF-8 bytes", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "code-text-input-"));
    const filePath = path.join(tmpDir, "multibyte.md");
    await writeFile(filePath, "你".repeat(30 * 1024));
    const builder = new CodexTurnInputBuilder({
      capability: { fileReferenceInput: false, legacyTextSnippetInput: true, imageInput: true }
    });

    const result = await builder.build({
      text: "总结附件",
      assets: [{
        id: "asset-text-1",
        kind: "text",
        fileName: "multibyte.md",
        mimeType: "text/markdown",
        absolutePath: filePath,
        sizeBytes: 90 * 1024
      }]
    });

    const item = result.items[0];
    expect(item.type).toBe("text");
    if (item.type !== "text") {
      throw new Error("expected text input item");
    }
    const snippet = item.text
      .split("[附件文本片段: multibyte.md]\n")[1]
      .split("\n\n[已按 64KB 限制截断]")[0];
    expect(Buffer.byteLength(snippet, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(snippet).not.toContain("\uFFFD");
    expect(item.text).toContain("[已按 64KB 限制截断]");
  });
});
