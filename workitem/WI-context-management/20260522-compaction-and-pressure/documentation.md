---
wi: WI-context-management/20260522-compaction-and-pressure
phase: documentation
status: confirmed
date: 2026-05-22
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `README.md` | Architecture tree | Removed PreCompact from hooks.json description |
| `README.md` | Step 5 — Configure hooks | Removed PreCompact block from example JSON |
| `README.md` | Slash commands table | Added `/dako:checkpoint` row |
| `obsidian-docs/Slash Commands.md` | Between /doctor and /recall | Added full `/checkpoint` section |
| `CLAUDE.md` | Architecture section | Removed PreCompact from hook list |
| `CLAUDE.md` | Session Start — After compaction | Replaced get_context protocol with find_patterns(query: "context-snapshot") |
| `CLAUDE.md` | During a Session | Added Context Checkpointing section (15-turn rule + snapshot structure) |
| `CLAUDE.md` | Tool Reference table | Replaced get_context row with find_patterns (context-snapshot) / Short-term |

## Workitem Documentation

### What was built

Two changes to how DakoHarness handles context compaction recovery:

1. **Removed the PreCompact hook** — previously, when Claude Code was about to compact the conversation context, a hook script (`logger.mjs PreCompact`) saved the last 3 assistant turns to MongoDB tagged `auto-cleanup`. This caused snapshots to accumulate in long-term memory when the cleanup step wasn't run reliably.

2. **Agent-side STM checkpointing** — recovery snapshots are now saved to short-term memory (SQLite, 7-day TTL) by the agent itself, not by a hook script. This eliminates accumulation because STM entries expire automatically. Two triggers:
   - **Periodic**: CLAUDE.md instructs the agent to save a snapshot every 15 turns
   - **On-demand**: a new `/dako:checkpoint` command (also `/checkpoint` in dev mode) saves a snapshot immediately

### How it works

**Snapshot format** (stored via `remember_pattern` with `type: "context-snapshot"`):
```
Current task: <what is being worked on>
Key decisions this session: <decisions not yet saved to LTM, or "none">
Active workitem: <WI path and phase, or "none">
```

**Recovery** (on session start after compaction): the agent calls `find_patterns(query: "context-snapshot", project: "<project>")`. If a result is found, it reads the most recent snapshot to restore context. No delete is needed — STM TTL handles expiry after 7 days.

**Why hooks can't write to STM**: the STM binary is an MCP server (stdio protocol), not a CLI tool. Hook scripts can't call it directly. Moving the snapshot write to the agent side is the only approach that doesn't require a new binary CLI mode or a local file.

### Usage

```
/dako:checkpoint
```

No arguments. Run at any point in a long session. The command asks for the current task if it isn't obvious from the conversation, then saves the snapshot.

The 15-turn periodic rule runs automatically — no user action needed.

### Known limitations

None. Review verdict was `pass` with no accepted gaps.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
