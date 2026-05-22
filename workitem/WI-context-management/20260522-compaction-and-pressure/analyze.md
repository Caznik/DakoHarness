---
wi: WI-context-management/20260522-compaction-and-pressure
phase: analyze
status: confirmed
date: 2026-05-22
---

## Requirements

1. The PreCompact hook no longer writes snapshots to MongoDB — it is removed from all hook config files and its handler is removed from `logger.mjs`
2. CLAUDE.md gains a turn-count rule: every 15 turns, the agent saves a structured context snapshot to STM via `remember_pattern` with `type: "context-snapshot"`
3. A new `/dako:checkpoint` command exists — user-triggered, saves the same structured snapshot on demand
4. The context snapshot has a defined structure: current task description, key decisions made this session not yet in LTM, active workitem path and current phase (if any)
5. CLAUDE.md recovery protocol updated: at session start, call `find_patterns` with `query: "context-snapshot"` instead of `get_context`; if a recent snapshot is found, use it to restore context
6. Snapshot cleanup is automatic — STM's 7-day TTL handles it; no explicit delete call needed

## Out of Scope

- Cleaning up existing `auto-cleanup` snapshots in LTM (already done manually this session)
- Changes to UserPromptSubmit or Stop hooks (session logging unchanged)
- STM binary changes
- `/dako:session-end` integration (could chain into checkpoint — separate workitem)

## Open Questions

*(none — all resolved during interview)*

## Acceptance Criteria

- [ ] **AC-1** — PreCompact hook entry removed from `.claude/settings.json` (dev) and `claude-plugin-release/hooks/hooks.json` (plugin)
- [ ] **AC-2** — PreCompact handler removed from `logger.mjs`
- [ ] **AC-3** — CLAUDE.md contains a turn-count rule: every 15 turns the agent calls `remember_pattern` with `type: "context-snapshot"` and structured content
- [ ] **AC-4** — Snapshot content structure defined in CLAUDE.md: current task, key decisions not yet in LTM, active workitem path + phase if any
- [ ] **AC-5** — CLAUDE.md session-start recovery protocol updated: call `find_patterns(query: "context-snapshot")` instead of `get_context`; if result found, read and use for context recovery
- [ ] **AC-6** — `/dako:checkpoint` command created in `commands/checkpoint.md`, `.claude/commands/checkpoint.md`, and `claude-plugin-release/commands/checkpoint.md`
- [ ] **AC-7** — `/dako:checkpoint` saves the same structured snapshot as the periodic turn-count rule
- [ ] **AC-8** — No explicit snapshot deletion is needed anywhere — STM TTL handles expiry

## Interview Notes

- User initially didn't recognize the workitem because the backlog item was vague. Narrowed scope significantly during analyze.
- The core insight: compaction snapshots are ephemeral recovery artifacts — they belong in STM (7-day TTL, auto-expiry) not LTM (permanent, accumulates)
- Agent-side save chosen over hook-based or local-file approaches: keeps hooks for logging, memory tools for memory; architecturally cleaner
- "Both" on trigger: periodic turn-count rule as safety net + `/dako:checkpoint` for explicit saves
- "Both" on snapshot content: structured summary (task + decisions + workitem) not raw transcript turns
- "Remove it" on PreCompact hook: no fallback, no migration — clean cut
- Turn-count interval: 15 turns confirmed

## Sign-off

**Confirmed by user:** yes
**Date:** 2026-05-22
