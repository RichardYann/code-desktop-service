import { describe, expect, it } from "vitest";
import { buildSessionListSections } from "../sessionList.js";
import type { SessionSummary } from "../schemas.js";

const base: Omit<SessionSummary, "id" | "title" | "createdAt" | "updatedAt"> = {
  toolId: "codex-mac",
  projectPath: "/repo/a",
  projectName: "a",
  isPinned: false,
  needsUserInput: false,
  waitsForNextDirection: false,
  statusLabel: "idle",
  lastMessagePreview: "preview"
};

function session(input: Partial<SessionSummary> & Pick<SessionSummary, "id" | "updatedAt">): SessionSummary {
  return {
    ...base,
    title: input.id,
    createdAt: input.updatedAt,
    ...input
  };
}

describe("buildSessionListSections", () => {
  it("keeps pending sessions out of pinned even when pinned", () => {
    const sections = buildSessionListSections([
      session({ id: "s1", updatedAt: "2026-05-05T10:00:00.000Z", isPinned: true, needsUserInput: true })
    ]);

    expect(sections.pending.map((item) => item.id)).toEqual(["s1"]);
    expect(sections.pinned).toEqual([]);
  });

  it("does not treat idle sessions waiting for the next direction as pending", () => {
    const sections = buildSessionListSections([
      session({
        id: "waiting-next",
        updatedAt: "2026-05-05T10:00:00.000Z",
        projectPath: null,
        projectName: null,
        waitsForNextDirection: true,
        statusLabel: "completed"
      })
    ]);

    expect(sections.pending).toEqual([]);
    expect(sections.history[0].projectKey).toBe("__projectless__");
    expect(sections.history[0].sessions.map((item) => item.id)).toEqual(["waiting-next"]);
  });

  it("expands only the newest project and shows two latest sessions", () => {
    const sections = buildSessionListSections([
      session({ id: "old-a", updatedAt: "2026-05-05T08:00:00.000Z", projectPath: "/repo/a", projectName: "a" }),
      session({ id: "new-a", updatedAt: "2026-05-05T11:00:00.000Z", projectPath: "/repo/a", projectName: "a" }),
      session({ id: "third-a", updatedAt: "2026-05-05T09:00:00.000Z", projectPath: "/repo/a", projectName: "a" }),
      session({ id: "b", updatedAt: "2026-05-05T07:00:00.000Z", projectPath: "/repo/b", projectName: "b" })
    ]);

    expect(sections.history[0]).toMatchObject({ projectName: "a", isExpanded: true });
    expect(sections.history[0].visibleSessions.map((item) => item.id)).toEqual(["new-a", "third-a"]);
    expect(sections.history[1]).toMatchObject({ projectName: "b", isExpanded: false });
  });

  it("groups projectless sessions as the special project group", () => {
    const sections = buildSessionListSections([
      session({ id: "none", updatedAt: "2026-05-05T12:00:00.000Z", projectPath: null, projectName: null })
    ]);

    expect(sections.history[0].projectKey).toBe("__projectless__");
    expect(sections.history[0].projectName).toBe("无项目会话");
  });
});
