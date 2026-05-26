---
wi: WI-local-embedding-recall
phase: intake
status: confirmed
date: 2026-05-26
---

## Request

Local embedding model for recall: add an optional embedding backend (Transformers.js with `Xenova/all-MiniLM-L6-v2` as the default model) so `/recall` can do true semantic search instead of just keyword + agent-side query expansion.

Use the AC-9 extension points already reserved in `Storage.ts` (`RecallArgs.embedding`, `mode: "keyword" | "vector" | "hybrid"`) and the SQLite `embedding BLOB` column reservation.

Default mode = hybrid (FTS5/`$text` + cosine, RRF-merged). One-shot backfill script embeds every existing memory's `title + content`. Both `MongoStorage` and `SqliteStorage` adapters get vector storage and search; on standalone Mongo (single-node `docker-compose` default) and SQLite we use in-app cosine if no native vector index is available.

## Classification

- **Type:** new feature
- **Scope:** `mcps/mongodb-memory/` — `Storage.ts` (fill AC-9 extension), `MongoStorage.ts` + `SqliteStorage.ts` (vector storage + search), new embedding helper module, one-shot backfill script, `/recall` skill behavior. Cross-cuts the runtime `recall` path and adds a new dependency (Transformers.js).

## Routing Decision

- **Flow:** Full workflow
- **Rationale:** Multi-touch behavior change. Decisions to pin in analyze/plan: model identity and pinning, vector storage encoding (float32 BLOB / base64 / sqlite-vec extension), hybrid scoring scheme (RRF k-value, weights), backfill semantics (re-runnable, model-change detection, dedup), first-run model-download UX, and the in-app cosine fallback for standalone Mongo + SQLite without native vector index.
- **Phases:** intake → analyze → propose (conditional) → plan → implement → review → document → repo → archive

## Confirmation

Confirmed by user → yes

## Cancellation

