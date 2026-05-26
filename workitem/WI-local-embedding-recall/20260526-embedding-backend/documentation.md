---
wi: WI-local-embedding-recall
phase: documentation
status: confirmed
date: 2026-05-26
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `README.md` | Roadmap → Backlog table | Removed the "Local embedding model for recall" row (shipped). |
| `obsidian-docs/Roadmap.md` | Backlog table | Same removal as README. |
| `obsidian-docs/Memory System.md` | New section `## Vector recall (embeddings)` inserted between "Migrating from SQLite to MongoDB" and "When to search" | Documents `DAKO_EMBEDDING_MODEL` env var, hybrid auto-detect, RRF scoring, inline-embed-on-`remember` semantics, the `embed_query` preflight used by the `/recall` skill, the `npm run embed-backfill` script (with `--dry-run` / `--force`), and model-mismatch graceful-degradation behavior. |

## Workitem Documentation

### What was built

Optional local-embedding-backed semantic recall for the long-term memory MCP. Adds a vector path alongside the existing keyword/FTS recall and merges them with Reciprocal Rank Fusion. The embedding model runs in-process via Transformers.js — no external API, no GPU required. Default model: `Xenova/all-MiniLM-L6-v2` (384-dim, ~30MB), configurable via `DAKO_EMBEDDING_MODEL` in `.env`.

Three observable changes:

1. `remember` now embeds the memory's `title + "\n" + content` inline at insert time and stores the vector in the memory row.
2. `recall` accepts a new `mode: "keyword" | "vector" | "hybrid"` arg. Default auto-detects: hybrid when any embedding exists for the current model, keyword otherwise. Existing installs that don't run the backfill see zero behavior change.
3. A new `npm run embed-backfill` script embeds existing memories that pre-date the feature (or that were tagged with a different model). Idempotent, supports `--dry-run` and `--force`.

The `/recall` slash command transparently uses the new path: it preflights an `embed_query` MCP call once on the user's original keywords, then threads the resulting embedding into each variant `recall` call so the server doesn't re-embed.

### How it works

**Storage layout.** Both `MongoStorage` and `SqliteStorage` gained two new fields on the `memories` collection/table:

- `embedding` — Float32 raw bytes (4 × dim). SQLite stores it as `BLOB`; MongoDB stores it as `Binary` (subtype 0). Encoder-agnostic — the same byte layout will be directly usable by future native vector indexes (Atlas `vectorSearch`, `sqlite-vec`) if a follow-up workitem adds them.
- `embedding_model` — string. The model id that produced the vector. Used by the vector half of `recall` to skip rows whose embeddings came from a different model, so swapping `DAKO_EMBEDDING_MODEL` is graceful.

Existing rows without these fields/columns remain readable — the vector half of recall filters them out via `WHERE embedding IS NOT NULL`.

**Schema migration.** Idempotent. SQLite gains the two columns via `ALTER TABLE memories ADD COLUMN …`, wrapped in a helper that absorbs the "duplicate column name" error on subsequent runs. MongoDB just gains one new index — `{ embedding_model: 1 }` — for fast mismatch-skip queries.

**Hybrid scoring.** `recall` in hybrid mode fetches `Math.max(2 × limit, 1)` candidates per side (FTS and vector), merges them with RRF score `1 / (60 + rank_fts) + 1 / (60 + rank_vec)` (rank = 1 for top, 0 contribution if absent on that side), sorts descending, and returns the top `limit`. Single-side fallback: if either side returns 0 candidates, the other side's order is used directly with no RRF math. Both empty → today's "no memories found" message.

**Vector storage size.** 384-dim Float32 = 1536 bytes per memory + ~30 bytes for the model-id string. Easily fits typical DakoHarness memory volumes (thousands, not millions).

**Inline embed failure path.** If `embedTexts` throws (model fails to load, OOM, etc.), `remember` still inserts the memory — with `embedding` and `embedding_model` left null — and writes a stderr warning. The row is searchable via keyword recall but excluded from vector recall. No user-facing error, no data loss.

**Why in-process cosine, not Atlas vectorSearch / sqlite-vec.** The default `mcps/mongodb-memory/docker-compose.yml` is standalone (no replica set, no Atlas), and bare SQLite has no vector extension. Both adapters compute cosine in-app over Float32Arrays so the feature works on the default install with zero extra setup. The Mongo candidate fetch is capped at `max(500, 2 × limit)` to keep memory bounded on large collections; in-app cosine is more than fast enough for the volumes DakoHarness sees.

**`embed_query` MCP tool.** The `/recall` skill needs to embed the user's original (un-expanded) query once and pass it to every keyword-variant `recall` call. Because skills are Claude prompts — not Node code — they can't run Transformers.js themselves. The `embed_query` MCP tool gives the skill a server-side way to compute the embedding once and hand it back as a base64 Float32 buffer. The skill stores that buffer and threads it through the variant loop.

**Test seam.** The whole test suite runs with `DAKO_EMBED_STUB=1`, which makes `embedTexts` skip Transformers.js entirely and return a deterministic FNV-1a-folded fake vector. CI never downloads the ~30MB model, tests stay fast, and the deterministic stub lets tests hand-construct expected RRF orderings.

### Usage

**Existing install with stored memories — turn on semantic recall:**

```bash
cd mcps/mongodb-memory
npm run embed-backfill -- --dry-run     # see how many rows would be embedded
npm run embed-backfill                  # embed them
```

The default model downloads on the first `embed-backfill` call (or first `remember`, whichever fires first). After the backfill, `recall` auto-upgrades to hybrid mode for that project.

**Switching to a different embedding model:**

```bash
# 1. Update .env:
#    DAKO_EMBEDDING_MODEL=Xenova/bge-small-en-v1.5
# 2. Re-embed everything against the new model:
npm run embed-backfill -- --force
```

The `--force` flag re-embeds every row regardless of its existing `embedding_model`. Without it, the backfill is idempotent and only embeds rows missing the current model's vectors.

**Mixed-model state.** If you change `DAKO_EMBEDDING_MODEL` and don't run `--force`, the new model embeds only future-inserted memories. Old rows keep their previous-model embeddings; the vector half of recall skips them silently (they remain searchable via the FTS half). Nothing crashes. Recall quality degrades only for the mismatched subset until you re-embed.

**Forcing a recall mode (debugging, comparison):**

```javascript
// MCP tool call
recall({ project: "my-project", query: "...", mode: "keyword" })   // FTS only
recall({ project: "my-project", query: "...", mode: "vector"  })   // vector only
recall({ project: "my-project", query: "...", mode: "hybrid"  })   // RRF merge
recall({ project: "my-project", query: "..." })                    // auto-detect (default)
```

`mode: "vector"` errors with a helpful message if no embeddings exist for the current model — the error names the backfill command.

### Known limitations

- **No native vector index in v1.** In-app cosine over Float32 buffers works for the typical DakoHarness volume (thousands of memories per project). For very large collections, the Mongo candidate fetch is capped at 500 rows, which means vector accuracy degrades past that point. Atlas `vectorSearch` / `sqlite-vec` integration is reserved as forward-compat — the byte layout already matches both.
- **CPU-only inference.** Transformers.js runs ONNX on CPU. First embed after MCP boot takes ~1–3s for model load; subsequent embeds are ~50–200ms. No GPU/CUDA in v1.
- **STM and workitems collections are not embedded.** Only the `memories` collection has vectors. Short-term memory stays keyword-only (Go MCP, 7-day TTL). The `workitems` archive collection has no semantic-search demand worth the storage overhead.
- **English-tuned default model.** `Xenova/all-MiniLM-L6-v2` is English-only. Users on multilingual content should set `DAKO_EMBEDDING_MODEL` to a multilingual variant and re-backfill.
- **No real-model integration test in CI.** Tests use the deterministic stub. Real-model quality is a manual smoke test post-merge; the stub exercises every code path but doesn't validate semantic relevance.
- **`/recall` skill behavior not auto-tested.** Slash-command logic is markdown the agent reads; no automated test asserts the agent threads the `embedding` arg correctly. Same gap as the previous `/recall` query-expansion shipment — verified by inspection.

## Confirmation
**Confirmed by user:** yes
**Notes:** Signed off 2026-05-26.

## Cancellation
*(Fill only if status: cancelled)*
