---
wi: WI-local-embedding-recall
phase: analyze
status: confirmed
date: 2026-05-26
---

## Requirements

### Functional
1. New env var `DAKO_EMBEDDING_MODEL` controls the embedding model; defaults to `Xenova/all-MiniLM-L6-v2` (384-dim).
2. Model is downloaded lazily on first use to `node_modules/.cache/transformers/` (Transformers.js default cache).
3. Each `memories` row gains two new fields: `embedding` (Float32 raw bytes — 4 × dim) and `embedding_model` (string — the model id that produced the vector). Both nullable.
   - SQLite: `embedding BLOB`, `embedding_model TEXT` columns.
   - MongoDB: `embedding: Binary subtype 0`, `embedding_model: string` fields.
4. `remember` (MCP tool) inline-embeds `title + "\n" + content` at insert time. The vector and the current `DAKO_EMBEDDING_MODEL` value are written to the new fields. On embed failure (model load error, OOM, etc.), the memory is still inserted with `embedding = null`, a warning is logged to stderr, and the tool returns success.
5. `recall` (MCP tool) accepts a new optional `mode: "keyword" | "vector" | "hybrid"` arg. Defaults to auto-detect: hybrid if any memory in the project's `memories` has a non-null `embedding` matching the current `DAKO_EMBEDDING_MODEL`; keyword otherwise. Explicit `mode: "vector"` errors when no matching embeddings exist.
6. `recall` also accepts an optional `embedding: Buffer | Float32Array` so a caller (e.g. the `/recall` skill) can pre-compute the query embedding and avoid double-embedding on the server.
7. Hybrid scoring: Reciprocal Rank Fusion (RRF) with k=60, equal weights, top (2 × limit) candidates fetched per side, final result list capped at the caller's `limit`. RRF score formula: `score = sum_over_sides( 1 / (k + rank_on_that_side) )`.
8. Single-side fallback: if one side of the hybrid returns 0 candidates, the other side's ranking is used directly (no RRF math needed). If both return 0, the result is empty (same as today's keyword-only behavior).
9. Vector search implementation: in-process cosine similarity over Float32 buffers in both adapters. No reliance on Atlas `vectorSearch` index or `sqlite-vec` extension in v1.
10. Rows with `embedding_model` ≠ current `DAKO_EMBEDDING_MODEL` are skipped by the vector half of recall (treated as having no embedding). They remain searchable via the FTS/`$text` keyword half.
11. New `npm run embed-backfill` script. For each `memories` row across the configured backend: if `embedding_model == DAKO_EMBEDDING_MODEL`, skip; else embed `title + "\n" + content` and store the result + model id. Streamed per-batch progress; final summary table (rows-read, embedded, skipped, errors, duration).
12. Backfill flags: `--dry-run` (read-only, prints plan), `--force` (re-embed every row, ignoring current `embedding_model`). Default: idempotent skip-already-embedded.
13. The `/recall` skill keeps its agent-side query-expansion behavior for the keyword side (up to 5 paraphrased variants drive the FTS half of hybrid). The vector half embeds the user's original query once and runs a single vector search. Skill computes the query embedding agent-side and passes `embedding` to the MCP `recall` tool to avoid double-embedding.

### Non-functional
- Zero regression for users who never run backfill and never restart with the new code path active. With no embeddings present, recall behaves byte-identically to today's keyword-only output.
- Cold-start latency: first embed after MCP boot loads the model (~1–3s on CPU). Subsequent embeds are ~50–200ms on typical hardware.
- Vector storage overhead: 384-dim float32 = 1536 bytes per memory + ~30 bytes for the model id string. Well within sensible bounds for the expected memory volumes (thousands, not millions).
- Single new runtime dependency: `@xenova/transformers` (Node-compatible Transformers.js fork) — peer-free, ONNX-Runtime-backed, CPU-only by default.

## Out of Scope
- Native vector index integrations (Atlas `vectorSearch`, `sqlite-vec` extension). Forward-compat: the float32 BLOB layout will be directly usable by both indexes if a future workitem adds them.
- GPU/CUDA acceleration. Transformers.js runs CPU/ONNX.
- Cross-encoder re-ranking on top of hybrid retrieval.
- Multilingual / cross-language search. User can configure a multilingual model via `DAKO_EMBEDDING_MODEL` but default is English-tuned.
- Embedding short-term-memory patterns (STM stays keyword-only Go FTS5 by design).
- Embedding the `workitems` archive collection (only `memories` gets vectors in v1).
- A `forget`-by-similarity or cluster-merge feature on top of memory-audit. Audit may benefit from embeddings later; out of this WI's scope.
- User-supplied vectors via the `remember` MCP tool (the tool computes the embedding itself; callers do not pass vectors in).

## Open Questions
1. **Backfill batch size.** Lean: 32 rows per batch — typical MiniLM throughput on CPU. Pin in plan.
2. **Where the Transformers.js singleton lives.** Lean: new shared module `mcps/mongodb-memory/embed.ts` exporting `embedTexts(strs: string[]): Promise<Float32Array[]>` and `getModelId(): string`. Imported by both adapters and the backfill script. Pin in plan.
3. **Model pre-warm on MCP startup.** Lean: on-demand only (lazy), with a one-line `[embed] loading <model>…` log when the model first loads, so the latency is visible. Pin in plan.

## Acceptance Criteria
- [ ] **AC-1** — Adding `DAKO_EMBEDDING_MODEL` to `.env` (default `Xenova/all-MiniLM-L6-v2`) selects the embedding model. First call to embed lazy-downloads it to the Transformers.js cache. Unset / absent → default model used; no error.
- [ ] **AC-2** — Both adapters store a vector per memory: SQLite `embedding BLOB` + `embedding_model TEXT` columns added via idempotent `ALTER TABLE` on startup; MongoDB writes `embedding` (Binary subtype 0) + `embedding_model` (string) fields on insert. Existing rows without these fields/columns remain readable.
- [ ] **AC-3** — `remember` embeds `title + "\n" + content` at insert time and stores `embedding` + `embedding_model = DAKO_EMBEDDING_MODEL`. On embed failure: the memory is still inserted with `embedding = null` and `embedding_model = null`, a warning is written to stderr, and the tool returns its normal success ToolResult.
- [ ] **AC-4** — `recall` accepts optional `mode: "keyword" | "vector" | "hybrid"` and optional `embedding: Buffer | Float32Array`. Default `mode` auto-detects: `hybrid` if any row in `memories` for the project has `embedding_model == DAKO_EMBEDDING_MODEL` and a non-null `embedding`, else `keyword`. `mode: "vector"` when no matching embeddings exist throws a clear error mentioning the backfill command. Omitting `embedding` causes the server to compute it from `query` (single embed); supplying it skips that step.
- [ ] **AC-5** — Hybrid mode: fetch top (2 × limit) candidates from FTS side and from vector side; merge with RRF score `1/(60+rank_fts) + 1/(60+rank_vec)` (rank = 1 for top, ∞ for absent); sort descending; return top `limit`.
- [ ] **AC-6** — Single-side fallback: if either FTS or vector returns 0 candidates, the other side's order is used directly (no RRF), still capped at `limit`. If both return 0, return the existing "no memories found" message.
- [ ] **AC-7** — Vector search uses in-process cosine similarity over Float32 buffers in both adapters. No `sqlite-vec` or Atlas `vectorSearch` dependency. Works on the default `docker-compose.yml` single-node Mongo and on bare SQLite.
- [ ] **AC-8** — Rows whose `embedding_model` does not equal the current `DAKO_EMBEDDING_MODEL` are excluded from vector-side candidate fetch. They remain present in FTS results. Mixed-model state is therefore graceful: nothing crashes; recall degrades cleanly for those rows.
- [ ] **AC-9** — `npm run embed-backfill` (no args) walks every `memories` row in the configured backend. For each row: skip if `embedding_model == DAKO_EMBEDDING_MODEL`; else embed and write `embedding` + `embedding_model`. Streams per-batch progress; prints final summary with rows-read, embedded, skipped, errors, total duration.
- [ ] **AC-10** — Backfill flags: `--dry-run` (read-only; prints counts and exits 0 with no writes); `--force` (re-embeds every row regardless of `embedding_model`). Unrecognized flags exit non-zero with usage.
- [ ] **AC-11** — Backfill is idempotent without `--force`: a second invocation on a fully-embedded database completes in milliseconds (count check only) and reports `0 embedded, N skipped`.
- [ ] **AC-12** — `/recall` skill: keyword variants still drive the FTS half via the existing query-expansion behavior. For each `recall` MCP call, the skill computes the query embedding once on the original (un-expanded) query and passes it via the new `embedding` arg so the server does not embed again.
- [ ] **AC-13** — `Storage.recall` keeps its current signature back-compat: callers supplying neither `mode` nor `embedding` get exactly today's keyword-only behavior (modulo the auto-detect upgrade once embeddings exist).
- [ ] **AC-14** — Tests cover: inline embed happy path; embed-failure graceful insert; auto-detect mode selection (none vs some embeddings present); RRF merge math on synthetic ranked inputs; single-side fallback; model-mismatch skip in vector half; backfill idempotent re-run; backfill `--force`; backfill `--dry-run`; `mode: "vector"` errors with helpful message when no embeddings exist. Test isolation: the embed function is wrapped so tests can stub it without loading the real model (avoids ~30MB download in CI).

## Interview Notes
- Model selection: user picked configurable via env with lazy download (Recommended). Keeps the fast path simple while letting power users switch to larger models like `bge-small-en` if they want.
- Vector encoding: float32 raw bytes (Recommended). Compact (~3× smaller than JSON arrays), encoder-agnostic, forward-compat with future native vector indexes that consume the same byte layout.
- Embed timing: inline on `remember` + one-shot backfill (Recommended). Latency cost (~50–200ms) judged acceptable for `remember`'s call frequency. Failure mode pinned: insert succeeds without embedding, warning logged.
- Hybrid scoring: RRF k=60 equal weights, 2× candidate fetch per side (Recommended). Standard from the IR literature; no tuning surface in v1.
- Model-change handling: tag each row with the model id; vector half ignores mismatched rows (Recommended). Avoids the "start refuses to load" UX cliff while keeping recall semantically correct.
- Backfill rerun: skip-already-embedded; `--force` for re-embed (Recommended). Mirrors the migrator's idempotency design.
- Default recall behavior: auto-detect (Recommended). Zero behavior change until embeddings exist; just-works after backfill.
- Query expansion interaction: keep expansion for FTS side; embed original query once for vector side (Recommended). Minimal extra latency; preserves the existing keyword-side robustness.

## Sign-off
**Confirmed by user:** yes
**Date:** 2026-05-26
