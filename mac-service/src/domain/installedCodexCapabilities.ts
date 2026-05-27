import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type InstalledCapabilityKind = "skill" | "plugin";

export interface InstalledCodexCapability {
  id: string;
  kind: InstalledCapabilityKind;
  name: string;
  description: string;
  source: string;
  isAvailable: boolean;
}

export interface InstalledCapabilityRoots {
  codexHome?: string;
  codexUserHome?: string;
  agentsHome?: string;
}

interface ParsedFrontmatter {
  name: string;
  description: string;
}

function defaultCodexUserHome(): string {
  return path.join(os.homedir(), ".codex");
}

function defaultCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured && configured.length > 0 ? configured : defaultCodexUserHome();
}

function defaultAgentsHome(): string {
  return path.join(os.homedir(), ".agents");
}

function readText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readDirectories(root: string): fs.Dirent[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function parseFrontmatter(text: string): ParsedFrontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const values = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    values.set(key, rawValue.replace(/^["']|["']$/g, ""));
  }
  return {
    name: values.get("name") ?? "",
    description: values.get("description") ?? ""
  };
}

function listSkillDirectory(
  root: string,
  source: string,
  idPrefix: string,
  separator = ":"
): InstalledCodexCapability[] {
  const capabilities: InstalledCodexCapability[] = [];
  for (const entry of readDirectories(root)) {
    const skillText = readText(path.join(root, entry.name, "SKILL.md"));
    if (!skillText) continue;
    const frontmatter = parseFrontmatter(skillText);
    if (!frontmatter) continue;
    const name = frontmatter.name.trim() || entry.name;
    if (name.length === 0) continue;
    capabilities.push({
      id: `${idPrefix}${separator}${entry.name}`,
      kind: "skill",
      name,
      description: frontmatter.description.trim(),
      source,
      isAvailable: true
    });
  }
  return capabilities;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readPluginManifest(manifestPath: string): { name: string; description: string } | null {
  const manifestText = readText(manifestPath);
  if (!manifestText) return null;
  try {
    const manifest = objectValue(JSON.parse(manifestText) as unknown);
    const pluginInterface = objectValue(manifest.interface);
    const name = stringValue(pluginInterface.displayName) || stringValue(manifest.name);
    const description = stringValue(pluginInterface.shortDescription) ||
      stringValue(pluginInterface.longDescription) ||
      stringValue(manifest.description);
    return name.length > 0 ? { name, description } : null;
  } catch {
    return null;
  }
}

function listPluginCachePlugins(cacheRoot: string): InstalledCodexCapability[] {
  const capabilities: InstalledCodexCapability[] = [];
  for (const publisher of readDirectories(cacheRoot)) {
    const publisherPath = path.join(cacheRoot, publisher.name);
    for (const plugin of readDirectories(publisherPath)) {
      const pluginPath = path.join(publisherPath, plugin.name);
      for (const version of readDirectories(pluginPath)) {
        const manifest = readPluginManifest(path.join(pluginPath, version.name, ".codex-plugin", "plugin.json"));
        if (!manifest) continue;
        capabilities.push({
          id: `plugin:codex-cache:${publisher.name}/${plugin.name}`,
          kind: "plugin",
          name: manifest.name,
          description: manifest.description,
          source: "codex-cache",
          isAvailable: true
        });
        break;
      }
    }
  }
  return capabilities;
}

function listPluginCacheSkills(cacheRoot: string): InstalledCodexCapability[] {
  const capabilities: InstalledCodexCapability[] = [];
  for (const publisher of readDirectories(cacheRoot)) {
    const publisherPath = path.join(cacheRoot, publisher.name);
    for (const plugin of readDirectories(publisherPath)) {
      const pluginPath = path.join(publisherPath, plugin.name);
      for (const version of readDirectories(pluginPath)) {
        capabilities.push(...listSkillDirectory(
          path.join(pluginPath, version.name, "skills"),
          `plugin:${publisher.name}/${plugin.name}`,
          `skill:plugin:${publisher.name}/${plugin.name}`,
          "/"
        ));
      }
    }
  }
  return capabilities;
}

function addUnique(target: Map<string, InstalledCodexCapability>, capabilities: InstalledCodexCapability[]): void {
  for (const capability of capabilities) {
    if (!target.has(capability.id)) {
      target.set(capability.id, capability);
    }
  }
}

export function listInstalledCodexCapabilities(roots: InstalledCapabilityRoots = {}): InstalledCodexCapability[] {
  const codexHome = roots.codexHome ?? defaultCodexHome();
  const codexUserHome = roots.codexUserHome ?? (roots.codexHome ? roots.codexHome : defaultCodexUserHome());
  const agentsHome = roots.agentsHome ?? defaultAgentsHome();
  const capabilities = new Map<string, InstalledCodexCapability>();

  addUnique(capabilities, listSkillDirectory(path.join(codexHome, "skills"), "codex-home", "skill:codex-home"));
  addUnique(capabilities, listSkillDirectory(path.join(codexHome, "skills", ".system"), "codex-system", "skill:codex-system"));
  if (path.resolve(codexUserHome) !== path.resolve(codexHome)) {
    addUnique(capabilities, listSkillDirectory(path.join(codexUserHome, "skills"), "codex-user", "skill:codex-user"));
    addUnique(capabilities, listSkillDirectory(path.join(codexUserHome, "skills", ".system"), "codex-user-system", "skill:codex-user-system"));
  }
  addUnique(capabilities, listSkillDirectory(path.join(agentsHome, "skills"), "agents", "skill:agents"));

  const pluginCacheRoot = path.join(codexUserHome, "plugins", "cache");
  addUnique(capabilities, listPluginCacheSkills(pluginCacheRoot));
  addUnique(capabilities, listPluginCachePlugins(pluginCacheRoot));

  const kindRank = (kind: InstalledCapabilityKind): number => kind === "skill" ? 0 : 1;
  return [...capabilities.values()].sort((a, b) => {
    const kindComparison = kindRank(a.kind) - kindRank(b.kind);
    if (kindComparison !== 0) return kindComparison;
    const sourceComparison = a.source.localeCompare(b.source);
    if (sourceComparison !== 0) return sourceComparison;
    return a.name.localeCompare(b.name);
  });
}
