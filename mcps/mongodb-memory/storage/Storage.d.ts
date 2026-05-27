/**
 * Storage.ts — Domain-method facade for the DakoHarness long-term memory MCP.
 *
 * DESIGN INTENT
 * -------------
 * Every MCP tool handler calls exactly one method on this interface. No handler
 * imports the MongoDB driver or any SQLite binding directly. Swapping the backend
 * (DAKO_STORAGE_BACKEND env var) requires zero changes to server.ts or logger.mjs.
 *
 * AC-9 VECTOR EXTENSION POINT — filled by WI-local-embedding-recall (2026-05-26)
 * ------------------------------------------------------------------------------
 * `RecallArgs` now carries optional `mode` and `embedding` fields and the
 * interface gains an `embedQuery()` method. The non-vector callers are
 * untouched: omitting both new fields gives back today's keyword behavior
 * (with auto-detect upgrade to hybrid once embeddings exist for the project).
 *
 * Schema-side: SQLite gains `embedding BLOB` + `embedding_model TEXT` via
 * idempotent ALTER TABLE; MongoDB just starts writing the fields plus one
 * new {embedding_model: 1} index for the mismatch-skip filter.
 *
 * AC-10 MONGODB → SQLITE FIELD MAPPING TABLE
 * --------------------------------------------
 * Every MongoDB document field maps to the corresponding SQLite column:
 *
 * Collection: memories
 * ┌──────────────────────┬──────────────────────┬──────────────────────────────────┐
 * │ MongoDB field        │ SQLite column         │ Type translation                 │
 * ├──────────────────────┼──────────────────────┼──────────────────────────────────┤
 * │ _id (ObjectId)       │ id INTEGER PK        │ Auto-rowid; surfaced as "mem-<id>"│
 * │ project TEXT         │ project TEXT         │ identical                        │
 * │ agent TEXT           │ agent TEXT           │ identical                        │
 * │ type TEXT            │ type TEXT            │ identical                        │
 * │ title TEXT           │ title TEXT           │ identical                        │
 * │ content TEXT         │ content TEXT         │ identical                        │
 * │ tags string[]        │ tags TEXT            │ JSON.stringify / JSON.parse      │
 * │ scope TEXT           │ scope TEXT           │ identical                        │
 * │ session_id TEXT      │ session_id TEXT      │ nullable in both                 │
 * │ timestamp Date       │ timestamp TEXT       │ ISO-8601 string (toISOString)    │
 * │ embedding Binary(0)  │ embedding BLOB       │ Float32 raw bytes (4 × dim);     │
 * │                      │                      │ nullable in both                 │
 * │ embedding_model TEXT │ embedding_model TEXT │ model id that produced vector;   │
 * │                      │                      │ nullable in both                 │
 * └──────────────────────┴──────────────────────┴──────────────────────────────────┘
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
 * ┌──────────────────────┬──────────────────────┬──────────────────────────────────┐
 * │ MongoDB field        │ SQLite column         │ Type translation                 │
 * ├──────────────────────┼──────────────────────┼──────────────────────────────────┤
 * │ _id (ObjectId)       │ id INTEGER PK        │ Auto-rowid                       │
 * │ session_id TEXT      │ session_id TEXT      │ identical                        │
 * │ role TEXT            │ role TEXT            │ identical                        │
 * │ content TEXT         │ content TEXT         │ identical                        │
 * │ seq INTEGER          │ seq INTEGER          │ identical                        │
 * │ timestamp Date       │ timestamp TEXT       │ ISO-8601 string                  │
 * │ embedding Binary(0)  │ embedding BLOB       │ Float32 raw bytes (4 × dim);     │
 * │                      │                      │ nullable in both                 │
 * │ embedding_model TEXT │ embedding_model TEXT │ model id that produced vector;   │
 * │                      │                      │ nullable in both                 │
 * └──────────────────────┴──────────────────────┴──────────────────────────────────┘
 *
 * WI-rag-long-sessions (2026-05-26) added the embedding columns/fields above
 * so message history is recall-searchable. `messages` has no `project` column;
 * scoping by project requires joining/looking up via the `sessions` collection.
 */
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
    /**
     * Recall strategy. Default = auto-detect: hybrid if any row in the project's
     * memories has `embedding_model == DAKO_EMBEDDING_MODEL` AND a non-null
     * embedding, else keyword. Explicit "vector" against an empty embedding set
     * throws a clear error pointing at the backfill command.
     */
    mode?: "keyword" | "vector" | "hybrid";
    /**
     * Pre-computed query embedding as raw Float32 bytes (4 × dim). When supplied,
     * the server skips its own embed call. The server boundary base64-decodes
     * the tool argument into this Buffer before calling the adapter.
     */
    embedding?: Buffer;
}
export interface EmbedQueryArgs {
    text: string;
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
    session_id?: string;
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
export interface RecallSessionMessagesArgs {
    project: string;
    query: string;
    /** Narrow to one session. Omitted = project-wide across all sessions. */
    session_id?: string;
    /** ISO-8601 timestamp; only messages with timestamp >= since are searched. */
    since?: string;
    limit?: number;
    /** Pre-computed query embedding as raw Float32 bytes — server boundary base64-decodes. */
    embedding?: Buffer;
}
/** Shape returned by the MCP SDK's tool response — text content block. */
export interface ToolResult {
    content: Array<{
        type: "text";
        text: string;
    }>;
}
/**
 * One method per MCP tool, plus nextMessageSeq used by logger.mjs.
 *
 * All methods are async even if the underlying adapter is synchronous
 * (better-sqlite3 is sync, but the interface must be uniform).
 */
export interface Storage {
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
    getSession(args: GetSessionArgs): Promise<ToolResult>;
    listSessions(args: ListSessionsArgs): Promise<ToolResult>;
    recallSessionMessages(args: RecallSessionMessagesArgs): Promise<ToolResult>;
    getSystemStatus(): Promise<ToolResult>;
    nextMessageSeq(session_id: string): Promise<number>;
    close(): Promise<void>;
}
//# sourceMappingURL=Storage.d.ts.map