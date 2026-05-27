import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCaptureService, CaptureServiceError } from "../domain/captureService.js";
import { createTestAppContext } from "./helpers.js";

describe("captureService", () => {
  it("captures a local web screenshot buffer and stores it as an available media asset", async () => {
    const context = createTestAppContext();
    const now = "2026-05-16T08:00:00.000Z";
    context.repositories.localWebSessions.insert({
      id: "local-web-1",
      sessionId: "thread-1",
      targetUrl: "http://127.0.0.1:5173",
      proxyUrl: "https://127.0.0.1:9443/proxy/local-web-1",
      status: "active",
      createdAt: now,
      updatedAt: now,
      error: ""
    });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const service = createCaptureService({
      mediaAssetRepository: context.repositories.mediaAssets,
      localWebSessionRepository: context.repositories.localWebSessions,
      storageDir: path.join(context.config.dataDir, "media-assets"),
      now: () => new Date(now),
      idGenerator: () => "asset-capture-1",
      captureRunner: {
        captureLocalWebScreenshot: async () => png
      }
    });

    const asset = await service.captureLocalWebScreenshot({
      sessionId: "thread-1",
      localWebSessionId: "local-web-1",
      deviceId: "device-1"
    });

    expect(asset).toMatchObject({
      id: "asset-capture-1",
      sessionId: "thread-1",
      source: "localWebCapture",
      kind: "screenshot",
      fileName: "local-web-1-20260516-080000.png",
      mimeType: "image/png",
      sizeBytes: png.length,
      status: "available",
      url: "/api/assets/asset-capture-1/content",
      error: ""
    });
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    const stored = context.repositories.mediaAssets.get(asset.id);
    expect(stored?.relativePath).toBe("thread-1/asset-capture-1/local-web-1-20260516-080000.png");
    const content = await context.mediaAssets.readAssetContent(asset.id);
    expect(content.content.equals(png)).toBe(true);
  });

  it("returns a clear error when screen capture has no runner", async () => {
    const context = createTestAppContext();
    const service = createCaptureService({
      mediaAssetRepository: context.repositories.mediaAssets,
      localWebSessionRepository: context.repositories.localWebSessions,
      storageDir: path.join(context.config.dataDir, "media-assets")
    });

    await expect(service.captureScreenScreenshot({
      sessionId: "thread-1",
      deviceId: "device-1",
      userConfirmed: true
    })).rejects.toMatchObject({
      code: "CAPTURE_RUNNER_UNAVAILABLE"
    } satisfies Partial<CaptureServiceError>);
  });

  it("captures a confirmed screen screenshot buffer and stores it as a screen capture asset", async () => {
    const context = createTestAppContext();
    const now = "2026-05-16T08:30:00.000Z";
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    const service = createCaptureService({
      mediaAssetRepository: context.repositories.mediaAssets,
      localWebSessionRepository: context.repositories.localWebSessions,
      storageDir: path.join(context.config.dataDir, "media-assets"),
      now: () => new Date(now),
      idGenerator: () => "asset-screen-1",
      captureRunner: {
        captureScreenScreenshot: async () => png
      }
    });

    const asset = await service.captureScreenScreenshot({
      sessionId: "thread-1",
      deviceId: "device-1",
      userConfirmed: true
    });

    expect(asset).toMatchObject({
      id: "asset-screen-1",
      sessionId: "thread-1",
      source: "screenCapture",
      kind: "screenshot",
      fileName: "screen-20260516-083000.png",
      mimeType: "image/png",
      sizeBytes: png.length,
      status: "available",
      url: "/api/assets/asset-screen-1/content",
      error: ""
    });
    const content = await context.mediaAssets.readAssetContent(asset.id);
    expect(content.content.equals(png)).toBe(true);
  });
});
