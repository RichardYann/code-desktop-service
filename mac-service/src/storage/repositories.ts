import type Database from "better-sqlite3";
import type { SessionSummary } from "../domain/sessionService.js";
import type { PairedDevice } from "../security/pairing.js";

export type SessionInputQueueStatus = "queued" | "sending" | "sent" | "failed" | "cancelled";

export interface StoredSessionInputQueueItem {
  id: string;
  sessionId: string;
  clientMessageId: string;
  text: string;
  textPreview: string;
  textLength: number;
  status: SessionInputQueueStatus;
  guidanceJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSessionRuntimeConfig {
  sessionId: string;
  model: string | null;
  effort: string;
  permissionMode: string;
  approvalMode: string;
  approvalsReviewer?: string;
  updatedAt: string;
  source?: string;
}

export interface StoredMediaAsset {
  id: string;
  sessionId: string;
  source: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  status: string;
  relativePath: string;
  createdAt: string;
  expiresAt: string | null;
  error: string;
}

export interface StoredMediaAssetWithSession extends StoredMediaAsset {
  sessionTitle: string | null;
  projectPath: string | null;
  projectName: string | null;
  sessionUpdatedAt: string | null;
}

export interface StoredSessionAttachment {
  id: string;
  sessionId: string;
  assetId: string;
  role: string;
  codexInputStatus: string;
  codexInputMessage: string;
  createdAt: string;
}

export interface StoredLocalWebSession {
  id: string;
  sessionId: string;
  targetUrl: string;
  proxyUrl: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  error: string;
}

export interface StoredManagedProject {
  projectPath: string;
  projectName: string;
  rootId: string | null;
  isHidden: boolean;
  createdByMobile: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSessionStats {
  projectPath: string;
  projectName: string;
  lastUsedAt: string;
  sessionCount: number;
}

export interface StoredProjectRoot {
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

export function createRepositories(db: Database.Database) {
  return {
    projects: {
      saveRoot(root: StoredProjectRoot): StoredProjectRoot {
        db.prepare(`
          INSERT OR REPLACE INTO project_roots (
            root_path,
            created_at,
            updated_at
          )
          VALUES (
            @rootPath,
            COALESCE((SELECT created_at FROM project_roots WHERE root_path = @rootPath), @createdAt),
            @updatedAt
          )
        `).run(root);
        return root;
      },

      removeRoot(rootPath: string): void {
        db.prepare("DELETE FROM project_roots WHERE root_path = @rootPath").run({ rootPath });
      },

      listRoots(): StoredProjectRoot[] {
        return db.prepare(`
          SELECT
            root_path AS rootPath,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM project_roots
          ORDER BY updated_at ASC
        `).all() as StoredProjectRoot[];
      },

      save(project: StoredManagedProject): StoredManagedProject {
        db.prepare(`
          INSERT OR REPLACE INTO managed_projects (
            project_path,
            project_name,
            root_id,
            is_hidden,
            created_by_mobile,
            last_used_at,
            created_at,
            updated_at
          )
          VALUES (
            @projectPath,
            @projectName,
            @rootId,
            @isHidden,
            @createdByMobile,
            @lastUsedAt,
            @createdAt,
            @updatedAt
          )
        `).run({
          ...project,
          isHidden: project.isHidden ? 1 : 0,
          createdByMobile: project.createdByMobile ? 1 : 0
        });
        return project;
      },

      get(projectPath: string): StoredManagedProject | null {
        const row = db.prepare(`
          SELECT
            project_path AS projectPath,
            project_name AS projectName,
            root_id AS rootId,
            is_hidden AS isHidden,
            created_by_mobile AS createdByMobile,
            last_used_at AS lastUsedAt,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM managed_projects
          WHERE project_path = @projectPath
        `).get({ projectPath }) as (Omit<StoredManagedProject, "isHidden" | "createdByMobile"> & {
          isHidden: number;
          createdByMobile: number;
        }) | undefined;
        if (!row) return null;
        return {
          ...row,
          isHidden: row.isHidden === 1,
          createdByMobile: row.createdByMobile === 1
        };
      },

      list(): StoredManagedProject[] {
        const rows = db.prepare(`
          SELECT
            project_path AS projectPath,
            project_name AS projectName,
            root_id AS rootId,
            is_hidden AS isHidden,
            created_by_mobile AS createdByMobile,
            last_used_at AS lastUsedAt,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM managed_projects
          ORDER BY updated_at DESC
        `).all() as Array<Omit<StoredManagedProject, "isHidden" | "createdByMobile"> & {
          isHidden: number;
          createdByMobile: number;
        }>;
        return rows.map((row) => ({
          ...row,
          isHidden: row.isHidden === 1,
          createdByMobile: row.createdByMobile === 1
        }));
      },

      setHidden(projectPath: string, isHidden: boolean, now: string): StoredManagedProject {
        const existing = this.get(projectPath);
        const name = projectPath.split(/[\\/]/).filter(Boolean).at(-1) ?? projectPath;
        const next: StoredManagedProject = existing ?? {
          projectPath,
          projectName: name,
          rootId: null,
          isHidden,
          createdByMobile: false,
          lastUsedAt: null,
          createdAt: now,
          updatedAt: now
        };
        next.isHidden = isHidden;
        next.updatedAt = now;
        return this.save(next);
      },

      listSessionProjectStats(): ProjectSessionStats[] {
        return db.prepare(`
          SELECT
            project_path AS projectPath,
            COALESCE(project_name, project_path) AS projectName,
            MAX(updated_at) AS lastUsedAt,
            COUNT(*) AS sessionCount
          FROM sessions
          WHERE project_path IS NOT NULL AND length(project_path) > 0
          GROUP BY project_path, project_name
          ORDER BY lastUsedAt DESC
        `).all() as ProjectSessionStats[];
      }
    },

    mediaAssets: {
      insert(asset: StoredMediaAsset): StoredMediaAsset {
        db.prepare(`
          INSERT OR REPLACE INTO media_assets (
            id,
            session_id,
            source,
            kind,
            file_name,
            mime_type,
            size_bytes,
            sha256,
            status,
            relative_path,
            created_at,
            expires_at,
            error
          )
          VALUES (
            @id,
            @sessionId,
            @source,
            @kind,
            @fileName,
            @mimeType,
            @sizeBytes,
            @sha256,
            @status,
            @relativePath,
            @createdAt,
            @expiresAt,
            @error
          )
        `).run(asset);
        return asset;
      },

      get(id: string): StoredMediaAsset | null {
        const row = db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            source,
            kind,
            file_name AS fileName,
            mime_type AS mimeType,
            size_bytes AS sizeBytes,
            sha256,
            status,
            relative_path AS relativePath,
            created_at AS createdAt,
            expires_at AS expiresAt,
            error
          FROM media_assets
          WHERE id = @id
        `).get({ id }) as StoredMediaAsset | undefined;
        return row ?? null;
      },

      listBySession(sessionId: string): StoredMediaAsset[] {
        return db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            source,
            kind,
            file_name AS fileName,
            mime_type AS mimeType,
            size_bytes AS sizeBytes,
            sha256,
            status,
            relative_path AS relativePath,
            created_at AS createdAt,
            expires_at AS expiresAt,
            error
          FROM media_assets
          WHERE session_id = @sessionId
          ORDER BY created_at DESC, rowid DESC
        `).all({ sessionId }) as StoredMediaAsset[];
      },

      listExpired(nowIso: string): StoredMediaAsset[] {
        return db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            source,
            kind,
            file_name AS fileName,
            mime_type AS mimeType,
            size_bytes AS sizeBytes,
            sha256,
            status,
            relative_path AS relativePath,
            created_at AS createdAt,
            expires_at AS expiresAt,
            error
          FROM media_assets
          WHERE expires_at IS NOT NULL
            AND expires_at <= @nowIso
        `).all({ nowIso }) as StoredMediaAsset[];
      },

      listRecent(limit: number): StoredMediaAsset[] {
        return db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            source,
            kind,
            file_name AS fileName,
            mime_type AS mimeType,
            size_bytes AS sizeBytes,
            sha256,
            status,
            relative_path AS relativePath,
            created_at AS createdAt,
            expires_at AS expiresAt,
            error
          FROM media_assets
          ORDER BY created_at DESC, rowid DESC
          LIMIT @limit
        `).all({ limit }) as StoredMediaAsset[];
      },

      listAll(): StoredMediaAsset[] {
        return db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            source,
            kind,
            file_name AS fileName,
            mime_type AS mimeType,
            size_bytes AS sizeBytes,
            sha256,
            status,
            relative_path AS relativePath,
            created_at AS createdAt,
            expires_at AS expiresAt,
            error
          FROM media_assets
          ORDER BY created_at DESC, rowid DESC
        `).all() as StoredMediaAsset[];
      },

      listForManagement(query: string): StoredMediaAssetWithSession[] {
        const normalizedQuery = query.trim().toLowerCase();
        const rows = db.prepare(`
          SELECT
            a.id,
            a.session_id AS sessionId,
            a.source,
            a.kind,
            a.file_name AS fileName,
            a.mime_type AS mimeType,
            a.size_bytes AS sizeBytes,
            a.sha256,
            a.status,
            a.relative_path AS relativePath,
            a.created_at AS createdAt,
            a.expires_at AS expiresAt,
            a.error,
            s.title AS sessionTitle,
            s.project_path AS projectPath,
            s.project_name AS projectName,
            s.updated_at AS sessionUpdatedAt
          FROM media_assets a
          LEFT JOIN sessions s ON s.id = a.session_id
          WHERE @query = ''
            OR lower(a.file_name) LIKE @like
            OR lower(a.kind) LIKE @like
            OR lower(a.session_id) LIKE @like
            OR lower(COALESCE(s.title, '')) LIKE @like
            OR lower(COALESCE(s.project_name, '')) LIKE @like
            OR lower(COALESCE(s.project_path, '')) LIKE @like
          ORDER BY
            COALESCE(s.project_name, CASE WHEN s.project_path IS NULL THEN '无项目会话' ELSE s.project_path END) COLLATE NOCASE ASC,
            a.created_at DESC,
            a.rowid DESC
        `).all({
          query: normalizedQuery,
          like: `%${normalizedQuery}%`
        }) as StoredMediaAssetWithSession[];
        return rows;
      },

      totalSizeBytes(): number {
        const row = db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS totalSizeBytes FROM media_assets WHERE status = 'available'")
          .get() as { totalSizeBytes: number } | undefined;
        return row?.totalSizeBytes ?? 0;
      },

      updateStatus(input: { id: string; status: string; error: string }): void {
        db.prepare(`
          UPDATE media_assets
          SET status = @status,
              error = @error
          WHERE id = @id
        `).run(input);
      },

      updateUploaded(input: { id: string; sha256: string; status: string; error: string }): void {
        db.prepare(`
          UPDATE media_assets
          SET sha256 = @sha256,
              status = @status,
              error = @error
          WHERE id = @id
        `).run(input);
      },

      updateSession(input: { id: string; sessionId: string }): void {
        db.prepare(`
          UPDATE media_assets
          SET session_id = @sessionId
          WHERE id = @id
        `).run(input);
      },

      delete(id: string): number {
        const result = db.prepare("DELETE FROM media_assets WHERE id = @id").run({ id });
        return result.changes;
      },

      deleteExpired(nowIso: string): number {
        const result = db.prepare(`
          DELETE FROM media_assets
          WHERE expires_at IS NOT NULL
            AND expires_at <= @nowIso
        `).run({ nowIso });
        return result.changes;
      }
    },

    sessionAttachments: {
      insert(attachment: StoredSessionAttachment): StoredSessionAttachment {
        db.prepare(`
          INSERT OR REPLACE INTO session_attachments (
            id,
            session_id,
            asset_id,
            role,
            codex_input_status,
            codex_input_message,
            created_at
          )
          VALUES (
            @id,
            @sessionId,
            @assetId,
            @role,
            @codexInputStatus,
            @codexInputMessage,
            @createdAt
          )
        `).run(attachment);
        return attachment;
      },

      listBySession(sessionId: string): StoredSessionAttachment[] {
        return db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            asset_id AS assetId,
            role,
            codex_input_status AS codexInputStatus,
            codex_input_message AS codexInputMessage,
            created_at AS createdAt
          FROM session_attachments
          WHERE session_id = @sessionId
          ORDER BY created_at DESC, rowid DESC
        `).all({ sessionId }) as StoredSessionAttachment[];
      },

      deleteByAssetId(assetId: string): number {
        const result = db.prepare("DELETE FROM session_attachments WHERE asset_id = @assetId").run({ assetId });
        return result.changes;
      }
    },

    localWebSessions: {
      insert(session: StoredLocalWebSession): StoredLocalWebSession {
        db.prepare(`
          INSERT OR REPLACE INTO local_web_sessions (
            id,
            session_id,
            target_url,
            proxy_url,
            status,
            created_at,
            updated_at,
            error
          )
          VALUES (
            @id,
            @sessionId,
            @targetUrl,
            @proxyUrl,
            @status,
            @createdAt,
            @updatedAt,
            @error
          )
        `).run(session);
        return session;
      },

      get(id: string): StoredLocalWebSession | null {
        const row = db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            target_url AS targetUrl,
            proxy_url AS proxyUrl,
            status,
            created_at AS createdAt,
            updated_at AS updatedAt,
            error
          FROM local_web_sessions
          WHERE id = @id
        `).get({ id }) as StoredLocalWebSession | undefined;
        return row ?? null;
      },

      listBySession(sessionId: string): StoredLocalWebSession[] {
        return db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            target_url AS targetUrl,
            proxy_url AS proxyUrl,
            status,
            created_at AS createdAt,
            updated_at AS updatedAt,
            error
          FROM local_web_sessions
          WHERE session_id = @sessionId
          ORDER BY created_at DESC, rowid DESC
        `).all({ sessionId }) as StoredLocalWebSession[];
      },

      listActive(): StoredLocalWebSession[] {
        return db.prepare(`
          SELECT
            id,
            session_id AS sessionId,
            target_url AS targetUrl,
            proxy_url AS proxyUrl,
            status,
            created_at AS createdAt,
            updated_at AS updatedAt,
            error
          FROM local_web_sessions
          WHERE status = 'active'
          ORDER BY created_at DESC, rowid DESC
        `).all() as StoredLocalWebSession[];
      },

      updateStatus(input: { id: string; status: string; updatedAt: string; error: string }): void {
        db.prepare(`
          UPDATE local_web_sessions
          SET status = @status,
              updated_at = @updatedAt,
              error = @error
          WHERE id = @id
        `).run(input);
      }
    },

    saveDevice(device: PairedDevice): void {
      db.prepare(`
        INSERT OR REPLACE INTO paired_devices (id, device_name, token_hash, created_at, expires_at, revoked_at)
        VALUES (@id, @deviceName, @tokenHash, @createdAt, @expiresAt, @revokedAt)
      `).run(device);
    },

    revokeDevice(id: string): void {
      db.prepare("UPDATE paired_devices SET revoked_at = @revokedAt WHERE id = @id")
        .run({ id, revokedAt: new Date().toISOString() });
    },

    listDevices(): PairedDevice[] {
      return db.prepare(`
        SELECT
          id,
          device_name AS deviceName,
          token_hash AS tokenHash,
          created_at AS createdAt,
          expires_at AS expiresAt,
          revoked_at AS revokedAt
        FROM paired_devices
      `).all() as PairedDevice[];
    },

    saveSession(session: SessionSummary): void {
      db.prepare(`
        INSERT OR REPLACE INTO sessions (
          id,
          tool_id,
          title,
          project_path,
          project_name,
          created_at,
          updated_at,
          is_pinned,
          needs_user_input,
          waits_for_next_direction,
          status_label,
          last_message_preview,
          context_tokens_used,
          context_window_tokens
        )
        VALUES (
          @id,
          @toolId,
          @title,
          @projectPath,
          @projectName,
          @createdAt,
          @updatedAt,
          @isPinned,
          @needsUserInput,
          @waitsForNextDirection,
          @statusLabel,
          @lastMessagePreview,
          @contextTokensUsed,
          @contextWindowTokens
        )
      `).run({
        ...session,
        isPinned: session.isPinned ? 1 : 0,
        needsUserInput: session.needsUserInput ? 1 : 0,
        waitsForNextDirection: session.waitsForNextDirection ? 1 : 0,
        contextTokensUsed: session.contextTokensUsed ?? null,
        contextWindowTokens: session.contextWindowTokens ?? null
      });
    },

    listSessions(): SessionSummary[] {
      const rows = db.prepare(`
        SELECT
          id,
          tool_id AS toolId,
          title,
          project_path AS projectPath,
          project_name AS projectName,
          created_at AS createdAt,
          updated_at AS updatedAt,
          is_pinned AS isPinned,
          needs_user_input AS needsUserInput,
          waits_for_next_direction AS waitsForNextDirection,
          status_label AS statusLabel,
          last_message_preview AS lastMessagePreview,
          context_tokens_used AS contextTokensUsed,
          context_window_tokens AS contextWindowTokens
        FROM sessions
      `).all() as Array<{
        id: string;
        toolId: string;
        title: string;
        projectPath: string | null;
        projectName: string | null;
        createdAt: string;
        updatedAt: string;
        isPinned: number;
        needsUserInput: number;
        waitsForNextDirection: number;
        statusLabel: string;
        lastMessagePreview: string;
        contextTokensUsed: number | null;
        contextWindowTokens: number | null;
      }>;
      return rows.map((row) => {
        const session: SessionSummary = {
          id: row.id,
          toolId: row.toolId,
          title: row.title,
          projectPath: row.projectPath,
          projectName: row.projectName,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          isPinned: row.isPinned === 1,
          needsUserInput: row.needsUserInput === 1,
          waitsForNextDirection: row.waitsForNextDirection === 1,
          statusLabel: row.statusLabel,
          lastMessagePreview: row.lastMessagePreview
        };
        if (row.contextTokensUsed !== null) {
          session.contextTokensUsed = row.contextTokensUsed;
        }
        if (row.contextWindowTokens !== null) {
          session.contextWindowTokens = row.contextWindowTokens;
        }
        return session;
      });
    },

    deleteSessionsForToolExcept(toolId: string, retainedIds: string[]): void {
      if (retainedIds.length === 0) {
        db.prepare("DELETE FROM sessions WHERE tool_id = @toolId").run({ toolId });
        return;
      }
      const placeholders = retainedIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM sessions WHERE tool_id = ? AND id NOT IN (${placeholders})`)
        .run(toolId, ...retainedIds);
    },

    saveInputQueueItem(item: StoredSessionInputQueueItem): void {
      db.prepare(`
        INSERT OR REPLACE INTO session_input_queue (
          id,
          session_id,
          client_message_id,
          text,
          text_preview,
          text_length,
          status,
          guidance_json,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @sessionId,
          @clientMessageId,
          @text,
          @textPreview,
          @textLength,
          @status,
          @guidanceJson,
          @createdAt,
          @updatedAt
        )
      `).run(item);
    },

    listInputQueueItems(sessionId: string): StoredSessionInputQueueItem[] {
      return db.prepare(`
        SELECT
          id,
          session_id AS sessionId,
          client_message_id AS clientMessageId,
          text,
          text_preview AS textPreview,
          text_length AS textLength,
          status,
          guidance_json AS guidanceJson,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM session_input_queue
        WHERE session_id = @sessionId
        ORDER BY created_at ASC, rowid ASC
      `).all({ sessionId }) as StoredSessionInputQueueItem[];
    },

    updateInputQueueItemStatus(input: {
      sessionId: string;
      id: string;
      status: SessionInputQueueStatus;
      updatedAt: string;
    }): void {
      db.prepare(`
        UPDATE session_input_queue
        SET status = @status,
            updated_at = @updatedAt
        WHERE session_id = @sessionId
          AND id = @id
      `).run(input);
    },

    saveSessionRuntimeBaseConfig(config: StoredSessionRuntimeConfig & { source: string }): void {
      db.prepare(`
        INSERT OR REPLACE INTO session_runtime_base_configs (
          session_id,
          model,
          effort,
          permission_mode,
          approval_mode,
          approvals_reviewer,
          source,
          updated_at
        )
        VALUES (
          @sessionId,
          @model,
          @effort,
          @permissionMode,
          @approvalMode,
          @approvalsReviewer,
          @source,
          @updatedAt
        )
      `).run(config);
    },

    readSessionRuntimeBaseConfig(sessionId: string): StoredSessionRuntimeConfig | null {
      const row = db.prepare(`
        SELECT
          session_id AS sessionId,
          model,
          effort,
          permission_mode AS permissionMode,
          approval_mode AS approvalMode,
          approvals_reviewer AS approvalsReviewer,
          source,
          updated_at AS updatedAt
        FROM session_runtime_base_configs
        WHERE session_id = @sessionId
      `).get({ sessionId }) as StoredSessionRuntimeConfig | undefined;
      return row ?? null;
    },

    saveSessionRuntimeConfigOverride(config: StoredSessionRuntimeConfig): void {
      db.prepare(`
        INSERT OR REPLACE INTO session_runtime_config_overrides (
          session_id,
          model,
          effort,
          permission_mode,
          approval_mode,
          approvals_reviewer,
          updated_at
        )
        VALUES (
          @sessionId,
          @model,
          @effort,
          @permissionMode,
          @approvalMode,
          @approvalsReviewer,
          @updatedAt
        )
      `).run(config);
    },

    readSessionRuntimeConfigOverride(sessionId: string): StoredSessionRuntimeConfig | null {
      const row = db.prepare(`
        SELECT
          session_id AS sessionId,
          model,
          effort,
          permission_mode AS permissionMode,
          approval_mode AS approvalMode,
          approvals_reviewer AS approvalsReviewer,
          updated_at AS updatedAt
        FROM session_runtime_config_overrides
        WHERE session_id = @sessionId
      `).get({ sessionId }) as StoredSessionRuntimeConfig | undefined;
      return row ?? null;
    }
  };
}
