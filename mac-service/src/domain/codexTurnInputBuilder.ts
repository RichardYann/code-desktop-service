import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import type {
  CodexAttachmentAsset,
  CodexAttachmentCapability,
  CodexAttachmentStatus
} from "./codexAttachmentAdapter.js";

export type CodexTurnInputItem =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "localImage"; path: string; detail?: "high" | "original" }
  | { type: "mention"; name: string; path: string };

export interface CodexTurnInputBuildResult {
  items: CodexTurnInputItem[];
  attachments: CodexAttachmentStatus[];
}

export interface CodexTurnInputBuildInput {
  text: string;
  assets: CodexAttachmentAsset[];
}

const TEXT_ATTACHMENT_LIMIT_BYTES = 64 * 1024;

export class CodexTurnInputBuilder {
  private capability: CodexAttachmentCapability;

  constructor(input: { capability: CodexAttachmentCapability }) {
    this.capability = input.capability;
  }

  async build(input: CodexTurnInputBuildInput): Promise<CodexTurnInputBuildResult> {
    let text = input.text;
    const items: CodexTurnInputItem[] = [];
    const attachments: CodexAttachmentStatus[] = [];

    for (const asset of input.assets) {
      if (asset.kind === "image" || asset.kind === "screenshot") {
        const result = await this.imageItem(asset);
        attachments.push(result.status);
        if (result.item) {
          items.push(result.item);
        }
        continue;
      }

      if (this.isFileReferenceKind(asset)) {
        if (this.fileReferenceInputEnabled()) {
          const result = await this.fileReferenceItem(asset);
          attachments.push(result.status);
          if (result.item) {
            items.push(result.item);
          }
          continue;
        }

        if (this.isTextLike(asset) && this.legacyTextSnippetInputEnabled()) {
          const result = await this.textStatusAndContent(asset);
          attachments.push(result.status);
          if (result.content.length > 0) {
            text += `\n\n[附件文本片段: ${asset.fileName}]\n${result.content}`;
          }
          continue;
        }

        attachments.push({
          assetId: asset.id,
          codexInputStatus: "unsupported",
          codexInputMessage: "当前 Codex 通道不支持该文档直接进入上下文"
        });
        continue;
      }

      attachments.push({
        assetId: asset.id,
        codexInputStatus: "unsupported",
        codexInputMessage: "当前版本不支持该类型附件进入 Codex 上下文"
      });
    }

    if (text.trim().length > 0) {
      items.unshift({ type: "text", text, text_elements: [] });
    }

    return { items, attachments };
  }

  private async imageItem(asset: CodexAttachmentAsset): Promise<{
    item: CodexTurnInputItem | null;
    status: CodexAttachmentStatus;
  }> {
    if (!this.capability.imageInput) {
      return {
        item: null,
        status: {
          assetId: asset.id,
          codexInputStatus: "unsupported",
          codexInputMessage: "当前 Codex 通道不支持图片输入，图片仅作为会话附件展示"
        }
      };
    }

    try {
      await access(asset.absolutePath, constants.R_OK);
    } catch {
      return {
        item: null,
        status: {
          assetId: asset.id,
          codexInputStatus: "failed",
          codexInputMessage: "图片附件文件不可读取"
        }
      };
    }

    return {
      item: { type: "localImage", path: asset.absolutePath },
      status: {
        assetId: asset.id,
        codexInputStatus: "sent",
        codexInputMessage: "已通过 Codex 官方图片输入通道发送"
      }
    };
  }

  private async fileReferenceItem(asset: CodexAttachmentAsset): Promise<{
    item: CodexTurnInputItem | null;
    status: CodexAttachmentStatus;
  }> {
    try {
      await access(asset.absolutePath, constants.R_OK);
    } catch {
      return {
        item: null,
        status: {
          assetId: asset.id,
          codexInputStatus: "failed",
          codexInputMessage: "文件附件不可读取"
        }
      };
    }

    return {
      item: { type: "mention", name: asset.fileName, path: asset.absolutePath },
      status: {
        assetId: asset.id,
        codexInputStatus: "sent",
        codexInputMessage: "已通过 Codex 文件引用通道发送"
      }
    };
  }

  private async textStatusAndContent(asset: CodexAttachmentAsset): Promise<{
    status: CodexAttachmentStatus;
    content: string;
  }> {
    if (this.fileReferenceInputEnabled()) {
      return {
        status: {
          assetId: asset.id,
          codexInputStatus: "pending",
          codexInputMessage: "文本文件将通过 Codex 文件引用通道发送"
        },
        content: ""
      };
    }
    if (!this.legacyTextSnippetInputEnabled()) {
      return {
        status: {
          assetId: asset.id,
          codexInputStatus: "unsupported",
          codexInputMessage: "当前 Codex 通道不支持该文档直接进入上下文"
        },
        content: ""
      };
    }

    try {
      const contentBuffer = await readFile(asset.absolutePath);
      const truncated = contentBuffer.length > TEXT_ATTACHMENT_LIMIT_BYTES;
      const bounded = truncated
        ? truncateUtf8Buffer(contentBuffer, TEXT_ATTACHMENT_LIMIT_BYTES).toString("utf8")
        : contentBuffer.toString("utf8");
      const truncatedMessage = truncated ? "\n\n[已按 64KB 限制截断]" : "";
      return {
        status: {
          assetId: asset.id,
          codexInputStatus: "sent",
          codexInputMessage: "已按 64KB 上限作为文本片段进入本轮上下文"
        },
        content: bounded + truncatedMessage
      };
    } catch (error) {
      return {
        status: {
          assetId: asset.id,
          codexInputStatus: "failed",
          codexInputMessage: error instanceof Error ? error.message : "文本附件读取失败"
        },
        content: ""
      };
    }
  }

  private isTextLike(asset: CodexAttachmentAsset): boolean {
    return asset.kind === "text" || asset.kind === "code" || asset.mimeType.startsWith("text/") ||
      asset.mimeType === "application/json";
  }

  private isFileReferenceKind(asset: CodexAttachmentAsset): boolean {
    return this.isTextLike(asset) || asset.kind === "pdf" || asset.kind === "office" || asset.kind === "document";
  }

  private fileReferenceInputEnabled(): boolean {
    return this.capability.fileReferenceInput;
  }

  private legacyTextSnippetInputEnabled(): boolean {
    return this.capability.legacyTextSnippetInput;
  }
}

function truncateUtf8Buffer(buffer: Buffer, maxBytes: number): Buffer {
  let end = Math.min(buffer.length, maxBytes);
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return buffer.subarray(0, end);
}
