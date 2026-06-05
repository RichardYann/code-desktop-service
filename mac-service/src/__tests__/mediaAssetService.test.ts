import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestAppContext } from "./helpers.js";

describe("mediaAssetService", () => {
  it("stores and lists session media assets", () => {
    const context = createTestAppContext();
    const now = "2026-05-16T00:00:00.000Z";
    const asset = context.repositories.mediaAssets.insert({
      id: "asset-1",
      sessionId: "thread-1",
      source: "mobileUpload",
      kind: "image",
      fileName: "screen.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      sha256: null,
      status: "pending",
      relativePath: "thread-1/asset-1/screen.png",
      createdAt: now,
      expiresAt: "2026-05-23T00:00:00.000Z",
      error: ""
    });

    expect(asset.id).toBe("asset-1");
    expect(context.repositories.mediaAssets.listBySession("thread-1")).toHaveLength(1);
  });

  it("prepares and stores an uploaded asset", async () => {
    const context = createTestAppContext();
    const prepared = context.mediaAssets.prepareMobileUpload({
      sessionId: "thread-1",
      fileName: "screen.png",
      mimeType: "image/png",
      sizeBytes: 4
    });

    const uploaded = await context.mediaAssets.storeUploadedContent(prepared.asset.id, Buffer.from("data"), 4);

    expect(uploaded.status).toBe("available");
    expect(uploaded.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(context.mediaAssets.listSessionAssets("thread-1")).toHaveLength(1);
  });

  it("stores a Mac file copy as a session artifact without exposing its original path", async () => {
    const context = createTestAppContext();

    const artifact = await context.mediaAssets.storeMacArtifactContent({
      sessionId: "thread-1",
      fileName: "/Users/me/Desktop/demo.mov",
      mimeType: "video/quicktime",
      content: Buffer.from("movie")
    });

    expect(artifact.source).toBe("macArtifact");
    expect(artifact.kind).toBe("video");
    expect(artifact.fileName).toBe("demo.mov");
    expect(artifact.url).toBe(`/api/assets/${artifact.id}/content`);
    expect(context.repositories.mediaAssets.get(artifact.id)?.relativePath).not.toContain("/Users/me/Desktop");
    expect((await context.mediaAssets.readAssetContent(artifact.id)).content.toString("utf8")).toBe("movie");
  });

  it("preserves Unicode file names while stripping desktop path separators", async () => {
    const context = createTestAppContext();

    const artifact = await context.mediaAssets.storeMacArtifactContent({
      sessionId: "thread-1",
      fileName: "C:\\综合维修车间\\3.物资相关\\管内物资清查_1 20260603.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: Buffer.from("xlsx")
    });

    expect(artifact.fileName).toBe("管内物资清查_1 20260603.xlsx");
    expect(artifact.kind).toBe("office");
    expect(context.repositories.mediaAssets.get(artifact.id)?.relativePath).toContain("管内物资清查_1 20260603.xlsx");
  });

  it("keeps Unicode referenced desktop file names when copying a file reference", async () => {
    const context = createTestAppContext();
    const filePath = path.join(os.tmpdir(), "管内物资清查_2 20260603.docx");
    await writeFile(filePath, "docx");

    const artifact = await context.mediaAssets.storeMacFileReferenceAsset({
      sessionId: "thread-1",
      filePath
    });

    expect(artifact.fileName).toBe("管内物资清查_2 20260603.docx");
    expect(artifact.kind).toBe("office");
    await rm(filePath, { force: true });
  });

  it("rejects Mac file artifacts over 100M", async () => {
    const context = createTestAppContext();

    await expect(context.mediaAssets.storeMacArtifactContent({
      sessionId: "thread-1",
      fileName: "large.bin",
      mimeType: "application/octet-stream",
      content: Buffer.alloc(100 * 1024 * 1024 + 1)
    })).rejects.toMatchObject({
      code: "MEDIA_ASSET_REJECTED"
    });
  });
});
