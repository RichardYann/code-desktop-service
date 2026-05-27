import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listInstalledCodexCapabilities } from "../domain/installedCodexCapabilities.js";

function writeSkill(skillDir: string, name: string, description: string): void {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    `# ${name}`
  ].join("\n"));
}

describe("installed Codex capabilities", () => {
  it("lists installed skills and plugins without exposing full paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-capabilities-"));
    const codexHome = path.join(root, "codex-home");
    const codexUserHome = path.join(root, ".codex");
    const agentsHome = path.join(root, ".agents");
    const pluginDir = path.join(codexUserHome, "plugins", "cache", "openai-curated", "github", "7955f1db");
    const pluginSkillDir = path.join(codexUserHome, "plugins", "cache", "openai-curated", "superpowers", "7955f1db", "skills", "writing-plans");

    writeSkill(
      path.join(codexHome, "skills", "frontend-design"),
      "frontend-design",
      "Create production-grade frontend interfaces"
    );
    writeSkill(
      path.join(codexUserHome, "skills", "imagegen"),
      "imagegen",
      "Generate raster images"
    );
    writeSkill(
      path.join(agentsHome, "skills", "open-pencil"),
      "open-pencil",
      "Inspect local design files"
    );
    writeSkill(pluginSkillDir, "writing-plans", "Write comprehensive implementation plans");

    fs.mkdirSync(path.join(pluginDir, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, ".codex-plugin", "plugin.json"), JSON.stringify({
      name: "github",
      description: "Inspect repositories and pull requests",
      interface: {
        displayName: "GitHub",
        shortDescription: "Triage PRs and issues"
      }
    }));

    const capabilities = listInstalledCodexCapabilities({
      codexHome,
      codexUserHome,
      agentsHome
    });

    expect(capabilities).toEqual([
      {
        id: "skill:agents:open-pencil",
        kind: "skill",
        name: "open-pencil",
        description: "Inspect local design files",
        source: "agents",
        isAvailable: true
      },
      {
        id: "skill:codex-home:frontend-design",
        kind: "skill",
        name: "frontend-design",
        description: "Create production-grade frontend interfaces",
        source: "codex-home",
        isAvailable: true
      },
      {
        id: "skill:codex-user:imagegen",
        kind: "skill",
        name: "imagegen",
        description: "Generate raster images",
        source: "codex-user",
        isAvailable: true
      },
      {
        id: "skill:plugin:openai-curated/superpowers/writing-plans",
        kind: "skill",
        name: "writing-plans",
        description: "Write comprehensive implementation plans",
        source: "plugin:openai-curated/superpowers",
        isAvailable: true
      },
      {
        id: "plugin:codex-cache:openai-curated/github",
        kind: "plugin",
        name: "GitHub",
        description: "Triage PRs and issues",
        source: "codex-cache",
        isAvailable: true
      }
    ]);
    expect(JSON.stringify(capabilities)).not.toContain(root);
  });

  it("skips skills without parseable frontmatter and plugins without parseable manifests", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-capabilities-invalid-"));
    const codexHome = path.join(root, ".codex");
    const invalidSkillDir = path.join(codexHome, "skills", "broken");
    const invalidPluginDir = path.join(codexHome, "plugins", "cache", "publisher", "broken-plugin", "version");

    fs.mkdirSync(invalidSkillDir, { recursive: true });
    fs.writeFileSync(path.join(invalidSkillDir, "SKILL.md"), "# Missing frontmatter");
    fs.mkdirSync(path.join(invalidPluginDir, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(path.join(invalidPluginDir, ".codex-plugin", "plugin.json"), "{");

    expect(listInstalledCodexCapabilities({
      codexHome,
      codexUserHome: codexHome,
      agentsHome: path.join(root, ".agents")
    })).toEqual([]);
  });

  it("includes bundled system skills under the hidden .system directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-capabilities-system-"));
    const codexHome = path.join(root, ".codex");

    writeSkill(
      path.join(codexHome, "skills", ".system", "imagegen"),
      "imagegen",
      "Generate or edit raster images"
    );

    expect(listInstalledCodexCapabilities({
      codexHome,
      codexUserHome: codexHome,
      agentsHome: path.join(root, ".agents")
    })).toEqual([{
      id: "skill:codex-system:imagegen",
      kind: "skill",
      name: "imagegen",
      description: "Generate or edit raster images",
      source: "codex-system",
      isAvailable: true
    }]);
  });

  it("scans plugin skills from every cached version directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-capabilities-versions-"));
    const codexHome = path.join(root, ".codex");
    fs.mkdirSync(path.join(
      codexHome,
      "plugins",
      "cache",
      "openai-curated",
      "github",
      "11111111",
      "skills"
    ), { recursive: true });
    writeSkill(
      path.join(codexHome, "plugins", "cache", "openai-curated", "github", "22222222", "skills", "gh-fix-ci"),
      "gh-fix-ci",
      "Debug failing GitHub Actions checks"
    );

    expect(listInstalledCodexCapabilities({
      codexHome,
      codexUserHome: codexHome,
      agentsHome: path.join(root, ".agents")
    })).toEqual([{
      id: "skill:plugin:openai-curated/github/gh-fix-ci",
      kind: "skill",
      name: "gh-fix-ci",
      description: "Debug failing GitHub Actions checks",
      source: "plugin:openai-curated/github",
      isAvailable: true
    }]);
  });
});
