---
wi: WI-memory-quality/20260522-memory-audit
phase: analyze
status: confirmed
date: 2026-05-22
---

## Requirements

1. A new `list_memories` tool added to `mcps/mongodb-memory/server.js` — returns all LTM memories for a project, with an optional type filter, ordered by `created_at`. Returns memory IDs alongside content so `forget` can be called on specific entries.
2. A new `/dako:memory-audit` command (`commands/`, `.claude/commands/`, `claude-plugin-release/commands/`) that runs three audit passes in sequence:
   - **Pass 1 — Deduplication**: agent reads all memories, identifies near-duplicate pairs by type + content similarity (agent judgment), presents each pair with a recommendation, user confirms which to keep, agent deletes the other via `forget`
   - **Pass 2 — Staleness**: agent flags memories older than 90 days, presents each with "keep / update / delete" options, executes the user's choice (update = `remember` new content + `forget` old; delete = `forget` only)
   - **Pass 3 — Contradictions**: agent reads all memories grouped by type, identifies pairs with conflicting claims, presents each conflict with proposed resolution (keep one / keep both / delete both), executes on confirmation
3. Agent proposes every change before executing — no autonomous deletion or modification
4. Post-audit summary: N duplicates merged, N stale resolved, N contradictions resolved

## Out of Scope

- Semantic/embedding-based similarity detection (backlog item — time-based and agent judgment used instead)
- Automatic or scheduled audits (on-demand only)
- Cross-project or team-scope audits
- Short-term memory auditing (STM has 7-day TTL — self-cleaning)
- In-place memory editing (updates done as forget + remember)

## Open Questions

*(none — all resolved during interview)*

## Acceptance Criteria

- [ ] **AC-1** — `list_memories` tool added to server.js: accepts `project` (required), `type` (optional filter), `limit` (optional, default 200); returns array of memory documents including `_id`, `type`, `title`, `content`, `created_at`
- [ ] **AC-2** — `/dako:memory-audit` command created in all three locations (`commands/`, `.claude/commands/`, `claude-plugin-release/commands/`)
- [ ] **AC-3** — Deduplication pass: agent uses `list_memories` to fetch all memories, identifies near-duplicate pairs (same type, similar content) by agent judgment, presents each pair with recommendation, on user confirmation calls `forget` on the discarded entry
- [ ] **AC-4** — Staleness pass: agent identifies memories with `created_at` older than 90 days, presents each individually with keep/update/delete options; update = `remember` new content + `forget` old; delete = `forget` only
- [ ] **AC-5** — Contradiction pass: agent reads all memories grouped by type, identifies pairs with conflicting claims, presents each conflict with proposed resolution (keep one / keep both / delete both), executes on confirmation
- [ ] **AC-6** — No change is executed without explicit per-change user confirmation — agent always shows what it will do and waits for approval
- [ ] **AC-7** — Post-audit summary printed after all three passes: "X duplicate(s) merged, Y stale resolved, Z contradiction(s) resolved"
- [ ] **AC-8** — Each pass handles the empty case gracefully: if no duplicates / no stale / no contradictions found, reports "none found" for that pass and moves on

## Interview Notes

- All three operations confirmed in scope
- On-demand command chosen over automatic/periodic — user controls when audits run
- Agent proposes, user confirms each change — no autonomous modifications
- Staleness threshold: 90 days (time-based); semantic search deferred to backlog
- Deduplication: full audit across all memories (not topic-scoped); agent judgment for similarity
- Merge strategy: keep the better one, delete the other — no content combining
- `list_memories` MCP tool confirmed as new addition to server.js; needed because `recall` FTS is unreliable for bulk retrieval

## Sign-off

**Confirmed by user:** yes
**Date:** 2026-05-22
