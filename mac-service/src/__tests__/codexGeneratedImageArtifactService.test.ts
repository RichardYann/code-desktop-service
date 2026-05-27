import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestAppContext } from "./helpers.js";
import {
  createCodexGeneratedImageArtifactService,
  readCodexGeneratedImageArtifactsFromJsonl
} from "../domain/codexGeneratedImageArtifactService.js";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("codexGeneratedImageArtifactService", () => {
  it("extracts Codex image generation artifacts from rollout jsonl", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: "2026-05-18T12:32:55.366Z",
        type: "event_msg",
        payload: {
          type: "image_generation_end",
          call_id: "ig_test",
          saved_path: "/Users/me/.codex/generated_images/thread-1/ig_test.png",
          result: "iVBORw0KGgo="
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-18T12:32:55.369Z",
        type: "response_item",
        payload: {
          type: "image_generation_call",
          id: "ig_test",
          result: "iVBORw0KGgo="
        }
      })
    ].join("\n");

    const artifacts = readCodexGeneratedImageArtifactsFromJsonl(jsonl, "thread-1");

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      sessionId: "thread-1",
      callId: "ig_test",
      fileName: "ig_test.png",
      createdAt: "2026-05-18T12:32:55.366Z"
    });
  });

  it("syncs generated PNG files as codex event media assets and does not duplicate them", async () => {
    const context = createTestAppContext();
    const generatedImagesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-generated-images-"));
    const sessionId = "thread-1";
    const generatedSessionDir = path.join(generatedImagesRoot, sessionId);
    await mkdir(generatedSessionDir, { recursive: true });
    const imagePath = path.join(generatedSessionDir, "ig_test.png");
    await writeFile(imagePath, PNG_BYTES);
    const rolloutPath = path.join(generatedImagesRoot, "rollout.jsonl");
    await writeFile(rolloutPath, JSON.stringify({
      timestamp: "2026-05-18T12:32:55.366Z",
      type: "image_generation_end",
      payload: {
        type: "image_generation_end",
        call_id: "ig_test",
        saved_path: imagePath
      }
    }) + "\n");
    const service = createCodexGeneratedImageArtifactService({
      mediaAssetRepository: context.repositories.mediaAssets,
      sessionAttachmentRepository: context.repositories.sessionAttachments,
      storageDir: path.join(context.config.dataDir, "media-assets"),
      generatedImagesRoot
    });

    const first = await service.syncFromRollout({ sessionId, rolloutPath });
    const second = await service.syncFromRollout({ sessionId, rolloutPath });

    expect(first.artifacts).toHaveLength(1);
    expect(second.artifacts).toHaveLength(1);
    expect(first.createdAssetIds).toEqual([first.artifacts[0].asset.id]);
    expect(second.createdAssetIds).toEqual([]);
    expect(first.artifacts[0].asset).toMatchObject({
      sessionId,
      source: "codexEvent",
      kind: "image",
      fileName: "ig_test.png",
      mimeType: "image/png",
      status: "available",
      expiresAt: null
    });
    expect(first.artifacts[0].attachment).toMatchObject({
      sessionId,
      assetId: first.artifacts[0].asset.id,
      role: "codexArtifact",
      codexInputStatus: "notRequired"
    });
    expect(context.repositories.mediaAssets.listBySession(sessionId)).toHaveLength(1);
    expect(context.repositories.sessionAttachments.listBySession(sessionId)).toHaveLength(1);
    expect((await context.mediaAssets.readAssetContent(first.artifacts[0].asset.id)).content.equals(PNG_BYTES)).toBe(true);
  });
});
