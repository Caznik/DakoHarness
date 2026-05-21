import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MongoClient } from "mongodb";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });

const MONGO_URI = process.env.MONGO_URI || "mongodb://dako:harness@localhost:27017/agent_memory?authSource=admin";
const DB_NAME = process.env.MONGO_DB || "agent_memory";

const client = new MongoClient(MONGO_URI);

const MEMORY_TYPES = ["decision", "convention", "bug", "context", "lesson"] as const;
type MemoryType = typeof MEMORY_TYPES[number];
const MEMORY_SCOPES = ["project", "team"] as const;

async function main() {
  await client.connect();
  console.error("Connected to MongoDB");

  const db = client.db(DB_NAME);

  await db.collection("memories").createIndex(
    { title: "text", content: "text" },
    { name: "memories_text_search" }
  );
  await db.collection("memories").createIndex({ scope: 1 });

  const server = new Server(
    { name: "dako-long-term-memory", version: "2.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // ── Long-term memory ──────────────────────────────────────────────────
      {
        name: "remember",
        description: `Saves a typed memory for a project so it persists across sessions and agents.
Use this when something important is learned, decided, or discovered.
Types:
  - decision  : architectural or design choice ("use X because Y")
  - convention: code pattern, naming rule, or standard for this project
  - bug       : a bug found and how it was fixed, to avoid repeating it
  - context   : important project fact not obvious from the code
  - lesson    : what went wrong and what was learned`,
        inputSchema: {
          type: "object",
          properties: {
            project:    { type: "string", description: "Project name" },
            agent:      { type: "string", description: "Agent saving this memory (e.g. 'claude-code')" },
            type:       { type: "string", enum: [...MEMORY_TYPES], description: "Category of memory" },
            title:      { type: "string", description: "Short, searchable title (one line)" },
            content:    { type: "string", description: "Full detail — include WHY, not just what" },
            tags:       { type: "array", items: { type: "string" }, description: "Optional keywords" },
            session_id: { type: "string", description: "Session where this memory originated (optional)" },
            scope:      { type: "string", enum: [...MEMORY_SCOPES], description: "'project' (default) — visible only within this project. 'team' — shared across all projects." }
          },
          required: ["project", "agent", "type", "title", "content"]
        }
      },
      {
        name: "recall",
        description: "Full-text search across memories for a project. Use to find relevant context before starting work.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project to search within" },
            query:   { type: "string", description: "Search terms (matched against title and content)" },
            type:         { type: "string", enum: [...MEMORY_TYPES], description: "Filter by memory type (optional)" },
            limit:        { type: "number", description: "Max results to return", default: 10 },
            include_team: { type: "boolean", description: "Also search team-scoped memories from all projects (default false)" }
          },
          required: ["project", "query"]
        }
      },
      {
        name: "get_context",
        description: `Loads all memories for a project grouped by type.
Call this at the start of a session to restore project context before working.`,
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project name" },
            type:    { type: "string", enum: [...MEMORY_TYPES], description: "Only load this type (optional)" }
          },
          required: ["project"]
        }
      },
      {
        name: "get_system_status",
        description: "Returns connection health, memory counts per project, and session stats.",
        inputSchema: { type: "object", properties: {} }
      },
      // ── Session transcript ────────────────────────────────────────────────
      {
        name: "start_session",
        description: "Creates a session record for a coding agent conversation. Returns a session_id.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string" },
            agent:   { type: "string" },
            cwd:     { type: "string" }
          },
          required: ["project", "agent"]
        }
      },
      {
        name: "log_message",
        description: "Appends a message turn to an existing session.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            role:       { type: "string", enum: ["user", "assistant", "system"] },
            content:    { type: "string" }
          },
          required: ["session_id", "role", "content"]
        }
      },
      {
        name: "get_session",
        description: "Retrieves the full transcript for a session, ordered chronologically.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" }
          },
          required: ["session_id"]
        }
      },
      {
        name: "list_sessions",
        description: "Lists recent sessions for a project, newest first.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string" },
            agent:   { type: "string", description: "Filter by agent (optional)" },
            limit:   { type: "number", default: 10 }
          },
          required: ["project"]
        }
      },
      {
        name: "promote_to_team",
        description: "Promotes a project-scoped memory to team scope, making it searchable across all projects. Use when a lesson or decision is broadly applicable beyond the current project.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project the memory currently belongs to" },
            title:   { type: "string", description: "Exact title of the memory to promote" },
            type:    { type: "string", enum: [...MEMORY_TYPES], description: "Narrows match if title is ambiguous (optional)" }
          },
          required: ["project", "title"]
        }
      },
      {
        name: "forget",
        description: "Deletes a memory by project and title. Use to remove stale or superseded entries. Optionally filter by type to avoid accidental deletion when titles are ambiguous.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project the memory belongs to" },
            title:   { type: "string", description: "Exact title of the memory to delete" },
            type:    { type: "string", enum: [...MEMORY_TYPES], description: "Memory type — narrows match if title is ambiguous (optional)" }
          },
          required: ["project", "title"]
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const db = client.db(DB_NAME);
    const { name, arguments: args } = request.params;

    // ── REMEMBER ─────────────────────────────────────────────────────────────
    if (name === "remember") {
      const { project, agent, type, title, content, tags = [], session_id, scope = "project" } = args as any;
      const memories = db.collection("memories");
      await memories.insertOne({
        project, agent, type, title, content, tags, scope,
        ...(session_id ? { session_id } : {}),
        timestamp: new Date()
      });
      return { content: [{ type: "text", text: `Remembered [${type}]: "${title}"` }] };
    }

    // ── RECALL ───────────────────────────────────────────────────────────────
    if (name === "recall") {
      const { project, query, type, limit = 10, include_team = false } = args as any;
      const memories = db.collection("memories");

      const filter: any = { $text: { $search: query } };
      if (include_team) {
        filter.$or = [{ project }, { scope: "team" }];
      } else {
        filter.project = project;
      }
      if (type) filter.type = type;

      const results = await memories
        .find(filter, { projection: { score: { $meta: "textScore" } } })
        .sort({ score: { $meta: "textScore" } })
        .limit(limit)
        .toArray();

      if (results.length === 0) {
        return { content: [{ type: "text", text: `No memories found for "${query}" in project "${project}".` }] };
      }

      const formatted = results.map(m =>
        `[${m.type.toUpperCase()}] ${m.title}\n${m.content}${m.tags?.length ? `\nTags: ${m.tags.join(", ")}` : ""}`
      ).join("\n\n---\n\n");

      return { content: [{ type: "text", text: `${results.length} result(s) for "${query}":\n\n${formatted}` }] };
    }

    // ── GET CONTEXT ──────────────────────────────────────────────────────────
    if (name === "get_context") {
      const { project, type } = args as any;
      const memories = db.collection("memories");

      const filter: any = { project };
      if (type) filter.type = type;

      const all = await memories.find(filter).sort({ type: 1, timestamp: -1 }).toArray();

      if (all.length === 0) {
        return { content: [{ type: "text", text: `No memories stored for project "${project}" yet.` }] };
      }

      // Group by type
      const grouped: Record<string, typeof all> = {};
      for (const m of all) {
        if (!grouped[m.type]) grouped[m.type] = [];
        grouped[m.type]!.push(m);
      }

      const sections = Object.entries(grouped).map(([t, items]) => {
        const entries = items.map(m => `  • ${m.title}\n    ${m.content}`).join("\n");
        return `## ${t.toUpperCase()}S\n${entries}`;
      });

      return { content: [{ type: "text", text: `Project context for "${project}":\n\n${sections.join("\n\n")}` }] };
    }

    // ── GET SYSTEM STATUS ────────────────────────────────────────────────────
    if (name === "get_system_status") {
      const memories  = db.collection("memories");
      const sessions  = db.collection("sessions");
      const messages  = db.collection("messages");

      const [memCount, sessionCount, msgCount, projects] = await Promise.all([
        memories.countDocuments(),
        sessions.countDocuments(),
        messages.countDocuments(),
        memories.distinct("project")
      ]);

      const text = [
        `Status: HEALTHY`,
        `Memories: ${memCount} across ${projects.length} project(s) — ${projects.join(", ") || "none"}`,
        `Sessions: ${sessionCount} | Messages logged: ${msgCount}`
      ].join("\n");

      return { content: [{ type: "text", text: text }] };
    }

    // ── START SESSION ────────────────────────────────────────────────────────
    if (name === "start_session") {
      const { project, agent, cwd = "" } = args as any;
      const session_id = randomUUID();
      await db.collection("sessions").insertOne({ session_id, project, agent, cwd, started_at: new Date() });
      return { content: [{ type: "text", text: JSON.stringify({ session_id }) }] };
    }

    // ── LOG MESSAGE ──────────────────────────────────────────────────────────
    if (name === "log_message") {
      const { session_id, role, content } = args as any;
      const messages = db.collection("messages");
      const seq = await messages.countDocuments({ session_id });
      await messages.insertOne({ session_id, role, content, seq, timestamp: new Date() });
      return { content: [{ type: "text", text: `Logged [${role}] seq:${seq}` }] };
    }

    // ── GET SESSION ──────────────────────────────────────────────────────────
    if (name === "get_session") {
      const { session_id } = args as any;
      const session = await db.collection("sessions").findOne({ session_id });
      if (!session) {
        return { content: [{ type: "text", text: `No session found: "${session_id}"` }] };
      }

      const msgs = await db.collection("messages").find({ session_id }).sort({ seq: 1 }).toArray();
      const transcript = msgs.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join("\n\n");
      const header = `Session: ${session_id}\nProject: ${session.project} | Agent: ${session.agent} | Started: ${session.started_at.toISOString()}\nMessages: ${msgs.length}\n\n`;

      return { content: [{ type: "text", text: header + (transcript || "(no messages yet)") }] };
    }

    // ── LIST SESSIONS ────────────────────────────────────────────────────────
    if (name === "list_sessions") {
      const { project, agent, limit = 10 } = args as any;
      const query: any = { project };
      if (agent) query.agent = agent;

      const results = await db.collection("sessions").find(query).sort({ started_at: -1 }).limit(limit).toArray();
      if (results.length === 0) {
        return { content: [{ type: "text", text: `No sessions found for project "${project}".` }] };
      }

      const formatted = results.map(s =>
        `[${s.started_at.toISOString()}] ${s.session_id} | ${s.agent}${s.cwd ? ` | ${s.cwd}` : ""}`
      ).join("\n");

      return { content: [{ type: "text", text: `Sessions for "${project}":\n\n${formatted}` }] };
    }

    // ── PROMOTE TO TEAM ──────────────────────────────────────────────────────
    if (name === "promote_to_team") {
      const { project, title, type } = args as any;
      const memFilter: any = { project, title };
      if (type) memFilter.type = type;
      const result = await db.collection("memories").updateOne(memFilter, { $set: { scope: "team" } });
      if (result.matchedCount === 0) {
        return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
      }
      return { content: [{ type: "text", text: `Promoted to team scope: "${title}"` }] };
    }

    // ── FORGET ───────────────────────────────────────────────────────────────
    if (name === "forget") {
      const { project, title, type } = args as any;
      const filter: any = { project, title };
      if (type) filter.type = type;
      const result = await db.collection("memories").deleteMany(filter);
      if (result.deletedCount === 0) {
        return { content: [{ type: "text", text: `No memory found matching title "${title}" in project "${project}".` }] };
      }
      return { content: [{ type: "text", text: `Deleted ${result.deletedCount} memory entry: "${title}"` }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
