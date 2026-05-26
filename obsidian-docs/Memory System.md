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

### Migrating from SQLite to MongoDB

If you started on SQLite and later want to switch to MongoDB without losing stored memories, workitems, sessions, or messages, run the one-shot migrator inside the long-term memory MCP:

```bash
cd mcps/mongodb-memory
npm run migrate                  # full migration
npm run migrate -- --dry-run     # preflight: prints plan, makes no writes
```

What it does:

- Reads `mcps/mongodb-memory/.env` for both source and target connection settings (`DAKO_SQLITE_PATH`, `MONGO_URI`, `MONGO_DB`).
- Copies all four collections (`memories`, `workitems`, `sessions`, `messages`) per the field-mapping spec in `storage/Storage.ts`. Dedupes by natural key, so any MongoDB rows that already match are skipped — the run is idempotent.
- On success: rewrites `DAKO_STORAGE_BACKEND` in `.env` to `mongodb` (preserving comments, blank lines, line endings, and quoting), then renames the SQLite file to `<basename>.bak-<unix-timestamp>` as a safety net.
- On any failure (driver error, verification mismatch, `.env` rewrite failure, rename failure): every document inserted by the run is deleted, `.env` is left or reverted to `sqlite`, and the SQLite file stays in place. Re-run safely.

Pre-flight: if `.env` already says `mongodb` (or the key is unset, which is equivalent), the tool exits 0 with a no-op message. Safe to re-run after success.

Stop the long-term MCP before running the migration so it does not write to either backend mid-run.

---

## Vector recall (embeddings)

The long-term memory MCP supports optional local embeddings for semantic recall on top of the keyword/FTS path. Embedding is computed in-process via Transformers.js — no external service required.

### Configuration

| Env var | Default | Effect |
|---|---|---|
| `DAKO_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Selects the embedding model. First call lazy-downloads it to `node_modules/.cache/transformers/`. |

The default model is 384-dim, English-tuned, ~30MB. Power users can switch to larger or multilingual variants (e.g. `Xenova/bge-small-en-v1.5`, `Xenova/paraphrase-multilingual-MiniLM-L12-v2`) by setting this env var.

### How `recall` uses embeddings

`recall` accepts a `mode: "keyword" | "vector" | "hybrid"` arg. Default is **auto-detect**: hybrid if any memory in the project has an embedding matching the current `DAKO_EMBEDDING_MODEL`, keyword otherwise. Existing setups without embeddings see zero behavior change until you run the backfill.

Hybrid scoring uses **Reciprocal Rank Fusion** (k=60, equal weights, 2× limit candidates per side) to merge FTS and vector results. Single-side fallback: if one side returns zero candidates, the other side's order is used directly.

New memories are embedded inline at `remember` time. If embedding fails (model load error, OOM), the memory is still stored — with no embedding — and a stderr warning is logged. That row is searchable via keyword recall but skipped by vector recall.

The `/recall` skill preflights once via the `embed_query` MCP tool so the keyword variants all reuse the same query embedding for their vector halves.

### Backfilling existing memories

To embed memories that pre-date this feature (or after switching the model), run:

```bash
cd mcps/mongodb-memory
npm run embed-backfill                  # embed every row whose model doesn't match
npm run embed-backfill -- --dry-run     # preflight: prints plan, makes no writes
npm run embed-backfill -- --force       # re-embed every row regardless of current model
```

Idempotent: re-running on a fully-embedded database completes in milliseconds and reports `0 embedded, N skipped`. Per-batch error isolation means a single failure doesn't abort the run.

### Model mismatch handling

Each embedding is tagged with the model id that produced it. Rows whose `embedding_model` differs from the current `DAKO_EMBEDDING_MODEL` are excluded from the vector half of recall but remain searchable via the FTS half. Switching models is graceful — no crash, no required migration — but vector recall quality degrades for mismatched rows until you run `npm run embed-backfill --force`.

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
