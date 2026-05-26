---
wi: WI-local-embedding-recall
created: 2026-05-26
updated: 2026-05-26
status: active

---

## Current State

**Current phase:** repo
**Blocked:** no

## Sub-features

| Sub-feature | Status | Phases completed |
|---|---|---|
| 20260526-embedding-backend | in-progress | intake, analyze, plan, implementation, review, document |

## Active Blockers

| # | Description |
|---|---|

## Key Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-26 | Default model `Xenova/all-MiniLM-L6-v2`, configurable via `DAKO_EMBEDDING_MODEL`, lazy download | Small (~30MB), 384-dim, English-tuned; env override keeps power-user flexibility |
| 2026-05-26 | Vector storage = Float32 raw bytes (SQLite BLOB, MongoDB Binary subtype 0) | Compact (3× smaller than JSON), encoder-agnostic, forward-compat with native vector indexes |
| 2026-05-26 | Inline embed on `remember` + one-shot backfill for existing rows; embed-failure → insert without embedding, warn | New memories get semantic recall immediately; failures degrade gracefully |
| 2026-05-26 | Hybrid = RRF k=60, equal weights, 2× candidate fetch per side; single-side fallback | Standard IR-literature recipe; no tuning surface in v1 |
| 2026-05-26 | Tag each embedding with model id; mismatched rows excluded from vector half, kept in FTS | Avoids "refuse to start" UX cliff while keeping recall correct after model swap |
| 2026-05-26 | Backfill idempotent (skip-already-embedded), `--force` re-embeds, `--dry-run` plans | Mirrors the migrator's idempotency model; safe to re-run |
| 2026-05-26 | Default `recall` mode auto-detects: hybrid if embeddings exist, else keyword | Zero regression for users who haven't backfilled; just-works after backfill |
| 2026-05-26 | `/recall` skill: keep keyword variants for FTS half; embed original query once for vector half | Minimal extra latency on top of existing expansion; preserves keyword-side robustness |
| 2026-05-26 | In-process cosine over Float32 buffers in both adapters; no sqlite-vec / Atlas vectorSearch dep | Default docker-compose Mongo is single-node and bare SQLite has no vec extension — must work without native indexes |
| 2026-05-26 | Shared `embed.ts` module + `DAKO_EMBED_STUB=1` test seam | Avoid 30MB model download in CI; deterministic fake exercises every code path |
| 2026-05-26 | New `embed_query` MCP tool so the `/recall` skill can fetch the query embedding once | Agent can't run Transformers.js; needs an explicit server-side hook to honor AC-12's "embed once, reuse across variants" |
| 2026-05-26 | Backfill uses per-batch error isolation (continue on chunk failure) instead of migrator's abort-and-rollback | Backfill is idempotent and repeatable — partial progress + retry is safer than rollback |
| 2026-05-26 | Mongo candidate-fetch capped at `max(500, 2×limit)` | Bounded memory for in-app cosine; large collections degrade gracefully |
| 2026-05-26 | wi-implement dispatch #1 for 20260526-embedding-backend | initial |
| 2026-05-26 | wi-implement dispatch #2 for 20260526-embedding-backend | post-session-limit-resume (dispatch #1 wrote Architecture Notes then session reset) |

## Parking / Cancellation

