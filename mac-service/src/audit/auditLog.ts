import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

export interface AuditInput {
  deviceId: string | null;
  sessionId: string | null;
  actionType: string;
  result: "success" | "failed";
  detail: string;
}

export function createAuditLog(db: Database.Database) {
  return {
    record(input: AuditInput): void {
      db.prepare(`
        INSERT INTO audit_logs (id, created_at, device_id, session_id, action_type, result, detail)
        VALUES (@id, @createdAt, @deviceId, @sessionId, @actionType, @result, @detail)
      `).run({
        id: nanoid(16),
        createdAt: new Date().toISOString(),
        ...input
      });
    },

    list(limit = 200) {
      return db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?").all(limit);
    }
  };
}
