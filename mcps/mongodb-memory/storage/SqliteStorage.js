// AUTO-MIRROR of SqliteStorage.ts — keep in sync (no build step yet)
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";

export class SqliteStorage {
  constructor(db) {
    this.db = db;
  }

  /**
   * Factory — creates/opens the SQLite file, runs schema init, returns ready instance.
   */
  static create(dbPath) {
    // Ensure parent directory exists (R6: mkdirSync is idempotent)
    mkdirSync(dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);

    // Performance pragmas
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    // ── Schema init (idempotent) ─────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project     TEXT    NOT NULL,
        agent       TEXT    NOT NULL,
        type        TEXT    NOT NULL,
        title       TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        tags        TEXT    NOT NULL DEFAULT '[]',
        scope       TEXT    NOT NULL DEFAULT 'project',
        session_id  TEXT,
        timestamp   TEXT    NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        title,
        content,
        content=memories,
        content_rowid=id
      );

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

      CREATE TABLE IF NOT EXISTS workitems (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        wi_path       TEXT    NOT NULL,
        project       TEXT    NOT NULL,
        username      TEXT,
        git_commit    TEXT,
        documentation TEXT    NOT NULL,
        archived_at   TEXT    NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS workitems_fts USING fts5(
        documentation,
        content=workitems,
        content_rowid=id
      );

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

      CREATE TABLE IF NOT EXISTS sessions (
        session_id  TEXT PRIMARY KEY,
        project     TEXT NOT NULL,
        agent       TEXT NOT NULL,
        cwd         TEXT NOT NULL DEFAULT '',
        started_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT    NOT NULL,
        role        TEXT    NOT NULL,
        content     TEXT    NOT NULL,
        seq         INTEGER NOT NULL,
        timestamp   TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_session_seq ON messages (session_id, seq);
    `);

    return new SqliteStorage(db);
  }

  // ── REMEMBER ──────────────────────────────────────────────────────────────

  async remember(args) {
    const { project, agent, type, title, content, tags = [], session_id, scope = "project" } = args;
    this.db.prepare(`
      INSERT INTO memories (project, agent, type, title, content, tags, scope, session_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(project, agent, type, title, content, JSON.stringify(tags), scope, session_id ?? null, new Date().toISOString());
    return { content: [{ type: "text", text: `Remembered [${type}]: "${title}"` }] };
  }

  // ── RECALL ────────────────────────────────────────────────────────────────

  async recall(args) {
    const { project, query, type, limit = 10, include_team = false } = args;

    let sql;
    const params = [query];

    if (include_team) {
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

    const results = this.db.prepare(sql).all(...params);

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No memories found for "${query}" in project "${project}".` }] };
    }

    const formatted = results.map(m => {
      const tagsArr = JSON.parse(m.tags);
      return `[${m.type.toUpperCase()}] ${m.title}\n${m.content}${tagsArr.length ? `\nTags: ${tagsArr.join(", ")}` : ""}`;
    }).join("\n\n---\n\n");

    return { content: [{ type: "text", text: `${results.length} result(s) for "${query}":\n\n${formatted}` }] };
  }

  // ── GET CONTEXT ───────────────────────────────────────────────────────────

  async getContext(args) {
    const { project, type } = args;

    let sql = `SELECT * FROM memories WHERE project = ?`;
    const params = [project];
    if (type) { sql += ` AND type = ?`; params.push(type); }
    sql += ` ORDER BY type ASC, timestamp DESC`;

    const all = this.db.prepare(sql).all(...params);

    if (all.length === 0) {
      return { content: [{ type: "text", text: `No memories stored for project "${project}" yet.` }] };
    }

    const grouped = {};
    for (const m of all) {
      if (!grouped[m.type]) grouped[m.type] = [];
      grouped[m.type].push(m);
    }

    const sections = Object.entries(grouped).map(([t, items]) => {
      const entries = items.map(m => `  • ${m.title}\n    ${m.content}`).join("\n");
      return `## ${t.toUpperCase()}S\n${entries}`;
    });

    return { content: [{ type: "text", text: `Project context for "${project}":\n\n${sections.join("\n\n")}` }] };
  }

  // ── PROMOTE TO TEAM ───────────────────────────────────────────────────────

  async promoteToTeam(args) {
    const { project, title, type } = args;
    let sql = `UPDATE memories SET scope = 'team' WHERE project = ? AND title = ?`;
    const params = [project, title];
    if (type) { sql += ` AND type = ?`; params.push(type); }

    const result = this.db.prepare(sql).run(...params);
    if (result.changes === 0) {
      return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
    }
    return { content: [{ type: "text", text: `Promoted to team scope: "${title}"` }] };
  }

  // ── FORGET ────────────────────────────────────────────────────────────────

  async forget(args) {
    const { project, title, type } = args;
    let sql = `DELETE FROM memories WHERE project = ? AND title = ?`;
    const params = [project, title];
    if (type) { sql += ` AND type = ?`; params.push(type); }

    const result = this.db.prepare(sql).run(...params);
    if (result.changes === 0) {
      return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
    }
    return { content: [{ type: "text", text: `Deleted ${result.changes} memory entry: "${title}"` }] };
  }

  // ── LIST MEMORIES ─────────────────────────────────────────────────────────

  async listMemories(args) {
    const { project, type, limit = 200 } = args;
    let sql = `SELECT * FROM memories WHERE project = ?`;
    const params = [project];
    if (type) { sql += ` AND type = ?`; params.push(type); }
    sql += ` ORDER BY timestamp ASC LIMIT ?`;
    params.push(limit);

    const results = this.db.prepare(sql).all(...params);

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No memories found for project "${project}".` }] };
    }

    const now = Date.now();
    const formatted = results.map(m => {
      const age_days = Math.floor((now - new Date(m.timestamp).getTime()) / 86400000);
      return JSON.stringify({ type: m.type, title: m.title, content: m.content, timestamp: m.timestamp, age_days, scope: m.scope });
    }).join("\n");

    return { content: [{ type: "text", text: `${results.length} memories for project "${project}":\n\n${formatted}` }] };
  }

  // ── ARCHIVE WORKITEM ──────────────────────────────────────────────────────

  async archiveWorkitem(args) {
    const { wi_path, project, username, git_commit, documentation } = args;
    this.db.prepare(`
      INSERT INTO workitems (wi_path, project, username, git_commit, documentation, archived_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(wi_path, project, username ?? null, git_commit ?? null, documentation, new Date().toISOString());
    return { content: [{ type: "text", text: `Workitem archived: ${wi_path} (project: ${project})` }] };
  }

  // ── START SESSION ─────────────────────────────────────────────────────────

  async startSession(args) {
    const { project, agent, cwd = "", session_id: supplied_id } = args;
    const session_id = supplied_id ?? randomUUID();
    this.db.prepare(`
      INSERT OR IGNORE INTO sessions (session_id, project, agent, cwd, started_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(session_id, project, agent, cwd, new Date().toISOString());
    return { content: [{ type: "text", text: JSON.stringify({ session_id }) }] };
  }

  // ── LOG MESSAGE ───────────────────────────────────────────────────────────

  async logMessage(args) {
    const { session_id, role, content } = args;
    const seq = this._nextSeqSync(session_id);
    this.db.prepare(`
      INSERT INTO messages (session_id, role, content, seq, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(session_id, role, content, seq, new Date().toISOString());
    return { content: [{ type: "text", text: `Logged [${role}] seq:${seq}` }] };
  }

  // ── GET SESSION ───────────────────────────────────────────────────────────

  async getSession(args) {
    const { session_id } = args;
    const session = this.db.prepare(`SELECT * FROM sessions WHERE session_id = ?`).get(session_id);
    if (!session) {
      return { content: [{ type: "text", text: `No session found: "${session_id}"` }] };
    }

    const msgs = this.db.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC`).all(session_id);
    const transcript = msgs.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join("\n\n");
    const header = `Session: ${session_id}\nProject: ${session.project} | Agent: ${session.agent} | Started: ${session.started_at}\nMessages: ${msgs.length}\n\n`;

    return { content: [{ type: "text", text: header + (transcript || "(no messages yet)") }] };
  }

  // ── LIST SESSIONS ─────────────────────────────────────────────────────────

  async listSessions(args) {
    const { project, agent, limit = 10 } = args;
    let sql = `SELECT * FROM sessions WHERE project = ?`;
    const params = [project];
    if (agent) { sql += ` AND agent = ?`; params.push(agent); }
    sql += ` ORDER BY started_at DESC LIMIT ?`;
    params.push(limit);

    const results = this.db.prepare(sql).all(...params);
    if (results.length === 0) {
      return { content: [{ type: "text", text: `No sessions found for project "${project}".` }] };
    }

    const formatted = results.map(s =>
      `[${s.started_at}] ${s.session_id} | ${s.agent}${s.cwd ? ` | ${s.cwd}` : ""}`
    ).join("\n");

    return { content: [{ type: "text", text: `Sessions for "${project}":\n\n${formatted}` }] };
  }

  // ── GET SYSTEM STATUS ─────────────────────────────────────────────────────

  async getSystemStatus() {
    const memCount    = this.db.prepare(`SELECT COUNT(*) as c FROM memories`).get().c;
    const sessionCount = this.db.prepare(`SELECT COUNT(*) as c FROM sessions`).get().c;
    const msgCount    = this.db.prepare(`SELECT COUNT(*) as c FROM messages`).get().c;
    const projectRows = this.db.prepare(`SELECT DISTINCT project FROM memories`).all();
    const projects    = projectRows.map(r => r.project);

    const text = [
      `Status: HEALTHY`,
      `Memories: ${memCount} across ${projects.length} project(s) — ${projects.join(", ") || "none"}`,
      `Sessions: ${sessionCount} | Messages logged: ${msgCount}`,
    ].join("\n");

    return { content: [{ type: "text", text: text }] };
  }

  // ── NEXT MESSAGE SEQ (helper for logger.mjs) ──────────────────────────────

  async nextMessageSeq(session_id) {
    return this._nextSeqSync(session_id);
  }

  _nextSeqSync(session_id) {
    return this.db.prepare(`SELECT COUNT(*) as c FROM messages WHERE session_id = ?`).get(session_id).c;
  }

  // ── LIFECYCLE ─────────────────────────────────────────────────────────────

  async close() {
    this.db.close();
  }
}
