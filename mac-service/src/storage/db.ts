import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, type ServiceConfig } from "../config.js";

export function openDatabase(fileName = "code-v1.sqlite", config: Pick<ServiceConfig, "dataDir"> = loadConfig()) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(path.join(config.dataDir, fileName));

  db.exec(`
    CREATE TABLE IF NOT EXISTS paired_devices (
      id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      device_id TEXT,
      session_id TEXT,
      action_type TEXT NOT NULL,
      result TEXT NOT NULL,
      detail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      tool_id TEXT NOT NULL,
      title TEXT NOT NULL,
      project_path TEXT,
      project_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_pinned INTEGER NOT NULL,
      needs_user_input INTEGER NOT NULL,
      waits_for_next_direction INTEGER NOT NULL,
      status_label TEXT NOT NULL,
      last_message_preview TEXT NOT NULL,
      context_tokens_used INTEGER,
      context_window_tokens INTEGER
    );
    CREATE TABLE IF NOT EXISTS managed_projects (
      project_path TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      root_id TEXT,
      is_hidden INTEGER NOT NULL,
      created_by_mobile INTEGER NOT NULL,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_managed_projects_hidden_updated
    ON managed_projects (is_hidden, updated_at);
    CREATE TABLE IF NOT EXISTS project_roots (
      root_path TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_project_roots_updated
    ON project_roots (updated_at);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      send_state TEXT,
      client_message_id TEXT,
      can_withdraw INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_input_queue (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      client_message_id TEXT NOT NULL,
      text TEXT NOT NULL,
      text_preview TEXT NOT NULL,
      text_length INTEGER NOT NULL,
      status TEXT NOT NULL,
      guidance_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_input_queue_session_status
    ON session_input_queue (session_id, status, created_at);
    CREATE TABLE IF NOT EXISTS session_runtime_configs (
      session_id TEXT PRIMARY KEY,
      model TEXT,
      effort TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      approvals_reviewer TEXT NOT NULL DEFAULT 'user',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_runtime_base_configs (
      session_id TEXT PRIMARY KEY,
      model TEXT,
      effort TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      approvals_reviewer TEXT NOT NULL DEFAULT 'user',
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_runtime_config_overrides (
      session_id TEXT PRIMARY KEY,
      model TEXT,
      effort TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      approvals_reviewer TEXT NOT NULL DEFAULT 'user',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      status TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      error TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_assets_session_status
    ON media_assets (session_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_media_assets_expires_at
    ON media_assets (expires_at);
    CREATE TABLE IF NOT EXISTS session_attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL,
      codex_input_status TEXT NOT NULL,
      codex_input_message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_attachments_session_created
    ON session_attachments (session_id, created_at);
    CREATE TABLE IF NOT EXISTS local_web_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      target_url TEXT NOT NULL,
      proxy_url TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_local_web_sessions_session_status
    ON local_web_sessions (session_id, status, created_at);
  `);

  ensureColumn(db, "session_runtime_configs", "approvals_reviewer", "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, "session_runtime_base_configs", "approvals_reviewer", "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, "session_runtime_config_overrides", "approvals_reviewer", "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn(db, "sessions", "context_tokens_used", "INTEGER");
  ensureColumn(db, "sessions", "context_window_tokens", "INTEGER");

  db.exec(`
    INSERT OR IGNORE INTO session_runtime_config_overrides (
      session_id,
      model,
      effort,
      permission_mode,
      approval_mode,
      approvals_reviewer,
      updated_at
    )
    SELECT
      session_id,
      model,
      effort,
      permission_mode,
      approval_mode,
      COALESCE(approvals_reviewer, 'user'),
      updated_at
    FROM session_runtime_configs;
  `);

  const deviceColumns = db.prepare("PRAGMA table_info(paired_devices)").all() as Array<{ name: string }>;
  const hasExpiresAt = deviceColumns.some((column) => column.name === "expires_at");
  if (!hasExpiresAt) {
    db.exec(`
      ALTER TABLE paired_devices ADD COLUMN expires_at TEXT;
      UPDATE paired_devices
      SET expires_at = datetime(created_at, '+30 days')
      WHERE expires_at IS NULL;
    `);
  }

  return db;
}

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
