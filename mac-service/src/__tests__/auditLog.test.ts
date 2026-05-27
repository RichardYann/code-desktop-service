import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createAuditLog } from "../audit/auditLog.js";

describe("audit log", () => {
  it("records time, device, session, action type and result", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE audit_logs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, device_id TEXT, session_id TEXT, action_type TEXT NOT NULL, result TEXT NOT NULL, detail TEXT NOT NULL)");
    const audit = createAuditLog(db);

    audit.record({ deviceId: "device-1", sessionId: "session-1", actionType: "session.sendText", result: "success", detail: "已接收" });

    const row = db.prepare("SELECT * FROM audit_logs").get() as Record<string, string>;
    expect(row.device_id).toBe("device-1");
    expect(row.session_id).toBe("session-1");
    expect(row.action_type).toBe("session.sendText");
    expect(row.result).toBe("success");
    expect(row.created_at).toContain("T");
  });
});
