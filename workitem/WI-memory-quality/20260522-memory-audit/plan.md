---
wi: WI-memory-quality/20260522-memory-audit
phase: plan
status: confirmed
date: 2026-05-22
approach: New list_memories MCP tool + /dako:memory-audit skill command
---

## Context
**Selected approach:** New `list_memories` MCP tool + `/dako:memory-audit` skill command
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8

## Implementation Sequence

### Step 1 — Add list_memories tool to server.js
**Satisfies:** AC-1
**Files:** `mcps/mongodb-memory/server.js`
**Description:** Add `list_memories` to both the `ListToolsRequestSchema` tools array (schema) and the `CallToolRequestSchema` handler (implementation), following the exact same pattern as all existing tools.

Schema:
- `project` (string, required)
- `type` (string, optional — enum of MEMORY_TYPES)
- `limit` (number, optional, default 200)

Handler: `db.collection("memories").find({ project [, type] }).sort({ timestamp: 1 }).limit(limit)` — sorted oldest-first (useful for staleness pass). Returns documents with fields: `_id`, `type`, `title`, `content`, `timestamp`, `scope`.

Why `timestamp` not `created_at`: `remember` writes `timestamp: new Date()` — that is the creation field.

### Step 2 — Write /dako:memory-audit command
**Satisfies:** AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8
**Files:** `commands/memory-audit.md`, `.claude/commands/memory-audit.md`, `claude-plugin-release/commands/memory-audit.md`
**Description:** Skill file with three sequential passes. All three files identical — follows the doctor/checkpoint pattern.

**Pass 1 — Deduplication (AC-3, AC-6, AC-8):**
1. Call `list_memories(project, limit: 200)`
2. Read all returned memories; identify near-duplicate pairs by agent judgment (same type, similar title or content)
3. For each pair: show both to user, recommend which to keep and why, wait for confirmation
4. On confirm: call `forget(project, title, type)` on the discarded entry
5. If no duplicates found: report "No duplicates found" and proceed

**Pass 2 — Staleness (AC-4, AC-6, AC-8):**
1. From the `list_memories` result, filter entries where `timestamp` is older than 90 days from today
2. For each stale memory: show content and age, offer keep / update / delete
3. On "keep": skip
4. On "delete": call `forget(project, title, type)`
5. On "update": ask for new content, call `forget` first (to avoid same-title collision), then call `remember` with updated content
6. If none older than 90 days: report "No stale memories found" and proceed

**Pass 3 — Contradictions (AC-5, AC-6, AC-8):**
1. From the `list_memories` result, group by type; read all entries and identify pairs with conflicting claims (agent judgment)
2. For each conflict: show both memories, explain the contradiction, propose resolution (keep A / keep B / keep both / delete both)
3. On confirm: execute `forget` on whichever entries are to be removed
4. If no contradictions found: report "No contradictions found" and proceed

**Summary (AC-7):** After all three passes, print: "Audit complete — X duplicate(s) merged, Y stale resolved, Z contradiction(s) resolved."

## Risks / Known Unknowns

- **`forget` deletes by title — not unique**: if two memories share the same title, `forget` hits both. Mitigation: always pass `type` alongside `title` in `forget` calls from the audit command to narrow the match. Note this in the command file.
- **Large memory sets**: default limit of 200 may miss entries on very active projects. Acceptable for now — can be raised by the user if needed.
- **Agent judgment quality**: duplicate and contradiction detection relies on agent reading and comparing — no algorithmic guarantee. False positives and misses are possible; the confirmation step (AC-6) is the safety net.

## Confirmation
**Confirmed by user:** yes
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
