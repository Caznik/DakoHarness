---
tags: [dakoharness, memory]
created: 2026-05-20
---

# Memory System

DakoHarness uses a two-tier memory model. Each tier has a distinct purpose and lifetime.

---

## Two tiers

| Tier | Storage | Scope | TTL | Purpose |
|---|---|---|---|---|
| **Long-term** | MongoDB or SQLite (pluggable) | Project or Team | Permanent | Decisions, conventions, bugs, lessons |
| **Short-term** | SQLite (FTS5) | Project, machine-local | 7 days | Recent patterns, accepted approaches |

---

## Backend selection (long-term tier)

The long-term MCP supports two storage backends selected by the `DAKO_STORAGE_BACKEND` field in `.env`:

| Value | Backend | Prerequisites | Data location |
|---|---|---|---|
| `mongodb` (default) | MongoDB | MongoDB 6+ running (or via Docker) | MongoDB `agent_memory` database |
| `sqlite` | SQLite (FTS5) | Node.js only — no database server | `.dako/memory.db` (same directory as STM patterns) |

**When to use MongoDB:** team setups, shared memory across machines, existing installations.  
**When to use SQLite:** local/solo use, no Docker available, simpler setup.

An unset `DAKO_STORAGE_BACKEND` behaves identically to `mongodb` — existing users see zero change. An invalid value causes the server to exit with a clear error.

Both backends support full-text search (MongoDB `$text` indexes; SQLite FTS5 `BM25` ranking) on memory title+content and workitem documentation.

> [!NOTE]
> Memory is **pull-based** — the agent never preloads memory at session start. It searches only when the task warrants it.

---

## When to search

| Situation | Tool | Tier |
|---|---|---|
| Task feels related to past work | `find_patterns` with keywords | Short-term |
| Need a past decision or convention | `recall` with keywords | Long-term |
| After compaction — check for snapshot | `get_context` (auto-cleanup tag only) | Long-term |
| Search across all projects (team knowledge) | `recall` with `include_team: true` | Long-term |

---

## When to save

### Short-term (`remember_pattern`)

Save when:
- The user explicitly accepts an approach ("yes", "looks good", "do it")
- A bug fix has a reusable pattern
- A code style or convention is established for the first time
- Two approaches were tried and the user picked one

### Long-term (`remember`)

Save when:
- An architectural decision should outlast this week
- A convention is confirmed permanent
- A bug fix reveals a systemic issue
- An important project fact isn't obvious from the code

> [!WARNING]
> Do **not** save routine tool calls, rejected attempts, or anything already derivable from the codebase.

---

## Memory types (long-term)

| Type | Use for |
|---|---|
| `decision` | Architectural or design choice with reasoning |
| `convention` | Naming rule, code style, pattern for this project |
| `bug` | A bug and how it was fixed |
| `context` | Important project fact not obvious from code |
| `lesson` | What went wrong and what was learned |

> [!TIP]
> Always save the **WHY**, not just the what. A memory without reasoning is useless in future sessions.

---

## Memory scope

| Scope | Visible to | Default |
|---|---|---|
| `project` | Only this project | Yes |
| `team` | All projects on the same MongoDB | No — explicit promotion required |

To promote a project memory to team scope: [[Slash Commands#/promote-team]]

---

## Lifecycle: short-term → long-term

```
Session work
    ↓
remember_pattern (short-term, 7-day TTL)
    ↓ if pattern proves durable across sessions
/promote or /session-end
    ↓
remember (long-term, permanent)
    ↓ if broadly applicable beyond this project
/promote-team
    ↓
scope: "team" (searchable across all projects)
```

---

## Related

- [[Session Logging]] — how transcripts are captured
- [[Team Memory]] — cross-project promotion workflow
- [[Slash Commands]] — /recall, /promote, /promote-team, /session-end
