---
wi: WI-rag-long-sessions
phase: analyze
status: confirmed
date: 2026-05-26
---

## Requirements

### Functional
1. The `messages` collection gains two new fields in both `MongoStorage` and `SqliteStorage`: `embedding` (Float32 raw bytes — SQLite `BLOB`, MongoDB `Binary` subtype 0) and `embedding_model` (string — model id that produced the vector). Both nullable.
2. `log_message` (existing MCP tool) embeds `role + ": " + content` inline at insert time using the existing `embedTexts` helper from `embed.ts`. Result is written to the row's `embedding` + `embedding_model` fields. On embed failure: insert succeeds with both fields null, stderr warning logged, tool returns its normal success ToolResult — same failure semantics as `remember`.
3. Skip rules on `log_message`: do NOT embed when (a) trimmed `content` is empty, (b) trimmed content length < 20 characters, or (c) `role === "tool"`. The message is still inserted; `embedding` / `embedding_model` are left null. Skip is silent (no stderr warning).
4. New MCP tool `recall_session_messages` with input:
   - `project: string` (required)
   - `query: string` (required)
   - `session_id?: string` (default = project-wide search across all sessions)
   - `since?: string` (optional ISO-8601 timestamp; only messages with `timestamp >= since` are searched)
   - `limit?: number` (default 10)
   - `embedding?: string` (optional base64 Float32; if supplied, server skips re-embedding the query — mirrors `recall`)
5. `recall_session_messages` retrieval shape: vector-only (no FTS/`$text` path for messages). Filter `{ project, embedding_model: currentModel, embedding non-null }` plus optional `session_id` and `timestamp >= since`. Vector candidate fetch capped at `Math.max(500, 2 × limit)`. In-process cosine; sort desc; return top `limit`.
6. Default scope is **project-wide**: omitting `session_id` searches every session in the project. Callers pass `session_id` explicitly to narrow to one conversation.
7. Result rendering: one line per matched message in the form `[<session_id>] [<timestamp>] [<role>]: <content>` ordered by similarity descending. Top-N controlled by `limit`. If no matches: today's-style "No matching messages found …" text.
8. Mixed-model graceful degradation: rows whose `embedding_model` differs from the current `DAKO_EMBEDDING_MODEL` are excluded from results. Same pattern as `memories.recall`.
9. New `/recall-session` slash command, mirrored at `.claude/commands/recall-session.md`, `commands/recall-session.md`, and `claude-plugin-release/commands/recall-session.md`. Steps: (a) determine project from `DAKO_PROJECT` or cwd basename; (b) call `embed_query` once on the user's query; (c) call `recall_session_messages` with the resulting embedding; (d) present results grouped by session, sorted by similarity. The skill defaults to project-wide search; users can include `session=<id>` or `since=<iso>` in args to narrow.
10. `embed-backfill` script gains a `--collection memories|messages|all` flag. Default remains `memories` (no surprise for existing users). `--collection messages` walks the messages collection, embedding rows that match the skip rules (Req-3) and the current `DAKO_EMBEDDING_MODEL` mismatch. `--collection all` runs both sequentially. `--dry-run` and `--force` work identically across collections.
11. CLAUDE.md "Memory Protocol" section gets a one-line note: after compaction, `/recall-session <topic>` is available to retrieve semantically relevant earlier turns. No hook changes; this is purely a documentation hint about the new skill.

### Non-functional
- Zero regression on existing flows: `log_message` continues to succeed when embedding fails or is skipped. `recall` (memories) behavior unchanged. STM is unaffected.
- Inline-embed latency: ~50–200ms per non-skipped turn. Acceptable budget for `log_message`'s call frequency (hook-driven, per user prompt + per assistant turn).
- No new runtime dependencies. Rides on `@xenova/transformers` shipped in WI-local-embedding-recall.
- Storage overhead: 384-dim float32 = 1536 bytes per embedded message. A long session of 1000 turns ≈ 1.5MB of vectors. Acceptable.

## Out of Scope
- FTS / `$text` index on the `messages` collection (vector-only retrieval by design).
- Auto-recall on compaction (no hook integration; `/recall-session` is invoked explicitly by the agent).
- Embedding the `sessions` collection metadata itself (just `messages`).
- Cross-project session search.
- Team-scoping for sessions (not currently scoped that way; out of scope here).
- Cross-encoder re-ranking on top of vector retrieval.
- Native vector indexes (Atlas `vectorSearch`, `sqlite-vec`) — same exclusion as WI-local-embedding-recall; forward-compat byte layout preserved.
- `forget`-style targeted deletion of message embeddings — only batch backfill / re-embed for now.
- Auto-archival of old sessions / TTL on message embeddings — sessions stay in Mongo indefinitely.
- Surrounding-turn context in results (caller can use `get_session` to fetch full transcript around a hit).
- Structured parsing of tool-call payloads — treated as `role: "tool"` and skipped at embed time.

## Open Questions
1. **Skip threshold of 20 characters.** Constant or env-configurable? Lean: constant in `embed.ts` (`MESSAGE_MIN_LEN = 20`) — one place to tune if needed; no env var clutter. Pin in plan.
2. **Display format on `/recall-session`.** Lean: one line per hit (`[session_id] [timestamp] [role]: content`), no surrounding-turn context. Caller can use `get_session` for full transcript. Pin in plan.
3. **`since` parsing strictness.** Lean: pass through to `new Date(since)`; if `isNaN(getTime())`, error with a clear "expected ISO-8601" message. Pin in plan.

## Acceptance Criteria
- [ ] **AC-1** — Both adapters add `embedding` + `embedding_model` to the `messages` collection. SQLite: idempotent `ALTER TABLE messages ADD COLUMN` for both (same helper used for `memories`). MongoDB: new `{ embedding_model: 1 }` index created in `MongoStorage.create()` for fast mismatch filtering. Existing rows without these fields/columns remain readable.
- [ ] **AC-2** — `log_message` embeds `role + ": " + content` inline using `embedTexts` and stores the result on the inserted row. On embed failure: row still inserted with `embedding = null` and `embedding_model = null`; warning written to stderr in the form `[embed] inline embed failed for message <seq>: <reason>`; tool returns the existing success ToolResult.
- [ ] **AC-3** — Skip rules: `log_message` skips embedding (still inserts row) when any of (a) trimmed `content === ""`, (b) trimmed `content.length < 20`, (c) `role === "tool"`. No warning is emitted on skip; both new fields are left null.
- [ ] **AC-4** — New MCP tool `recall_session_messages` registered in `server.ts`. Input schema: `project` (string, required), `query` (string, required), `session_id` (string, optional), `since` (ISO-8601 string, optional), `limit` (number, default 10), `embedding` (base64 string, optional). Server base64-decodes `embedding` to Buffer before calling the adapter.
- [ ] **AC-5** — Retrieval implementation: vector-only. Filter `{ project, embedding_model: currentModel, embedding non-null }` ∧ optional `session_id` filter ∧ optional `timestamp >= since` filter. Candidate fetch capped at `Math.max(500, 2 × limit)`. In-process cosine on Float32 buffers (uses existing `cosine` helper from `embed.ts`). Sorted descending; top `limit` returned.
- [ ] **AC-6** — Default scope is project-wide: omitting `session_id` searches every session for that project. Supplying `session_id` narrows to that single session.
- [ ] **AC-7** — Result rendering: each hit on its own line in the format `[<session_id-short>] [<iso timestamp>] [<role>]: <content>` where `session_id-short` is the first 8 chars of the UUID (full id present in the project's `list_sessions` output already). Order is similarity descending. If zero hits: a "No matching messages found in project '<p>'" text. Same overall shape as today's `recall` ToolResult.
- [ ] **AC-8** — Mixed-model graceful degradation: rows whose `embedding_model` differs from the current `DAKO_EMBEDDING_MODEL` are filtered out of results. They are not embedded again by recall — only the explicit `--force` backfill rewrites them.
- [ ] **AC-9** — `recall_session_messages` accepts an `embedding` arg (same base64 shape as `recall`). When provided, the server skips its own `embedTexts(query)` call. The new `/recall-session` skill uses this path: one `embed_query` MCP call per skill invocation, no matter how many internal `recall_session_messages` calls (currently one — keyword variants are NOT generated for session-message recall in v1).
- [ ] **AC-10** — New `/recall-session` skill, mirrored in three locations (`.claude/commands/`, `commands/`, `claude-plugin-release/commands/`). Steps documented in the skill file: (1) resolve project; (2) parse optional `session=<id>` / `since=<iso>` from args; (3) call `embed_query` once on the user's query; (4) call `recall_session_messages` with the embedding + parsed filters; (5) present results grouped by session, sorted within each group by timestamp. Empty result handled gracefully ("no relevant turns found, proceed without prior context").
- [ ] **AC-11** — `embed-backfill` gains `--collection memories|messages|all`. Default = `memories` (preserves current behavior; no breaking change). `--collection messages` walks `messages`, applies the same skip rules as `log_message` (Req-3), and writes embeddings with the same per-batch error isolation. `--collection all` runs both sequentially. `--dry-run` and `--force` work identically across both. Unknown `--collection` value exits 1 with usage.
- [ ] **AC-12** — CLAUDE.md "Memory Protocol" section gets a one-line update under existing compaction-recovery guidance: a note that `/recall-session <topic>` is available on-demand to retrieve semantically relevant earlier turns. No hook changes.
- [ ] **AC-13** — Tests cover: (a) `log_message` inline embed happy path; (b) all three skip rules (empty / <20 chars / role=tool); (c) embed-failure graceful insert; (d) `recall_session_messages` vector retrieval with no session filter (project-wide); (e) with session filter; (f) with `since` time-window filter; (g) with no matching embeddings → "no matches" text; (h) with caller-supplied `embedding` — server does not re-embed (assert via stub counter); (i) `embed-backfill --collection messages` idempotent run; (j) `--collection messages --force`; (k) `--collection all`. All tests use `DAKO_EMBED_STUB=1`; Mongo branches skip on unreachable.
- [ ] **AC-14** — Zero regression: `recall` (memories) result format and ranking are byte-identical to pre-WI behavior on equivalent inputs. `log_message` still inserts when embedding is disabled or unavailable. Existing `embed-backfill` invocation (`npm run embed-backfill` with no flag) continues to target `memories` only.

## Interview Notes
- Embed shape: user picked **`role + ": " + content`** (Recommended). Cheap; role is a meaningful semantic signal.
- Insert latency: user picked **inline best-effort with skip rules** (Recommended). ~50–200ms per turn budgeted; short/empty/tool-call messages skipped to avoid embedding noise.
- Default scope: user picked **project-wide** (override of the recommended "current session only"). Means `recall_session_messages` with no `session_id` searches every session in the project. Suits cross-session continuity and matches how the agent thinks about "earlier work."
- Recall mode: user picked **vector-only** (Recommended). Avoids the FTS/`$text` schema migration on messages; vector handles paraphrase recall well on conversational text.
- Skill surface: user picked **new `/recall-session` skill** (Recommended). Keeps `/recall` focused on long-term memories; clear mental model.
- Compaction: user picked **skill-only, no auto-recall** (Recommended). One-line CLAUDE.md hint; no hook changes; agent invokes on demand.
- Time window default: user picked **no default — all-time** (Recommended). Caller opts in to `since`.
- Backfill shape: user picked **extend `embed-backfill` with `--collection` flag** (Recommended). One CLI, one mental model.

## Sign-off
**Confirmed by user:** yes
**Date:** 2026-05-26
