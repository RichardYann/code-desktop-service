import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectService } from "../domain/projectService.js";
import { openDatabase } from "../storage/db.js";
import { createRepositories } from "../storage/repositories.js";

afterEach(() => {
  vi.useRealTimers();
});

function createFixture(rootMode: "default" | "first" | "none" = "default") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-project-service-"));
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "code-root-a-"));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "code-root-b-"));
  const db = openDatabase("projects.sqlite", { dataDir });
  const repositories = createRepositories(db);
  const roots = rootMode === "first" ? [rootA] : rootMode === "none" ? [] : [rootA, rootB];
  const service = createProjectService({
    roots,
    projectRepository: repositories.projects,
    sessionRepository: repositories.projects
  });
  return { dataDir, rootA, rootB, repositories, service };
}

describe("project service", () => {
  it("lists configured roots with stable ids and writable state", () => {
    const { rootA, rootB, service } = createFixture();

    const roots = service.listRoots();

    expect(roots).toHaveLength(2);
    expect(roots[0]).toMatchObject({
      path: rootA,
      isDefault: true,
      isAvailable: true,
      isWritable: true,
      errorMessage: ""
    });
    expect(roots[1]).toMatchObject({
      path: rootB,
      isDefault: false,
      isAvailable: true,
      isWritable: true,
      errorMessage: ""
    });
    expect(roots[0].id).not.toEqual(roots[1].id);
  });

  it("creates a project under a configured root", () => {
    const { rootA, service } = createFixture();
    const rootId = service.listRoots()[0].id;

    const project = service.createProject({ rootId, projectName: "Mobile App" });

    expect(project.projectPath).toEqual(path.join(rootA, "Mobile App"));
    expect(project.projectName).toEqual("Mobile App");
    expect(project.createdByMobile).toBe(true);
    expect(fs.existsSync(project.projectPath)).toBe(true);
    expect(service.listProjects()[0].projectPath).toEqual(project.projectPath);
  });

  it("rejects unsafe project names", () => {
    const { service } = createFixture();
    const rootId = service.listRoots()[0].id;

    expect(() => service.createProject({ rootId, projectName: "../secret" })).toThrow("项目名不能包含路径分隔符");
    expect(() => service.createProject({ rootId, projectName: ".hidden" })).toThrow("项目名不能以 . 开头");
    expect(() => service.createProject({ rootId, projectName: "a".repeat(65) })).toThrow("项目名不能超过 64 个字符");
  });

  it("rejects duplicate project names without overwriting", () => {
    const { rootA, service } = createFixture();
    const rootId = service.listRoots()[0].id;
    const projectPath = path.join(rootA, "Existing App");
    fs.mkdirSync(projectPath);

    expect(() => service.createProject({ rootId, projectName: "Existing App" })).toThrow("同名项目已存在");
    expect(fs.existsSync(projectPath)).toBe(true);
  });

  it("adds and removes roots configured from the web management page", () => {
    const { rootA, rootB, service } = createFixture("first");

    const afterAdd = service.addRoot({ rootPath: rootB });

    expect(afterAdd.map((root) => root.path)).toEqual([rootA, rootB]);
    const dynamicRoot = afterAdd.find((root) => root.path === rootB);
    expect(dynamicRoot).toBeDefined();

    const afterRemove = service.removeRoot(dynamicRoot?.id ?? "");

    expect(afterRemove.map((root) => root.path)).toEqual([rootA]);
  });

  it("does not remove roots provided by startup configuration", () => {
    const { service } = createFixture();
    const staticRootId = service.listRoots()[0].id;

    expect(() => service.removeRoot(staticRootId)).toThrow("启动配置中的项目根目录不能在 Web 管理页移除");
  });

  it("rejects missing roots configured from the web management page", () => {
    const { service } = createFixture("none");
    const missingRoot = path.join(os.tmpdir(), `code-missing-root-${Date.now()}`);

    expect(() => service.addRoot({ rootPath: missingRoot })).toThrow("项目根目录在桌面端不存在");
  });

  it("hides and restores projects without deleting files", () => {
    const { service } = createFixture();
    const rootId = service.listRoots()[0].id;
    const project = service.createProject({ rootId, projectName: "Hidden App" });

    service.hideProject(project.projectPath);
    expect(service.listProjects().find((item) => item.projectPath === project.projectPath)?.isHidden).toBe(true);
    expect(fs.existsSync(project.projectPath)).toBe(true);

    service.unhideProject(project.projectPath);
    expect(service.listProjects().find((item) => item.projectPath === project.projectPath)?.isHidden).toBe(false);
  });

  it("merges historical session projects and preserves hidden state", () => {
    const { repositories, service } = createFixture();
    repositories.saveSession({
      id: "session-1",
      toolId: "codex-mac",
      title: "历史会话",
      projectPath: "/external/repo",
      projectName: "repo",
      createdAt: "2026-05-18T08:00:00.000Z",
      updatedAt: "2026-05-18T08:10:00.000Z",
      isPinned: false,
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "idle",
      lastMessagePreview: ""
    });

    service.hideProject("/external/repo");
    const project = service.listProjects().find((item) => item.projectPath === "/external/repo");

    expect(project).toMatchObject({
      projectName: "repo",
      rootId: null,
      isHidden: true,
      exists: false,
      isInsideKnownRoot: false,
      sessionCount: 1,
      createdByMobile: false
    });
  });

  it("keeps historical session projects when project roots are added or removed", () => {
    const { repositories, rootB, service } = createFixture("first");
    repositories.saveSession({
      id: "session-1",
      toolId: "codex-mac",
      title: "桌面端历史会话",
      projectPath: "/external/repo",
      projectName: "repo",
      createdAt: "2026-05-18T08:00:00.000Z",
      updatedAt: "2026-05-18T08:10:00.000Z",
      isPinned: false,
      needsUserInput: false,
      waitsForNextDirection: false,
      statusLabel: "idle",
      lastMessagePreview: ""
    });

    const addedRoots = service.addRoot({ rootPath: rootB });
    const dynamicRoot = addedRoots.find((root) => root.path === rootB);
    service.removeRoot(dynamicRoot?.id ?? "");

    const project = service.listProjects().find((item) => item.projectPath === "/external/repo");
    expect(project).toMatchObject({
      projectName: "repo",
      rootId: null,
      isHidden: false,
      isInsideKnownRoot: false,
      sessionCount: 1
    });
  });
});
