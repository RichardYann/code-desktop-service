import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProjectSessionStats, StoredManagedProject, StoredProjectRoot } from "../storage/repositories.js";

export interface ProjectRoot {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  isAvailable: boolean;
  isWritable: boolean;
  lastCheckedAt: string;
  errorMessage: string;
}

export interface ManagedProject {
  projectPath: string;
  projectName: string;
  rootId: string | null;
  isHidden: boolean;
  exists: boolean;
  isInsideKnownRoot: boolean;
  lastUsedAt: string | null;
  sessionCount: number;
  createdByMobile: boolean;
  updatedAt: string;
}

export interface ProjectRepository {
  saveRoot(root: StoredProjectRoot): StoredProjectRoot;
  removeRoot(rootPath: string): void;
  listRoots(): StoredProjectRoot[];
  save(project: StoredManagedProject): StoredManagedProject;
  get(projectPath: string): StoredManagedProject | null;
  list(): StoredManagedProject[];
  setHidden(projectPath: string, isHidden: boolean, now: string): StoredManagedProject;
}

export interface SessionProjectRepository {
  listSessionProjectStats(): ProjectSessionStats[];
}

export interface ProjectServiceDeps {
  roots: string[];
  projectRepository: ProjectRepository;
  sessionRepository: SessionProjectRepository;
}

function nowIso(): string {
  return new Date().toISOString();
}

function rootIdFor(rootPath: string): string {
  return "root-" + crypto.createHash("sha256").update(path.resolve(rootPath)).digest("hex").slice(0, 12);
}

function nameFromPath(inputPath: string): string {
  const base = path.basename(inputPath);
  return base.length > 0 ? base : inputPath;
}

function normalizedRoots(roots: string[]): string[] {
  const result: string[] = [];
  for (const root of roots) {
    if (root.trim().length === 0) continue;
    const resolved = path.resolve(root);
    if (!result.includes(resolved)) result.push(resolved);
  }
  return result;
}

function pathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hasWindowsReservedProjectNameCharacter(value: string): boolean {
  return /[<>"|?*]/.test(value);
}

function isWindowsReservedDeviceName(value: string): boolean {
  const baseName = value.split(".")[0].toLowerCase();
  return baseName === "con" ||
    baseName === "prn" ||
    baseName === "aux" ||
    baseName === "nul" ||
    baseName === "conin$" ||
    baseName === "conout$" ||
    /^com[1-9]$/.test(baseName) ||
    /^lpt[1-9]$/.test(baseName);
}

function validateProjectName(input: string): string {
  const name = input.trim();
  if (name.length === 0) {
    throw new Error("项目名不能为空");
  }
  if (name.length > 64) {
    throw new Error("项目名不能超过 64 个字符");
  }
  if (name.includes("/") || name.includes("\\") || name.includes(":")) {
    throw new Error("项目名不能包含路径分隔符");
  }
  if (hasWindowsReservedProjectNameCharacter(name)) {
    throw new Error("项目名不能包含 Windows 保留字符");
  }
  if (/[\x00-\x1F]/.test(name)) {
    throw new Error("项目名不能包含控制字符");
  }
  if (name === "..") {
    throw new Error("项目名不能为 ..");
  }
  if (name.startsWith(".")) {
    throw new Error("项目名不能以 . 开头");
  }
  if (name.endsWith(" ") || name.endsWith(".")) {
    throw new Error("项目名不能以空格或 . 结尾");
  }
  if (isWindowsReservedDeviceName(name)) {
    throw new Error("项目名不能使用 Windows 保留设备名");
  }
  return name;
}

function validateRootPath(input: string): string {
  const rootPath = path.resolve(input.trim());
  if (input.trim().length === 0) {
    throw new Error("项目根目录不能为空");
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(rootPath);
  } catch {
    throw new Error("项目根目录在桌面端不存在");
  }
  if (!stat.isDirectory()) {
    throw new Error("项目根目录必须是文件夹");
  }
  try {
    fs.accessSync(rootPath, fs.constants.W_OK);
  } catch {
    throw new Error("桌面端服务没有该根目录的写入权限");
  }
  return rootPath;
}

function rootState(rootPath: string, index: number): ProjectRoot {
  const checkedAt = nowIso();
  let isAvailable = false;
  let isWritable = false;
  let errorMessage = "";
  try {
    const stat = fs.statSync(rootPath);
    isAvailable = stat.isDirectory();
    if (!isAvailable) {
      errorMessage = "该根目录在桌面端不可用";
    } else {
      fs.accessSync(rootPath, fs.constants.W_OK);
      isWritable = true;
    }
  } catch (error) {
    if (isAvailable) {
      errorMessage = "桌面端服务没有写入权限";
    } else if (error instanceof Error && error.message.length > 0) {
      errorMessage = "该根目录在桌面端不可用";
    } else {
      errorMessage = "该根目录在桌面端不可用";
    }
  }

  return {
    id: rootIdFor(rootPath),
    name: nameFromPath(rootPath),
    path: rootPath,
    isDefault: index === 0,
    isAvailable,
    isWritable,
    lastCheckedAt: checkedAt,
    errorMessage
  };
}

export function createProjectService(deps: ProjectServiceDeps) {
  const staticRoots = normalizedRoots(deps.roots);

  function configuredRootPaths(): string[] {
    return normalizedRoots([
      ...staticRoots,
      ...deps.projectRepository.listRoots().map((root) => root.rootPath)
    ]);
  }

  function listRoots(): ProjectRoot[] {
    return configuredRootPaths().map((rootPath, index) => rootState(rootPath, index));
  }

  function rootForId(rootId: string): ProjectRoot {
    const root = listRoots().find((item) => item.id === rootId);
    if (!root) {
      throw new Error("项目根目录不存在");
    }
    if (!root.isAvailable) {
      throw new Error(root.errorMessage || "该根目录在桌面端不可用");
    }
    if (!root.isWritable) {
      throw new Error(root.errorMessage || "桌面端服务没有写入权限");
    }
    return root;
  }

  function findRootForProject(projectPath: string): ProjectRoot | null {
    const resolvedProjectPath = path.resolve(projectPath);
    const currentRoots = listRoots();
    for (const root of currentRoots) {
      if (pathInsideRoot(resolvedProjectPath, root.path)) {
        return root;
      }
    }
    return null;
  }

  function toManagedProject(project: StoredManagedProject, stats: ProjectSessionStats | null): ManagedProject {
    const projectPath = path.resolve(project.projectPath);
    const root = findRootForProject(projectPath);
    const lastUsedAt = stats?.lastUsedAt ?? project.lastUsedAt;
    return {
      projectPath,
      projectName: stats?.projectName ?? project.projectName,
      rootId: root?.id ?? project.rootId,
      isHidden: project.isHidden,
      exists: fs.existsSync(projectPath),
      isInsideKnownRoot: root !== null,
      lastUsedAt,
      sessionCount: stats?.sessionCount ?? 0,
      createdByMobile: project.createdByMobile,
      updatedAt: lastUsedAt ?? project.updatedAt
    };
  }

  function listProjects(): ManagedProject[] {
    const stats = deps.sessionRepository.listSessionProjectStats();
    const statsByPath = new Map<string, ProjectSessionStats>();
    for (const entry of stats) {
      statsByPath.set(path.resolve(entry.projectPath), {
        ...entry,
        projectPath: path.resolve(entry.projectPath)
      });
    }

    const managed = deps.projectRepository.list();
    const merged = new Map<string, ManagedProject>();
    for (const project of managed) {
      const projectPath = path.resolve(project.projectPath);
      merged.set(projectPath, toManagedProject({ ...project, projectPath }, statsByPath.get(projectPath) ?? null));
    }

    for (const entry of statsByPath.values()) {
      if (merged.has(entry.projectPath)) continue;
      const existing = deps.projectRepository.get(entry.projectPath);
      const stored: StoredManagedProject = existing ?? {
        projectPath: entry.projectPath,
        projectName: entry.projectName || nameFromPath(entry.projectPath),
        rootId: null,
        isHidden: false,
        createdByMobile: false,
        lastUsedAt: entry.lastUsedAt,
        createdAt: entry.lastUsedAt,
        updatedAt: entry.lastUsedAt
      };
      merged.set(entry.projectPath, toManagedProject(stored, entry));
    }

    return [...merged.values()].sort((a, b) => {
      if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
  }

  function projectFromPath(projectPath: string): ManagedProject {
    const resolved = path.resolve(projectPath);
    const found = listProjects().find((project) => project.projectPath === resolved);
    if (found) return found;
    const now = nowIso();
    return toManagedProject({
      projectPath: resolved,
      projectName: nameFromPath(resolved),
      rootId: null,
      isHidden: false,
      createdByMobile: false,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now
    }, null);
  }

  return {
    listRoots,

    listProjects,

    addRoot(input: { rootPath: string }): ProjectRoot[] {
      const rootPath = validateRootPath(input.rootPath);
      const now = nowIso();
      deps.projectRepository.saveRoot({
        rootPath,
        createdAt: now,
        updatedAt: now
      });
      return listRoots();
    },

    removeRoot(rootId: string): ProjectRoot[] {
      const root = listRoots().find((item) => item.id === rootId);
      if (!root) {
        throw new Error("项目根目录不存在");
      }
      if (staticRoots.includes(root.path)) {
        throw new Error("启动配置中的项目根目录不能在 Web 管理页移除");
      }
      deps.projectRepository.removeRoot(root.path);
      return listRoots();
    },

    createProject(input: { rootId: string; projectName: string }): ManagedProject {
      const name = validateProjectName(input.projectName);
      const root = rootForId(input.rootId);
      const projectPath = path.resolve(root.path, name);
      if (!pathInsideRoot(projectPath, root.path)) {
        throw new Error("项目路径必须位于配置的根目录内");
      }
      if (fs.existsSync(projectPath)) {
        throw new Error("同名项目已存在");
      }
      fs.mkdirSync(projectPath);
      const now = nowIso();
      deps.projectRepository.save({
        projectPath,
        projectName: name,
        rootId: root.id,
        isHidden: false,
        createdByMobile: true,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now
      });
      return projectFromPath(projectPath);
    },

    hideProject(projectPath: string): ManagedProject {
      const resolved = path.resolve(projectPath);
      deps.projectRepository.setHidden(resolved, true, nowIso());
      return projectFromPath(resolved);
    },

    unhideProject(projectPath: string): ManagedProject {
      const resolved = path.resolve(projectPath);
      deps.projectRepository.setHidden(resolved, false, nowIso());
      return projectFromPath(resolved);
    }
  };
}
