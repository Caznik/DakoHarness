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

import { MongoClient, type Db } from "mongodb";
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

export class MongoStorage implements Storage {
  private client: MongoClient;
  private db: Db;

  private constructor(client: MongoClient, db: Db) {
    this.client = client;
    this.db = db;
  }

  /**
   * Factory — opens the MongoClient, creates indexes, returns a ready instance.
   * Throws with a helpful hint if the connection fails (R5 mitigation).
   */
  static async create(uri: string, dbName: string): Promise<MongoStorage> {
    const client = new MongoClient(uri);
    try {
      await client.connect();
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `MongoDB connection failed: ${reason}. ` +
        `To switch to a self-contained backend, set DAKO_STORAGE_BACKEND=sqlite in .env`
      );
    }

    const db = client.db(dbName);
    console.error("Connected to MongoDB");

    // Indexes — same 4 created previously in server.ts main()
    await db.collection("memories").createIndex(
      { title: "text", content: "text" },
      { name: "memories_text_search" }
    );
    await db.collection("memories").createIndex({ scope: 1 });
    await db.collection("workitems").createIndex({ project: 1, wi_path: 1 });
    await db.collection("workitems").createIndex(
      { documentation: "text" },
      { name: "workitems_text_search" }
    );

    return new MongoStorage(client, db);
  }

  // ── REMEMBER ──────────────────────────────────────────────────────────────

  async remember(args: RememberArgs): Promise<ToolResult> {
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

  async recall(args: RecallArgs): Promise<ToolResult> {
    const { project, query, type, limit = 10, include_team = false } = args;
    const memories = this.db.collection("memories");

    const filter: Record<string, unknown> = { $text: { $search: query } };
    if (include_team) {
      filter["$or"] = [{ project }, { scope: "team" }];
    } else {
      filter["project"] = project;
    }
    if (type) filter["type"] = type;

    const results = await memories
      .find(filter, { projection: { score: { $meta: "textScore" } } })
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .toArray();

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No memories found for "${query}" in project "${project}".` }] };
    }

    const formatted = results.map((m) =>
      `[${(m["type"] as string).toUpperCase()}] ${m["title"] as string}\n${m["content"] as string}${(m["tags"] as string[] | undefined)?.length ? `\nTags: ${(m["tags"] as string[]).join(", ")}` : ""}`
    ).join("\n\n---\n\n");

    return { content: [{ type: "text", text: `${results.length} result(s) for "${query}":\n\n${formatted}` }] };
  }

  // ── GET CONTEXT ───────────────────────────────────────────────────────────

  async getContext(args: GetContextArgs): Promise<ToolResult> {
    const { project, type } = args;
    const memories = this.db.collection("memories");

    const filter: Record<string, unknown> = { project };
    if (type) filter["type"] = type;

    const all = await memories.find(filter).sort({ type: 1, timestamp: -1 }).toArray();

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
    const memFilter: Record<string, unknown> = { project, title };
    if (type) memFilter["type"] = type;
    const result = await this.db.collection("memories").updateOne(memFilter, { $set: { scope: "team" } });
    if (result.matchedCount === 0) {
      return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
    }
    return { content: [{ type: "text", text: `Promoted to team scope: "${title}"` }] };
  }

  // ── FORGET ────────────────────────────────────────────────────────────────

  async forget(args: ForgetArgs): Promise<ToolResult> {
    const { project, title, type } = args;
    const filter: Record<string, unknown> = { project, title };
    if (type) filter["type"] = type;
    const result = await this.db.collection("memories").deleteMany(filter);
    if (result.deletedCount === 0) {
      return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
    }
    return { content: [{ type: "text", text: `Deleted ${result.deletedCount} memory entry: "${title}"` }] };
  }

  // ── LIST MEMORIES ─────────────────────────────────────────────────────────

  async listMemories(args: ListMemoriesArgs): Promise<ToolResult> {
    const { project, type, limit = 200 } = args;
    const filter: Record<string, unknown> = { project };
    if (type) filter["type"] = type;
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
      const age_days = Math.floor((now - new Date(m["timestamp"] as Date).getTime()) / 86400000);
      return JSON.stringify({ type: m["type"], title: m["title"], content: m["content"], timestamp: m["timestamp"], age_days, scope: m["scope"] });
    }).join("\n");

    return { content: [{ type: "text", text: `${results.length} memories for project "${project}":\n\n${formatted}` }] };
  }

  // ── ARCHIVE WORKITEM ──────────────────────────────────────────────────────

  async archiveWorkitem(args: ArchiveWorkitemArgs): Promise<ToolResult> {
    const { wi_path, project, username, git_commit, documentation } = args;
    await this.db.collection("workitems").insertOne({
      wi_path, project,
      ...(username   ? { username }   : {}),
      ...(git_commit ? { git_commit } : {}),
      documentation,
      archived_at: new Date(),
    });
    return { content: [{ type: "text", text: `Workitem archived: ${wi_path} (project: ${project})` }] };
  }

  // ── START SESSION ─────────────────────────────────────────────────────────

  async startSession(args: StartSessionArgs): Promise<ToolResult> {
    const { project, agent, cwd = "", session_id: supplied_id } = args;
    const session_id = supplied_id ?? randomUUID();
    await this.db.collection("sessions").insertOne({ session_id, project, agent, cwd, started_at: new Date() });
    return { content: [{ type: "text", text: JSON.stringify({ session_id }) }] };
  }

  // ── LOG MESSAGE ───────────────────────────────────────────────────────────

  async logMessage(args: LogMessageArgs): Promise<ToolResult> {
    const { session_id, role, content } = args;
    const messages = this.db.collection("messages");
    const seq = await messages.countDocuments({ session_id });
    await messages.insertOne({ session_id, role, content, seq, timestamp: new Date() });
    return { content: [{ type: "text", text: `Logged [${role}] seq:${seq}` }] };
  }

  // ── GET SESSION ───────────────────────────────────────────────────────────

  async getSession(args: GetSessionArgs): Promise<ToolResult> {
    const { session_id } = args;
    const session = await this.db.collection("sessions").findOne({ session_id });
    if (!session) {
      return { content: [{ type: "text", text: `No session found: "${session_id}"` }] };
    }

    const msgs = await this.db.collection("messages").find({ session_id }).sort({ seq: 1 }).toArray();
    const transcript = msgs.map((m) => `[${(m["role"] as string).toUpperCase()}]: ${m["content"] as string}`).join("\n\n");
    const header = `Session: ${session_id}\nProject: ${session["project"] as string} | Agent: ${session["agent"] as string} | Started: ${(session["started_at"] as Date).toISOString()}\nMessages: ${msgs.length}\n\n`;

    return { content: [{ type: "text", text: header + (transcript || "(no messages yet)") }] };
  }

  // ── LIST SESSIONS ─────────────────────────────────────────────────────────

  async listSessions(args: ListSessionsArgs): Promise<ToolResult> {
    const { project, agent, limit = 10 } = args;
    const query: Record<string, unknown> = { project };
    if (agent) query["agent"] = agent;

    const results = await this.db.collection("sessions").find(query).sort({ started_at: -1 }).limit(limit).toArray();
    if (results.length === 0) {
      return { content: [{ type: "text", text: `No sessions found for project "${project}".` }] };
    }

    const formatted = results.map((s) =>
      `[${(s["started_at"] as Date).toISOString()}] ${s["session_id"] as string} | ${s["agent"] as string}${s["cwd"] ? ` | ${s["cwd"] as string}` : ""}`
    ).join("\n");

    return { content: [{ type: "text", text: `Sessions for "${project}":\n\n${formatted}` }] };
  }

  // ── GET SYSTEM STATUS ─────────────────────────────────────────────────────

  async getSystemStatus(): Promise<ToolResult> {
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

  async nextMessageSeq(session_id: string): Promise<number> {
    return this.db.collection("messages").countDocuments({ session_id });
  }

  // ── LIFECYCLE ─────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    await this.client.close();
  }
}
