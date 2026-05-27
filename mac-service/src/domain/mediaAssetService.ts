import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { CodexAttachmentAsset } from "./codexAttachmentAdapter.js";
import { classifyMediaAsset, validateMobileUpload, type MediaKind } from "./mediaAssetPolicy.js";
import type { StoredMediaAsset, createRepositories } from "../storage/repositories.js";

type MediaAssetRepository = ReturnType<typeof createRepositories>["mediaAssets"];
const NEW_SESSION_DRAFT_PREFIX = "draft-new-session-";
const MAC_ARTIFACT_LIMIT_BYTES = 100 * 1024 * 1024;

export interface PublicMediaAsset {
  id: string;
  sessionId: string;
  source: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  status: string;
  url: string | null;
  createdAt: string;
  expiresAt: string | null;
  error: string;
}

export interface PreparedMediaAsset {
  asset: PublicMediaAsset;
  uploadUrl: string;
}

export interface MediaAssetService {
  prepareMobileUpload(input: { sessionId: string; fileName: string; mimeType: string; sizeBytes: number }): PreparedMediaAsset;
  storeUploadedContent(assetId: string, body: Buffer, contentLength: number | null): Promise<PublicMediaAsset>;
  storeMacArtifactContent(input: { sessionId: string; fileName: string; mimeType: string; content: Buffer }): Promise<PublicMediaAsset>;
  storeMacFileReferenceAsset(input: { sessionId: string; filePath: string; fileName?: string }): Promise<PublicMediaAsset>;
  readAssetContent(assetId: string): Promise<{ asset: PublicMediaAsset; content: Buffer }>;
  listSessionAssets(sessionId: string): PublicMediaAsset[];
  listCodexAttachmentAssets(sessionId: string, assetIds: string[]): CodexAttachmentAsset[];
  listNewSessionDraftAttachmentAssets(assetIds: string[]): CodexAttachmentAsset[];
  assignNewSessionDraftAssets(assetIds: string[], sessionId: string): PublicMediaAsset[];
  deleteAsset(assetId: string): Promise<PublicMediaAsset>;
  deleteAllAssets(): Promise<PublicMediaAsset[]>;
  publicAsset(asset: StoredMediaAsset): PublicMediaAsset;
}

export function createMediaAssetService(input: {
  repository: MediaAssetRepository;
  storageDir: string;
  now?: () => Date;
}): MediaAssetService {
  const now = input.now ?? (() => new Date());

  function absolutePathFor(asset: StoredMediaAsset): string {
    const absolutePath = path.resolve(input.storageDir, asset.relativePath);
    const storageRoot = path.resolve(input.storageDir);
    if (absolutePath !== storageRoot && !absolutePath.startsWith(storageRoot + path.sep)) {
      throw new Error("媒体资产路径无效");
    }
    return absolutePath;
  }

  function publicAsset(asset: StoredMediaAsset): PublicMediaAsset {
    return {
      id: asset.id,
      sessionId: asset.sessionId,
      source: asset.source,
      kind: asset.kind,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      status: asset.status,
      url: asset.status === "available" ? assetContentUrl(asset.id) : null,
      createdAt: asset.createdAt,
      expiresAt: asset.expiresAt,
      error: asset.error
    };
  }

  async function deleteStoredAsset(asset: StoredMediaAsset): Promise<PublicMediaAsset> {
    const deleted = publicAsset(asset);
    const targetPath = absolutePathFor(asset);
    await rm(path.dirname(targetPath), { recursive: true, force: true });
    input.repository.delete(asset.id);
    return deleted;
  }

  return {
    prepareMobileUpload(uploadInput): PreparedMediaAsset {
      const validation = validateMobileUpload(uploadInput);
      if (!validation.ok) {
        throw new MediaAssetError("MEDIA_ASSET_REJECTED", validation.message);
      }
      const createdAt = now().toISOString();
      const expiresAt = new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const assetId = "asset-" + nanoid(16);
      const fileName = safeFileName(uploadInput.fileName);
      const relativePath = path.join(safePathSegment(uploadInput.sessionId), assetId, fileName);
      const kind: MediaKind = validation.kind || classifyMediaAsset(fileName, uploadInput.mimeType);
      const stored = input.repository.insert({
        id: assetId,
        sessionId: uploadInput.sessionId,
        source: "mobileUpload",
        kind,
        fileName,
        mimeType: uploadInput.mimeType,
        sizeBytes: uploadInput.sizeBytes,
        sha256: null,
        status: "pending",
        relativePath,
        createdAt,
        expiresAt,
        error: ""
      });
      return {
        asset: publicAsset(stored),
        uploadUrl: assetContentUrl(assetId)
      };
    },

    async storeUploadedContent(assetId: string, body: Buffer, contentLength: number | null): Promise<PublicMediaAsset> {
      const asset = input.repository.get(assetId);
      if (!asset) throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
      if (asset.status !== "pending" && asset.status !== "uploading") {
        throw new MediaAssetError("MEDIA_ASSET_STATE_INVALID", "媒体资产当前状态不允许上传");
      }
      if (contentLength !== null && contentLength !== asset.sizeBytes) {
        input.repository.updateStatus({ id: assetId, status: "failed", error: "上传大小与准备信息不一致" });
        throw new MediaAssetError("MEDIA_ASSET_SIZE_MISMATCH", "上传大小与准备信息不一致");
      }
      if (body.length !== asset.sizeBytes) {
        input.repository.updateStatus({ id: assetId, status: "failed", error: "上传内容大小与准备信息不一致" });
        throw new MediaAssetError("MEDIA_ASSET_SIZE_MISMATCH", "上传内容大小与准备信息不一致");
      }
      const targetPath = absolutePathFor(asset);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, body);
      const sha256 = createHash("sha256").update(body).digest("hex");
      input.repository.updateUploaded({ id: assetId, sha256, status: "available", error: "" });
      const updated = input.repository.get(assetId);
      if (!updated) throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
      return publicAsset(updated);
    },

    async storeMacArtifactContent(artifactInput): Promise<PublicMediaAsset> {
      if (artifactInput.content.length > MAC_ARTIFACT_LIMIT_BYTES) {
        throw new MediaAssetError("MEDIA_ASSET_REJECTED", "桌面端文件产物不能超过 100M");
      }
      const createdAt = now().toISOString();
      const expiresAt = new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const assetId = "asset-" + nanoid(16);
      const fileName = safeFileName(artifactInput.fileName);
      const relativePath = path.join(safePathSegment(artifactInput.sessionId), assetId, fileName);
      const targetPath = path.resolve(input.storageDir, relativePath);
      const storageRoot = path.resolve(input.storageDir);
      if (targetPath !== storageRoot && !targetPath.startsWith(storageRoot + path.sep)) {
        throw new Error("媒体资产路径无效");
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, artifactInput.content);
      const sha256 = createHash("sha256").update(artifactInput.content).digest("hex");
      const stored = input.repository.insert({
        id: assetId,
        sessionId: artifactInput.sessionId,
        source: "macArtifact",
        kind: classifyMediaAsset(fileName, artifactInput.mimeType),
        fileName,
        mimeType: artifactInput.mimeType,
        sizeBytes: artifactInput.content.length,
        sha256,
        status: "available",
        relativePath,
        createdAt,
        expiresAt,
        error: ""
      });
      return publicAsset(stored);
    },

    async storeMacFileReferenceAsset(referenceInput): Promise<PublicMediaAsset> {
      const absoluteFilePath = path.resolve(referenceInput.filePath);
      if (!path.isAbsolute(referenceInput.filePath)) {
        throw new MediaAssetError("MEDIA_ASSET_REJECTED", "只能同步桌面端绝对路径文件");
      }
      const fileStat = await stat(absoluteFilePath).catch((error: unknown) => {
        throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", error instanceof Error ? error.message : "文件不存在");
      });
      if (!fileStat.isFile()) {
        throw new MediaAssetError("MEDIA_ASSET_REJECTED", "只能同步普通文件");
      }
      if (fileStat.size > MAC_ARTIFACT_LIMIT_BYTES) {
        throw new MediaAssetError("MEDIA_ASSET_REJECTED", "桌面端文件不能超过 100M");
      }
      const content = await readFile(absoluteFilePath);
      const createdAt = now().toISOString();
      const expiresAt = new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const assetId = "asset-" + nanoid(16);
      const fileName = safeFileName(referenceInput.fileName && referenceInput.fileName.trim().length > 0
        ? referenceInput.fileName
        : absoluteFilePath);
      const mimeType = mimeTypeForFileName(fileName);
      const relativePath = path.join(safePathSegment(referenceInput.sessionId), assetId, fileName);
      const targetPath = path.resolve(input.storageDir, relativePath);
      const storageRoot = path.resolve(input.storageDir);
      if (targetPath !== storageRoot && !targetPath.startsWith(storageRoot + path.sep)) {
        throw new Error("媒体资产路径无效");
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content);
      const sha256 = createHash("sha256").update(content).digest("hex");
      const stored = input.repository.insert({
        id: assetId,
        sessionId: referenceInput.sessionId,
        source: "macFile",
        kind: classifyMediaAsset(fileName, mimeType),
        fileName,
        mimeType,
        sizeBytes: content.length,
        sha256,
        status: "available",
        relativePath,
        createdAt,
        expiresAt,
        error: ""
      });
      return publicAsset(stored);
    },

    async readAssetContent(assetId: string): Promise<{ asset: PublicMediaAsset; content: Buffer }> {
      const asset = input.repository.get(assetId);
      if (!asset) throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
      if (asset.status !== "available") {
        throw new MediaAssetError("MEDIA_ASSET_UNAVAILABLE", "媒体资产暂不可用");
      }
      if (asset.expiresAt !== null && Date.parse(asset.expiresAt) <= now().getTime()) {
        input.repository.updateStatus({ id: assetId, status: "expired", error: "媒体资产已过期" });
        throw new MediaAssetError("MEDIA_ASSET_EXPIRED", "媒体资产已过期");
      }
      const targetPath = absolutePathFor(asset);
      if (!fs.existsSync(targetPath)) {
        throw new MediaAssetError("MEDIA_ASSET_FILE_MISSING", "媒体文件不存在或已被清理");
      }
      return { asset: publicAsset(asset), content: await readFile(targetPath) };
    },

    listSessionAssets(sessionId: string): PublicMediaAsset[] {
      return input.repository.listBySession(sessionId).map(publicAsset);
    },

    listCodexAttachmentAssets(sessionId: string, assetIds: string[]): CodexAttachmentAsset[] {
      return assetIds.map((assetId) => {
        const asset = input.repository.get(assetId);
        if (!asset) throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
        if (asset.sessionId !== sessionId) {
          throw new MediaAssetError("MEDIA_ASSET_SESSION_MISMATCH", "媒体资产不属于当前会话");
        }
        if (asset.status !== "available") {
          throw new MediaAssetError("MEDIA_ASSET_UNAVAILABLE", "媒体资产暂不可用");
        }
        if (asset.expiresAt !== null && Date.parse(asset.expiresAt) <= now().getTime()) {
          input.repository.updateStatus({ id: assetId, status: "expired", error: "媒体资产已过期" });
          throw new MediaAssetError("MEDIA_ASSET_EXPIRED", "媒体资产已过期");
        }
        const absolutePath = absolutePathFor(asset);
        if (!fs.existsSync(absolutePath)) {
          throw new MediaAssetError("MEDIA_ASSET_FILE_MISSING", "媒体文件不存在或已被清理");
        }
        return {
          id: asset.id,
          kind: asset.kind,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          absolutePath,
          sizeBytes: asset.sizeBytes
        };
      });
    },

    listNewSessionDraftAttachmentAssets(assetIds: string[]): CodexAttachmentAsset[] {
      return assetIds.map((assetId) => {
        const asset = input.repository.get(assetId);
        if (!asset) throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
        assertNewSessionDraftAsset(asset);
        assertAvailableAsset(asset, assetId, input.repository, now);
        const absolutePath = absolutePathFor(asset);
        if (!fs.existsSync(absolutePath)) {
          throw new MediaAssetError("MEDIA_ASSET_FILE_MISSING", "媒体文件不存在或已被清理");
        }
        return {
          id: asset.id,
          kind: asset.kind,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          absolutePath,
          sizeBytes: asset.sizeBytes
        };
      });
    },

    assignNewSessionDraftAssets(assetIds: string[], sessionId: string): PublicMediaAsset[] {
      return assetIds.map((assetId) => {
        const asset = input.repository.get(assetId);
        if (!asset) throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
        assertNewSessionDraftAsset(asset);
        input.repository.updateSession({ id: assetId, sessionId });
        const updated = input.repository.get(assetId);
        if (!updated) throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
        return publicAsset(updated);
      });
    },

    async deleteAsset(assetId: string): Promise<PublicMediaAsset> {
      const asset = input.repository.get(assetId);
      if (!asset) throw new MediaAssetError("MEDIA_ASSET_NOT_FOUND", "媒体资产不存在");
      return deleteStoredAsset(asset);
    },

    async deleteAllAssets(): Promise<PublicMediaAsset[]> {
      const assets = input.repository.listAll();
      const deleted: PublicMediaAsset[] = [];
      for (const asset of assets) {
        deleted.push(await deleteStoredAsset(asset));
      }
      return deleted;
    },

    publicAsset
  };
}

export class MediaAssetError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function assetContentUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/content`;
}

function safeFileName(fileName: string): string {
  const normalized = path.basename(fileName.trim()).replace(/[^A-Za-z0-9._ -]/g, "_").trim();
  return normalized.length > 0 ? normalized : "attachment.bin";
}

function safePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : "session";
}

function mimeTypeForFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (extension === ".txt" || extension === ".log") return "text/plain";
  if (extension === ".json") return "application/json";
  if (extension === ".xml") return "application/xml";
  if (extension === ".csv") return "text/csv";
  if (extension === ".yaml" || extension === ".yml") return "application/x-yaml";
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".css") return "text/css";
  if (extension === ".js" || extension === ".jsx") return "text/javascript";
  if (extension === ".ts" || extension === ".tsx" || extension === ".ets") return "application/typescript";
  if (extension === ".py") return "text/x-python";
  if (extension === ".swift") return "text/x-swift";
  if (extension === ".go") return "text/x-go";
  if (extension === ".rs") return "text/x-rust";
  if (extension === ".java") return "text/x-java-source";
  if (extension === ".kt") return "text/x-kotlin";
  if (extension === ".doc") return "application/msword";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".xls") return "application/vnd.ms-excel";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === ".ppt") return "application/vnd.ms-powerpoint";
  if (extension === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

function assertNewSessionDraftAsset(asset: StoredMediaAsset): void {
  if (!asset.sessionId.startsWith(NEW_SESSION_DRAFT_PREFIX)) {
    throw new MediaAssetError("MEDIA_ASSET_SESSION_MISMATCH", "媒体资产不属于新建会话草稿");
  }
}

function assertAvailableAsset(
  asset: StoredMediaAsset,
  assetId: string,
  repository: MediaAssetRepository,
  now: () => Date
): void {
  if (asset.status !== "available") {
    throw new MediaAssetError("MEDIA_ASSET_UNAVAILABLE", "媒体资产暂不可用");
  }
  if (asset.expiresAt !== null && Date.parse(asset.expiresAt) <= now().getTime()) {
    repository.updateStatus({ id: assetId, status: "expired", error: "媒体资产已过期" });
    throw new MediaAssetError("MEDIA_ASSET_EXPIRED", "媒体资产已过期");
  }
}
