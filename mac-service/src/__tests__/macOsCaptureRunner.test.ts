import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMacOsCaptureRunner } from "../domain/macOsCaptureRunner.js";

describe("macOsCaptureRunner", () => {
  it("reads the PNG written by the screencapture command", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "code-macos-capture-test-"));
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const runner = createMacOsCaptureRunner({
      tempDir,
      runScreencapture: async (outputPath) => {
        await writeFile(outputPath, png);
      }
    });

    const content = await runner.captureScreenScreenshot?.({
      sessionId: "thread-1",
      deviceId: "device-1"
    });

    expect(content?.equals(png)).toBe(true);
  });

  it("captures a local web page with the page screenshot runner instead of screencapture", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "code-macos-local-web-capture-test-"));
    const pagePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
    let screenCaptureCalled = false;
    let capturedUrl = "";
    const runner = createMacOsCaptureRunner({
      tempDir,
      runScreencapture: async () => {
        screenCaptureCalled = true;
      },
      runChromeScreenshot: async (targetUrl, outputPath) => {
        capturedUrl = targetUrl;
        await writeFile(outputPath, pagePng);
      }
    });

    const content = await runner.captureLocalWebScreenshot?.({
      sessionId: "thread-1",
      localWebSessionId: "local-web-1",
      targetUrl: "http://127.0.0.1:5173/page",
      deviceId: "device-1"
    });

    expect(content?.equals(pagePng)).toBe(true);
    expect(capturedUrl).toBe("http://127.0.0.1:5173/page");
    expect(screenCaptureCalled).toBe(false);
  });
});
