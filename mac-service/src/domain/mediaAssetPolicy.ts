export type MediaKind = "image" | "document" | "text" | "code" | "pdf" | "office" | "screenshot" | "video" | "audio" | "other";

export interface MediaUploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MediaValidationResult {
  ok: boolean;
  kind: MediaKind;
  message: string;
}

const IMAGE_LIMIT_BYTES = 50 * 1024 * 1024;
const DOCUMENT_LIMIT_BYTES = 50 * 1024 * 1024;

const codeExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".py",
  ".rs",
  ".swift",
  ".ts",
  ".tsx"
]);

const blockedExtensions = new Set([
  ".7z",
  ".app",
  ".bat",
  ".bin",
  ".bz2",
  ".cmd",
  ".dmg",
  ".exe",
  ".gz",
  ".msi",
  ".pkg",
  ".rar",
  ".sh",
  ".tar",
  ".tgz",
  ".xz",
  ".zip",
  ".zsh"
]);

export function classifyMediaAsset(fileName: string, mimeType: string): MediaKind {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  const extension = fileExtension(fileName);
  if (normalizedMimeType.startsWith("image/")) return "image";
  if (normalizedMimeType.startsWith("video/")) return "video";
  if (normalizedMimeType.startsWith("audio/")) return "audio";
  if (normalizedMimeType === "application/pdf" || extension === ".pdf") return "pdf";
  if (isOfficeType(normalizedMimeType, extension)) return "office";
  if (normalizedMimeType.startsWith("text/")) return extension === ".md" || extension === ".markdown" ? "document" : "text";
  if (isCodeType(normalizedMimeType, extension)) return "code";
  if (extension === ".md" || extension === ".markdown" || extension === ".rtf") return "document";
  if (extension === ".json" || extension === ".csv" || extension === ".log" || extension === ".xml" || extension === ".yaml" || extension === ".yml") {
    return "text";
  }
  return "other";
}

export function validateMobileUpload(input: MediaUploadInput): MediaValidationResult {
  const kind = classifyMediaAsset(input.fileName, input.mimeType);
  if (input.sizeBytes < 0) {
    return { ok: false, kind, message: "文件大小无效" };
  }
  if (isBlockedExtension(input.fileName)) {
    return { ok: false, kind, message: "当前版本不支持上传压缩包、可执行文件或脚本文件" };
  }
  if (kind === "video" || kind === "audio" || kind === "other") {
    return { ok: false, kind, message: "当前版本不支持上传该类型文件给 Codex" };
  }
  if (kind === "image" && input.sizeBytes > IMAGE_LIMIT_BYTES) {
    return { ok: false, kind, message: "图片不能超过 50M" };
  }
  if (kind !== "image" && input.sizeBytes > DOCUMENT_LIMIT_BYTES) {
    return { ok: false, kind, message: "文档不能超过 50M" };
  }
  return { ok: true, kind, message: "" };
}

function isBlockedExtension(fileName: string): boolean {
  return blockedExtensions.has(fileExtension(fileName));
}

function isOfficeType(mimeType: string, extension: string): boolean {
  if (mimeType.includes("officedocument")) return true;
  if (mimeType === "application/msword" || mimeType === "application/vnd.ms-excel" || mimeType === "application/vnd.ms-powerpoint") {
    return true;
  }
  return extension === ".doc" || extension === ".docx" || extension === ".xls" || extension === ".xlsx" ||
    extension === ".ppt" || extension === ".pptx";
}

function isCodeType(mimeType: string, extension: string): boolean {
  if (mimeType === "application/json" || mimeType === "application/xml" || mimeType === "application/x-yaml") return true;
  return codeExtensions.has(extension);
}

function fileExtension(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const slashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const baseName = slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed;
  const dotIndex = baseName.lastIndexOf(".");
  return dotIndex >= 0 ? baseName.slice(dotIndex) : "";
}
