import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import type { CaptureRunner } from "./captureService.js";

export interface MacOsCaptureRunnerOptions {
  tempDir?: string;
  runScreencapture?: (outputPath: string) => Promise<void>;
  runChromeScreenshot?: (targetUrl: string, outputPath: string) => Promise<void>;
  chromePath?: string;
}

export function createMacOsCaptureRunner(options: MacOsCaptureRunnerOptions = {}): CaptureRunner {
  return {
    captureLocalWebScreenshot: async (input) => captureLocalWebPage(options, input.targetUrl),
    captureScreenScreenshot: async () => captureScreen(options)
  };
}

async function captureLocalWebPage(options: MacOsCaptureRunnerOptions, targetUrl: string): Promise<Buffer> {
  const parentDir = options.tempDir ?? os.tmpdir();
  const tempDir = await mkdtemp(path.join(parentDir, "code-local-web-capture-"));
  const outputPath = path.join(tempDir, "local-web.png");
  try {
    if (options.runChromeScreenshot) {
      await options.runChromeScreenshot(targetUrl, outputPath);
    } else {
      await execa(options.chromePath ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=1280,800",
        `--screenshot=${outputPath}`,
        targetUrl
      ], { timeout: 20_000 });
    }
    return await readFile(outputPath);
  } catch (error) {
    const detail = error instanceof Error && error.message.length > 0 ? error.message : "unknown error";
    throw new Error("Mac 本地 Web 页面截图失败：" + detail);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function captureScreen(options: MacOsCaptureRunnerOptions): Promise<Buffer> {
  const parentDir = options.tempDir ?? os.tmpdir();
  const tempDir = await mkdtemp(path.join(parentDir, "code-screen-capture-"));
  const outputPath = path.join(tempDir, "screen.png");
  try {
    if (options.runScreencapture) {
      await options.runScreencapture(outputPath);
    } else {
      await execa("/usr/sbin/screencapture", ["-x", "-t", "png", outputPath], { timeout: 15_000 });
    }
    return await readFile(outputPath);
  } catch (error) {
    const detail = error instanceof Error && error.message.length > 0 ? error.message : "unknown error";
    throw new Error("Mac 屏幕截图失败：" + detail);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
