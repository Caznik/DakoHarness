---
wi: WI-auto-registry-refresh/20260525-session-start-detection
phase: plan
status: confirmed
date: 2026-05-25
approach: Approach A
---

## Context
**Selected approach:** CLAUDE.md Session Start protocol addition
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8

**Codebase notes:**
- CLAUDE.md `## Memory Protocol` → `### Session Start` is at line 20-26. Current content: blank-start rule + "After compaction" subsection.
- The new freshness check fits as a sibling subsection to "After compaction" — both are conditional session-start actions.
- README.md line 304: backlog row "Auto registry-refresh on session start" → remove.
- obsidian-docs/Roadmap.md line 132: same backlog row in the Future Ideas table → remove.
- obsidian-docs/Slash Commands.md `/registry-refresh` section (lines 141-156): add a note that the command is also invoked automatically at session start when stale.
- `.claude/skill-registry.md` is gitignored (per existing Slash Commands.md callout) — the freshness check assumes the file may not exist on a fresh clone and treats "missing" as stale, which works.

## Implementation Sequence

### Step 1 — Add Registry Freshness subsection to CLAUDE.md
**Satisfies:** AC-1, AC-2, AC-3, AC-4, AC-5
**Files:** `CLAUDE.md`
**Description:** Insert a new `**Registry freshness:**` subsection inside `### Session Start`, placed just before `**After compaction:**`. Specify:
- When: on session start, before reading the user's first task
- How: compare `.claude/skill-registry.md` mtime against the newest mtime in `.claude/commands/*.md`
- Stale rule: any command file newer than the registry, OR `.claude/skill-registry.md` does not exist
- On stale: invoke `/registry-refresh` and print one line in the existing format (`Registry refreshed — N skills indexed.`)
- On fresh: silent no-op
- On missing `.claude/commands/` directory: silent skip

### Step 2 — Remove backlog row from README.md
**Satisfies:** AC-8
**Files:** `README.md`
**Description:** Delete line 304 row "Auto registry-refresh on session start | If short-term memory shows recent command file changes…" — the feature is now implemented.

### Step 3 — Remove backlog row from obsidian-docs/Roadmap.md
**Satisfies:** AC-8
**Files:** `obsidian-docs/Roadmap.md`
**Description:** Delete line 132 row from the Future Ideas table — same feature, same reason.

### Step 4 — Note auto-refresh in obsidian-docs/Slash Commands.md
**Satisfies:** AC-8
**Files:** `obsidian-docs/Slash Commands.md`
**Description:** In the `/registry-refresh` section (lines 141-156), add a brief "Auto-invoked" line under "When to use" stating the command also runs automatically at session start when command files are newer than the registry. Cross-reference CLAUDE.md Session Start.

### Step 5 — Smoke test the protocol
**Satisfies:** AC-6, AC-7
**Files:** none modified — verification only
**Description:** Two scenarios:
1. **Fresh registry path** — confirm current `.claude/commands/*.md` mtimes are all older than `.claude/skill-registry.md` (if it exists). Walk through the protocol: result should be silent no-op.
2. **Stale registry path** — touch one `.claude/commands/*.md` (or note its mtime is naturally newer), walk through the protocol: result should be `/registry-refresh` invocation + the one-line notice.

Also verify AC-7 implicitly: diff shows only `.md` files changed (CLAUDE.md, README.md, obsidian-docs/Roadmap.md, obsidian-docs/Slash Commands.md). No package, env var, hook, or settings.json changes.

## Risks / Known Unknowns

- **mtime reliability across filesystems** — Windows NTFS and Linux ext4 both have second-or-better resolution; should be fine. Edge case: cloning the repo fresh may set all mtimes to clone time, making the registry equal-or-newer than commands. Since registry is gitignored, a fresh clone has no registry → falls into the "missing" branch and triggers refresh on first session. Correct behavior.
- **Multiple agents touching command files between sessions** — outside DakoHarness scope; the next session's freshness check still catches it.

## Confirmation
**Confirmed by user:** yes
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
