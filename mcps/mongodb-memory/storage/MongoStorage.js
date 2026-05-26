/**
 * MongoStorage.ts — MongoDB adapter for the Storage interface.
 *
 * Wraps the existing MongoDB driver usage from server.ts. Behavior is
 * identical to the pre-WI implementation — this is a pure relocation,
 * not a rewrite. The MongoClient lifecycle, collection names, index
 * definitions, query shapes, and return text formats are all preserved
 * verbatim so that AC-2 and AC-8 (transparency for existing users) hold.
 *
 * Index creation moves here from main() in server.ts so that the server
 * entry point no longer needs to know which backend's indexes to create.
 */
import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";
export class MongoStorage {
    client;
    db;
    constructor(client, db) {
        this.client = client;
        this.db = db;
    }
    /**
     * Factory — opens the MongoClient, creates indexes, returns a ready instance.
     * Throws with a helpful hint if the connection fails (R5 mitigation).
     */
    static async create(uri, dbName) {
        const client = new MongoClient(uri);
        try {
            await client.connect();
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            throw new Error(`MongoDB connection failed: ${reason}. ` +
                `To switch to a self-contained backend, set DAKO_STORAGE_BACKEND=sqlite in .env`);
        }
        const db = client.db(dbName);
        console.error("Connected to MongoDB");
        // Indexes — same 4 created previously in server.ts main()
        await db.collection("memories").createIndex({ title: "text", content: "text" }, { name: "memories_text_search" });
        await db.collection("memories").createIndex({ scope: 1 });
        await db.collection("workitems").createIndex({ project: 1, wi_path: 1 });
        await db.collection("workitems").createIndex({ documentation: "text" }, { name: "workitems_text_search" });
        return new MongoStorage(client, db);
    }
    // ── REMEMBER ──────────────────────────────────────────────────────────────
    async remember(args) {
        const { project, agent, type, title, content, tags = [], session_id, scope = "project" } = args;
        const memories = this.db.collection("memories");
        await memories.insertOne({
            project, agent, type, title, content, tags, scope,
            ...(session_id ? { session_id } : {}),
            timestamp: new Date(),
        });
        return { content: [{ type: "text", text: `Remembered [${type}]: "${title}"` }] };
    }
    // ── RECALL ────────────────────────────────────────────────────────────────
    async recall(args) {
        const { project, query, type, limit = 10, include_team = false } = args;
        const memories = this.db.collection("memories");
        const filter = { $text: { $search: query } };
        if (include_team) {
            filter["$or"] = [{ project }, { scope: "team" }];
        }
        else {
            filter["project"] = project;
        }
        if (type)
            filter["type"] = type;
        const results = await memories
            .find(filter, { projection: { score: { $meta: "textScore" } } })
            .sort({ score: { $meta: "textScore" } })
            .limit(limit)
            .toArray();
        if (results.length === 0) {
            return { content: [{ type: "text", text: `No memories found for "${query}" in project "${project}".` }] };
        }
        const formatted = results.map((m) => `[${m["type"].toUpperCase()}] ${m["title"]}\n${m["content"]}${m["tags"]?.length ? `\nTags: ${m["tags"].join(", ")}` : ""}`).join("\n\n---\n\n");
        return { content: [{ type: "text", text: `${results.length} result(s) for "${query}":\n\n${formatted}` }] };
    }
    // ── GET CONTEXT ───────────────────────────────────────────────────────────
    async getContext(args) {
        const { project, type } = args;
        const memories = this.db.collection("memories");
        const filter = { project };
        if (type)
            filter["type"] = type;
        const all = await memories.find(filter).sort({ type: 1, timestamp: -1 }).toArray();
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
        const memFilter = { project, title };
        if (type)
            memFilter["type"] = type;
        const result = await this.db.collection("memories").updateOne(memFilter, { $set: { scope: "team" } });
        if (result.matchedCount === 0) {
            return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
        }
        return { content: [{ type: "text", text: `Promoted to team scope: "${title}"` }] };
    }
    // ── FORGET ────────────────────────────────────────────────────────────────
    async forget(args) {
        const { project, title, type } = args;
        const filter = { project, title };
        if (type)
            filter["type"] = type;
        const result = await this.db.collection("memories").deleteMany(filter);
        if (result.deletedCount === 0) {
            return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
        }
        return { content: [{ type: "text", text: `Deleted ${result.deletedCount} memory entry: "${title}"` }] };
    }
    // ── LIST MEMORIES ─────────────────────────────────────────────────────────
    async listMemories(args) {
        const { project, type, limit = 200 } = args;
        const filter = { project };
        if (type)
            filter["type"] = type;
        const results = await this.db.collection("memories")
            .find(filter)
            .sort({ timestamp: 1 })
            .limit(limit)
            .toArray();
        if (results.length === 0) {
            return { content: [{ type: "text", text: `No memories found for project "${project}".` }] };
        }
        const now = Date.now();
        const formatted = results.map((m) => {
            const age_days = Math.floor((now - new Date(m["timestamp"]).getTime()) / 86400000);
            return JSON.stringify({ type: m["type"], title: m["title"], content: m["content"], timestamp: m["timestamp"], age_days, scope: m["scope"] });
        }).join("\n");
        return { content: [{ type: "text", text: `${results.length} memories for project "${project}":\n\n${formatted}` }] };
    }
    // ── ARCHIVE WORKITEM ──────────────────────────────────────────────────────
    async archiveWorkitem(args) {
        const { wi_path, project, username, git_commit, documentation } = args;
        await this.db.collection("workitems").insertOne({
            wi_path, project,
            ...(username ? { username } : {}),
            ...(git_commit ? { git_commit } : {}),
            documentation,
            archived_at: new Date(),
        });
        return { content: [{ type: "text", text: `Workitem archived: ${wi_path} (project: ${project})` }] };
    }
    // ── START SESSION ─────────────────────────────────────────────────────────
    async startSession(args) {
        const { project, agent, cwd = "", session_id: supplied_id } = args;
        const session_id = supplied_id ?? randomUUID();
        await this.db.collection("sessions").insertOne({ session_id, project, agent, cwd, started_at: new Date() });
        return { content: [{ type: "text", text: JSON.stringify({ session_id }) }] };
    }
    // ── LOG MESSAGE ───────────────────────────────────────────────────────────
    async logMessage(args) {
        const { session_id, role, content } = args;
        const messages = this.db.collection("messages");
        const seq = await messages.countDocuments({ session_id });
        await messages.insertOne({ session_id, role, content, seq, timestamp: new Date() });
        return { content: [{ type: "text", text: `Logged [${role}] seq:${seq}` }] };
    }
    // ── GET SESSION ───────────────────────────────────────────────────────────
    async getSession(args) {
        const { session_id } = args;
        const session = await this.db.collection("sessions").findOne({ session_id });
        if (!session) {
            return { content: [{ type: "text", text: `No session found: "${session_id}"` }] };
        }
        const msgs = await this.db.collection("messages").find({ session_id }).sort({ seq: 1 }).toArray();
        const transcript = msgs.map((m) => `[${m["role"].toUpperCase()}]: ${m["content"]}`).join("\n\n");
        const header = `Session: ${session_id}\nProject: ${session["project"]} | Agent: ${session["agent"]} | Started: ${session["started_at"].toISOString()}\nMessages: ${msgs.length}\n\n`;
        return { content: [{ type: "text", text: header + (transcript || "(no messages yet)") }] };
    }
    // ── LIST SESSIONS ─────────────────────────────────────────────────────────
    async listSessions(args) {
        const { project, agent, limit = 10 } = args;
        const query = { project };
        if (agent)
            query["agent"] = agent;
        const results = await this.db.collection("sessions").find(query).sort({ started_at: -1 }).limit(limit).toArray();
        if (results.length === 0) {
            return { content: [{ type: "text", text: `No sessions found for project "${project}".` }] };
        }
        const formatted = results.map((s) => `[${s["started_at"].toISOString()}] ${s["session_id"]} | ${s["agent"]}${s["cwd"] ? ` | ${s["cwd"]}` : ""}`).join("\n");
        return { content: [{ type: "text", text: `Sessions for "${project}":\n\n${formatted}` }] };
    }
    // ── GET SYSTEM STATUS ─────────────────────────────────────────────────────
    async getSystemStatus() {
        const memories = this.db.collection("memories");
        const sessions = this.db.collection("sessions");
        const messages = this.db.collection("messages");
        const [memCount, sessionCount, msgCount, projects] = await Promise.all([
            memories.countDocuments(),
            sessions.countDocuments(),
            messages.countDocuments(),
            memories.distinct("project"),
        ]);
        const text = [
            `Status: HEALTHY`,
            `Memories: ${memCount} across ${projects.length} project(s) — ${projects.join(", ") || "none"}`,
            `Sessions: ${sessionCount} | Messages logged: ${msgCount}`,
        ].join("\n");
        return { content: [{ type: "text", text: text }] };
    }
    // ── NEXT MESSAGE SEQ (helper for logger.mjs) ──────────────────────────────
    async nextMessageSeq(session_id) {
        return this.db.collection("messages").countDocuments({ session_id });
    }
    // ── LIFECYCLE ─────────────────────────────────────────────────────────────
    async close() {
        await this.client.close();
    }
}
//# sourceMappingURL=MongoStorage.js.map