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
import { embedTexts, getModelId, floatsToBytes, bytesToFloats, cosine, rrfMerge, } from "../embed.js";
export class SqliteStorage {
    db;
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
        // WI-local-embedding-recall: idempotent ALTER TABLE to add vector columns.
        // better-sqlite3 throws "duplicate column name" on subsequent runs — catch
        // that one specific error and rethrow anything else.
        const addColumnIfMissing = (sql) => {
            try {
                db.exec(sql);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!/duplicate column name/i.test(msg))
                    throw err;
            }
        };
        addColumnIfMissing(`ALTER TABLE memories ADD COLUMN embedding BLOB`);
        addColumnIfMissing(`ALTER TABLE memories ADD COLUMN embedding_model TEXT`);
        return new SqliteStorage(db);
    }
    // ── REMEMBER ──────────────────────────────────────────────────────────────
    async remember(args) {
        const { project, agent, type, title, content, tags = [], session_id, scope = "project" } = args;
        const stmt = this.db.prepare(`
      INSERT INTO memories (project, agent, type, title, content, tags, scope, session_id, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const info = stmt.run(project, agent, type, title, content, JSON.stringify(tags), scope, session_id ?? null, new Date().toISOString());
        // Inline embed (AC-3). Failure does not block insert — log to stderr and
        // leave embedding/embedding_model NULL. The keyword path still works.
        try {
            const [vec] = await embedTexts([`${title}\n${content}`]);
            if (vec) {
                this.db.prepare(`UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?`)
                    .run(floatsToBytes(vec), getModelId(), info.lastInsertRowid);
            }
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[embed] inline embed failed for "${title}": ${reason}\n`);
        }
        return { content: [{ type: "text", text: `Remembered [${type}]: "${title}"` }] };
    }
    // ── RECALL ────────────────────────────────────────────────────────────────
    async recall(args) {
        const { project, query, type, limit = 10, include_team = false, mode: suppliedMode, embedding } = args;
        const currentModel = getModelId();
        const candidateCap = Math.max(2 * limit, 1);
        // ── Auto-detect mode (AC-4) ──────────────────────────────────────────────
        const hasEmbeddings = () => {
            const probeSql = include_team
                ? `SELECT 1 FROM memories WHERE (project = ? OR scope = 'team') AND embedding_model = ? AND embedding IS NOT NULL LIMIT 1`
                : `SELECT 1 FROM memories WHERE project = ? AND embedding_model = ? AND embedding IS NOT NULL LIMIT 1`;
            const row = this.db.prepare(probeSql).get(project, currentModel);
            return row !== undefined;
        };
        let mode;
        if (suppliedMode) {
            mode = suppliedMode;
            if (mode === "vector" && !hasEmbeddings()) {
                throw new Error(`No embeddings for model '${currentModel}' in project '${project}'. Run 'npm run embed-backfill' to embed existing memories.`);
            }
        }
        else {
            mode = hasEmbeddings() ? "hybrid" : "keyword";
        }
        // ── Keyword half (FTS5) — returns rows in BM25 order ─────────────────────
        const runKeyword = (cap) => {
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
            }
            else {
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
            params.push(cap);
            try {
                return this.db.prepare(sql).all(...params);
            }
            catch (err) {
                // FTS5 raises a parse error for special characters in the user's query.
                // Treat as "no FTS matches" so the vector half can still produce a result.
                const msg = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[recall] FTS query failed for "${query}": ${msg}\n`);
                return [];
            }
        };
        // ── Vector half — returns rows ordered by cosine desc ────────────────────
        const runVector = async (cap) => {
            let queryVec;
            if (embedding) {
                queryVec = bytesToFloats(embedding);
            }
            else {
                const [v] = await embedTexts([query]);
                if (!v)
                    return [];
                queryVec = v;
            }
            let sql;
            const params = [];
            if (include_team) {
                sql = `SELECT * FROM memories WHERE (project = ? OR scope = 'team') AND embedding_model = ? AND embedding IS NOT NULL`;
                params.push(project, currentModel);
            }
            else {
                sql = `SELECT * FROM memories WHERE project = ? AND embedding_model = ? AND embedding IS NOT NULL`;
                params.push(project, currentModel);
            }
            if (type) {
                sql += ` AND type = ?`;
                params.push(type);
            }
            const rows = this.db.prepare(sql).all(...params);
            const scored = rows.map((r) => {
                const rowVec = bytesToFloats(r["embedding"]);
                return { row: r, score: cosine(queryVec, rowVec) };
            });
            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, cap).map((s) => s.row);
        };
        // ── Branch on mode ───────────────────────────────────────────────────────
        let finalRows;
        if (mode === "keyword") {
            finalRows = runKeyword(limit);
        }
        else if (mode === "vector") {
            finalRows = (await runVector(limit)).slice(0, limit);
        }
        else {
            // hybrid: fetch 2× from each side, RRF merge to `limit`.
            const ftsRows = runKeyword(candidateCap);
            const vecRows = await runVector(candidateCap);
            const idOf = (r) => String(r["id"]);
            const byId = new Map();
            for (const r of ftsRows)
                byId.set(idOf(r), r);
            for (const r of vecRows)
                if (!byId.has(idOf(r)))
                    byId.set(idOf(r), r);
            const mergedIds = rrfMerge(ftsRows.map(idOf), vecRows.map(idOf), limit);
            finalRows = mergedIds.map((id) => byId.get(id)).filter(Boolean);
        }
        if (finalRows.length === 0) {
            return { content: [{ type: "text", text: `No memories found for "${query}" in project "${project}".` }] };
        }
        const formatted = finalRows.map((m) => {
            const tagsArr = JSON.parse(m["tags"]);
            return `[${m["type"].toUpperCase()}] ${m["title"]}\n${m["content"]}${tagsArr.length ? `\nTags: ${tagsArr.join(", ")}` : ""}`;
        }).join("\n\n---\n\n");
        return { content: [{ type: "text", text: `${finalRows.length} result(s) for "${query}":\n\n${formatted}` }] };
    }
    // ── EMBED QUERY ───────────────────────────────────────────────────────────
    async embedQuery(args) {
        const [vec] = await embedTexts([args.text]);
        if (!vec)
            throw new Error("embedTexts returned empty result");
        const payload = {
            embedding: floatsToBytes(vec).toString("base64"),
            model: getModelId(),
        };
        return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
    // ── GET CONTEXT ───────────────────────────────────────────────────────────
    async getContext(args) {
        const { project, type } = args;
        let sql = `SELECT * FROM memories WHERE project = ?`;
        const params = [project];
        if (type) {
            sql += ` AND type = ?`;
            params.push(type);
        }
        sql += ` ORDER BY type ASC, timestamp DESC`;
        const all = this.db.prepare(sql).all(...params);
        if (all.length === 0) {
            return { content: [{ type: "text", text: `No memories stored for project "${project}" yet.` }] };
        }
        const grouped = {};
        for (const m of all) {
            const t = m["type"];
            if (!grouped[t])
                grouped[t] = [];
            grouped[t].push(m);
        }
        const sections = Object.entries(grouped).map(([t, items]) => {
            const entries = items.map((m) => `  • ${m["title"]}\n    ${m["content"]}`).join("\n");
            return `## ${t.toUpperCase()}S\n${entries}`;
        });
        return { content: [{ type: "text", text: `Project context for "${project}":\n\n${sections.join("\n\n")}` }] };
    }
    // ── PROMOTE TO TEAM ───────────────────────────────────────────────────────
    async promoteToTeam(args) {
        const { project, title, type } = args;
        let sql = `UPDATE memories SET scope = 'team' WHERE project = ? AND title = ?`;
        const params = [project, title];
        if (type) {
            sql += ` AND type = ?`;
            params.push(type);
        }
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
        if (type) {
            sql += ` AND type = ?`;
            params.push(type);
        }
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
        if (type) {
            sql += ` AND type = ?`;
            params.push(type);
        }
        sql += ` ORDER BY timestamp ASC LIMIT ?`;
        params.push(limit);
        const results = this.db.prepare(sql).all(...params);
        if (results.length === 0) {
            return { content: [{ type: "text", text: `No memories found for project "${project}".` }] };
        }
        const now = Date.now();
        const formatted = results.map((m) => {
            const age_days = Math.floor((now - new Date(m["timestamp"]).getTime()) / 86400000);
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
        const seq = this.nextMessageSeqSync(session_id);
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
        const transcript = msgs.map((m) => `[${m["role"].toUpperCase()}]: ${m["content"]}`).join("\n\n");
        const header = `Session: ${session_id}\nProject: ${session["project"]} | Agent: ${session["agent"]} | Started: ${session["started_at"]}\nMessages: ${msgs.length}\n\n`;
        return { content: [{ type: "text", text: header + (transcript || "(no messages yet)") }] };
    }
    // ── LIST SESSIONS ─────────────────────────────────────────────────────────
    async listSessions(args) {
        const { project, agent, limit = 10 } = args;
        let sql = `SELECT * FROM sessions WHERE project = ?`;
        const params = [project];
        if (agent) {
            sql += ` AND agent = ?`;
            params.push(agent);
        }
        sql += ` ORDER BY started_at DESC LIMIT ?`;
        params.push(limit);
        const results = this.db.prepare(sql).all(...params);
        if (results.length === 0) {
            return { content: [{ type: "text", text: `No sessions found for project "${project}".` }] };
        }
        const formatted = results.map((s) => `[${s["started_at"]}] ${s["session_id"]} | ${s["agent"]}${s["cwd"] ? ` | ${s["cwd"]}` : ""}`).join("\n");
        return { content: [{ type: "text", text: `Sessions for "${project}":\n\n${formatted}` }] };
    }
    // ── GET SYSTEM STATUS ─────────────────────────────────────────────────────
    async getSystemStatus() {
        const memCount = this.db.prepare(`SELECT COUNT(*) as c FROM memories`).get().c;
        const sessionCount = this.db.prepare(`SELECT COUNT(*) as c FROM sessions`).get().c;
        const msgCount = this.db.prepare(`SELECT COUNT(*) as c FROM messages`).get().c;
        const projectRows = this.db.prepare(`SELECT DISTINCT project FROM memories`).all();
        const projects = projectRows.map((r) => r.project);
        const text = [
            `Status: HEALTHY`,
            `Memories: ${memCount} across ${projects.length} project(s) — ${projects.join(", ") || "none"}`,
            `Sessions: ${sessionCount} | Messages logged: ${msgCount}`,
        ].join("\n");
        return { content: [{ type: "text", text: text }] };
    }
    // ── NEXT MESSAGE SEQ (helper for logger.mjs) ──────────────────────────────
    async nextMessageSeq(session_id) {
        return this.nextMessageSeqSync(session_id);
    }
    nextMessageSeqSync(session_id) {
        const row = this.db.prepare(`SELECT COUNT(*) as c FROM messages WHERE session_id = ?`).get(session_id);
        return row.c;
    }
    // ── LIFECYCLE ─────────────────────────────────────────────────────────────
    async close() {
        // better-sqlite3 connections are cheap; closing is a no-op for logger use.
        // Explicit close is available for long-lived process cleanup.
        this.db.close();
    }
}
//# sourceMappingURL=SqliteStorage.js.map