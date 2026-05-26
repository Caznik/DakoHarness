---
wi: WI-sqlite-to-mongo-migration
phase: analyze
status: confirmed
date: 2026-05-26
---

## Requirements

### Functional
1. New `npm run migrate` script lives in `mcps/mongodb-memory/package.json`.
2. Migrates all four LTM collections from a SQLite backend to MongoDB: `memories`, `workitems`, `sessions`, `messages`.
3. Field translation follows the AC-10 field-mapping table in `storage/Storage.ts` (JSON-decode `tags`, ISO-8601 → `Date`, generate new ObjectIds).
4. Reads connection settings from `mcps/mongodb-memory/.env` only: `DAKO_SQLITE_PATH`, `MONGODB_URI`, `DAKO_DB`, `DAKO_STORAGE_BACKEND`.
5. Merge semantics: dedupe by natural key — never insert a row whose natural key already exists in Mongo. Natural keys:
   - `memories` = `(project, agent, type, title)`
   - `workitems` = `wi_path`
   - `sessions` = `session_id`
   - `messages` = `(session_id, seq)`
6. Atomicity: abort-and-rollback. On any failure, every document the migrator inserted is removed, `.env` is not modified, source SQLite is not renamed.
7. Verification: per-collection, `rows_read_from_sqlite == rows_inserted + rows_skipped_by_dedup`. Mismatch is treated as failure (triggers rollback).
8. `--dry-run` flag: read SQLite, compute per-collection insert/skip counts, print plan, write nothing.
9. On success (non-dry-run), the tool rewrites `DAKO_STORAGE_BACKEND` in `mcps/mongodb-memory/.env` to `mongodb`, preserving other lines, comments, and ordering. If the key is missing, it is appended.
10. On success (non-dry-run), the source SQLite file is renamed to `<basename>.bak-<unix-timestamp>` in place.
11. Pre-flight: if `DAKO_STORAGE_BACKEND` in `.env` is `mongodb` (or absent — same default), abort with a clear "already on mongodb; nothing to migrate" message.
12. Output: per-collection streamed progress (e.g. `[memories] inserted 412, skipped 20 (432/432) ✓`) and a final summary table (rows-read, inserted, skipped, duration per collection) plus the `.env` line rewritten and the `.bak` filename.
13. Exit code: 0 on full success (including no-op for an empty SQLite), non-zero on any failure.

### Non-functional
- Re-runnable: invoking after success aborts safely at the pre-flight (Req-11). Invoking after a rolled-back failure is safe (dedup absorbs any leftovers in the rare partial-rollback edge case).
- No new runtime dependencies beyond what `MongoStorage` and `SqliteStorage` already use (`mongodb` driver, `better-sqlite3`).
- Implementation uses the existing adapters where natural; raw driver access is acceptable inside the migrator for bulk operations.

## Out of Scope
- Reverse direction (mongodb → sqlite).
- Other backends (PostgreSQL etc.).
- Continuous sync / replication.
- Embedding/vector column migration (none exists in SQLite yet — AC-9 of WI-pluggable-memory-backend is forward-compat only).
- Per-project / per-type filtering — migrate everything in the SQLite file.
- Backup file management — the `.bak-<timestamp>` lives until the user deletes it.
- Concurrent-MCP protection — user is responsible for stopping the running MCP before migrating (will be in docs).

## Open Questions
1. **Rollback mechanism on standalone Mongo.** Mongo multi-document transactions require a replica set. The default `docker-compose.yml` in `mcps/mongodb-memory/` is single-node. Plan-phase decision: either (a) require replica set, or (b) implement manual rollback by tracking inserted `_id`s and deleting them on failure. Default lean: (b), since most local Docker setups are single-node.
2. **What if `mcps/mongodb-memory/.env` is missing?** Default lean: abort with a clear message naming the expected path.
3. **CRLF-vs-LF on `.env` rewrite.** Should preserve the file's existing line-ending style. Plan-phase nit.

## Acceptance Criteria
- [ ] **AC-1** — `npm run migrate` (no args) inside `mcps/mongodb-memory` reads `.env` and migrates all four collections from the configured SQLite database to the configured MongoDB database.
- [ ] **AC-2** — Connection settings are read only from `mcps/mongodb-memory/.env`. Missing required keys (`DAKO_SQLITE_PATH`, `MONGODB_URI`, `DAKO_DB`) cause a non-zero exit with a message naming the missing key. If `.env` itself is absent, exit non-zero with the expected path in the message.
- [ ] **AC-3** — Field translation conforms exactly to the AC-10 table in `storage/Storage.ts`: `tags` is JSON-parsed back into an array, ISO-8601 strings become `Date`, and new `_id` ObjectIds are generated (SQLite integer rowids are not preserved).
- [ ] **AC-4** — Merge by natural key: a SQLite row is skipped if its natural key already exists in Mongo. Keys per Req-5. Skip counts appear in the per-collection progress line and final summary.
- [ ] **AC-5** — Atomicity: on any failure (driver error, validation error, verification failure, `.env` rewrite failure, `.bak` rename failure), every document inserted by this run is removed from Mongo, `.env` is not modified, and the source SQLite file is not renamed.
- [ ] **AC-6** — Verification: after copy and before flipping `.env`, the migrator asserts `rows_read_from_sqlite == rows_inserted + rows_skipped_by_dedup` for every collection. Mismatch triggers AC-5 rollback.
- [ ] **AC-7** — `--dry-run` flag: reads SQLite, computes per-collection insert/skip plan, prints it, exits 0 without any Mongo writes, without `.env` change, and without renaming SQLite.
- [ ] **AC-8** — On success (non-dry-run), `DAKO_STORAGE_BACKEND=sqlite` in `mcps/mongodb-memory/.env` is rewritten to `DAKO_STORAGE_BACKEND=mongodb`. Other lines, comments, blank lines, and line-ending style (CRLF vs LF) are preserved. If the key is missing, it is appended. Rewrite failure triggers AC-5 rollback.
- [ ] **AC-9** — On success (non-dry-run), the SQLite file at `DAKO_SQLITE_PATH` is renamed to `<basename>.bak-<unix-timestamp>` in place. Rename failure triggers AC-5 rollback (`.env` is reverted).
- [ ] **AC-10** — Pre-flight: if `DAKO_STORAGE_BACKEND` in `.env` is `mongodb`, empty, or unset (all equivalent to "already on mongodb"), the migrator aborts before opening SQLite with a clear message and exit code 0 (idempotent no-op, not an error).
- [ ] **AC-11** — Output: per-collection streamed lines in the form `[<collection>] inserted N, skipped M (N+M/T) ✓` and a final summary table with `read | inserted | skipped | duration` per collection, plus the `.env` line rewritten and the `.bak` filename.
- [ ] **AC-12** — Exit codes: `0` on full success or idempotent no-op (AC-10); non-zero on any failure path.
- [ ] **AC-13** — Re-runnability: a second invocation after success hits the AC-10 pre-flight and exits cleanly. A second invocation after a fully rolled-back failure produces the same result as a first invocation on equivalent data.

## Interview Notes
- User confirmed scope: one-shot migrate (not ongoing sync), with the tool itself flipping `DAKO_STORAGE_BACKEND` so the user doesn't have to.
- Mongo-populated case: user picked **merge** over refuse/replace, accepting that duplicates are possible. Follow-up question pinned **natural-key dedup** as the dedup rule, making merge idempotent.
- Partial failure: user picked **abort-and-rollback** (agent-recommended) — strongest data-integrity guarantee.
- SQLite after success: user picked **rename to `.bak`** (agent-recommended) over delete or leave-as-is, giving a reversible safety net.
- Dry-run: user picked **yes** — useful for preflighting on real data before committing.
- Config source: user picked **mcps/mongodb-memory/.env only** — keeps the tool simple; no CLI overrides for v1.
- Verification: user picked **row counts must match** — cheap and catches the common bug classes; content sampling deferred.
- Output: user picked **per-collection streamed progress + final summary** — visible enough for trust on long runs.

## Sign-off
**Confirmed by user:** yes
**Date:** 2026-05-26
