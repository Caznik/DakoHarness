---
wi: WI-rag-long-sessions/20260526-message-embeddings
phase: documentation
status: confirmed
date: 2026-05-27
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `obsidian-docs/Memory System.md` | New: "Session message recall (RAG for long sessions)" | Documents inline embed on `log_message`, the `recall_session_messages` MCP tool, `embed-backfill --collection` flag, and the compaction-recovery use case. Inserted between "Model mismatch handling" and "When to search". |
| `obsidian-docs/Session Logging.md` | "MongoDB collections" → added subsection "Message embeddings" | Documents that `messages` rows now carry optional `embedding` + `embedding_model`, the skip rules, the failure-graceful contract, and points readers to `recall_session_messages` / `/recall-session`. |
| `obsidian-docs/Slash Commands.md` | New: "/recall-session" entry | Documents the new skill: usage, 5-step flow, default project-wide scope, when to use. Inserted between `/recall` and `/promote`. |
| `obsidian-docs/Roadmap.md` | "Backlog" table | Removed the "RAG for long sessions" row (now delivered). |
| `README.md` | "Slash commands" table | Added `/dako:recall-session` row. |
| `README.md` | "Roadmap" → "Backlog" table | Removed the "RAG for long sessions" row (now delivered). |
| `CLAUDE.md` | "Memory Protocol" → "Session Start" → "After compaction" paragraph | One-line compaction-recovery hint pointing at `/recall-session <topic>` (made during implement phase, Step 10 — confirmed present in review). |

## Workitem Documentation

### What was built

Semantic recall over the `messages` collection (every captured conversation turn) so an agent can find earlier exchanges by meaning, not just exact keywords. Three pieces:

1. **Inline embed on every meaningful turn.** `log_message` now embeds `role + ": " + content` at insert time using the same Transformers.js model that the long-term `memories` collection uses. Short/empty/tool turns are skipped silently. Embed failure never blocks the insert — the row is committed with null embedding fields and a stderr warning, identical to how `remember` handles embed failures.
2. **A new MCP tool — `recall_session_messages`.** Input: `project`, `query`, optional `session_id`, optional ISO-8601 `since`, optional `limit` (default 10), optional pre-computed `embedding`. Vector-only retrieval (cosine over Float32 buffers in-process). Default scope is **project-wide**: omit `session_id` and it searches every session for that project. Model-mismatch rows are filtered out automatically (same contract as memories `recall`).
3. **A new agent-facing skill — `/recall-session <query> [session=<id>] [since=<iso>]`.** Mirrored at all three skill locations (`.claude/commands/`, `commands/`, `claude-plugin-release/commands/`). Calls `embed_query` once to fetch the query vector, then calls `recall_session_messages` and renders the hits grouped by session.

Plus operational glue:

- **`embed-backfill --collection memories|messages|all`** to backfill rows that pre-date this WI. Default with no flag remains `memories` so existing invocations are unchanged.
- **CLAUDE.md hint** at line 30 telling the agent that `/recall-session <topic>` is available after compaction for deeper history than the auto-saved snapshot.

### How it works

- **Shared embed plumbing.** `embed.ts` is the single source of truth for both `logMessage` (inline embed) and `embed-backfill --collection messages` (batch backfill). It exports `shouldEmbedMessage(role, content)` and the constant `MESSAGE_MIN_LEN = 20`. Insert-time and backfill-time skip semantics stay identical because both paths call the same helper.
- **The `messages` collection has no `project` column.** SQLite scopes by JOINing to `sessions` (`messages.session_id = sessions.session_id WHERE sessions.project = ?`); MongoDB scopes by first looking up `session_id`s belonging to the project, then filtering messages by membership. No denormalised `project` column was added — the existing `messages_session_seq` index plus the `sessions.session_id` PK make the JOIN cheap.
- **Embedding storage.** Same layout as `memories`: SQLite `BLOB` (Float32 raw bytes), MongoDB `Binary` subtype 0. The existing `floatsToBytes` / `bytesToFloats` / `cosine` helpers from `embed.ts` are reused as-is.
- **Vector-only by design.** No FTS5 virtual table on messages and no `$text` index on the Mongo `messages` collection. Conversational text is well-served by vector recall on its own; adding an FTS half would have required a schema migration with marginal benefit.
- **Insert-then-update embed pattern.** Both adapters' `logMessage` insert the row first, then attempt the embed inside a try/catch, then UPDATE the row's `embedding` + `embedding_model` fields on success. Failure leaves both fields null. Mirrors the proven contract from `remember`.
- **Caller-supplied embedding shortcut.** `recall_session_messages` accepts an optional base64 `embedding` arg. The `/recall-session` skill uses it: one `embed_query` MCP call up front, then the same vector is reused inside `recall_session_messages` instead of being re-computed server-side. Same pattern `/recall` uses for its keyword-variant calls.
- **Mixed-model graceful degradation.** Rows are tagged with `embedding_model`. Rows whose tag differs from the current `DAKO_EMBEDDING_MODEL` are silently excluded from results — they aren't re-embedded by recall, only by explicit `embed-backfill --collection messages --force`.

### Usage

**Agent-facing (the common case):**

```
/recall-session compaction recovery patterns
/recall-session migration plan since=2026-05-01
/recall-session backfill flag design session=8f3c2a1b
```

**Direct MCP call (programmatic / debugging):**

```jsonc
// recall_session_messages
{
  "project": "DakoHarness",
  "query": "embedding storage layout",
  "limit": 10
  // optional: "session_id", "since" (ISO-8601), "embedding" (base64)
}
```

**Backfill messages from before this feature shipped:**

```bash
cd mcps/mongodb-memory
npm run embed-backfill -- --collection messages
npm run embed-backfill -- --collection all          # memories then messages
npm run embed-backfill -- --collection messages --force   # re-embed everything
npm run embed-backfill -- --collection messages --dry-run # preflight
```

The default `npm run embed-backfill` (no flag) continues to target `memories` only — no behavior change for existing users.

### Known limitations

None accepted as gaps in this WI. Out-of-scope items deliberately left for future work:

- **No FTS half for messages** — vector-only by design. If conversational keyword search becomes useful (e.g. exact error strings), this can be added later without breaking the byte layout.
- **No native vector index** (Atlas `vectorSearch`, `sqlite-vec`) — in-app cosine keeps the default standalone Docker install zero-setup. The Float32 byte layout is preserved so a future swap to a native index would be straightforward.
- **`seq` race in `logMessage`** — pre-existing and out of scope. Both adapters compute `seq` then insert non-atomically.
- **No `forget`-style deletion of message embeddings** — only batch backfill / re-embed for now.
- **Pre-existing TS errors in `npm test`'s `tsc` step** — confirmed unchanged from baseline by the implementer (stashed the WI diff and re-ran `tsc`: same 20 errors). Caused by missing `@types/better-sqlite3`, missing `@xenova/transformers` types, and an MCP SDK `setRequestHandler` signature drift. None introduced by this WI; worth a future housekeeping pass.

## Confirmation
**Confirmed by user:** yes
**Date:** 2026-05-27
**Notes:**

## Cancellation
