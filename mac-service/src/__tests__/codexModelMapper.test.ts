import { describe, expect, it } from "vitest";
import { mapCodexModelList } from "../codex/codexModelMapper.js";

describe("codex model mapper", () => {
  it("maps model/list response to safe display metadata", () => {
    const mapped = mapCodexModelList({
      data: [
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          isDefault: true,
          hidden: false,
          supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }, { reasoningEffort: "xhigh" }]
        },
        { id: "internal-test", displayName: "Internal", isDefault: false, hidden: true, apiKey: "secret" }
      ],
      providerSecret: "must-not-leak"
    });

    expect(mapped.defaultModel).toBe("gpt-5.5");
    expect(mapped.models).toEqual([{
      id: "gpt-5.5",
      label: "GPT-5.5",
      isDefault: true,
      hidden: false,
      isAvailable: true,
      supportedEfforts: ["low", "medium", "high", "xhigh"]
    }]);
    expect(JSON.stringify(mapped)).not.toContain("secret");
  });
});
