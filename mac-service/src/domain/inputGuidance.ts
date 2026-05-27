import type { InstalledCodexCapability } from "./installedCodexCapabilities.js";

export type SessionInputMode = "plain" | "guided" | "queued" | "steer-now";

export interface SessionInputGuidance {
  mode: SessionInputMode;
  selectedCapabilityIds: string[];
}

export interface BuildGuidedInputOptions {
  text: string;
  guidance: SessionInputGuidance;
  capabilities: InstalledCodexCapability[];
}

const MOBILE_INPUT_GUIDANCE_OPEN = "<mobile-input-guidance>";
const MOBILE_INPUT_GUIDANCE_CLOSE = "</mobile-input-guidance>";

function firstNonWhitespaceIndex(text: string): number {
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") {
      return index;
    }
  }
  return text.length;
}

export function stripMobileInputGuidance(text: string): string {
  const startIndex = firstNonWhitespaceIndex(text);
  const candidate = text.slice(startIndex);
  if (!candidate.startsWith(MOBILE_INPUT_GUIDANCE_OPEN)) {
    return text;
  }
  const closeIndex = candidate.indexOf(MOBILE_INPUT_GUIDANCE_CLOSE);
  if (closeIndex < 0) {
    return text;
  }
  const rest = candidate.slice(closeIndex + MOBILE_INPUT_GUIDANCE_CLOSE.length);
  return rest.slice(firstNonWhitespaceIndex(rest));
}

function selectedCapabilities(input: BuildGuidedInputOptions): InstalledCodexCapability[] {
  const byId = new Map(input.capabilities.map((capability) => [capability.id, capability]));
  const selected: InstalledCodexCapability[] = [];
  for (const id of input.guidance.selectedCapabilityIds) {
    const capability = byId.get(id);
    if (!capability || !capability.isAvailable) {
      throw new Error("选择的技能或插件不可用");
    }
    selected.push(capability);
  }
  return selected;
}

export function buildGuidedInput(input: BuildGuidedInputOptions): string {
  const selected = selectedCapabilities(input);
  if (input.guidance.mode === "plain" || selected.length === 0) {
    return input.text;
  }

  const lines = selected.map((capability) => {
    const label = capability.kind === "skill" ? "Selected skill for this turn" : "Selected plugin for this turn";
    return `- ${label}: ${capability.name}`;
  });

  return [
    "<mobile-input-guidance>",
    "The mobile user selected local Codex capabilities for this turn.",
    "If a selected skill applies to the request, use that skill according to its instructions.",
    "Do not install, update, or configure capabilities because of this selection.",
    ...lines,
    "</mobile-input-guidance>",
    "",
    input.text
  ].join("\n");
}
