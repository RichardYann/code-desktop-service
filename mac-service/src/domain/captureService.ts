import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { validateCaptureRequest } from "./capturePolicy.js";
import type { PublicMediaAsset } from "./mediaAssetService.js";
import type { StoredMediaAsset, createRepositories } from "../storage/repositories.js";

type MediaAssetRepository = ReturnType<typeof createRepositories>["mediaAssets"];
type LocalWebSessionRepository = ReturnType<typeof createRepositories>["localWebSessions"];

export interface CaptureRunner {
  captureLocalWebScreenshot?: (input: {
    sessionId: string;
    localWebSessionId: string;
    targetUrl: string;
    deviceId: string;
  }) => Promise<Buffer>;
  captureScreenScreenshot?: (input: {
    sessionId: string;
    deviceId: string;
  }) => Promise<Buffer>;
}

export interface CaptureService {
  captureLocalWebScreenshot(input: {
    sessionId: string;
    localWebSessionId: string;
    deviceId: string;
  }): Promise<PublicMediaAsset>;
  captureScreenScreenshot(input: {
    sessionId: string;
    deviceId: string;
    userConfirmed: boolean;
  }): Promise<PublicMediaAsset>;
}

export function createCaptureService(input: {
  mediaAssetRepository: MediaAssetRepository;
  localWebSessionRepository: LocalWebSessionRepository;
  storageDir: string;
  captureRunner?: CaptureRunner;
  now?: () => Date;
  idGenerator?: () => string;
}): CaptureService {
  const now = input.now ?? (() => new Date());
  const idGenerator = input.idGenerator ?? (() => "asset-" + nanoid(16));

  async function storeScreenshotAsset(assetInput: {
    sessionId: string;
    source: "localWebCapture" | "screenCapture";
    fileName: string;
    content: Buffer;
    createdAt: string;
  }): Promise<PublicMediaAsset> {
    const assetId = idGenerator();
    const safeName = safeFileName(assetInput.fileName);
    const relativePath = path.join(safePathSegment(assetInput.sessionId), assetId, safeName);
    const targetPath = absolutePathFor(input.storageDir, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, assetInput.content);
    const stored = input.mediaAssetRepository.insert({
      id: assetId,
      sessionId: assetInput.sessionId,
      source: assetInput.source,
      kind: "screenshot",
      fileName: safeName,
      mimeType: "image/png",
      sizeBytes: assetInput.content.length,
      sha256: createHash("sha256").update(assetInput.content).digest("hex"),
      status: "available",
      relativePath,
      createdAt: assetInput.createdAt,
      expiresAt: null,
      error: ""
    });
    return publicAsset(stored);
  }

  return {
    async captureLocalWebScreenshot(captureInput): Promise<PublicMediaAsset> {
      const localWebSession = input.localWebSessionRepository.get(captureInput.localWebSessionId);
      if (!localWebSession) {
        throw new CaptureServiceError("CAPTURE_TARGET_NOT_FOUND", "本地 Web 截图目标不存在");
      }
      if (localWebSession.sessionId !== captureInput.sessionId) {
        throw new CaptureServiceError("CAPTURE_TARGET_INVALID", "本地 Web 截图目标不属于当前会话");
      }
      if (localWebSession.status !== "active") {
        throw new CaptureServiceError("CAPTURE_TARGET_UNAVAILABLE", "本地 Web 截图目标不可用");
      }
      const validation = validateCaptureRequest({
        kind: "localWebScreenshot",
        targetUrl: localWebSession.targetUrl,
        userConfirmed: true
      });
      if (!validation.ok) {
        throw new CaptureServiceError("CAPTURE_REQUEST_REJECTED", validation.message);
      }
      const runner = input.captureRunner?.captureLocalWebScreenshot;
      if (!runner) {
        throw new CaptureServiceError("CAPTURE_RUNNER_UNAVAILABLE", "本地 Web 截图能力尚未接入");
      }
      const createdAt = now();
      const content = await runCapture(() => runner({
        sessionId: captureInput.sessionId,
        localWebSessionId: captureInput.localWebSessionId,
        targetUrl: localWebSession.targetUrl,
        deviceId: captureInput.deviceId
      }));
      assertPngContent(content);
      return storeScreenshotAsset({
        sessionId: captureInput.sessionId,
        source: "localWebCapture",
        fileName: `${safePathSegment(captureInput.localWebSessionId)}-${timestampForFileName(createdAt)}.png`,
        content,
        createdAt: createdAt.toISOString()
      });
    },

    async captureScreenScreenshot(captureInput): Promise<PublicMediaAsset> {
      const validation = validateCaptureRequest({
        kind: "screenScreenshot",
        targetUrl: null,
        userConfirmed: captureInput.userConfirmed
      });
      if (!validation.ok) {
        throw new CaptureServiceError("CAPTURE_CONFIRMATION_REQUIRED", validation.message);
      }
      const runner = input.captureRunner?.captureScreenScreenshot;
      if (!runner) {
        throw new CaptureServiceError("CAPTURE_RUNNER_UNAVAILABLE", "桌面端屏幕截图能力尚未接入");
      }
      const createdAt = now();
      const content = await runCapture(() => runner({
        sessionId: captureInput.sessionId,
        deviceId: captureInput.deviceId
      }));
      assertPngContent(content);
      return storeScreenshotAsset({
        sessionId: captureInput.sessionId,
        source: "screenCapture",
        fileName: `screen-${timestampForFileName(createdAt)}.png`,
        content,
        createdAt: createdAt.toISOString()
      });
    }
  };
}

export class CaptureServiceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function runCapture(capture: () => Promise<Buffer>): Promise<Buffer> {
  try {
    return await capture();
  } catch (error) {
    if (error instanceof CaptureServiceError) throw error;
    const message = error instanceof Error && error.message.length > 0 ? error.message : "截图失败";
    throw new CaptureServiceError("CAPTURE_FAILED", message);
  }
}

function assertPngContent(content: Buffer): void {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  if (content.length === 0 || !content.subarray(0, 4).equals(pngHeader)) {
    throw new CaptureServiceError("CAPTURE_INVALID_OUTPUT", "截图输出不是有效 PNG");
  }
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

function absolutePathFor(storageDir: string, relativePath: string): string {
  const absolutePath = path.resolve(storageDir, relativePath);
  const storageRoot = path.resolve(storageDir);
  if (absolutePath !== storageRoot && !absolutePath.startsWith(storageRoot + path.sep)) {
    throw new CaptureServiceError("CAPTURE_STORAGE_PATH_INVALID", "截图资产路径无效");
  }
  return absolutePath;
}

function timestampForFileName(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getUTCFullYear().toString(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds())
  ].join("");
}

function safeFileName(fileName: string): string {
  const normalized = path.basename(fileName.trim()).replace(/[^A-Za-z0-9._ -]/g, "_").trim();
  return normalized.length > 0 ? normalized : "screenshot.png";
}

function safePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return normalized.length > 0 ? normalized : "session";
}
