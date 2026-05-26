---
wi: WI-sqlite-to-mongo-migration
phase: documentation
status: confirmed
date: 2026-05-26
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `README.md` | Roadmap → Backlog table | Removed the "SQLite → MongoDB sync" row (the feature is now shipped, no longer backlog). |
| `obsidian-docs/Memory System.md` | Backend selection | Added a new `### Migrating from SQLite to MongoDB` subsection after the pull-based callout. Documents `npm run migrate`, dry-run flag, dedup behavior, `.env`/`.bak` post-conditions, rollback guarantees, pre-flight no-op, and the "stop the MCP first" caveat. |

## Workitem Documentation

### What was built

A one-shot migration tool that moves long-term-memory data from a SQLite backend to MongoDB, then flips the backend selector so the long-term MCP starts using MongoDB on its next launch. The user never has to edit `.env` by hand or copy data manually.

Invoked via:

```bash
cd mcps/mongodb-memory
npm run migrate                  # full migration
npm run migrate -- --dry-run     # preflight only — no writes
```

The tool lives at `mcps/mongodb-memory/migrate.ts`. There is no new `dako` CLI binary; this is just an npm script inside the existing long-term-memory MCP.

### How it works

**Configuration source.** Reads `mcps/mongodb-memory/.env` only (same file the running MCP reads). Required keys: `DAKO_STORAGE_BACKEND` (must be `sqlite` for migration to proceed), `DAKO_SQLITE_PATH`, `MONGO_URI`, `MONGO_DB`. The migrator never accepts CLI flags for these values — keeps the surface area small and matches what the server is going to connect to.

**Pre-flight no-op.** If `DAKO_STORAGE_BACKEND` is empty, unset, or already `mongodb`, the tool exits 0 with `Backend is already mongodb — nothing to migrate.` Re-running after success is therefore safe and silent.

**Reads & translates.** Opens SQLite read-only via `better-sqlite3`. For each of the four tables (`memories`, `workitems`, `sessions`, `messages`) it reads every row and translates fields per the AC-10 mapping in `storage/Storage.ts`:
- Drops the SQLite integer `id` column (Mongo assigns a new `_id` ObjectId on insert).
- `JSON.parse`s the `tags` TEXT column back into an array.
- Converts ISO-8601 TEXT timestamps to JavaScript `Date` objects.

**Dedupes by natural key.** Before inserting, the tool reads existing natural keys from each MongoDB collection and skips any source row that already has a match. Keys:
- `memories` = `(project, agent, type, title)`
- `workitems` = `wi_path`
- `sessions` = `session_id`
- `messages` = `(session_id, seq)`

This makes the run idempotent — re-running on the same data produces the same result, and merging into a MongoDB that already had partial data does not duplicate rows. Within-batch dedup is also applied so duplicates inside the SQLite source don't slip through.

**Inserts and verifies per collection.** For each collection in fixed order (`memories`, `workitems`, `sessions`, `messages`): `insertMany` with `ordered: true`, then a verification step that asserts both `mongo_count_delta == inserted_count` and `read_count == inserted_count + skipped_count`. Any mismatch throws and triggers rollback.

**Atomic rollback.** Standalone MongoDB doesn't support multi-document transactions (the default `docker-compose.yml` is single-node), so the migrator tracks every `ObjectId` it inserts and, on any failure, calls `deleteMany({_id: {$in: ids}})` per collection. Failure paths covered:
- Driver / network error on `insertMany` — partial-success `insertedIds` are captured from the thrown `BulkWriteError` *before* re-throwing, so the rollback finds and deletes them.
- Verification mismatch — already-inserted documents in this and prior collections are deleted.
- `.env` rewrite failure — Mongo rollback runs.
- SQLite rename failure — `.env` is reverted to `sqlite` (since it was already rewritten by then), then Mongo rollback runs.

**`.env` rewrite is atomic and format-preserving.** Writes to `.env.tmp` next to the original, then `renameSync`s over it. Detects CRLF vs LF, preserves blank lines, comments, and the user's quote style (`"mongodb"` / `'mongodb'` / bare). If the `DAKO_STORAGE_BACKEND` key isn't present, it appends.

**Order of post-copy operations.** `.env` rewrite first, then SQLite rename. Rationale: if the rename failed after a successful `.env` rewrite, the system would be in a degenerate state (`.env` says `mongodb` but SQLite is still in place and writable). The rename-failure path reverts `.env` back to `sqlite` before bubbling.

**SQLite is renamed, not deleted.** On success the source file is renamed to `<basename>.bak-<unix-timestamp>` in the same directory. The user can keep it as a backup or delete it manually.

### Usage

**Typical flow:**

1. Stop the running long-term-memory MCP (so it isn't writing to either backend mid-migration).
2. (Optional) preflight: `cd mcps/mongodb-memory && npm run migrate -- --dry-run`. Prints per-collection insert/skip plan. Makes no writes.
3. Run: `npm run migrate`. Watches per-collection progress (`[memories] inserted N, skipped M (N+M/T) ✓`). Final summary table + the `.env` line that was rewritten + the `.bak` filename.
4. Restart the long-term-memory MCP. It now reads from MongoDB.

**Output (truncated):**
```
[memories] inserted 412, skipped 20 (412+20/432) ✓
[workitems] inserted 12, skipped 0 (12+0/12) ✓
[sessions] inserted 34, skipped 0 (34+0/34) ✓
[messages] inserted 1284, skipped 0 (1284+0/1284) ✓

Summary
collection  | read | inserted | skipped | duration_ms
------------+------+----------+---------+------------
memories    |  432 |      412 |      20 |        145
workitems   |   12 |       12 |       0 |         18
sessions    |   34 |       34 |       0 |         22
messages    | 1284 |     1284 |       0 |        311

.env updated: DAKO_STORAGE_BACKEND=mongodb
SQLite renamed: /path/.dako/memory.db.bak-1714112400
Total: 521 ms
```

**Exit codes:** `0` on success, `0` on the pre-flight no-op, `0` on dry-run; non-zero on any failure path. Suitable for use in scripts.

### Known limitations

- **One-way only.** No MongoDB → SQLite path. Migration in the other direction is intentionally out of scope.
- **All-or-nothing scope.** The tool migrates everything in the SQLite file — no per-project or per-collection filtering.
- **Concurrent-MCP protection is the user's responsibility.** If the long-term MCP is running and writing to either backend during the migration, the verification step is likely to catch the resulting count drift and roll back — but it is not guaranteed. Stop the MCP first.
- **Backup file cleanup is the user's responsibility.** The `.bak-<timestamp>` file lives until deleted manually.
- **No CLI overrides.** Connection settings come only from `mcps/mongodb-memory/.env`. To migrate from a non-standard SQLite path, temporarily edit `DAKO_SQLITE_PATH` (or rename the source file to the configured path) before running.
- **No new dependencies.** Tests use the built-in Node `node:test` runner; if MongoDB isn't reachable, the test file exits 0 with a skip note so CI without MongoDB stays green.

## Confirmation
**Confirmed by user:** yes
**Notes:** Signed off 2026-05-26.

## Cancellation
*(Fill only if status: cancelled)*
