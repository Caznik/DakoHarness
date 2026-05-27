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
import type { Storage, ToolResult, RememberArgs, RecallArgs, EmbedQueryArgs, GetContextArgs, PromoteToTeamArgs, ForgetArgs, ListMemoriesArgs, ArchiveWorkitemArgs, StartSessionArgs, LogMessageArgs, GetSessionArgs, ListSessionsArgs } from "./Storage.js";
import type { RecallSessionMessagesArgs } from "./Storage.js";
export declare class SqliteStorage implements Storage {
    private db;
    private constructor();
    /**
     * Factory — creates/opens the SQLite file, runs schema init, returns ready instance.
     */
    static create(dbPath: string): SqliteStorage;
    remember(args: RememberArgs): Promise<ToolResult>;
    recall(args: RecallArgs): Promise<ToolResult>;
    embedQuery(args: EmbedQueryArgs): Promise<ToolResult>;
    getContext(args: GetContextArgs): Promise<ToolResult>;
    promoteToTeam(args: PromoteToTeamArgs): Promise<ToolResult>;
    forget(args: ForgetArgs): Promise<ToolResult>;
    listMemories(args: ListMemoriesArgs): Promise<ToolResult>;
    archiveWorkitem(args: ArchiveWorkitemArgs): Promise<ToolResult>;
    startSession(args: StartSessionArgs): Promise<ToolResult>;
    logMessage(args: LogMessageArgs): Promise<ToolResult>;
    recallSessionMessages(args: RecallSessionMessagesArgs): Promise<ToolResult>;
    getSession(args: GetSessionArgs): Promise<ToolResult>;
    listSessions(args: ListSessionsArgs): Promise<ToolResult>;
    getSystemStatus(): Promise<ToolResult>;
    nextMessageSeq(session_id: string): Promise<number>;
    private nextMessageSeqSync;
    close(): Promise<void>;
}
//# sourceMappingURL=SqliteStorage.d.ts.map