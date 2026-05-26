import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as dotenv from "dotenv";
import { getStorage } from "./storage/factory.js";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") });

const MEMORY_TYPES = ["decision", "convention", "bug", "context", "lesson"] as const;
const MEMORY_SCOPES = ["project", "team"] as const;

async function main() {
  // Backend is selected by DAKO_STORAGE_BACKEND (default: mongodb).
  // MongoStorage.create() opens the connection and creates indexes.
  // An invalid backend value throws here and exits non-zero (AC-4).
  const storage = await getStorage();

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
        description: "Search memories for a project. Default auto-detects: hybrid (FTS + vector RRF) if embeddings exist for the configured model, else keyword-only. Pass `mode` to force a specific strategy; pass `embedding` (base64 Float32) to skip server-side query embedding.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project to search within" },
            query:   { type: "string", description: "Search terms (matched against title and content)" },
            type:         { type: "string", enum: [...MEMORY_TYPES], description: "Filter by memory type (optional)" },
            limit:        { type: "number", description: "Max results to return", default: 10 },
            include_team: { type: "boolean", description: "Also search team-scoped memories from all projects (default false)" },
            mode:         { type: "string", enum: ["keyword", "vector", "hybrid"], description: "Recall strategy. Default auto-detects: hybrid if embeddings exist, else keyword." },
            embedding:    { type: "string", description: "Base64-encoded Float32 query embedding. If omitted, the server computes it from query." }
          },
          required: ["project", "query"]
        }
      },
      {
        name: "embed_query",
        description: "Compute an embedding for a query string using the configured DAKO_EMBEDDING_MODEL. Returns {embedding (base64 Float32), model (string)}. Used by the /recall skill to embed once and reuse across keyword variants.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to embed" }
          },
          required: ["text"]
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
      },
      {
        name: "list_memories",
        description: "Returns all memories for a project, sorted oldest-first. Use for bulk operations like auditing, deduplication, and staleness checks. Each entry includes type, title, content, timestamp, age_days, and scope.",
        inputSchema: {
          type: "object",
          properties: {
            project: { type: "string", description: "Project name" },
            type:    { type: "string", enum: [...MEMORY_TYPES], description: "Filter by memory type (optional)" },
            limit:   { type: "number", description: "Max results to return (default 200)", default: 200 }
          },
          required: ["project"]
        }
      },
      // ── Workitem archive ──────────────────────────────────────────────────
      {
        name: "archive_workitem",
        description: "Archive a completed workitem to the workitems collection. Call from the /wi-archive command after all phases are done.",
        inputSchema: {
          type: "object",
          properties: {
            wi_path:       { type: "string", description: "Workitem path (e.g. 'WI-memory-layer/20260521-short-term-memory')" },
            project:       { type: "string", description: "Project name" },
            username:      { type: "string", description: "Username from git config or env (optional)" },
            git_commit:    { type: "string", description: "Git commit SHA that closed this workitem (optional)" },
            documentation: { type: "string", description: "Full text of the Workitem Documentation section from documentation.md" }
          },
          required: ["wi_path", "project", "documentation"]
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "remember")        return storage.remember(args as any);
    if (name === "recall") {
      // Boundary: agent passes embedding as base64; the Storage interface takes Buffer.
      const a = (args ?? {}) as { embedding?: string } & Record<string, unknown>;
      const decoded: Record<string, unknown> = { ...a };
      if (typeof a.embedding === "string" && a.embedding.length > 0) {
        decoded["embedding"] = Buffer.from(a.embedding, "base64");
      } else {
        delete decoded["embedding"];
      }
      return storage.recall(decoded as any);
    }
    if (name === "embed_query")     return storage.embedQuery(args as any);
    if (name === "get_context")     return storage.getContext(args as any);
    if (name === "get_system_status") return storage.getSystemStatus();
    if (name === "start_session")   return storage.startSession(args as any);
    if (name === "log_message")     return storage.logMessage(args as any);
    if (name === "get_session")     return storage.getSession(args as any);
    if (name === "list_sessions")   return storage.listSessions(args as any);
    if (name === "promote_to_team") return storage.promoteToTeam(args as any);
    if (name === "forget")          return storage.forget(args as any);
    if (name === "list_memories")   return storage.listMemories(args as any);
    if (name === "archive_workitem") return storage.archiveWorkitem(args as any);

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
