---
wi: WI-rag-long-sessions
created: 2026-05-26
updated: 2026-05-27
status: active

---

## Current State

**Current phase:** repo
**Blocked:** no

## Sub-features

| Sub-feature | Status | Phases completed |
|---|---|---|
| 20260526-message-embeddings | in-progress | intake, analyze, plan, implement, review, document |

## Active Blockers

| # | Description |
|---|---|

## Key Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-26 | Embed `role + ": " + content` (not content-only, not with prior-turn snippet) | Role is a meaningful semantic signal at zero extra cost |
| 2026-05-26 | Inline embed on `log_message` with skip rules (empty / <20 chars / role=tool) | Latency budget acceptable; skip rules avoid embedding noise |
| 2026-05-26 | Default `recall_session_messages` scope = project-wide (not session-only) | Better suits cross-session continuity; agent narrows with explicit `session_id` |
| 2026-05-26 | Vector-only retrieval for messages — no FTS / `$text` index added | Avoids schema migration; vector handles conversational paraphrase recall well |
| 2026-05-26 | New `/recall-session` skill, not a flag on `/recall` | Keeps `/recall` focused on LTM; clear mental model per skill |
| 2026-05-26 | Compaction integration = CLAUDE.md hint only, no hook | Skill-on-demand is sufficient; no UX surprise |
| 2026-05-26 | No default `since` (all-time); opt-in via ISO-8601 arg | Semantic ranking already weighs relevance; explicit narrowing only |
| 2026-05-26 | Extend `embed-backfill` with `--collection memories|messages|all` (not new script) | One CLI, one mental model; default stays `memories` for back-compat |
| 2026-05-26 | Skip threshold = `MESSAGE_MIN_LEN = 20` characters, hardcoded | Lean toward constant; revisit if real-world tuning needed |
| 2026-05-26 | `shouldEmbedMessage` helper centralised in `embed.ts`, used by both `logMessage` and `embed-backfill` | Single source of truth keeps insert-time and backfill-time skip semantics consistent |
| 2026-05-26 | SQLite project filter via JOIN to `sessions` table (no new `project` column on `messages`) | Avoids redundant denormalised column; `messages_session_seq` + `sessions.session_id` PK make JOIN fast |
| 2026-05-26 | Inline embed lands AFTER insert; UPDATE the just-inserted row | Need `insertedId` / `lastInsertRowid`; failure leaves row with null embedding fields cleanly |
| 2026-05-26 | `since` UTC if no offset; unparseable → error | Documented in tool description; no clever timezone inference |
| 2026-05-26 | wi-implement dispatch #1 for 20260526-message-embeddings | initial |
| 2026-05-27 | wi-implement dispatch #2 for 20260526-message-embeddings | post-session-limit-resume (dispatch #1 wrote Architecture Notes, did CLAUDE.md edit (Step 10), and created /recall-session skill (Step 9) then session reset) |

## Parking / Cancellation

