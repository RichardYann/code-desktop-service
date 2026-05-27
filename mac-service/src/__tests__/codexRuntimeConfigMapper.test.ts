import { describe, expect, it } from "vitest";
import { isRuntimeConfigParameterUnsupportedError, mapRuntimeConfigToTurnParams } from "../codex/codexRuntimeConfigMapper.js";

describe("codex runtime config mapper", () => {
  it("maps model and effort only when explicitly selected", () => {
    const defaultParams = mapRuntimeConfigToTurnParams({
      sessionId: "thread-1",
      model: null,
      effort: "default",
      permissionMode: "workspace",
      approvalMode: "on-request",
      approvalsReviewer: "user",
      updatedAt: "2026-05-14T00:00:00.000Z"
    }, { supportsPermissionsProfile: true });
    expect(defaultParams).not.toHaveProperty("model");
    expect(defaultParams).not.toHaveProperty("approvalsReviewer");

    expect(mapRuntimeConfigToTurnParams({
      sessionId: "thread-1",
      model: "gpt-5.5",
      effort: "high",
      permissionMode: "workspace",
      approvalMode: "on-request",
      approvalsReviewer: "auto_review",
      updatedAt: "2026-05-14T00:00:00.000Z"
    }, { supportsPermissionsProfile: true })).toMatchObject({
      model: "gpt-5.5",
      effort: "high",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      permissions: { type: "profile", id: ":workspace" }
    });
  });

  it("maps full access no-approval as an explicit high-risk profile", () => {
    expect(mapRuntimeConfigToTurnParams({
      sessionId: "thread-1",
      model: "gpt-5.5",
      effort: "xhigh",
      permissionMode: "full-access",
      approvalMode: "full-access-never",
      approvalsReviewer: "user",
      updatedAt: "2026-05-14T00:00:00.000Z"
    }, { supportsPermissionsProfile: true })).toMatchObject({
      approvalPolicy: "never",
      permissions: { type: "profile", id: ":danger-full-access" }
    });
  });

  it("does not send permissions and sandboxPolicy together", () => {
    const params = mapRuntimeConfigToTurnParams({
      sessionId: "thread-1",
      model: null,
      effort: "default",
      permissionMode: "readonly",
      approvalMode: "manual",
      approvalsReviewer: "user",
      updatedAt: "2026-05-14T00:00:00.000Z"
    }, { supportsPermissionsProfile: false });

    expect(params).toMatchObject({
      approvalPolicy: "on-request",
      sandboxPolicy: { type: "readOnly" }
    });
    expect(params).not.toHaveProperty("permissions");
  });

  it("detects only runtime parameter unsupported errors", () => {
    expect(isRuntimeConfigParameterUnsupportedError(new Error("Invalid params: unknown field permissions"))).toBe(true);
    expect(isRuntimeConfigParameterUnsupportedError(new Error("network failed"))).toBe(false);
  });
});
