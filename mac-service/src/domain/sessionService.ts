export interface SessionSummary {
  id: string;
  toolId: string;
  title: string;
  projectPath: string | null;
  projectName: string | null;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  needsUserInput: boolean;
  waitsForNextDirection: boolean;
  statusLabel: string;
  lastMessagePreview: string;
  contextTokensUsed?: number | null;
  contextWindowTokens?: number | null;
}

export type SendState = "pending" | "received" | "failed";

export function canWithdraw(sendState: SendState): boolean {
  return sendState === "pending";
}

const GENERIC_CODEX_TITLE = "Codex 会话";

function isProbablyOldPreviewDerivedTitle(session: SessionSummary): boolean {
  return session.title.length >= 40 &&
    session.title.length > 0 &&
    session.lastMessagePreview.startsWith(session.title);
}

function mergeSession(existing: SessionSummary, incoming: SessionSummary): SessionSummary {
  const shouldPreserveExistingTitle = incoming.title === GENERIC_CODEX_TITLE &&
    existing.title !== GENERIC_CODEX_TITLE &&
    !isProbablyOldPreviewDerivedTitle(existing);
  const shouldPreserveNewerExistingTitle = existing.title !== incoming.title &&
    !isProbablyOldPreviewDerivedTitle(existing) &&
    Date.parse(existing.updatedAt) > Date.parse(incoming.updatedAt);
  const shouldPreserveExistingUpdatedAt = Date.parse(existing.updatedAt) > Date.parse(incoming.updatedAt);
  return {
    ...incoming,
    title: shouldPreserveExistingTitle || shouldPreserveNewerExistingTitle ? existing.title : incoming.title,
    updatedAt: shouldPreserveExistingUpdatedAt ? existing.updatedAt : incoming.updatedAt,
    isPinned: existing.isPinned
  };
}

function isPendingSession(session: SessionSummary): boolean {
  return session.needsUserInput;
}

function mergeToolSnapshotSession(existing: SessionSummary, incoming: SessionSummary): SessionSummary {
  const merged = mergeSession(existing, incoming);
  if (!isPendingSession(existing) || isPendingSession(incoming)) {
    return merged;
  }
  return {
    ...merged,
    needsUserInput: existing.needsUserInput,
    waitsForNextDirection: existing.waitsForNextDirection,
    statusLabel: existing.statusLabel,
    lastMessagePreview: existing.lastMessagePreview
  };
}

export interface SessionRepository {
  saveSession(session: SessionSummary): void;
  listSessions(): SessionSummary[];
  deleteSessionsForToolExcept?(toolId: string, retainedIds: string[]): void;
}

export function createSessionService(repository?: SessionRepository) {
  const sessions = new Map<string, SessionSummary>();
  for (const session of repository?.listSessions() ?? []) {
    sessions.set(session.id, session);
  }

  function save(session: SessionSummary): void {
    repository?.saveSession(session);
  }

  return {
    addSession(session: SessionSummary): SessionSummary {
      const existing = sessions.get(session.id);
      const nextSession = existing ? mergeSession(existing, session) : session;
      sessions.set(session.id, nextSession);
      save(nextSession);
      return nextSession;
    },

    replaceToolSessions(toolId: string, incomingSessions: SessionSummary[]): SessionSummary[] {
      const retainedIds = new Set<string>();
      const nextSessions: SessionSummary[] = [];
      for (const incoming of incomingSessions) {
        if (incoming.toolId !== toolId) continue;
        retainedIds.add(incoming.id);
        const existing = sessions.get(incoming.id);
        const nextSession = existing ? mergeToolSnapshotSession(existing, incoming) : incoming;
        sessions.set(incoming.id, nextSession);
        save(nextSession);
        nextSessions.push(nextSession);
      }
      for (const session of [...sessions.values()]) {
        if (session.toolId === toolId && !retainedIds.has(session.id)) {
          sessions.delete(session.id);
        }
      }
      repository?.deleteSessionsForToolExcept?.(toolId, [...retainedIds]);
      return nextSessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },

    get(id: string): SessionSummary | undefined {
      return sessions.get(id);
    },

    setPinned(id: string, isPinned: boolean): void {
      const session = sessions.get(id);
      if (session) {
        const nextSession = { ...session, isPinned, updatedAt: new Date().toISOString() };
        sessions.set(id, nextSession);
        save(nextSession);
      }
    },

    rename(id: string, title: string): SessionSummary | undefined {
      const normalizedTitle = title.trim();
      const session = sessions.get(id);
      if (!session || normalizedTitle.length === 0) return undefined;
      const nextSession = { ...session, title: normalizedTitle, updatedAt: new Date().toISOString() };
      sessions.set(id, nextSession);
      save(nextSession);
      return nextSession;
    },

    search(toolId: string, query: string): SessionSummary[] {
      const normalized = query.trim().toLowerCase();
      return [...sessions.values()]
        .filter((session) => session.toolId === toolId)
        .filter((session) => session.title.toLowerCase().includes(normalized) || session.lastMessagePreview.toLowerCase().includes(normalized))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },

    list(toolId: string): SessionSummary[] {
      return [...sessions.values()]
        .filter((session) => session.toolId === toolId)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
