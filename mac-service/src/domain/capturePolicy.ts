import { classifyLocalWebTarget } from "./localWebTargetPolicy.js";

export type CaptureRequestKind = "localWebScreenshot" | "screenScreenshot" | "screenRecording" | "localWebRecording";

export interface CaptureRequest {
  kind: CaptureRequestKind;
  targetUrl: string | null;
  userConfirmed: boolean;
}

export interface CaptureValidationResult {
  ok: boolean;
  message: string;
}

export function validateCaptureRequest(input: CaptureRequest): CaptureValidationResult {
  if (input.kind === "screenRecording" || input.kind === "localWebRecording") {
    return { ok: false, message: "当前版本暂不支持录制" };
  }
  if (!input.userConfirmed) {
    return { ok: false, message: "截图需要用户确认后才能执行" };
  }
  if (input.kind === "localWebScreenshot") {
    if (input.targetUrl === null || input.targetUrl.length === 0) {
      return { ok: false, message: "本地 Web 截图缺少目标页面" };
    }
    const target = classifyLocalWebTarget(input.targetUrl);
    if (!target.allowed) {
      return { ok: false, message: "只能截取已确认的桌面端本地 Web 页面" };
    }
  }
  return { ok: true, message: "" };
}
