import { describe, expect, it } from "vitest";
import { validateCaptureRequest } from "../domain/capturePolicy.js";

describe("capturePolicy", () => {
  it("allows user confirmed local web screenshot", () => {
    const result = validateCaptureRequest({
      kind: "localWebScreenshot",
      targetUrl: "http://127.0.0.1:5173",
      userConfirmed: true
    });

    expect(result.ok).toBe(true);
  });

  it("requires confirmation for screen screenshot", () => {
    const result = validateCaptureRequest({
      kind: "screenScreenshot",
      targetUrl: null,
      userConfirmed: false
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("需要用户确认");
  });

  it("rejects recording requests in v2", () => {
    const result = validateCaptureRequest({
      kind: "screenRecording",
      targetUrl: null,
      userConfirmed: true
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("V2 不支持录屏");
  });
});
