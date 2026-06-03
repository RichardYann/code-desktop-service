export class CodexTurnInputLifecycleService {
  private activeTurns = new Map<string, string>();
  private pendingTurnStarts = new Set<string>();
  private interruptPendingTurns = new Map<string, string>();
  private terminalTurns = new Set<string>();

  private turnKey(sessionId: string, turnId: string): string {
    return `${sessionId}:${turnId}`;
  }

  noteTurnStarted(sessionId: string, turnId: string): void {
    if (sessionId.length === 0 || turnId.length === 0) return;
    this.terminalTurns.delete(this.turnKey(sessionId, turnId));
    this.activeTurns.set(sessionId, turnId);
    this.pendingTurnStarts.delete(sessionId);
    this.interruptPendingTurns.delete(sessionId);
  }

  noteTurnStartRequested(sessionId: string): void {
    if (sessionId.length === 0) return;
    this.pendingTurnStarts.add(sessionId);
  }

  noteTurnStartedFromStartResponse(sessionId: string, turnId: string, previousTurnId: string | undefined): void {
    if (sessionId.length === 0 || turnId.length === 0) return;
    if (this.terminalTurns.has(this.turnKey(sessionId, turnId))) {
      this.pendingTurnStarts.delete(sessionId);
      return;
    }
    const currentTurnId = this.activeTurns.get(sessionId);
    if (currentTurnId === undefined || currentTurnId === previousTurnId) {
      this.activeTurns.set(sessionId, turnId);
    }
    this.pendingTurnStarts.delete(sessionId);
  }

  noteTurnStartFailed(sessionId: string): void {
    if (sessionId.length === 0) return;
    this.pendingTurnStarts.delete(sessionId);
  }

  noteTurnCompleted(sessionId: string, turnId?: string): void {
    if (sessionId.length === 0) return;
    if (turnId !== undefined && turnId.length > 0) {
      this.terminalTurns.add(this.turnKey(sessionId, turnId));
    }
    const activeTurnId = this.activeTurns.get(sessionId);
    if (turnId === undefined || turnId.length === 0 || activeTurnId === undefined || activeTurnId === turnId) {
      this.activeTurns.delete(sessionId);
    }
    const pendingInterruptTurnId = this.interruptPendingTurns.get(sessionId);
    if (turnId === undefined || turnId.length === 0 || pendingInterruptTurnId === turnId) {
      this.interruptPendingTurns.delete(sessionId);
    }
  }

  noteActiveTurnMissing(sessionId: string): void {
    if (sessionId.length === 0) return;
    this.activeTurns.delete(sessionId);
    this.pendingTurnStarts.delete(sessionId);
    this.interruptPendingTurns.delete(sessionId);
  }

  activeTurnId(sessionId: string): string | undefined {
    return this.activeTurns.get(sessionId);
  }

  sessionIdForTurn(turnId: string): string | undefined {
    if (turnId.length === 0) return undefined;
    for (const [sessionId, activeTurnId] of this.activeTurns.entries()) {
      if (activeTurnId === turnId) return sessionId;
    }
    return undefined;
  }

  singleActiveSessionId(): string | undefined {
    if (this.activeTurns.size !== 1) return undefined;
    return this.activeTurns.keys().next().value;
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.activeTurns.has(sessionId);
  }

  hasPendingTurnStart(sessionId: string): boolean {
    return this.pendingTurnStarts.has(sessionId);
  }

  canStartNewTurn(sessionId: string): boolean {
    return !this.hasActiveTurn(sessionId) && !this.hasPendingTurnStart(sessionId);
  }

  canDrainQueueAfterTerminal(sessionId: string, terminalTurnId?: string): boolean {
    if (!this.canStartNewTurn(sessionId)) return false;
    const pendingInterruptTurnId = this.interruptPendingTurns.get(sessionId);
    if (pendingInterruptTurnId === undefined) return true;
    if (terminalTurnId === undefined || terminalTurnId.length === 0) return false;
    return pendingInterruptTurnId === terminalTurnId;
  }

  markInterruptRequested(sessionId: string, turnId: string): void {
    if (sessionId.length === 0 || turnId.length === 0) return;
    this.interruptPendingTurns.set(sessionId, turnId);
  }
}
