---
wi: WI-context-management/20260522-compaction-and-pressure
phase: plan
status: confirmed
date: 2026-05-22
approach: Agent-side STM save
---

## Context
**Selected approach:** Agent-side STM save
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8

## Implementation Sequence

### Step 1 — Remove PreCompact hook entries
**Satisfies:** AC-1
**Files:** `.claude/settings.json`, `claude-plugin-release/hooks/hooks.json`
**Description:** Delete the PreCompact block from both hook config files. UserPromptSubmit and Stop remain unchanged. The PreCompact hook is the only source of `auto-cleanup` LTM snapshots — removing it stops accumulation at the root.

### Step 2 — Remove PreCompact handler from logger.mjs
**Satisfies:** AC-2
**Files:** `mcps/mongodb-memory/logger.mjs`
**Description:** Delete the `else if (event === "PreCompact")` block (lines 169–206). Update the header comment to remove PreCompact from supported events. The rest of logger.mjs (session management, UserPromptSubmit, Stop) is untouched.

### Step 3 — Update CLAUDE.md: recovery protocol, turn-count rule, snapshot structure
**Satisfies:** AC-3, AC-4, AC-5
**Files:** `CLAUDE.md`
**Description:** Three targeted edits:
1. **Architecture section**: remove PreCompact from the hook list description
2. **Session Start → After compaction**: replace `get_context` / `auto-cleanup` protocol with `find_patterns(query: "context-snapshot", project: "DakoHarness")` — if a result is found, read it to restore context; no delete needed (TTL handles cleanup)
3. **New "Context checkpointing" section** (after "When to Save"): every 15 turns, call `remember_pattern` with `type: "context-snapshot"`, `project: "DakoHarness"`, `agent: "claude-code"`, and content structured as:
   - `Current task:` — what is being worked on right now
   - `Key decisions this session:` — decisions made but not yet in LTM
   - `Active workitem:` — path and current phase, or "none"
4. **Tool Reference table**: replace `get_context` row with `find_patterns (query: "context-snapshot") | Short-term`

### Step 4 — Write /dako:checkpoint command
**Satisfies:** AC-6, AC-7
**Files:** `commands/checkpoint.md`, `.claude/commands/checkpoint.md`, `claude-plugin-release/commands/checkpoint.md`
**Description:** A simple command that saves the same structured snapshot as the periodic turn-count rule. Steps: (1) gather current task from user if not obvious, (2) note any key decisions made this session not yet in LTM, (3) check for active workitem via source_of_truth.md, (4) call `remember_pattern` with the assembled content. Report confirmation. All three files identical — follows the doctor.md pattern.

## Notes on AC-8
AC-8 (auto-expiry) requires no code — STM's existing 7-day TTL handles it. Verified: `remember_pattern` writes to SQLite with a TTL timestamp; no changes to the STM binary are needed.

## Risks / Known Unknowns

- **Turn-count compliance**: The 15-turn rule in CLAUDE.md is a behavioral instruction, not enforced code. The agent may not count turns precisely. Risk: low — the checkpoint command and session-end serve as manual safety nets.
- **STM down during checkpoint**: If the STM MCP is unreachable when a checkpoint is triggered (periodic or manual), `remember_pattern` fails silently. The checkpoint command should note the failure to the user rather than silently succeeding.
- **CLAUDE.md is live immediately**: changes affect the next session start. If the new recovery protocol (`find_patterns`) has a bug, the agent may fail to recover after compaction. Needs careful review before confirm.

## Confirmation
**Confirmed by user:** yes
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
