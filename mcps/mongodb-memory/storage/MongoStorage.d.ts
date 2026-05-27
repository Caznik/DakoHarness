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
import type { Storage, ToolResult, RememberArgs, RecallArgs, EmbedQueryArgs, GetContextArgs, PromoteToTeamArgs, ForgetArgs, ListMemoriesArgs, ArchiveWorkitemArgs, StartSessionArgs, LogMessageArgs, GetSessionArgs, ListSessionsArgs } from "./Storage.js";
import type { RecallSessionMessagesArgs } from "./Storage.js";
export declare class MongoStorage implements Storage {
    private client;
    private db;
    private constructor();
    /**
     * Factory — opens the MongoClient, creates indexes, returns a ready instance.
     * Throws with a helpful hint if the connection fails (R5 mitigation).
     */
    static create(uri: string, dbName: string): Promise<MongoStorage>;
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
    close(): Promise<void>;
}
//# sourceMappingURL=MongoStorage.d.ts.map