import type { SessionSummary } from "./schemas.js";

export interface ProjectGroup {
  projectKey: string;
  projectName: string;
  isExpanded: boolean;
  sessions: SessionSummary[];
  visibleSessions: SessionSummary[];
}

export interface SessionListSections {
  pending: SessionSummary[];
  pinned: SessionSummary[];
  history: ProjectGroup[];
}

function byUpdatedDesc(a: SessionSummary, b: SessionSummary): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function isPending(session: SessionSummary): boolean {
  return session.needsUserInput;
}

export function buildSessionListSections(sessions: SessionSummary[]): SessionListSections {
  const sorted = [...sessions].sort(byUpdatedDesc);
  const pending = sorted.filter(isPending);
  const pinned = sorted.filter((session) => session.isPinned && !isPending(session));
  const normal = sorted.filter((session) => !session.isPinned && !isPending(session));

  const groups = new Map<string, SessionSummary[]>();
  for (const session of normal) {
    const key = session.projectPath ?? "__projectless__";
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }

  const history = [...groups.entries()]
    .map(([projectKey, groupSessions]) => {
      const sessionsInGroup = [...groupSessions].sort(byUpdatedDesc);
      return {
        projectKey,
        projectName: projectKey === "__projectless__" ? "无项目会话" : sessionsInGroup[0].projectName ?? projectKey,
        isExpanded: false,
        sessions: sessionsInGroup,
        visibleSessions: [] as SessionSummary[]
      };
    })
    .sort((a, b) => byUpdatedDesc(a.sessions[0], b.sessions[0]));

  return {
    pending,
    pinned,
    history: history.map((group, index) => ({
      ...group,
      isExpanded: index === 0,
      visibleSessions: index === 0 ? group.sessions.slice(0, 2) : []
    }))
  };
}
