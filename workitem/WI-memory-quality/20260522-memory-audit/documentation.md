---
wi: WI-memory-quality/20260522-memory-audit
phase: documentation
status: confirmed
date: 2026-05-22
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `README.md` | Slash commands table | Added `/dako:memory-audit` row |
| `README.md` | Backlog | Removed "Memory quality over time" (delivered) |
| `obsidian-docs/Slash Commands.md` | Between /checkpoint and /recall | Added full `/memory-audit` section |

## Workitem Documentation

### What was built

Two additions to DakoHarness:

1. **`list_memories` MCP tool** — a new tool in `mcps/mongodb-memory/server.js` that returns all long-term memories for a project in bulk, sorted oldest-first. Unlike `recall` (which does full-text keyword search), `list_memories` returns every memory without filtering, making it suitable for audit and quality operations. Each result includes `type`, `title`, `content`, `timestamp`, `age_days`, and `scope`.

2. **`/dako:memory-audit` command** — a new slash command (also `/memory-audit` in dev mode) that runs three sequential audit passes over all long-term memories for the current project:
   - **Deduplication**: finds near-duplicate pairs by agent judgment, presents them to the user, deletes the weaker entry on confirmation
   - **Staleness**: flags memories older than 90 days, lets the user keep, update, or delete each
   - **Contradiction detection**: identifies memories with conflicting claims on the same subject, presents resolution options, executes on confirmation

No change is made without explicit per-item user confirmation.

### How it works

**`list_memories`** queries the `memories` collection with `{ project [, type] }`, sorts by `timestamp: 1` (oldest first), and limits to 200 by default. The `age_days` field is computed server-side as `Math.floor((now - timestamp) / 86400000)` so the audit command can filter stale entries without date arithmetic.

**`/dako:memory-audit`** calls `list_memories` once at startup and holds the full result in memory for all three passes — avoiding repeated round-trips. Passes run in sequence: deduplication first (removes noise), then staleness (removes outdated entries), then contradictions (resolves conflicts in what remains).

**Update pattern for stale memories**: since `remember` always inserts a new document and `forget` deletes by title, an in-place update would cause a collision if both old and new entries share the same title. The command uses a `forget`-first pattern: delete the old entry, then `remember` the updated content.

**Safe deletion**: all `forget` calls pass both `title` and `type` to avoid accidental deletion when two memories share the same title but have different types.

### Usage

```
/dako:memory-audit
```

No arguments. Run from any project directory with DakoHarness configured. Works through each pass interactively. Prints a summary at the end:

```
Audit complete — 2 duplicate(s) merged, 3 stale resolved, 1 contradiction(s) resolved.
```

Recommended cadence: monthly on active projects, or after any major refactor.

### Known limitations

None. Review verdict was `pass` with no accepted gaps.

Semantic similarity for deduplication and contradiction detection is based on agent judgment (reading and comparing content), not algorithmic matching. False positives and misses are possible — the per-item confirmation step is the safety net. Embedding-based detection remains in the backlog.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
