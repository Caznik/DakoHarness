/**
 * SqliteStorage.ts — SQLite adapter for the Storage interface.
 *
 * Uses better-sqlite3 (synchronous API wrapped in async interface methods).
 *
 * SCHEMA CONVENTIONS
 * ------------------
 * - Text search uses FTS5 virtual tables (content-rowid linkage pattern),
 *   consistent with the STM Go MCP which also uses SQLite + FTS5.
 * - IDs exposed to callers are string "mem-<rowid>" to satisfy the string ID
 *   contract without changing caller-visible shapes.
 * - Dates are stored as ISO-8601 TEXT to preserve full precision and allow
 *   round-trip export to MongoDB without information loss (AC-10).
 * - Tags are JSON.stringify'd TEXT — same pattern used by STM for array fields.
 *
 * AC-9 VECTOR EXTENSION POINT (schema)
 * ----------------------------------------
 * The memories table has a comment block reserving a future "embedding" column.
 * When the "Local embedding model for recall" workitem lands, the migration is:
 *   ALTER TABLE memories ADD COLUMN embedding BLOB;
 * No existing rows or queries break. The FTS5 table is unaffected.
 * A separate vector index (e.g. sqlite-vss extension) attaches alongside the
 * existing FTS5 table without requiring the FTS5 table to change.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import type {
  Storage,
  ToolResult,
  RememberArgs,
  RecallArgs,
  GetContextArgs,
  PromoteToTeamArgs,
  ForgetArgs,
  ListMemoriesArgs,
  ArchiveWorkitemArgs,
  StartSessionArgs,
  LogMessageArgs,
  GetSessionArgs,
  ListSessionsArgs,
} from "./Storage.js";

export class SqliteStorage implements Storage {
  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Factory — creates/opens the SQLite file, runs schema init, returns ready instance.
   */
  static create(dbPath: string): SqliteStorage {
    // Ensure parent directory exists (R6: mkdirSync is idempotent)
    mkdirSync(dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);

    // Performance pragmas
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // ── Schema init (idempotent) ─────────────────────────────────────────────

    db.exec(`
      -- Long-term memories
      -- AC-9: future embedding column reserved — see module-level comment.
      CREATE TABLE IF NOT EXISTS memories (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project     TEXT    NOT NULL,
        agent       TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        title       TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        tags        TEXT    NOT NULL DEFAULT '[]',   -- JSON array
        scope       TEXT    NOT NULL DEFAULT 'project',
        session_id  TEXT,                             -- nullable
        timestamp   TEXT    NOT NULL                  -- ISO-8601
        -- future: embedding BLOB  (vector search, AC-9)
      );

      -- FTS5 on memories: title + content (mirrors MongoDB memories_text_search index)
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        title,
        content,
        content=memories,
        content_rowid=id
      );

      -- Triggers to keep FTS5 in sync with memories table
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
        INSERT INTO memories_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;

      -- Workitems archive
      CREATE TABLE IF NOT EXISTS workitems (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        wi_path       TEXT    NOT NULL,
        project       TEXT    NOT NULL,
        username      TEXT,
        git_commit    TEXT,
        documentation TEXT    NOT NULL,
        archived_at   TEXT    NOT NULL   -- ISO-8601
      );

      -- FTS5 on workitems: documentation (mirrors MongoDB workitems_text_search index)
      CREATE VIRTUAL TABLE IF NOT EXISTS workitems_fts USING fts5(
        documentation,
        content=workitems,
        content_rowid=id
      );

      -- Triggers to keep workitems FTS5 in sync
      CREATE TRIGGER IF NOT EXISTS workitems_ai AFTER INSERT ON workitems BEGIN
        INSERT INTO workitems_fts(rowid, documentation) VALUES (new.id, new.documentation);
      END;
      CREATE TRIGGER IF NOT EXISTS workitems_ad AFTER DELETE ON workitems BEGIN
        INSERT INTO workitems_fts(workitems_fts, rowid, documentation) VALUES ('delete', old.id, old.documentation);
      END;
      CREATE TRIGGER IF NOT EXISTS workitems_au AFTER UPDATE ON workitems BEGIN
        INSERT INTO workitems_fts(workitems_fts, rowid, documentation) VALUES ('delete', old.id, old.documentation);
        INSERT INTO workitems_fts(rowid, documentation) VALUES (new.id, new.documentation);
      END;

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        session_id  TEXT PRIMARY KEY,
        project     TEXT NOT NULL,
        agent       TEXT NOT NULL,
        cwd         TEXT NOT NULL DEFAULT '',
        started_at  TEXT NOT NULL   -- ISO-8601
      );

      -- Messages
      CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT    NOT NULL,
        role        TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        seq         INTEGER NOT NULL,
        timestamp   TEXT    NOT NULL   -- ISO-8601
      );
      CREATE INDEX IF NOT EXISTS messages_session_seq ON messages (session_id, seq);
    `);

    return new SqliteStorage(db);
  }

  // ── REMEMBER ──────────────────────────────────────────────────────────────

  async remember(args: RememberArgs): Promise<ToolResult> {
    const { project, agent, type, title, content, tags = [], session_id, scope = "project" } = args;
    const stmt = this.db.prepare(`
      INSERT INTO memories (project, agent, type, title, content, tags, scope, session_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(project, agent, type, title, content, JSON.stringify(tags), scope, session_id ?? null, new Date().toISOString());
    return { content: [{ type: "text", text: `Remembered [${type}]: "${title}"` }] };
  }

  // ── RECALL ────────────────────────────────────────────────────────────────

  async recall(args: RecallArgs): Promise<ToolResult> {
    const { project, query, type, limit = 10, include_team = false } = args;

    // FTS5 BM25 search — rank column is negative BM25 score (lower = better match)
    let sql: string;
    const params: unknown[] = [query];

    if (include_team) {
      // Match project OR team-scoped memories
      sql = `
        SELECT m.*, memories_fts.rank
        FROM memories_fts
        JOIN memories m ON memories_fts.rowid = m.id
        WHERE memories_fts MATCH ?
          AND (m.project = ? OR m.scope = 'team')
      `;
      params.push(project);
    } else {
      sql = `
        SELECT m.*, memories_fts.rank
        FROM memories_fts
        JOIN memories m ON memories_fts.rowid = m.id
        WHERE memories_fts MATCH ?
          AND m.project = ?
      `;
      params.push(project);
    }

    if (type) {
      sql += ` AND m.type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY memories_fts.rank LIMIT ?`;
    params.push(limit);

    const results = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No memories found for "${query}" in project "${project}".` }] };
    }

    const formatted = results.map((m) => {
      const tagsArr = JSON.parse(m["tags"] as string) as string[];
      return `[${(m["type"] as string).toUpperCase()}] ${m["title"] as string}\n${m["content"] as string}${tagsArr.length ? `\nTags: ${tagsArr.join(", ")}` : ""}`;
    }).join("\n\n---\n\n");

    return { content: [{ type: "text", text: `${results.length} result(s) for "${query}":\n\n${formatted}` }] };
  }

  // ── GET CONTEXT ───────────────────────────────────────────────────────────

  async getContext(args: GetContextArgs): Promise<ToolResult> {
    const { project, type } = args;

    let sql = `SELECT * FROM memories WHERE project = ?`;
    const params: unknown[] = [project];
    if (type) { sql += ` AND type = ?`; params.push(type); }
    sql += ` ORDER BY type ASC, timestamp DESC`;

    const all = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    if (all.length === 0) {
      return { content: [{ type: "text", text: `No memories stored for project "${project}" yet.` }] };
    }

    const grouped: Record<string, typeof all> = {};
    for (const m of all) {
      const t = m["type"] as string;
      if (!grouped[t]) grouped[t] = [];
      grouped[t]!.push(m);
    }

    const sections = Object.entries(grouped).map(([t, items]) => {
      const entries = items.map((m) => `  • ${m["title"] as string}\n    ${m["content"] as string}`).join("\n");
      return `## ${t.toUpperCase()}S\n${entries}`;
    });

    return { content: [{ type: "text", text: `Project context for "${project}":\n\n${sections.join("\n\n")}` }] };
  }

  // ── PROMOTE TO TEAM ───────────────────────────────────────────────────────

  async promoteToTeam(args: PromoteToTeamArgs): Promise<ToolResult> {
    const { project, title, type } = args;
    let sql = `UPDATE memories SET scope = 'team' WHERE project = ? AND title = ?`;
    const params: unknown[] = [project, title];
    if (type) { sql += ` AND type = ?`; params.push(type); }

    const result = this.db.prepare(sql).run(...params);
    if (result.changes === 0) {
      return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
    }
    return { content: [{ type: "text", text: `Promoted to team scope: "${title}"` }] };
  }

  // ── FORGET ────────────────────────────────────────────────────────────────

  async forget(args: ForgetArgs): Promise<ToolResult> {
    const { project, title, type } = args;
    let sql = `DELETE FROM memories WHERE project = ? AND title = ?`;
    const params: unknown[] = [project, title];
    if (type) { sql += ` AND type = ?`; params.push(type); }

    const result = this.db.prepare(sql).run(...params);
    if (result.changes === 0) {
      return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
    }
    return { content: [{ type: "text", text: `Deleted ${result.changes} memory entry: "${title}"` }] };
  }

  // ── LIST MEMORIES ─────────────────────────────────────────────────────────

  async listMemories(args: ListMemoriesArgs): Promise<ToolResult> {
    const { project, type, limit = 200 } = args;
    let sql = `SELECT * FROM memories WHERE project = ?`;
    const params: unknown[] = [project];
    if (type) { sql += ` AND type = ?`; params.push(type); }
    sql += ` ORDER BY timestamp ASC LIMIT ?`;
    params.push(limit);

    const results = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No memories found for project "${project}".` }] };
    }

    const now = Date.now();
    const formatted = results.map((m) => {
      const age_days = Math.floor((now - new Date(m["timestamp"] as string).getTime()) / 86400000);
      return JSON.stringify({
        type: m["type"],
        title: m["title"],
        content: m["content"],
        timestamp: m["timestamp"],
        age_days,
        scope: m["scope"],
      });
    }).join("\n");

    return { content: [{ type: "text", text: `${results.length} memories for project "${project}":\n\n${formatted}` }] };
  }

  // ── ARCHIVE WORKITEM ──────────────────────────────────────────────────────

  async archiveWorkitem(args: ArchiveWorkitemArgs): Promise<ToolResult> {
    const { wi_path, project, username, git_commit, documentation } = args;
    this.db.prepare(`
      INSERT INTO workitems (wi_path, project, username, git_commit, documentation, archived_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(wi_path, project, username ?? null, git_commit ?? null, documentation, new Date().toISOString());
    return { content: [{ type: "text", text: `Workitem archived: ${wi_path} (project: ${project})` }] };
  }

  // ── START SESSION ─────────────────────────────────────────────────────────

  async startSession(args: StartSessionArgs): Promise<ToolResult> {
    const { project, agent, cwd = "", session_id: supplied_id } = args;
    const session_id = supplied_id ?? randomUUID();
    this.db.prepare(`
      INSERT OR IGNORE INTO sessions (session_id, project, agent, cwd, started_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(session_id, project, agent, cwd, new Date().toISOString());
    return { content: [{ type: "text", text: JSON.stringify({ session_id }) }] };
  }

  // ── LOG MESSAGE ───────────────────────────────────────────────────────────

  async logMessage(args: LogMessageArgs): Promise<ToolResult> {
    const { session_id, role, content } = args;
    const seq = this.nextMessageSeqSync(session_id);
    this.db.prepare(`
      INSERT INTO messages (session_id, role, content, seq, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(session_id, role, content, seq, new Date().toISOString());
    return { content: [{ type: "text", text: `Logged [${role}] seq:${seq}` }] };
  }

  // ── GET SESSION ───────────────────────────────────────────────────────────

  async getSession(args: GetSessionArgs): Promise<ToolResult> {
    const { session_id } = args;
    const session = this.db.prepare(`SELECT * FROM sessions WHERE session_id = ?`).get(session_id) as Record<string, unknown> | undefined;
    if (!session) {
      return { content: [{ type: "text", text: `No session found: "${session_id}"` }] };
    }

    const msgs = this.db.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC`).all(session_id) as Array<Record<string, unknown>>;
    const transcript = msgs.map((m) => `[${(m["role"] as string).toUpperCase()}]: ${m["content"] as string}`).join("\n\n");
    const header = `Session: ${session_id}\nProject: ${session["project"] as string} | Agent: ${session["agent"] as string} | Started: ${session["started_at"] as string}\nMessages: ${msgs.length}\n\n`;

    return { content: [{ type: "text", text: header + (transcript || "(no messages yet)") }] };
  }

  // ── LIST SESSIONS ─────────────────────────────────────────────────────────

  async listSessions(args: ListSessionsArgs): Promise<ToolResult> {
    const { project, agent, limit = 10 } = args;
    let sql = `SELECT * FROM sessions WHERE project = ?`;
    const params: unknown[] = [project];
    if (agent) { sql += ` AND agent = ?`; params.push(agent); }
    sql += ` ORDER BY started_at DESC LIMIT ?`;
    params.push(limit);

    const results = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    if (results.length === 0) {
      return { content: [{ type: "text", text: `No sessions found for project "${project}".` }] };
    }

    const formatted = results.map((s) =>
      `[${s["started_at"] as string}] ${s["session_id"] as string} | ${s["agent"] as string}${s["cwd"] ? ` | ${s["cwd"] as string}` : ""}`
    ).join("\n");

    return { content: [{ type: "text", text: `Sessions for "${project}":\n\n${formatted}` }] };
  }

  // ── GET SYSTEM STATUS ─────────────────────────────────────────────────────

  async getSystemStatus(): Promise<ToolResult> {
    const memCount    = (this.db.prepare(`SELECT COUNT(*) as c FROM memories`).get() as { c: number }).c;
    const sessionCount = (this.db.prepare(`SELECT COUNT(*) as c FROM sessions`).get() as { c: number }).c;
    const msgCount    = (this.db.prepare(`SELECT COUNT(*) as c FROM messages`).get() as { c: number }).c;
    const projectRows = this.db.prepare(`SELECT DISTINCT project FROM memories`).all() as Array<{ project: string }>;
    const projects    = projectRows.map((r) => r.project);

    const text = [
      `Status: HEALTHY`,
      `Memories: ${memCount} across ${projects.length} project(s) — ${projects.join(", ") || "none"}`,
      `Sessions: ${sessionCount} | Messages logged: ${msgCount}`,
    ].join("\n");

    return { content: [{ type: "text", text: text }] };
  }

  // ── NEXT MESSAGE SEQ (helper for logger.mjs) ──────────────────────────────

  async nextMessageSeq(session_id: string): Promise<number> {
    return this.nextMessageSeqSync(session_id);
  }

  private nextMessageSeqSync(session_id: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) as c FROM messages WHERE session_id = ?`).get(session_id) as { c: number };
    return row.c;
  }

  // ── LIFECYCLE ─────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    // better-sqlite3 connections are cheap; closing is a no-op for logger use.
    // Explicit close is available for long-lived process cleanup.
    this.db.close();
  }
}
