---
wi: WI-auto-registry-refresh/20260525-session-start-detection
phase: documentation
status: confirmed
date: 2026-05-25
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `CLAUDE.md` | `## Memory Protocol` → `### Session Start` | Added `**Registry freshness:**` subsection between the blank-start rule and `**After compaction:**`. Defines the mtime-comparison check, stale rule (any newer command file or missing registry), action on stale (invoke `/registry-refresh` + one-line notice), silence on fresh, silent skip when `.claude/commands/` is missing. |
| `README.md` | Backlog | Removed "Auto registry-refresh on session start" row — feature is now implemented. |
| `obsidian-docs/Roadmap.md` | Future Ideas backlog table | Removed "Auto registry-refresh on session start" row — same feature, second location. |
| `obsidian-docs/Slash Commands.md` | `/registry-refresh` section, "When to use" line | Extended to mention auto-invocation at session start when command files are newer than the registry (or registry missing), with cross-reference to CLAUDE.md Session Start → Registry freshness. |

## Workitem Documentation

### What was built

A session-start protocol that keeps `.claude/skill-registry.md` in sync with `.claude/commands/` without manual intervention.

Previously, adding or modifying a command file required the user (or agent) to remember to run `/registry-refresh`. If they forgot, the registry index drifted — entries missing, descriptions outdated. The new protocol makes the agent check freshness automatically on every session start and self-heal silently when stale.

Implementation is pure CLAUDE.md prose — no hooks, no MCP changes, no settings.json edits, no env vars. The agent compares file mtimes during session start and invokes the existing `/registry-refresh` command when needed.

### How it works

**Trigger.** A new `**Registry freshness:**` subsection inside CLAUDE.md `## Memory Protocol` → `### Session Start` instructs the agent to run the check before reading the user's first task.

**Staleness rule.** The registry is stale if:
- Any `.claude/commands/*.md` has an mtime newer than `.claude/skill-registry.md`, **OR**
- `.claude/skill-registry.md` does not exist (e.g. on a fresh clone — the file is gitignored).

**Action on stale.** Invoke `/registry-refresh` and print one line in the existing format: `Registry refreshed — N skills indexed.` This is exactly the message `/registry-refresh` emits when invoked manually, so users see a consistent format regardless of how the refresh was triggered.

**Action on fresh.** Completely silent. No log line, no tool call, no prompt — the user shouldn't notice the check ran.

**Robustness.** If `.claude/commands/` does not exist (e.g. plugin-only installs where commands live elsewhere), the check is skipped silently.

**Why mtime, not STM tracking.** Two alternatives were considered during analyze: (1) storing a "last refresh" timestamp in STM, (2) hashing the file list. Both add round-trips or complexity for no behavioral gain. File mtimes are deterministic, work across fresh clones (missing registry → triggers refresh), and need no external state.

**Why agent-driven, not a SessionStart hook.** A hook would be deterministic but adds infrastructure (hook code + settings.json entry) for a feature whose cost of being missed is minimal (one missed refresh, which gets corrected the next session). The agent reads CLAUDE.md on every session anyway, so piggybacking on the existing session-start protocol is zero-cost.

### Usage

No user action required. The check runs automatically whenever Claude Code starts a session in a DakoHarness-enabled project.

If the agent finds the registry stale, the user will see a single line at the start of the session:

```
Registry refreshed — N skills indexed.
```

That's it. The next `/help` or any command lookup will see the up-to-date index.

Manual `/registry-refresh` invocation continues to work as before — it's now just rarely needed.

### Known limitations

Review verdict was `pass` with no accepted gaps.

Two design observations worth noting (deliberate choices, not gaps):

- **Mid-session command changes are not detected.** If you add a new command file mid-session, the registry won't refresh until the next session start. Run `/registry-refresh` manually in that case. Mid-session detection was explicitly out of scope.
- **Only `.claude/commands/` is watched.** The mirror locations `commands/` and `claude-plugin-release/commands/` exist for plugin packaging, but only `.claude/commands/` is read by the registry. Keeping mirrors in sync is still a manual three-file write — that's the established three-location skill convention, separate from this workitem.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
