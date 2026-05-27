import { describe, expect, it } from "vitest";
import {
  isOfficialContextualUserText,
  visibleUserTextFromLegacyIdePayload
} from "../codex/codexContextualUserFragments.js";

describe("codex contextual user fragments", () => {
  it("recognizes official contextual user fragments as non-visible", () => {
    const samples = [
      "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nrule\n</INSTRUCTIONS>",
      "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>",
      "<turn_aborted>interrupted by user</turn_aborted>",
      "<subagent_notification>\n{\"agent_path\":\"agent-1\",\"status\":\"running\"}\n</subagent_notification>",
      "<skill>\nname: writing-plans\n</skill>",
      "<user_shell_command>\npwd\n</user_shell_command>",
      "<goal_context>\nShip the feature\n</goal_context>",
      "<legacy_model_mismatch_warning>\nwarning\n</legacy_model_mismatch_warning>"
    ];

    expect(samples.map(isOfficialContextualUserText)).toEqual(samples.map(() => true));
  });

  it("extracts the legacy IDE wrapper request without treating plain raw user messages as official turns", () => {
    expect(visibleUserTextFromLegacyIdePayload("# Context from my IDE setup:\n\n## Open tabs:\n- a.md\n\n## My request for Codex:\n只显示这一句")).toBe("只显示这一句");
    expect(visibleUserTextFromLegacyIdePayload("plain raw role user text")).toBeNull();
  });
});
