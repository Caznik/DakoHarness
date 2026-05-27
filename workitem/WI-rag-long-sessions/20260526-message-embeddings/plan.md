---
wi: WI-rag-long-sessions
phase: plan
status: confirmed
date: 2026-05-26
approach: (single direction — no /wi-propose phase needed; analyze pinned the shape)
---

## Context
**Selected approach:** Mirror the `memories` embedding pattern shipped in WI-local-embedding-recall for the `messages` collection, with three deliberate divergences: (a) vector-only (no FTS migration on messages); (b) skip rules at insert time (empty / <20 chars / role=tool) to avoid embedding conversational noise; (c) default project-wide scope rather than session-scoped. New MCP tool `recall_session_messages` exposes the path; new `/recall-session` skill uses the existing `embed_query` preflight pattern to embed the query once and pass to the adapter.

**Codebase notes from exploration:**
- `MongoStorage.ts:343–348` — `logMessage` does `countDocuments({ session_id })` for `seq` then `insertOne`. Embed must happen AFTER `insertOne` so we have `result.insertedId` to UPDATE. Same pre-existing seq-race (non-atomic) — not this WI's problem.
- `SqliteStorage.ts:463–470` — same shape; `nextMessageSeqSync` computes `seq` then `INSERT`. We grab `lastInsertRowid` after insert for the post-embed UPDATE.
- `SqliteStorage.ts:154–162` — `messages` table schema; we add two columns via the existing `addColumnIfMissing` helper from the memories work.
- `MongoStorage.ts` `messages` collection is schemaless; we add one new index `{ embedding_model: 1 }` parallel to the memories one.
- `embed.ts` — already has `embedTexts`, `floatsToBytes`/`bytesToFloats`, `cosine`, `rrfMerge`, `EMBED_STUB_KEY`. New helper `shouldEmbedMessage(role, content)` lands here so it's shared between `logMessage` (both adapters) and `embed-backfill --collection messages`.
- `embed-backfill.ts:54–64` — flag parser rejects unknown flags. Adding `--collection memories|messages|all` means an arg with a value (`--collection messages`). Current parser is positional/value-less — we extend it to accept `--collection=<val>` OR `--collection <val>`.
- `server.ts` — tool registration is a list-and-route pattern. Adding `recall_session_messages` means one new tool-list entry plus one route. Same pattern as `embed_query` from the prior WI.
- The `/recall` skill is mirrored at three locations (`.claude/commands/`, `commands/`, `claude-plugin-release/commands/`). `/recall-session` follows the same sync convention.

**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14 (all 14).

## Implementation Sequence

### Step 1 — Schema migration for `messages` (both adapters)
**Satisfies:** AC-1, AC-14 (back-compat preserved)
**Files:**
- `mcps/mongodb-memory/storage/SqliteStorage.ts`
- `mcps/mongodb-memory/storage/MongoStorage.ts`
**Description:**
- In `SqliteStorage.create()`, after the existing schema init and after the memories `addColumnIfMissing` calls, run two more: `addColumnIfMissing("ALTER TABLE messages ADD COLUMN embedding BLOB")` and `addColumnIfMissing("ALTER TABLE messages ADD COLUMN embedding_model TEXT")`. The helper absorbs the "duplicate column name" error on subsequent runs (same as memories WI).
- In `MongoStorage.create()`, add `await db.collection("messages").createIndex({ embedding_model: 1 })` alongside the memories index. Mongo is schemaless — no column adds needed.
- Existing rows remain readable: `embedding IS NULL` is the natural state for pre-WI rows and the recall path filters via `WHERE embedding_model = currentModel AND embedding IS NOT NULL` so they're naturally excluded.

### Step 2 — `shouldEmbedMessage` skip-rule helper in `embed.ts`
**Satisfies:** AC-3
**Files:**
- `mcps/mongodb-memory/embed.ts`
**Description:**
- Export `MESSAGE_MIN_LEN = 20` constant.
- Export `shouldEmbedMessage(role: string, content: string): boolean` returning `false` when any of: `content.trim() === ""`, `content.trim().length < MESSAGE_MIN_LEN`, `role === "tool"`. Otherwise `true`.
- Used by `logMessage` (both adapters) at insert time AND by `embed-backfill --collection messages` so a row skipped at insert stays skipped at backfill (consistent semantics; no surprises).

### Step 3 — `MongoStorage.logMessage`: inline embed + skip rules
**Satisfies:** AC-2, AC-3, AC-14 (graceful failure preserves existing insert behavior)
**Files:**
- `mcps/mongodb-memory/storage/MongoStorage.ts`
**Description:**
- After the existing `insertOne` (`MongoStorage.ts:347`), check `shouldEmbedMessage(role, content)`. If false: return immediately (row inserted with null embedding fields — no-op). If true: call `embedTexts([\`${role}: ${content}\`])` in a try/catch. On success: `updateOne({_id: result.insertedId}, { $set: { embedding: new Binary(bytes, 0), embedding_model: getModelId() } })`. On failure: `console.error("[embed] inline embed failed for message seq:" + seq + ": " + reason)` and return — row stays with null fields. Tool returns its existing success ToolResult unchanged.

### Step 4 — `SqliteStorage.logMessage`: inline embed + skip rules
**Satisfies:** AC-2, AC-3, AC-14
**Files:**
- `mcps/mongodb-memory/storage/SqliteStorage.ts`
**Description:**
- Same pattern as Step 3 but for SQLite. Capture `info.lastInsertRowid` from the existing `prepare(...).run(...)` call. If `shouldEmbedMessage(role, content)` is false: return existing ToolResult. Else: `embedTexts([...])` in try/catch. On success: `this.db.prepare("UPDATE messages SET embedding = ?, embedding_model = ? WHERE id = ?").run(floatsToBytes(vec), getModelId(), Number(rowid))`. On failure: stderr warn + return existing ToolResult.
- `Number(rowid)` because better-sqlite3 returns `lastInsertRowid` as `number | bigint`; the WHERE clause binds best as `number` for INTEGER PK.

### Step 5 — `recallSessionMessages` adapter method (both backends)
**Satisfies:** AC-5, AC-6, AC-7 (result format), AC-8 (model-mismatch skip)
**Files:**
- `mcps/mongodb-memory/storage/MongoStorage.ts`
- `mcps/mongodb-memory/storage/SqliteStorage.ts`
**Description:**
- **Mongo path:** build filter `{ project, embedding_model: currentModel, embedding: { $exists: true } }` plus optional `session_id` and `timestamp: { $gte: new Date(since) }`. Project includes `session_id, role, content, timestamp, embedding`. `.limit(Math.max(500, 2 × limit))`. Pull candidates; compute `cosine(bytesToFloats(doc.embedding.buffer), queryVec)` for each; sort desc; take top `limit`.
- **SQLite path:** build SQL `SELECT session_id, role, content, timestamp, embedding FROM messages WHERE project ... AND embedding_model = ? AND embedding IS NOT NULL` + optional `AND session_id = ?` + optional `AND timestamp >= ?`. **But:** `messages` table doesn't have a `project` column today — it's keyed only by `session_id`. To filter by project, we JOIN against `sessions` (`messages.session_id = sessions.session_id WHERE sessions.project = ?`). Confirm this works on the existing schema (it does — `sessions` table has `project` per `SqliteStorage.ts:136–142`).
- For both: query embedding comes from `args.embedding` (Buffer, pre-decoded by server route) when supplied, else `embedTexts([query])`.
- Render: per-hit line `[${session_id.slice(0,8)}] [${timestamp_iso}] [${role}]: ${content}` joined by `\n\n`. Empty result → `No matching messages found in project "${project}".`

### Step 6 — `Storage` interface: add `recallSessionMessages` + arg type
**Satisfies:** AC-4 signature
**Files:**
- `mcps/mongodb-memory/storage/Storage.ts`
**Description:**
- Add interface:
  ```ts
  export interface RecallSessionMessagesArgs {
    project: string;
    query: string;
    session_id?: string;
    since?: string;     // ISO-8601
    limit?: number;     // default 10
    embedding?: Buffer; // pre-computed query embedding
  }
  ```
- Add method `recallSessionMessages(args: RecallSessionMessagesArgs): Promise<ToolResult>` to the `Storage` interface.
- Update the AC-10 mapping-table comment block in `Storage.ts` to note `messages` now has `embedding` (Float32 bytes ↔ Buffer ↔ Binary subtype 0) + `embedding_model` (TEXT/string) fields, mirroring `memories`.

### Step 7 — `server.ts`: register `recall_session_messages` tool
**Satisfies:** AC-4 (schema + route), AC-9 (caller-supplied embedding decode)
**Files:**
- `mcps/mongodb-memory/server.ts`
**Description:**
- Add to the tool list:
  ```ts
  {
    name: "recall_session_messages",
    description: "Semantic recall over conversation message history. Vector-only (no keyword/FTS). Returns top-k messages by cosine similarity. Use to retrieve relevant past turns in long sessions or after compaction.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        query:   { type: "string" },
        session_id: { type: "string", description: "Optional. If omitted, search project-wide across all sessions." },
        since:      { type: "string", description: "Optional ISO-8601 timestamp; only messages with timestamp >= since are searched." },
        limit:      { type: "number", default: 10 },
        embedding:  { type: "string", description: "Base64-encoded Float32 query embedding. If omitted, the server computes it." }
      },
      required: ["project", "query"]
    }
  }
  ```
- Add route: `if (name === "recall_session_messages") { const embBuf = args.embedding ? Buffer.from(args.embedding, "base64") : undefined; return storage.recallSessionMessages({...args, embedding: embBuf}); }`. Empty-string `embedding` treated as `undefined` (same defensive guard as the `recall` route).
- `since` parsing: forward as-is. The adapter validates via `new Date(since)`; if `isNaN(getTime())`, throw `Error("Invalid 'since' value: expected ISO-8601, got '<v>'")`.

### Step 8 — `embed-backfill`: `--collection memories|messages|all` flag
**Satisfies:** AC-11, AC-14 (default behavior preserved)
**Files:**
- `mcps/mongodb-memory/embed-backfill.ts`
**Description:**
- Extend `Options` with `collection: "memories" | "messages" | "all"`. Default `"memories"`.
- Extend the flag parser to accept `--collection <val>` (next argv element is the value) AND `--collection=<val>` (single token). Reject unknown values; reject the flag without a value.
- Factor the existing memories-walk into `backfillMemories(opts, sqlite|mongo)` returning a `Summary`.
- Add `backfillMessages(opts, sqlite|mongo)` mirroring the memories walk:
  - For each batch of 32 rows: filter rows where (a) `--force` is set OR `embedding_model != currentModel` AND (b) `shouldEmbedMessage(row.role, row.content)` is true. Build texts as `\`${role}: ${content}\``. `embedTexts(batch)`. Per-row UPDATE / bulkWrite to set `embedding` + `embedding_model`.
  - Rows that fail `shouldEmbedMessage` are counted in `skipped` (treated identically to "already embedded with current model").
  - Per-chunk error isolation (same as memories backfill).
- `--collection all` calls `backfillMemories` then `backfillMessages`. Final summary prints two tables (one per collection) under a single header.
- `--dry-run`: same walk; print would-embed/would-skip counts per collection; zero writes.

### Step 9 — `/recall-session` skill (three mirrored copies)
**Satisfies:** AC-10
**Files:**
- `.claude/commands/recall-session.md` (new)
- `commands/recall-session.md` (plugin-dir mirror — new)
- `claude-plugin-release/commands/recall-session.md` (marketplace mirror — new)
**Description:**
- Frontmatter: `name: recall-session`, description `"Search conversation history with semantic recall. Usage: /recall-session <query> [session=<id>] [since=<iso>]"`.
- Steps:
  1. Resolve `project` from `DAKO_PROJECT` env or cwd basename.
  2. If no args, ask the user for a query.
  3. Parse optional inline args: `session=<id>` and `since=<iso>` (everything else is the query text).
  4. Call `embed_query` MCP tool with `text = <query>`. Parse the returned JSON → `embedding` (base64).
  5. Call `recall_session_messages` MCP tool with `{project, query, embedding, session_id?, since?, limit: 10}`.
  6. Present results grouped by session: header `## Session <short-id>` then each matching turn `[<iso>] [<role>]: <content>`. If empty: tell the user plainly and suggest proceeding without prior context.

### Step 10 — CLAUDE.md compaction hint
**Satisfies:** AC-12
**Files:**
- `CLAUDE.md`
**Description:**
- Locate the existing "**After compaction:**" paragraph in the "Session Start" section.
- Append one sentence: "If you need more than the snapshot — to recover a specific earlier exchange — use `/recall-session <topic>` to semantically retrieve relevant past turns from the project's message history."
- No hook changes. The note is informational; the agent invokes the skill on demand.

### Step 11 — Tests
**Satisfies:** AC-13
**Files:**
- `mcps/mongodb-memory/recall-session-messages.test.ts` (new)
- `mcps/mongodb-memory/embed-backfill.test.ts` (extend — add `--collection` cases)
- `mcps/mongodb-memory/embed.test.ts` (extend — `shouldEmbedMessage` unit tests)
**Description:**
- All tests run with `DAKO_EMBED_STUB=1`. Mongo branches gate on `mongoReachable()`.
- **embed.test.ts additions:**
  - `shouldEmbedMessage("user", "")` → false
  - `shouldEmbedMessage("user", "ok")` → false (< 20 chars)
  - `shouldEmbedMessage("tool", "<some long enough content>")` → false (role=tool)
  - `shouldEmbedMessage("user", "<≥ 20 char content>")` → true
  - `shouldEmbedMessage("assistant", "<≥ 20 char content>")` → true
- **recall-session-messages.test.ts** (SQLite + Mongo branches):
  - Seed sessions A, B in project P; log messages of varying length, role, and session.
  - `logMessage` inline embed happy path: short message skipped (embedding null); long user message embedded (non-null); tool message skipped.
  - `logMessage` embed failure: trigger via `DAKO_EMBEDDING_MODEL=nonexistent/model` so the dynamic import throws; row still inserted, both fields null.
  - `recallSessionMessages({project: P, query})` returns ranked hits across both sessions (project-wide default).
  - `recallSessionMessages({project: P, query, session_id: A})` returns only session-A hits.
  - `recallSessionMessages({project: P, query, since: <isoForMidwayTimestamp>})` returns only post-midway hits.
  - `recallSessionMessages` with no embedded messages → "No matching messages found …" text.
  - `recallSessionMessages` with caller-supplied `embedding` (Buffer) — server does not call `embedTexts` (assert by checking a counter exposed via the stub).
  - Mixed-model rows (one row embedded with a stub vector + literal `embedding_model = "other-model"`) excluded from results.
- **embed-backfill.test.ts additions:**
  - `--collection messages` (idempotent): seed 5 messages where 2 already embedded → run → 3 embedded, 2 skipped. Skip-rule-failing rows (empty/short/tool) counted in `skipped`.
  - `--collection messages --force` → all eligible rows re-embedded; skip-rule-failing rows still skipped.
  - `--collection messages --dry-run` → zero writes.
  - `--collection all` → runs memories then messages; both summaries printed.
  - `--collection invalid` → exit 1 with usage.

## Risks / Known Unknowns
1. **`seq` race in concurrent `logMessage`.** Pre-existing — both adapters compute `seq` before insert, non-atomically. Not introduced by this WI; mentioned because we're touching the function and could choose to harden it. Plan: leave as-is. Real-world impact is negligible (one MCP process per session in practice).
2. **MiniLM 512-token cap on long messages.** Very long assistant turns get silently truncated by the model. Plan: rely on the model's built-in truncation; do not pre-truncate in user code. Recall on a giant turn still works on its first 512 tokens, which is the most informative slice.
3. **`messages` table has no `project` column.** SQLite path JOINs to `sessions` to filter by project. Mongo path has no equivalent issue because we'll add a small projection. Sanity-check the JOIN performance on the existing `messages_session_seq` index; should be fine since `sessions.session_id` is PK.
4. **`since` timezone-less ISO strings.** `new Date("2026-05-26")` is UTC midnight. Some users will expect local. Plan: document in the tool description "ISO-8601, UTC if no offset"; don't try to be clever. Reject unparseable values with a helpful error.
5. **Skip-rules consistency between insert and backfill.** Both call `shouldEmbedMessage`. If a future change moves the threshold, only one place needs updating — `embed.ts`. Plan-confirmed.
6. **`embed-backfill` flag parser refactor.** Adding `--collection <val>` changes the parser from positional to keyed. Existing `--dry-run` / `--force` callers must keep working. Plan: walk `argv` with an index, peek next token when current is `--collection`. Test the flag parser explicitly (already in test plan).
7. **Skill triple-sync.** Standard chore. The plan lists all three paths.
8. **Mongo Binary ↔ Buffer interop.** Same gotcha as memories WI; pattern carries over (`doc.embedding.buffer`).

## Confirmation
**Confirmed by user:** yes
**Notes:** Signed off 2026-05-26.

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
