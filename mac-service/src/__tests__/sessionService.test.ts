import { describe, expect, it } from "vitest";
import { canWithdraw, createSessionService, type SessionSummary } from "../domain/sessionService.js";

describe("session service", () => {
  it("searches only current Codex and current Mac sessions", () => {
    const service = createSessionService();
    service.addSession({ id: "1", toolId: "codex-mac", title: "修复登录", projectPath: "/repo/a", projectName: "a", createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "ok" });
    service.addSession({ id: "2", toolId: "other-mac", title: "修复登录", projectPath: "/repo/b", projectName: "b", createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "ok" });

    expect(service.search("codex-mac", "登录").map((item) => item.id)).toEqual(["1"]);
  });

  it("updates pin state", () => {
    const service = createSessionService();
    service.addSession({ id: "1", toolId: "codex-mac", title: "A", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "ok" });

    service.setPinned("1", true);
    expect(service.get("1")?.isPinned).toBe(true);
  });

  it("returns the locally preserved pin state when refreshing an existing session", () => {
    const service = createSessionService();
    service.addSession({ id: "1", toolId: "codex-mac", title: "A", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "ok" });
    service.setPinned("1", true);

    const refreshed = service.addSession({ id: "1", toolId: "codex-mac", title: "A loaded", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:01:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "loaded" });

    expect(refreshed.isPinned).toBe(true);
    expect(service.get("1")?.isPinned).toBe(true);
  });

  it("keeps a pending session pending when a Codex list snapshot lacks approval state", () => {
    const service = createSessionService();
    service.addSession({ id: "1", toolId: "codex-mac", title: "需要审批", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:30.000Z", isPinned: false, needsUserInput: true, waitsForNextDirection: false, statusLabel: "waiting_for_approval", lastMessagePreview: "是否允许 Codex 运行命令？" });

    const snapshot = service.replaceToolSessions("codex-mac", [{
      id: "1",
      toolId: "codex-mac",
      title: "需要审批",
      projectPath: null,
      projectName: null,
      createdAt: "2026-05-05T08:00:00.000Z",
      updatedAt: "2026-05-05T08:01:00.000Z",
      isPinned: false,
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "notLoaded",
      lastMessagePreview: ""
    }]);

    expect(snapshot[0]).toMatchObject({
      id: "1",
      needsUserInput: true,
      waitsForNextDirection: false,
      statusLabel: "waiting_for_approval",
      lastMessagePreview: "是否允许 Codex 运行命令？"
    });
    expect(service.get("1")?.needsUserInput).toBe(true);
  });

  it("does not preserve idle next-direction waits as pending state", () => {
    const service = createSessionService();
    service.addSession({ id: "1", toolId: "codex-mac", title: "等待下一步", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:30.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: true, statusLabel: "completed", lastMessagePreview: "已完成" });

    const snapshot = service.replaceToolSessions("codex-mac", [{
      id: "1",
      toolId: "codex-mac",
      title: "等待下一步",
      projectPath: null,
      projectName: null,
      createdAt: "2026-05-05T08:00:00.000Z",
      updatedAt: "2026-05-05T08:01:00.000Z",
      isPinned: false,
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "idle",
      lastMessagePreview: ""
    }]);

    expect(snapshot[0]).toMatchObject({
      id: "1",
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "idle"
    });
    expect(service.get("1")?.waitsForNextDirection).toBe(false);
  });

  it("replaces old preview-derived titles when a later refresh only has a generic title", () => {
    const service = createSessionService();
    const preview = "当前源码 Mac 服务已启动并监听 `37631`。我先验证进入 Codex 不再触发 appfreeze";
    service.addSession({ id: "1", toolId: "codex-mac", title: preview.slice(0, 60), projectPath: "/repo/code", projectName: "code", createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: preview });

    const refreshed = service.addSession({ id: "1", toolId: "codex-mac", title: "Codex 会话", projectPath: "/repo/code", projectName: "code", createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:01:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "" });

    expect(refreshed.title).toBe("Codex 会话");
    expect(service.get("1")?.title).toBe("Codex 会话");
  });

  it("does not replace an existing real title with a generic unloaded title", () => {
    const service = createSessionService();
    service.addSession({ id: "1", toolId: "codex-mac", title: "test test test", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "running", lastMessagePreview: "" });

    const refreshed = service.addSession({ id: "1", toolId: "codex-mac", title: "Codex 会话", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:01:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "" });

    expect(refreshed.title).toBe("test test test");
    expect(service.get("1")?.title).toBe("test test test");
  });

  it("does not replace a newer local rename with an older Codex list snapshot", () => {
    const service = createSessionService();
    service.addSession({ id: "1", toolId: "codex-mac", title: "test test test", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "" });
    service.rename("1", "移动端改名");

    const refreshed = service.addSession({ id: "1", toolId: "codex-mac", title: "test test test", projectPath: null, projectName: null, createdAt: "2026-05-05T08:00:00.000Z", updatedAt: "2026-05-05T08:01:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "" });

    expect(refreshed.title).toBe("移动端改名");
    expect(service.get("1")?.title).toBe("移动端改名");
  });

  it("loads and saves sessions through the repository", () => {
    const saved: SessionSummary[] = [{
      id: "persisted-1",
      toolId: "codex-mac",
      title: "已保存会话",
      projectPath: null,
      projectName: null,
      createdAt: "2026-05-11T00:00:00.000Z",
      updatedAt: "2026-05-11T00:00:00.000Z",
      isPinned: false,
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "running",
      lastMessagePreview: "恢复"
    }];
    const persisted: SessionSummary[] = [];
    const service = createSessionService({
      listSessions: () => saved,
      saveSession: (session) => {
        persisted.push(session);
      }
    });

    expect(service.list("codex-mac").map((session) => session.id)).toEqual(["persisted-1"]);

    service.addSession({
      id: "created-1",
      toolId: "codex-mac",
      title: "新建会话",
      projectPath: null,
      projectName: null,
      createdAt: "2026-05-11T00:01:00.000Z",
      updatedAt: "2026-05-11T00:01:00.000Z",
      isPinned: false,
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "running",
      lastMessagePreview: "开始"
    });
    service.setPinned("created-1", true);

    expect(persisted.map((session) => ({ id: session.id, isPinned: session.isPinned }))).toEqual([
      { id: "created-1", isPinned: false },
      { id: "created-1", isPinned: true }
    ]);
  });

  it("replaces one tool session list and drops cached sessions missing from the latest snapshot", () => {
    const service = createSessionService();
    service.addSession({ id: "archived-on-mac", toolId: "codex-mac", title: "归档会话", projectPath: null, projectName: null, createdAt: "2026-05-10T00:00:00.000Z", updatedAt: "2026-05-10T00:00:00.000Z", isPinned: false, needsUserInput: true, waitsForNextDirection: false, statusLabel: "waiting", lastMessagePreview: "" });
    service.addSession({ id: "still-on-mac", toolId: "codex-mac", title: "旧标题", projectPath: null, projectName: null, createdAt: "2026-05-10T00:00:00.000Z", updatedAt: "2026-05-10T00:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "" });
    service.addSession({ id: "other-tool", toolId: "other-mac", title: "其他工具", projectPath: null, projectName: null, createdAt: "2026-05-10T00:00:00.000Z", updatedAt: "2026-05-10T00:00:00.000Z", isPinned: false, needsUserInput: false, waitsForNextDirection: false, statusLabel: "idle", lastMessagePreview: "" });

    const snapshot = service.replaceToolSessions("codex-mac", [{
      id: "still-on-mac",
      toolId: "codex-mac",
      title: "最新标题",
      projectPath: null,
      projectName: null,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
      isPinned: false,
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "idle",
      lastMessagePreview: ""
    }]);

    expect(snapshot.map((session) => session.id)).toEqual(["still-on-mac"]);
    expect(service.list("codex-mac").map((session) => session.id)).toEqual(["still-on-mac"]);
    expect(service.list("other-mac").map((session) => session.id)).toEqual(["other-tool"]);
  });

  it("persists tool session removals when replacing a snapshot", () => {
    const saved: SessionSummary[] = [];
    const retained: Array<{ toolId: string; ids: string[] }> = [];
    const service = createSessionService({
      listSessions: () => [],
      saveSession: (session) => {
        saved.push(session);
      },
      deleteSessionsForToolExcept: (toolId, ids) => {
        retained.push({ toolId, ids });
      }
    });

    service.replaceToolSessions("codex-mac", [{
      id: "thread-1",
      toolId: "codex-mac",
      title: "线程",
      projectPath: null,
      projectName: null,
      createdAt: "2026-05-10T00:00:00.000Z",
      updatedAt: "2026-05-10T00:01:00.000Z",
      isPinned: false,
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "idle",
      lastMessagePreview: ""
    }]);

    expect(saved.map((session) => session.id)).toEqual(["thread-1"]);
    expect(retained).toEqual([{ toolId: "codex-mac", ids: ["thread-1"] }]);
  });

  it("allows withdraw only while send is pending", () => {
    expect(canWithdraw("pending")).toBe(true);
    expect(canWithdraw("received")).toBe(false);
    expect(canWithdraw("failed")).toBe(false);
  });
});
