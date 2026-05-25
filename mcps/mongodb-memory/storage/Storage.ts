/**
 * Storage.ts — Domain-method facade for the DakoHarness long-term memory MCP.
 *
 * DESIGN INTENT
 * -------------
 * Every MCP tool handler calls exactly one method on this interface. No handler
 * imports the MongoDB driver or any SQLite binding directly. Swapping the backend
 * (DAKO_STORAGE_BACKEND env var) requires zero changes to server.ts or logger.mjs.
 *
 * AC-9 VECTOR EXTENSION POINT
 * ----------------------------
 * The `recall` method signature accepts only keyword-based args today. A future
 * "Local embedding model for recall" workitem will add optional parameters:
 *   embedding?: number[]
 *   mode?: "keyword" | "vector" | "hybrid"
 * These can be appended to the `RecallArgs` type and honored by each adapter WITHOUT
 * changing the method name, without changing callers that don't supply them, and
 * without a destructive schema migration (SQLite: add nullable `embedding` BLOB column
 * via ALTER TABLE; MongoDB: just start writing the field — no migration needed).
 *
 * AC-10 MONGODB → SQLITE FIELD MAPPING TABLE
 * --------------------------------------------
 * Every MongoDB document field maps to the corresponding SQLite column:
 *
 * Collection: memories
 * ┌─────────────────┬─────────────────────┬──────────────────────────────────────┐
 * │ MongoDB field   │ SQLite column        │ Type translation                     │
 * ├─────────────────┼─────────────────────┼──────────────────────────────────────┤
 * │ _id (ObjectId)  │ id INTEGER PK       │ Auto-rowid; surfaced as "mem-<rowid>"│
 * │ project TEXT    │ project TEXT        │ identical                            │
 * │ agent TEXT      │ agent TEXT          │ identical                            │
 * │ type TEXT       │ type TEXT           │ identical                            │
 * │ title TEXT      │ title TEXT          │ identical                            │
 * │ content TEXT    │ content TEXT        │ identical                            │
 * │ tags string[]   │ tags TEXT           │ JSON.stringify / JSON.parse          │
 * │ scope TEXT      │ scope TEXT          │ identical                            │
 * │ session_id TEXT │ session_id TEXT     │ nullable in both                     │
 * │ timestamp Date  │ timestamp TEXT      │ ISO-8601 string (toISOString)        │
 * └─────────────────┴─────────────────────┴──────────────────────────────────────┘
 *
 * Collection: workitems
 * ┌──────────────────┬─────────────────────┬──────────────────────────────────────┐
 * │ MongoDB field    │ SQLite column        │ Type translation                     │
 * ├──────────────────┼─────────────────────┼──────────────────────────────────────┤
 * │ _id (ObjectId)   │ id INTEGER PK       │ Auto-rowid                           │
 * │ wi_path TEXT     │ wi_path TEXT        │ identical                            │
 * │ project TEXT     │ project TEXT        │ identical                            │
 * │ username TEXT    │ username TEXT       │ nullable in both                     │
 * │ git_commit TEXT  │ git_commit TEXT     │ nullable in both                     │
 * │ documentation TEXT│ documentation TEXT │ identical                            │
 * │ archived_at Date │ archived_at TEXT    │ ISO-8601 string                      │
 * └──────────────────┴─────────────────────┴──────────────────────────────────────┘
 *
 * Collection: sessions
 * ┌──────────────────┬─────────────────────┬──────────────────────────────────────┐
 * │ MongoDB field    │ SQLite column        │ Type translation                     │
 * ├──────────────────┼─────────────────────┼──────────────────────────────────────┤
 * │ session_id TEXT  │ session_id TEXT PK  │ identical                            │
 * │ project TEXT     │ project TEXT        │ identical                            │
 * │ agent TEXT       │ agent TEXT          │ identical                            │
 * │ cwd TEXT         │ cwd TEXT            │ identical                            │
 * │ started_at Date  │ started_at TEXT     │ ISO-8601 string                      │
 * └──────────────────┴─────────────────────┴──────────────────────────────────────┘
 *
 * Collection: messages
 * ┌──────────────────┬─────────────────────┬──────────────────────────────────────┐
 * │ MongoDB field    │ SQLite column        │ Type translation                     │
 * ├──────────────────┼─────────────────────┼──────────────────────────────────────┤
 * │ _id (ObjectId)   │ id INTEGER PK       │ Auto-rowid                           │
 * │ session_id TEXT  │ session_id TEXT     │ identical                            │
 * │ role TEXT        │ role TEXT           │ identical                            │
 * │ content TEXT     │ content TEXT        │ identical                            │
 * │ seq INTEGER      │ seq INTEGER         │ identical                            │
 * │ timestamp Date   │ timestamp TEXT      │ ISO-8601 string                      │
 * └──────────────────┴─────────────────────┴──────────────────────────────────────┘
 */

// ── Arg types (one per interface method) ────────────────────────────────────

export interface RememberArgs {
  project: string;
  agent: string;
  type: string;
  title: string;
  content: string;
  tags?: string[];
  session_id?: string;
  scope?: string;
}

export interface RecallArgs {
  project: string;
  query: string;
  type?: string;
  limit?: number;
  include_team?: boolean;
  // AC-9 extension point: embedding?: number[]; mode?: "keyword" | "vector" | "hybrid";
}

export interface GetContextArgs {
  project: string;
  type?: string;
}

export interface PromoteToTeamArgs {
  project: string;
  title: string;
  type?: string;
}

export interface ForgetArgs {
  project: string;
  title: string;
  type?: string;
}

export interface ListMemoriesArgs {
  project: string;
  type?: string;
  limit?: number;
}

export interface ArchiveWorkitemArgs {
  wi_path: string;
  project: string;
  username?: string;
  git_commit?: string;
  documentation: string;
}

export interface StartSessionArgs {
  project: string;
  agent: string;
  cwd?: string;
  session_id?: string; // caller-supplied (used by logger.mjs)
}

export interface LogMessageArgs {
  session_id: string;
  role: string;
  content: string;
}

export interface GetSessionArgs {
  session_id: string;
}

export interface ListSessionsArgs {
  project: string;
  agent?: string;
  limit?: number;
}

// ── Result types (returned to tool handlers) ──────────────────────────────

/** Shape returned by the MCP SDK's tool response — text content block. */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

// ── Storage interface ─────────────────────────────────────────────────────

/**
 * One method per MCP tool, plus nextMessageSeq used by logger.mjs.
 *
 * All methods are async even if the underlying adapter is synchronous
 * (better-sqlite3 is sync, but the interface must be uniform).
 */
export interface Storage {
  // Long-term memory operations
  remember(args: RememberArgs): Promise<ToolResult>;
  recall(args: RecallArgs): Promise<ToolResult>;
  getContext(args: GetContextArgs): Promise<ToolResult>;
  promoteToTeam(args: PromoteToTeamArgs): Promise<ToolResult>;
  forget(args: ForgetArgs): Promise<ToolResult>;
  listMemories(args: ListMemoriesArgs): Promise<ToolResult>;

  // Workitem archive
  archiveWorkitem(args: ArchiveWorkitemArgs): Promise<ToolResult>;

  // Session transcript
  startSession(args: StartSessionArgs): Promise<ToolResult>;
  logMessage(args: LogMessageArgs): Promise<ToolResult>;
  getSession(args: GetSessionArgs): Promise<ToolResult>;
  listSessions(args: ListSessionsArgs): Promise<ToolResult>;

  // Cross-cutting
  getSystemStatus(): Promise<ToolResult>;

  // Helper used by logger.mjs for seq counter (avoids exposing collection access)
  nextMessageSeq(session_id: string): Promise<number>;

  // Lifecycle
  close(): Promise<void>;
}
