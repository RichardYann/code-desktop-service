import { describe, expect, it } from "vitest";
import { mapCommandOutput, mapDiffUpdate, mapPlanUpdate } from "../codex/codexEventMapper.js";

describe("codex event mapper", () => {
  it("maps plan, command output and diff notifications to product events", () => {
    expect(mapPlanUpdate("session-1", [{ id: "1", title: "检查", status: "in_progress", detail: "" }])).toMatchObject({
      type: "session.plan.updated",
      sessionId: "session-1"
    });
    const planWithAlias = mapPlanUpdate("session-1", [{ id: "1", title: "检查", status: "done", detail: "" }]);
    expect(planWithAlias.type).toBe("session.plan.updated");
    if (planWithAlias.type === "session.plan.updated") {
      expect(planWithAlias.steps[0].status).toBe("completed");
    }

    expect(mapCommandOutput("session-1", "turn-1", "pnpm test", "2 tests passed")).toMatchObject({
      type: "session.commandSummary.updated",
      command: { title: "pnpm test", status: "completed" }
    });

    expect(mapDiffUpdate("session-1", [{ path: "src/main.ts", status: "modified", insertions: 2, deletions: 1 }])).toMatchObject({
      type: "session.diffOverview.updated",
      diff: { filesChanged: 1, insertions: 2, deletions: 1 }
    });
  });
});
