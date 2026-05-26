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

import { MongoClient, Binary, type Db } from "mongodb";
import { randomUUID } from "crypto";
import type {
  Storage,
  ToolResult,
  RememberArgs,
  RecallArgs,
  EmbedQueryArgs,
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
import {
  embedTexts,
  getModelId,
  floatsToBytes,
  bytesToFloats,
  cosine,
  rrfMerge,
} from "../embed.js";

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
    // WI-local-embedding-recall: index on embedding_model so the mismatch-skip
    // filter for vector recall is server-side fast even with many memories.
    await db.collection("memories").createIndex({ embedding_model: 1 });
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
    const result = await memories.insertOne({
      project, agent, type, title, content, tags, scope,
      ...(session_id ? { session_id } : {}),
      timestamp: new Date(),
    });

    // Inline embed (AC-3). Failure does not block insert — log to stderr.
    try {
      const [vec] = await embedTexts([`${title}\n${content}`]);
      if (vec) {
        await memories.updateOne(
          { _id: result.insertedId },
          { $set: { embedding: new Binary(floatsToBytes(vec), 0), embedding_model: getModelId() } },
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[embed] inline embed failed for "${title}": ${reason}\n`);
    }

    return { content: [{ type: "text", text: `Remembered [${type}]: "${title}"` }] };
  }

  // ── RECALL ────────────────────────────────────────────────────────────────

  async recall(args: RecallArgs): Promise<ToolResult> {
    const { project, query, type, limit = 10, include_team = false, mode: suppliedMode, embedding } = args;
    const memories = this.db.collection("memories");
    const currentModel = getModelId();
    const candidateCap = Math.max(2 * limit, 1);
    // Per plan Risks 5: bound vector-half candidate-fetch to keep memory sane.
    const vectorFetchLimit = Math.max(500, 2 * limit);

    // Project filter builder shared across both halves and the auto-detect probe.
    const projectFilter = (): Record<string, unknown> =>
      include_team ? { $or: [{ project }, { scope: "team" }] } : { project };

    // ── Auto-detect mode (AC-4) ──────────────────────────────────────────────
    const hasEmbeddings = async (): Promise<boolean> => {
      const probe = await memories.findOne({
        ...projectFilter(),
        embedding_model: currentModel,
        embedding: { $exists: true, $ne: null },
      }, { projection: { _id: 1 } });
      return probe !== null;
    };

    let mode: "keyword" | "vector" | "hybrid";
    if (suppliedMode) {
      mode = suppliedMode;
      if (mode === "vector" && !(await hasEmbeddings())) {
        throw new Error(`No embeddings for model '${currentModel}' in project '${project}'. Run 'npm run embed-backfill' to embed existing memories.`);
      }
    } else {
      mode = (await hasEmbeddings()) ? "hybrid" : "keyword";
    }

    // ── Keyword half — $text query, ordered by textScore desc ────────────────
    const runKeyword = async (cap: number): Promise<Array<Record<string, unknown>>> => {
      const filter: Record<string, unknown> = { $text: { $search: query }, ...projectFilter() };
      if (type) filter["type"] = type;
      try {
        return await memories
          .find(filter, { projection: { score: { $meta: "textScore" } } })
          .sort({ score: { $meta: "textScore" } })
          .limit(cap)
          .toArray() as Array<Record<string, unknown>>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[recall] $text query failed for "${query}": ${msg}\n`);
        return [];
      }
    };

    // ── Vector half — cosine over Float32 buffers ────────────────────────────
    const runVector = async (cap: number): Promise<Array<Record<string, unknown>>> => {
      let queryVec: Float32Array;
      if (embedding) {
        queryVec = bytesToFloats(embedding);
      } else {
        const [v] = await embedTexts([query]);
        if (!v) return [];
        queryVec = v;
      }

      const filter: Record<string, unknown> = {
        ...projectFilter(),
        embedding_model: currentModel,
        embedding: { $exists: true, $ne: null },
      };
      if (type) filter["type"] = type;

      // Pull candidates client-side. We bound at vectorFetchLimit (plan choice).
      const rows = await memories.find(filter).limit(vectorFetchLimit).toArray() as Array<Record<string, unknown>>;
      const scored = rows.map((r) => {
        // Mongo driver returns Binary; .buffer is the Node Buffer view.
        const bin = r["embedding"] as Binary | Buffer;
        const buf = bin instanceof Binary ? Buffer.from(bin.buffer) : (bin as Buffer);
        const rowVec = bytesToFloats(buf);
        return { row: r, score: cosine(queryVec, rowVec) };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, cap).map((s) => s.row);
    };

    // ── Branch ───────────────────────────────────────────────────────────────
    let finalRows: Array<Record<string, unknown>>;
    if (mode === "keyword") {
      finalRows = await runKeyword(limit);
    } else if (mode === "vector") {
      finalRows = (await runVector(limit)).slice(0, limit);
    } else {
      const ftsRows = await runKeyword(candidateCap);
      const vecRows = await runVector(candidateCap);
      const idOf = (r: Record<string, unknown>): string => String(r["_id"]);
      const byId = new Map<string, Record<string, unknown>>();
      for (const r of ftsRows) byId.set(idOf(r), r);
      for (const r of vecRows) if (!byId.has(idOf(r))) byId.set(idOf(r), r);
      const mergedIds = rrfMerge(ftsRows.map(idOf), vecRows.map(idOf), limit);
      finalRows = mergedIds.map((id) => byId.get(id)!).filter(Boolean);
    }

    if (finalRows.length === 0) {
      return { content: [{ type: "text", text: `No memories found for "${query}" in project "${project}".` }] };
    }

    const formatted = finalRows.map((m) =>
      `[${(m["type"] as string).toUpperCase()}] ${m["title"] as string}\n${m["content"] as string}${(m["tags"] as string[] | undefined)?.length ? `\nTags: ${(m["tags"] as string[]).join(", ")}` : ""}`
    ).join("\n\n---\n\n");

    return { content: [{ type: "text", text: `${finalRows.length} result(s) for "${query}":\n\n${formatted}` }] };
  }

  // ── EMBED QUERY ───────────────────────────────────────────────────────────

  async embedQuery(args: EmbedQueryArgs): Promise<ToolResult> {
    const [vec] = await embedTexts([args.text]);
    if (!vec) throw new Error("embedTexts returned empty result");
    const payload = {
      embedding: floatsToBytes(vec).toString("base64"),
      model: getModelId(),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
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
