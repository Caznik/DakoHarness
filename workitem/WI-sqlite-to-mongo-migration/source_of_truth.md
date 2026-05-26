---
wi: WI-sqlite-to-mongo-migration
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
| 20260526-migrate-command | in-progress | intake, analyze, plan, implementation, review, document |

## Active Blockers

| # | Description |
|---|---|

## Key Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-26 | Merge by natural-key dedup (not refuse/replace) | User accepted possible-duplicates risk; natural-key dedup keeps it idempotent |
| 2026-05-26 | Abort-and-rollback on any failure | Strongest data-integrity guarantee for a tool that rewrites `.env` and renames the source DB |
| 2026-05-26 | Rename SQLite to `.bak-<timestamp>` on success | Reversible safety net; prevents the (now-Mongo) MCP from reading stale data |
| 2026-05-26 | Config source = `mcps/mongodb-memory/.env` only, no CLI overrides | Keeps v1 simple; flags can be added later if needed |
| 2026-05-26 | Pre-flight no-op if backend already `mongodb` | Re-runnability with exit 0; not an error |
| 2026-05-26 | Migrator bypasses Storage facade — uses `better-sqlite3` + `mongodb` driver directly | Needs raw row access and `insertedIds` for rollback — not on the interface and shouldn't bloat it |
| 2026-05-26 | Manual rollback (track `insertedIds`, `deleteMany` on failure) over multi-doc transactions | Works on standalone Mongo (default `docker-compose.yml`); transactions require a replica set |
| 2026-05-26 | `.env` rewrite atomic via `.env.tmp` + `renameSync` | Avoids partial-write corruption; rollback path stays clean |
| 2026-05-26 | Failure ordering: `.env` first then SQLite rename, with revert-`.env` if rename fails | Keeps system from landing in `env=mongodb but SQLite still live` state |
| 2026-05-26 | Tests via `node --test` (built-in), skip if Mongo unreachable | No new deps; CI without Mongo still passes |
| 2026-05-26 | wi-implement dispatch #1 for 20260526-migrate-command | initial |

## Parking / Cancellation

