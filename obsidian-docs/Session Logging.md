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
| `messages` | All turns ordered by `seq`, linked to `session_id` by `role` and `content` |
| `memories` | Long-term memories + compaction snapshots |

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
