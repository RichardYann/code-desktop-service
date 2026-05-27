import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classifyMediaAsset } from "./mediaAssetPolicy.js";
import type { PublicMediaAsset } from "./mediaAssetService.js";
import type { StoredMediaAsset, StoredSessionAttachment, createRepositories } from "../storage/repositories.js";

type MediaAssetRepository = ReturnType<typeof createRepositories>["mediaAssets"];
type SessionAttachmentRepository = ReturnType<typeof createRepositories>["sessionAttachments"];

const CODEX_IMAGE_LIMIT_BYTES = 100 * 1024 * 1024;

export interface CodexGeneratedImageArtifactCandidate {
  sessionId: string;
  callId: string;
  savedPath: string | null;
  fileName: string;
  createdAt: string;
  base64Content: string | null;
}

export interface CodexGeneratedImageArtifact {
  callId: string;
  createdAt: string;
  asset: PublicMediaAsset;
  attachment: StoredSessionAttachment;
}

export interface CodexGeneratedImageArtifactSyncResult {
  artifacts: CodexGeneratedImageArtifact[];
  createdAssetIds: string[];
}

export interface CodexGeneratedImageArtifactService {
  syncFromRollout(input: { sessionId: string; rolloutPath: string }): Promise<CodexGeneratedImageArtifactSyncResult>;
}

export function createCodexGeneratedImageArtifactService(input: {
  mediaAssetRepository: MediaAssetRepository;
  sessionAttachmentRepository: SessionAttachmentRepository;
  storageDir: string;
  generatedImagesRoot?: string;
  now?: () => Date;
}): CodexGeneratedImageArtifactService {
  const generatedImagesRoot = input.generatedImagesRoot ?? path.join(os.homedir(), ".codex", "generated_images");
  const now = input.now ?? (() => new Date());

  async function storeCandidate(candidate: CodexGeneratedImageArtifactCandidate): Promise<{
    artifact: CodexGeneratedImageArtifact | null;
    created: boolean;
  }> {
    const assetId = assetIdForGeneratedImage(candidate.sessionId, candidate.callId);
    const existing = input.mediaAssetRepository.get(assetId);
    if (existing) {
      return {
        artifact: {
          callId: candidate.callId,
          createdAt: candidate.createdAt,
          asset: publicAsset(existing),
          attachment: ensureAttachment(input.sessionAttachmentRepository, publicAsset(existing), candidate.createdAt)
        },
        created: false
      };
    }

    const content = await readCandidateContent(candidate, generatedImagesRoot);
    if (!content) return { artifact: null, created: false };
    if (content.length > CODEX_IMAGE_LIMIT_BYTES) return { artifact: null, created: false };

    const fileName = safeFileName(candidate.fileName);
    const mimeType = mimeTypeForFileName(fileName);
    const relativePath = path.join(safePathSegment(candidate.sessionId), assetId, fileName);
    const targetPath = absoluteStoragePath(input.storageDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
    const stored = input.mediaAssetRepository.insert({
      id: assetId,
      sessionId: candidate.sessionId,
      source: "codexEvent",
      kind: classifyMediaAsset(fileName, mimeType),
      fileName,
      mimeType,
      sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      status: "available",
      relativePath,
      createdAt: candidate.createdAt || now().toISOString(),
      expiresAt: null,
      error: ""
    });
    const asset = publicAsset(stored);
    return {
      artifact: {
        callId: candidate.callId,
        createdAt: candidate.createdAt,
        asset,
        attachment: ensureAttachment(input.sessionAttachmentRepository, asset, candidate.createdAt)
      },
      created: true
    };
  }

  return {
    async syncFromRollout(syncInput): Promise<CodexGeneratedImageArtifactSyncResult> {
      if (syncInput.sessionId.trim().length === 0 || syncInput.rolloutPath.trim().length === 0) {
        return { artifacts: [], createdAssetIds: [] };
      }
      if (!fs.existsSync(syncInput.rolloutPath)) {
        return { artifacts: [], createdAssetIds: [] };
      }
      const jsonl = await readFile(syncInput.rolloutPath, "utf8");
      const candidates = readCodexGeneratedImageArtifactsFromJsonl(jsonl, syncInput.sessionId);
      const artifacts: CodexGeneratedImageArtifact[] = [];
      const createdAssetIds: string[] = [];
      for (const candidate of candidates) {
        const result = await storeCandidate(candidate);
        if (!result.artifact) continue;
        artifacts.push(result.artifact);
        if (result.created) createdAssetIds.push(result.artifact.asset.id);
      }
      return { artifacts, createdAssetIds };
    }
  };
}

export function readCodexGeneratedImageArtifactsFromJsonl(jsonl: string, sessionId: string): CodexGeneratedImageArtifactCandidate[] {
  const byCallId = new Map<string, CodexGeneratedImageArtifactCandidate>();
  const lines = jsonl.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      const entry = asRecord(JSON.parse(line) as unknown);
      const payload = asRecord(entry.payload);
      const eventType = stringField(payload, "type") || stringField(entry, "type");
      if (eventType !== "image_generation_end" && eventType !== "image_generation_call") continue;
      const callId = stringField(payload, "call_id") || stringField(payload, "callId") || stringField(payload, "id");
      if (callId.length === 0) continue;
      const savedPath = stringField(payload, "saved_path") ||
        stringField(payload, "savedPath") ||
        stringField(payload, "path") ||
        stringField(payload, "filePath") ||
        stringField(payload, "outputPath");
      const createdAt = timestampField(entry, "timestamp");
      const existing = byCallId.get(callId);
      const shouldKeepExistingPathEvent = existing !== undefined && existing.savedPath !== null && savedPath.length === 0;
      const candidate: CodexGeneratedImageArtifactCandidate = {
        sessionId,
        callId,
        savedPath: savedPath.length > 0 ? savedPath : existing?.savedPath ?? null,
        fileName: fileNameForCandidate(callId, savedPath.length > 0 ? savedPath : existing?.savedPath ?? null),
        createdAt: shouldKeepExistingPathEvent ? existing.createdAt : createdAt.length > 0 ? createdAt : existing?.createdAt ?? new Date().toISOString(),
        base64Content: stringField(payload, "result") || existing?.base64Content || null
      };
      byCallId.set(callId, candidate);
    } catch {
      continue;
    }
  }
  return Array.from(byCallId.values()).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

async function readCandidateContent(candidate: CodexGeneratedImageArtifactCandidate, generatedImagesRoot: string): Promise<Buffer | null> {
  const filePath = safeGeneratedImagePath(candidate, generatedImagesRoot);
  if (filePath !== null) {
    const fileStat = await stat(filePath).catch(() => null);
    if (fileStat && fileStat.isFile() && fileStat.size <= CODEX_IMAGE_LIMIT_BYTES) {
      return readFile(filePath);
    }
  }
  if (candidate.base64Content === null || candidate.base64Content.length === 0) {
    return null;
  }
  const content = decodeBase64Image(candidate.base64Content);
  if (content.length === 0 || content.length > CODEX_IMAGE_LIMIT_BYTES) return null;
  return content;
}

function safeGeneratedImagePath(candidate: CodexGeneratedImageArtifactCandidate, generatedImagesRoot: string): string | null {
  const sessionRoot = path.resolve(generatedImagesRoot, safePathSegment(candidate.sessionId));
  const fallbackPath = path.resolve(sessionRoot, `${safePathSegment(candidate.callId)}.png`);
  const rawPath = candidate.savedPath && candidate.savedPath.length > 0 ? path.resolve(candidate.savedPath) : fallbackPath;
  if (rawPath !== sessionRoot && !rawPath.startsWith(sessionRoot + path.sep)) {
    return null;
  }
  return rawPath;
}

function ensureAttachment(repository: SessionAttachmentRepository, asset: PublicMediaAsset, createdAt: string): StoredSessionAttachment {
  return repository.insert({
    id: `attachment-${asset.id}`,
    sessionId: asset.sessionId,
    assetId: asset.id,
    role: "codexArtifact",
    codexInputStatus: "notRequired",
    codexInputMessage: "Codex 图片产物已保存",
    createdAt: createdAt.length > 0 ? createdAt : asset.createdAt
  });
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
    url: asset.status === "available" ? `/api/assets/${encodeURIComponent(asset.id)}/content` : null,
    createdAt: asset.createdAt,
    expiresAt: asset.expiresAt,
    error: asset.error
  };
}

function assetIdForGeneratedImage(sessionId: string, callId: string): string {
  const hash = createHash("sha256").update(`${sessionId}:${callId}`).digest("hex").slice(0, 24);
  return `asset-codex-${hash}`;
}

function decodeBase64Image(value: string): Buffer {
  const commaIndex = value.indexOf(",");
  const content = value.startsWith("data:") && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  return Buffer.from(content, "base64");
}

function fileNameForCandidate(callId: string, savedPath: string | null): string {
  if (savedPath !== null && savedPath.length > 0) {
    return safeFileName(savedPath);
  }
  return `${safePathSegment(callId)}.png`;
}

function absoluteStoragePath(storageDir: string, relativePath: string): string {
  const absolutePath = path.resolve(storageDir, relativePath);
  const storageRoot = path.resolve(storageDir);
  if (absolutePath !== storageRoot && !absolutePath.startsWith(storageRoot + path.sep)) {
    throw new Error("Codex 图片产物路径无效");
  }
  return absolutePath;
}

function mimeTypeForFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
}

function safeFileName(fileName: string): string {
  const normalized = path.basename(fileName.trim()).replace(/[^A-Za-z0-9._ -]/g, "_").trim();
  return normalized.length > 0 ? normalized : "codex-image.png";
}

function safePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : "session";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, fieldName: string): string {
  const value = record[fieldName];
  return typeof value === "string" ? value : "";
}

function timestampField(record: Record<string, unknown>, fieldName: string): string {
  const value = record[fieldName];
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return "";
}
