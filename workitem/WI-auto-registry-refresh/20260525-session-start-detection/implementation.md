---
wi: WI-auto-registry-refresh/20260525-session-start-detection
phase: implementation
status: completed
date: 2026-05-25
---

## Architecture Notes

Markdown-only implementation — no code changes, no MCP changes, no hooks, no settings.json edits.

Patterns followed:
- **CLAUDE.md prose style**: section header + short prescriptive paragraph + bold-prefix subsection (`**After compaction:**` pattern). The new `**Registry freshness:**` subsection mirrors this exactly so it reads as a sibling rule, not a foreign addition.
- **Agent-driven session-start protocol**: same pattern as the existing "After compaction" rule — agent reads file state and acts, no hook involved. Established by [[WI-context-management]] and reinforced by [[WI-semantic-recall/20260525-embedding-search]].
- **Three-location skill sync NOT applicable**: the change is in CLAUDE.md, not a slash command. The /registry-refresh command itself is unchanged.

Deliberately not done:
- No SessionStart hook — rejected during analyze (AC-5, AC-7). Hook adds infra and a settings.json edit for no behavior gain over agent-driven; the agent reads CLAUDE.md every session start anyway.
- No STM tracking of last-refresh timestamp — mtime comparison is sufficient and avoids an extra STM round-trip on every session start.

## Plan Deviations

| Step | Original plan | What actually happened | Reason |
|---|---|---|---|

## Blockers

| # | Description | Resolution | Status |
|---|---|---|---|

## QA Log

| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-1, AC-2, AC-3, AC-4, AC-5 | pass | Inserted `**Registry freshness:**` subsection in CLAUDE.md `### Session Start`, placed just before `**After compaction:**`. Single paragraph covers: when (session start, before first task), how (mtime comparison), stale rule (any newer command file OR registry missing), action on stale (invoke /registry-refresh + one-line notice), silence on fresh, silent skip when `.claude/commands/` missing. |
| 1 | AC-8 | pass | Removed backlog row from README.md (line 304). Removed backlog row from obsidian-docs/Roadmap.md (line 132). Updated obsidian-docs/Slash Commands.md `/registry-refresh` "When to use" line to mention auto-invocation at session start with cross-reference to CLAUDE.md Session Start → Registry freshness. |
| 1 | AC-6 | pass | Smoke test run live — see detail below. |
| 1 | AC-7 | pass | Implicit — diff shows only `.md` files changed: CLAUDE.md, README.md, obsidian-docs/Roadmap.md, obsidian-docs/Slash Commands.md, plus the regenerated `.claude/skill-registry.md`. No package, env var, hook, or settings.json edits. |

### Smoke test detail (AC-6)

**Stale path (natural state at start of implementation):**
- Pre-implementation mtimes: registry = 2026-05-21T12:43:58 (from prior workitem), newest command file `recall.md` = 2026-05-25T06:54:17 (touched during WI-semantic-recall completion).
- Protocol evaluation: `recall.md` mtime > registry mtime → STALE.
- Action: invoked `/registry-refresh` via Skill tool. Output: `Registry refreshed — 21 skills indexed.` Registry file rewritten with current timestamp.
- **Pass:** stale detection correct, action correct, notice format matches existing /registry-refresh confirmation.

**Fresh path (post-refresh state):**
- Post-refresh mtimes: registry = 2026-05-25T07:21:22, newest command file still `recall.md` at 2026-05-25T06:54:17.
- Protocol evaluation: `recall.md` mtime < registry mtime → FRESH (stale: False per PowerShell check).
- Action: none — silent no-op.
- **Pass:** fresh detection correct, no tool call needed, no log output.

**Missing-directory path:** not exercised live but the protocol text explicitly handles it ("If `.claude/commands/` does not exist… skip the check silently"). Trivial branch.

## Regression

**Test suite run:** no
**Result:** n/a
**Failures:** No automated test suite exists in this project.
