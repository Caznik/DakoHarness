---
name: memory-audit
description: Audit long-term memories for the current project — deduplicate, flag stale (90+ days), and resolve contradictions. Agent proposes every change; user confirms before anything is deleted or modified.
---

## When to use
Run periodically on long-lived projects to keep long-term memory accurate and noise-free. All three passes run in sequence. No change is made without explicit user confirmation.

## Steps

### Setup
- Determine `project`: basename of cwd (or `DAKO_PROJECT` env var if set)
- Call `list_memories` with `project` and `limit: 200`
- Hold the full result in memory for all three passes — do not call `list_memories` again

Initialize counters: `duplicates_merged = 0`, `stale_resolved = 0`, `contradictions_resolved = 0`

---

### Pass 1 — Deduplication

1. Read all returned memories. Group by `type`.
2. Within each type group, identify pairs that appear to be near-duplicates: same or very similar `title`, or `content` that covers the same ground.
3. For each candidate pair:
   - Show both entries to the user (type, title, content, age)
   - Recommend which to keep and briefly explain why (e.g., more complete content, more recent, better phrasing)
   - Ask: "Keep A and delete B, keep B and delete A, or keep both?"
   - On "keep A, delete B": call `forget(project, title_B, type)` → increment `duplicates_merged`
   - On "keep B, delete A": call `forget(project, title_A, type)` → increment `duplicates_merged`
   - On "keep both": skip
4. If no duplicates found: print "Pass 1: No duplicates found." and continue

> Always pass `type` to `forget` alongside `title` to avoid accidental deletion when titles are ambiguous.

---

### Pass 2 — Staleness (90-day threshold)

1. From the `list_memories` result, identify entries where `age_days >= 90`.
2. For each stale memory (oldest first):
   - Show: type, title, content, age in days
   - Ask: "Keep as-is, update content, or delete?"
   - On "keep": skip
   - On "delete": call `forget(project, title, type)` → increment `stale_resolved`
   - On "update": ask for the corrected content, then:
     1. Call `forget(project, title, type)` first (removes the old entry)
     2. Call `remember(project, "claude-code", type, title, new_content)` (creates updated entry)
     → increment `stale_resolved`
3. If no memories are 90+ days old: print "Pass 2: No stale memories found." and continue

---

### Pass 3 — Contradiction Detection

1. From the `list_memories` result, group by `type`. Read all entries within each type.
2. Identify pairs whose `content` makes conflicting claims about the same subject.
3. For each conflict:
   - Show both entries (type, title, content)
   - Explain the contradiction clearly
   - Propose a resolution: keep A / keep B / keep both (add clarification) / delete both
   - Wait for user confirmation
   - Execute: call `forget` on whichever entries are to be removed; if "keep both with clarification", call `forget` on both then `remember` with merged/clarified content
   → increment `contradictions_resolved` for each conflict resolved
4. If no contradictions found: print "Pass 3: No contradictions found." and continue

---

### Summary

Print:

```
Audit complete — X duplicate(s) merged, Y stale resolved, Z contradiction(s) resolved.
```
