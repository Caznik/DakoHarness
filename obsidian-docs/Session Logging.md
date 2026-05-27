---
tags: [dakoharness, session, hooks]
created: 2026-05-20
---

# Session Logging

Every conversation turn is captured automatically via Claude Code hooks — no manual logging needed.

---

## Hook pipeline

| Hook | When it fires | What it logs |
|---|---|---|
| `UserPromptSubmit` | User sends a message | User turn → `messages` collection |
| `Stop` | Agent finishes a response | Assistant turn (read from JSONL transcript) → `messages` |
| `PreCompact` | Before context compression | Last 3 assistant turns → `memories` (tagged `auto-cleanup`) |

All hooks call `logger.mjs`, which connects directly to MongoDB (no MCP overhead).

---

## MongoDB collections

| Collection | Contents |
|---|---|
| `sessions` | One document per conversation: `session_id`, `project`, `agent`, `cwd`, `started_at` |
| `messages` | All turns ordered by `seq`, linked to `session_id` by `role` and `content`. Optional `embedding` + `embedding_model` for semantic recall (see below). |
| `memories` | Long-term memories + compaction snapshots |

### Message embeddings

`log_message` embeds `role + ": " + content` inline at insert time and writes the Float32 buffer to the row, tagged with the current `DAKO_EMBEDDING_MODEL`. Embedding is **skipped silently** when content is empty, shorter than 20 characters, or `role === "tool"` — the row is still inserted, just without `embedding` / `embedding_model`.

Embed failure never blocks the insert: the row is committed with null embedding fields and a stderr warning is logged. Same failure-graceful contract as `remember`.

Semantic recall over messages is exposed via the `recall_session_messages` MCP tool and the [[Slash Commands#/recall-session]] skill. Default scope is project-wide; pass `session_id` to narrow. To backfill messages that pre-date this feature, run `npm run embed-backfill -- --collection messages` (see [[Memory System#Session message recall (RAG for long sessions)]]).

---

## Session boundary detection

Claude Code sends a stable `session_id` in every hook payload. `logger.mjs` persists both the DakoHarness UUID and Claude's UUID in `.claude/.dako_session`:

```json
{
  "session_id": "<dako-uuid>",
  "claude_session_id": "<claude-conversation-uuid>"
}
```

On each hook invocation:
- If `payload.session_id` matches `claude_session_id` → same conversation, continue
- If they differ → new conversation → new `session_id` created, new session document inserted

**Backward-compatible:** old files with only `session_id` get `claude_session_id` added on the next hook without resetting the session.

---

## Compaction recovery

When Claude Code compresses context (`/compact`):

1. **PreCompact hook fires** → `logger.mjs` reads the last 3 assistant turns from the JSONL transcript
2. Saves them to `memories` collection tagged `["compaction", "auto-cleanup"]`
3. On the **next session start**, if the agent finds an `auto-cleanup` memory, it reads where work was interrupted
4. Calls `forget` to delete the snapshot — clean state

> [!NOTE]
> Compaction recovery is driven by `CLAUDE.md` instructions, not a SessionStart hook. Claude Code does not support `type: "prompt"` hooks for `SessionStart` — no conversation context exists yet when that event fires.

---

## logger.mjs environment

Configured via `mcps/mongodb-memory/.env`:

```env
MONGO_URI=mongodb://dako:harness@localhost:27017/agent_memory?authSource=admin
DAKO_AGENT=claude-code
# DAKO_PROJECT=MyProject     # optional, defaults to cwd basename
# DAKO_SESSION_FILE=...      # optional, defaults to <cwd>/.claude/.dako_session
```

---

## Related

- [[Architecture#Hook pipeline]] — hook wiring overview
- [[Memory System]] — how memories are stored and searched
- [[Setup Guide#Configure hooks]] — hook configuration
