import { readFile } from "node:fs/promises";

export interface CodexAttachmentCapability {
  imageInput: boolean;
  fileReferenceInput: boolean;
  legacyTextSnippetInput: boolean;
}

export interface CodexAttachmentAsset {
  id: string;
  kind: string;
  fileName: string;
  mimeType: string;
  absolutePath: string;
  sizeBytes: number;
}

export interface CodexAttachmentStatus {
  assetId: string;
  codexInputStatus: "notRequired" | "pending" | "sent" | "unsupported" | "failed";
  codexInputMessage: string;
}

export interface CodexAttachmentInput {
  text: string;
  assets: CodexAttachmentAsset[];
}

export interface CodexAttachmentBuildResult {
  text: string;
  attachments: CodexAttachmentStatus[];
}

const TEXT_ATTACHMENT_LIMIT_BYTES = 64 * 1024;

export class CodexAttachmentAdapter {
  private capability: CodexAttachmentCapability;

  constructor(input: { capability: CodexAttachmentCapability }) {
    this.capability = input.capability;
  }

  async buildInput(input: CodexAttachmentInput): Promise<CodexAttachmentBuildResult> {
    let text = input.text;
    const attachments: CodexAttachmentStatus[] = [];
    for (const asset of input.assets) {
      if (asset.kind === "image" || asset.kind === "screenshot") {
        attachments.push(this.imageStatus(asset));
        continue;
      }
      if (this.isTextLike(asset)) {
        const result = await this.textStatusAndContent(asset);
        attachments.push(result.status);
        if (result.content.length > 0) {
          text += `\n\n[附件文本片段: ${asset.fileName}]\n${result.content}`;
        }
        continue;
      }
      if (asset.kind === "pdf" || asset.kind === "office" || asset.kind === "document") {
        attachments.push(this.fileStatus(asset));
        continue;
      }
      attachments.push({
        assetId: asset.id,
        codexInputStatus: "unsupported",
        codexInputMessage: "当前版本不支持该类型附件进入 Codex 上下文"
      });
    }
    return { text, attachments };
  }

  private imageStatus(asset: CodexAttachmentAsset): CodexAttachmentStatus {
    if (this.capability.imageInput) {
      return {
        assetId: asset.id,
        codexInputStatus: "pending",
        codexInputMessage: "图片将通过 Codex 官方图片输入通道发送"
      };
    }
    return {
      assetId: asset.id,
      codexInputStatus: "unsupported",
      codexInputMessage: "当前 Codex 通道不支持图片输入，图片仅作为会话附件展示"
    };
  }

  private fileStatus(asset: CodexAttachmentAsset): CodexAttachmentStatus {
    if (this.fileReferenceInputEnabled()) {
      return {
        assetId: asset.id,
        codexInputStatus: "pending",
        codexInputMessage: "文件将通过 Codex 文件引用通道发送"
      };
    }
    return {
      assetId: asset.id,
      codexInputStatus: "unsupported",
      codexInputMessage: "当前 Codex 通道不支持该文档直接进入上下文"
    };
  }

  private async textStatusAndContent(asset: CodexAttachmentAsset): Promise<{ status: CodexAttachmentStatus; content: string }> {
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
      const content = await readFile(asset.absolutePath, "utf8");
      const bounded = content.length > TEXT_ATTACHMENT_LIMIT_BYTES ? content.slice(0, TEXT_ATTACHMENT_LIMIT_BYTES) : content;
      const truncated = content.length > bounded.length ? "\n\n[已按 64KB 限制截断]" : "";
      return {
        status: {
          assetId: asset.id,
          codexInputStatus: "sent",
          codexInputMessage: "已按 64KB 上限作为文本片段进入本轮上下文"
        },
        content: bounded + truncated
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

  private fileReferenceInputEnabled(): boolean {
    return this.capability.fileReferenceInput;
  }

  private legacyTextSnippetInputEnabled(): boolean {
    return this.capability.legacyTextSnippetInput;
  }
}
