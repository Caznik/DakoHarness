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
export {};
//# sourceMappingURL=Storage.js.map