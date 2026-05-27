import { describe, expect, it } from "vitest";
import { buildGuidedInput, stripMobileInputGuidance } from "../domain/inputGuidance.js";
import type { InstalledCodexCapability } from "../domain/installedCodexCapabilities.js";

const capabilities: InstalledCodexCapability[] = [
  {
    id: "skill:codex-home:frontend-design",
    kind: "skill",
    name: "frontend-design",
    description: "Create production-grade frontend interfaces",
    source: "codex-home",
    isAvailable: true
  },
  {
    id: "skill:agents:disabled",
    kind: "skill",
    name: "disabled",
    description: "Disabled skill",
    source: "agents",
    isAvailable: false
  },
  {
    id: "plugin:codex-cache:openai-curated/github",
    kind: "plugin",
    name: "GitHub",
    description: "Inspect repositories and pull requests",
    source: "codex-cache",
    isAvailable: true
  }
];

describe("input guidance", () => {
  it("keeps plain input unchanged after validating selected capabilities", () => {
    expect(buildGuidedInput({
      text: "  检查 README  ",
      guidance: { mode: "plain", selectedCapabilityIds: ["skill:codex-home:frontend-design"] },
      capabilities
    })).toBe("  检查 README  ");
  });

  it("keeps guided input unchanged when no capabilities are selected", () => {
    expect(buildGuidedInput({
      text: "整理 PR 反馈",
      guidance: { mode: "guided", selectedCapabilityIds: [] },
      capabilities
    })).toBe("整理 PR 反馈");
  });

  it("wraps selected skills and plugins for this turn without leaking paths", () => {
    const text = buildGuidedInput({
      text: "整理 PR 反馈",
      guidance: {
        mode: "guided",
        selectedCapabilityIds: [
          "skill:codex-home:frontend-design",
          "plugin:codex-cache:openai-curated/github"
        ]
      },
      capabilities
    });

    expect(text).toContain("<mobile-input-guidance>");
    expect(text).toContain("Selected skill for this turn: frontend-design");
    expect(text).toContain("Selected plugin for this turn: GitHub");
    expect(text).toContain("整理 PR 反馈");
    expect(text).not.toContain("Installed skill");
    expect(text).not.toContain("Installed plugin");
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain(".codex/plugins/cache");
  });

  it("strips the private mobile guidance block from echoed user text", () => {
    const guided = [
      "<mobile-input-guidance>",
      "The mobile user selected Codex capabilities for this turn.",
      "- Selected skill for this turn: imagegen",
      "</mobile-input-guidance>",
      "",
      "按照这个设计帮我生成一张效果图"
    ].join("\n");

    expect(stripMobileInputGuidance(guided)).toBe("按照这个设计帮我生成一张效果图");
  });

  it("only strips a complete mobile guidance block at the start of text", () => {
    expect(stripMobileInputGuidance("用户正文\n<mobile-input-guidance>\n内部\n</mobile-input-guidance>"))
      .toBe("用户正文\n<mobile-input-guidance>\n内部\n</mobile-input-guidance>");
    expect(stripMobileInputGuidance("<mobile-input-guidance>\n内部")).toBe("<mobile-input-guidance>\n内部");
  });

  it.each(["plain", "guided", "queued", "steer-now"] as const)("rejects unavailable selected capabilities for %s input", (mode) => {
    expect(() => buildGuidedInput({
      text: "继续",
      guidance: { mode, selectedCapabilityIds: ["skill:agents:disabled"] },
      capabilities
    })).toThrow("选择的技能或插件不可用");
  });

  it("rejects selected capability ids that were not scanned", () => {
    expect(() => buildGuidedInput({
      text: "继续",
      guidance: { mode: "queued", selectedCapabilityIds: ["skill:missing"] },
      capabilities
    })).toThrow("选择的技能或插件不可用");
  });
});
