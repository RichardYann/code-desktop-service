import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runtimeConfigForTurn } from "../appContext.js";
import { createSessionRuntimeConfigService, type CodexModelOption } from "../domain/sessionRuntimeConfigService.js";
import { openDatabase } from "../storage/db.js";
import { createRepositories } from "../storage/repositories.js";

describe("session runtime config service", () => {
  it("returns safe defaults for sessions without saved config", () => {
    const service = createSessionRuntimeConfigService();

    expect(service.get("thread-1")).toMatchObject({
      sessionId: "thread-1",
      model: null,
      effort: "default",
      permissionMode: "workspace",
      approvalMode: "on-request",
      approvalsReviewer: "user"
    });
  });

  it("preserves official approvals reviewer choices", () => {
    const service = createSessionRuntimeConfigService();

    const saved = service.update("thread-1", {
      model: null,
      effort: "default",
      permissionMode: "workspace",
      approvalMode: "on-request",
      approvalsReviewer: "auto_review"
    });

    expect(saved).toMatchObject({
      sessionId: "thread-1",
      permissionMode: "workspace",
      approvalMode: "on-request",
      approvalsReviewer: "auto_review"
    });
  });

  it("persists approvals reviewer choices in sqlite", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-runtime-config-db-"));
    const db = openDatabase("runtime.sqlite", { dataDir });
    const repositories = createRepositories(db);
    const service = createSessionRuntimeConfigService(repositories);

    service.update("thread-1", {
      model: null,
      effort: "default",
      permissionMode: "workspace",
      approvalMode: "on-request",
      approvalsReviewer: "auto_review"
    });

    expect(createSessionRuntimeConfigService(repositories).get("thread-1")).toMatchObject({
      sessionId: "thread-1",
      approvalsReviewer: "auto_review"
    });
    db.close();
  });

  it("returns codex session config until the user saves an override", () => {
    const service = createSessionRuntimeConfigService();
    service.saveCodexSessionConfig("thread-1", {
      model: "gpt-5.4",
      effort: "medium",
      permissionMode: "readonly",
      approvalMode: "manual"
    }, "codex-session");

    expect(service.get("thread-1")).toMatchObject({
      sessionId: "thread-1",
      model: "gpt-5.4",
      effort: "medium",
      permissionMode: "readonly",
      approvalMode: "manual"
    });

    service.update("thread-1", {
      model: "gpt-5.5",
      effort: "high",
      permissionMode: "workspace",
      approvalMode: "on-request"
    });

    expect(service.get("thread-1")).toMatchObject({
      sessionId: "thread-1",
      model: "gpt-5.5",
      effort: "high",
      permissionMode: "workspace",
      approvalMode: "on-request"
    });
  });

  it("separates display baseline config from user turn overrides", () => {
    const service = createSessionRuntimeConfigService();
    service.saveCodexSessionConfig("thread-1", {
      model: "gpt-5.4",
      effort: "medium",
      permissionMode: "workspace",
      approvalMode: "on-request"
    }, "codex-default-snapshot");

    expect(service.get("thread-1")).toMatchObject({
      sessionId: "thread-1",
      model: "gpt-5.4",
      effort: "medium"
    });
    expect(service.getUserOverride("thread-1")).toBeNull();

    service.update("thread-1", {
      model: "gpt-5.5",
      effort: "high",
      permissionMode: "workspace",
      approvalMode: "on-request",
      approvalsReviewer: "auto_review"
    });

    expect(service.getUserOverride("thread-1")).toMatchObject({
      sessionId: "thread-1",
      model: "gpt-5.5",
      effort: "high",
      approvalsReviewer: "auto_review"
    });
  });

  it("does not inject codex default snapshots into new turns", async () => {
    const service = createSessionRuntimeConfigService();
    let baselineReads = 0;
    const readBaseline = async () => {
      baselineReads++;
      return {
        model: "gpt-5.4",
        effort: "medium" as const,
        permissionMode: "workspace" as const,
        approvalMode: "on-request" as const
      };
    };

    await expect(runtimeConfigForTurn("thread-1", service, readBaseline)).resolves.toBeUndefined();
    expect(baselineReads).toBe(1);
    expect(service.get("thread-1")).toMatchObject({
      model: "gpt-5.4",
      effort: "medium"
    });

    await expect(runtimeConfigForTurn("thread-1", service, readBaseline)).resolves.toBeUndefined();
    expect(baselineReads).toBe(1);

    service.update("thread-1", {
      model: "gpt-5.5",
      effort: "high",
      permissionMode: "workspace",
      approvalMode: "on-request",
      approvalsReviewer: "auto_review"
    });

    await expect(runtimeConfigForTurn("thread-1", service, readBaseline)).resolves.toMatchObject({
      model: "gpt-5.5",
      effort: "high",
      approvalsReviewer: "auto_review"
    });
  });

  it("normalizes manual approval to readonly mode", () => {
    const service = createSessionRuntimeConfigService();
    const saved = service.update("thread-1", {
      model: null,
      effort: "medium",
      permissionMode: "workspace",
      approvalMode: "manual"
    });

    expect(saved.permissionMode).toBe("readonly");
    expect(saved.approvalMode).toBe("manual");
  });

  it("falls back from full access no-approval when permission is reduced", () => {
    const service = createSessionRuntimeConfigService();
    service.update("thread-1", {
      model: null,
      effort: "high",
      permissionMode: "full-access",
      approvalMode: "full-access-never"
    });

    const saved = service.update("thread-1", {
      model: null,
      effort: "medium",
      permissionMode: "workspace",
      approvalMode: "full-access-never"
    });

    expect(saved.permissionMode).toBe("workspace");
    expect(saved.approvalMode).toBe("on-request");
  });

  it("rejects full access no-approval without full access permission", () => {
    const service = createSessionRuntimeConfigService();

    expect(() => service.update("thread-1", {
      model: null,
      effort: "high",
      permissionMode: "workspace",
      approvalMode: "full-access-never"
    })).toThrow("Full Access 免审批只能用于 Full Access 权限");
  });

  it("rejects unavailable models and unsupported reasoning efforts", () => {
    const service = createSessionRuntimeConfigService();
    const models: CodexModelOption[] = [{
      id: "gpt-5.5",
      label: "GPT-5.5",
      isDefault: true,
      hidden: false,
      isAvailable: true,
      supportedEfforts: ["low", "medium"]
    }];

    expect(() => service.update("thread-1", {
      model: "missing-model",
      effort: "medium",
      permissionMode: "workspace",
      approvalMode: "on-request"
    }, { models })).toThrow("模型不可用，请重新选择模型");

    expect(() => service.update("thread-1", {
      model: "gpt-5.5",
      effort: "high",
      permissionMode: "workspace",
      approvalMode: "on-request"
    }, { models })).toThrow("当前模型不支持所选思考强度");
  });
});
