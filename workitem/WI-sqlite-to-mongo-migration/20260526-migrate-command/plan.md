---
wi: WI-sqlite-to-mongo-migration
phase: plan
status: confirmed
date: 2026-05-26
approach: (single direction — no /wi-propose phase needed; analyze pinned the shape)
---

## Context
**Selected approach:** Self-contained `migrate.ts` inside `mcps/mongodb-memory/`, invoked via `npm run migrate`. Talks to `better-sqlite3` and the `mongodb` driver directly (bypasses the Storage adapter facade) because the migrator needs raw row access and bulk insert with `_id` tracking — capabilities the Storage interface does not expose and should not expose (it would bloat the runtime interface for a one-off tool).

**Codebase notes from exploration:**
- Env vars in use by the factory: `DAKO_STORAGE_BACKEND`, `MONGO_URI` (not `MONGODB_URI`), `MONGO_DB` (not `DAKO_DB`), `DAKO_SQLITE_PATH`. The plan uses these exact names; analyze.md had two wrong — they are corrected here.
- SQLite schema is in `SqliteStorage.create()` (lines 68–154 of `SqliteStorage.ts`). The four target tables are `memories`, `workitems`, `sessions`, `messages`. FTS5 virtual tables and triggers are SQLite-only and do NOT migrate to Mongo.
- MongoStorage indexes (`memories_text_search`, `workitems_text_search`, plus the two B-tree indexes) are created in `MongoStorage.create()`. Connecting to Mongo via the adapter would create those indexes; the migrator will use the raw `MongoClient` and let the running MCP recreate indexes on first use.
- `dotenv` is already a dep — the migrator will use it for .env load.
- No test runner is configured. Implementation will add `node:test` (built-in) so tests run via `node --test` without new deps.

**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13 (all 13).

## Implementation Sequence

### Step 1 — CLI scaffolding, env load, pre-flight
**Satisfies:** AC-1, AC-2, AC-10, AC-12
**Files:**
- `mcps/mongodb-memory/migrate.ts` (new)
- `mcps/mongodb-memory/package.json` (add `"migrate": "tsc && node migrate.js"` script)
**Description:**
- Create `migrate.ts` as the entry point. Load `.env` from `mcps/mongodb-memory/.env` via `dotenv.config({ path })`.
- Validate required env vars: `DAKO_STORAGE_BACKEND`, `DAKO_SQLITE_PATH`, `MONGO_URI`, `MONGO_DB`. Missing or unreadable `.env` → exit non-zero with the expected absolute path and the missing key.
- Parse `--dry-run` flag (single arg, no CLI lib — `process.argv.includes("--dry-run")`).
- **Pre-flight (AC-10):** if `DAKO_STORAGE_BACKEND` is `mongodb`, empty, or unset, print `Backend is already mongodb — nothing to migrate.` and exit 0. Idempotent no-op, not an error.
- Wire exit codes: success = 0, every failure path = non-zero.

### Step 2 — Schema-aware SQLite reader
**Satisfies:** AC-3
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- Open SQLite via `better-sqlite3` (read-only mode).
- For each of the four tables, `SELECT * FROM <table>` and transform rows into Mongo-shaped documents per the AC-10 mapping table in `Storage.ts`:
  - `memories`: drop integer `id`; `JSON.parse(tags)` back to array; `new Date(timestamp)` for ISO-8601 string.
  - `workitems`: drop integer `id`; `new Date(archived_at)`.
  - `sessions`: keep `session_id` as `_id` discriminator semantics (but still let Mongo assign a new `_id` — `session_id` remains a normal field, since the natural key check uses it).
  - `messages`: drop integer `id`; `new Date(timestamp)`.
- Do **not** generate ObjectIds explicitly — let the Mongo driver generate them on insert. The migrator captures the returned `insertedIds` for rollback tracking.

### Step 3 — Mongo target reader & natural-key dedup
**Satisfies:** AC-4
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- Connect to Mongo via raw `MongoClient`, using `MONGO_URI` and `MONGO_DB`.
- For each target collection, fetch the existing natural-key set with a projection (e.g. `{ project: 1, agent: 1, type: 1, title: 1, _id: 0 }` for memories) and load into a `Set<string>` keyed by `JSON.stringify(key)`.
- Filter source rows: a row is `toInsert` if its key string is NOT in the existing set; otherwise it counts toward `skipCount`.
- Result per collection: `{ readCount, toInsert: doc[], skipCount }`.

### Step 4 — Dry-run path
**Satisfies:** AC-7
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- If `--dry-run` was passed: after Steps 2 & 3 complete, print the per-collection plan (`read | would-insert | would-skip`), print "no writes performed", close Mongo + SQLite, exit 0.
- Zero side effects: no inserts, no `.env` rewrite, no SQLite rename, no `.bak` file.

### Step 5 — Insert with rollback tracking
**Satisfies:** AC-5 (insert-failure path)
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- For each collection in fixed order (`memories`, `workitems`, `sessions`, `messages`):
  - If `toInsert` is empty, skip the insert call.
  - Otherwise call `collection.insertMany(toInsert, { ordered: true })`.
  - Push the returned `insertedIds` (an `{ 0: ObjectId, 1: ObjectId, ... }` object — convert to array) into a per-collection map `inserted: Record<collectionName, ObjectId[]>`.
- On any throw during the loop (driver error, validation error, network blip): invoke `rollback(inserted)`, which calls `collection.deleteMany({ _id: { $in: ids } })` per collection that has entries. Exit non-zero with the original error message.
- Rationale for manual rollback over multi-doc transactions: standalone Mongo (the default `docker-compose.yml` setup) doesn't support multi-doc transactions — manual rollback works on every Mongo topology and was the answer to analyze.md Open Question #1.

### Step 6 — Post-copy verification
**Satisfies:** AC-5 (verification-failure path), AC-6
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- For each collection: re-count Mongo collection after insert. Assert `(after_count - before_count) == inserted[col].length`. Assert `read == inserted[col].length + skipCount`. Mismatch → invoke `rollback`, exit non-zero with a verification-failure message naming the collection and the two numbers.

### Step 7 — Streamed per-collection progress
**Satisfies:** AC-11 (during the run)
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- After each collection's verification passes, print one line: `[<collection>] inserted N, skipped M (N+M/T) ✓`.
- For dry-run, the same line but with `would-insert` / `would-skip` and no `✓` (use `…dry-run`).
- Use `process.stdout.write` + explicit `\n`; no external logging lib.

### Step 8 — `.env` rewrite, preserving formatting
**Satisfies:** AC-8, AC-5 (rewrite-failure path)
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- Read `mcps/mongodb-memory/.env` as raw bytes → string.
- Detect line ending: presence of `\r\n` anywhere → CRLF, else LF.
- Split by detected line ending, find first line whose trimmed left side starts with `DAKO_STORAGE_BACKEND=`; replace its value with `mongodb` while preserving any surrounding quotes the user had (`"mongodb"`, `'mongodb'`, or bare).
- If no such line: append `DAKO_STORAGE_BACKEND=mongodb` followed by the detected line ending. Preserve trailing-newline-or-not behaviour from the original file.
- Atomic write: write to `.env.tmp` in the same directory, then `fs.renameSync` over `.env`.
- On any failure (permissions, disk full, partial write): invoke `rollback(inserted)`, exit non-zero with rewrite-failure message. Note: if the temp file write fails, `.env` is untouched. If the rename fails after temp write, `.env` is untouched and the temp file is removed on best effort.

### Step 9 — SQLite rename to `.bak-<timestamp>`
**Satisfies:** AC-9, AC-5 (rename-failure path)
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- Compute target path: `<DAKO_SQLITE_PATH>.bak-<Math.floor(Date.now()/1000)>` (Unix timestamp, seconds).
- Close the SQLite handle first (better-sqlite3 holds a file lock on Windows; rename will fail otherwise).
- `fs.renameSync(DAKO_SQLITE_PATH, target)`.
- On failure: revert `.env` (rewrite back to `sqlite`), invoke `rollback(inserted)`, exit non-zero.
- Order is important: `.env` rewrite first, then SQLite rename. The rationale: if SQLite rename fails after a successful `.env` rewrite, the system would be left in an inconsistent state (`.env` says mongodb but SQLite still in place and writable by anything that opens it). The revert step handles that.

### Step 10 — Final summary
**Satisfies:** AC-11 (final summary), AC-12
**Files:**
- `mcps/mongodb-memory/migrate.ts`
**Description:**
- Print a summary table with columns `read | inserted | skipped | duration_ms` per collection.
- Print: `.env updated: DAKO_STORAGE_BACKEND=mongodb`
- Print: `SQLite renamed: <bak-path>`
- Close Mongo + SQLite handles cleanly. Exit 0.

### Step 11 — Tests (re-runnability + golden paths)
**Satisfies:** AC-13 + verification of every other AC
**Files:**
- `mcps/mongodb-memory/migrate.test.ts` (new) — runs via `node --test`
- `mcps/mongodb-memory/package.json` (`"test": "tsc && node --test migrate.test.js"` replaces the placeholder)
**Description:**
- Build an in-temp-dir fixture: a SQLite file populated with a few rows in each table, a mock `.env` set to `sqlite`, and a Mongo test database name (e.g. `dako_migrate_test_<random>`).
- Tests:
  1. **Happy path** — seed SQLite, run migrate, assert each Mongo collection count matches, assert `.env` flipped, assert SQLite renamed.
  2. **Pre-flight no-op** — `.env` already `mongodb` → exit 0, no side effects.
  3. **Dry-run** — `--dry-run` after seed → exit 0, Mongo empty, `.env` unchanged, SQLite not renamed.
  4. **Re-runnability** — seed → run → seed again into a fresh SQLite (same content) → flip env back to sqlite → run → assert dedup skips everything.
  5. **Insert-failure rollback** — force a synthetic failure (e.g. inject a duplicate `session_id` post-dedup by mutating the toInsert list) → assert Mongo is empty, `.env` is unchanged, SQLite is not renamed.
  6. **Verification-failure rollback** — inject a count mismatch (e.g. monkey-patch the count call) → same rollback assertions.
- Tests skip cleanly if Mongo isn't reachable (so the suite runs in CI without Mongo) — print "skipped: Mongo unreachable" and exit 0 from that file.

## Risks / Known Unknowns
1. **better-sqlite3 file lock on Windows.** The handle MUST be closed before `fs.renameSync`. Step 9 sequences this explicitly. If we discover deeper issues during implementation, fallback is `fs.copyFileSync` + `fs.unlinkSync` (copy then delete).
2. **dotenv keeps a parsed snapshot.** After we `dotenv.config()` once, mutating `process.env` won't affect what we read from `.env` on disk — and that's what we want. Just don't accidentally re-call `dotenv.config` after rewriting.
3. **Test isolation against a shared Mongo.** Each test gets a per-run database name (`dako_migrate_test_<uuid>`) so parallel test runs don't collide, and drops it on teardown. If `MONGO_URI` is unreachable, the test file should `process.exit(0)` after printing a skip note rather than failing CI.
4. **Mongo `insertMany` ordering.** With `ordered: true`, the first failure aborts and remaining docs aren't inserted — but the already-inserted ones in the same call are in `result.insertedIds`. Rollback handles this correctly because we use the returned `insertedIds` array from each completed `insertMany`, not the input length.
5. **No CLI flags beyond `--dry-run`.** If someone wants to migrate from a `.bak-<timestamp>` file later, they'd need to temporarily rename it back to `DAKO_SQLITE_PATH`, or we add flags in a follow-up.
6. **Permissions on `.env`.** If the file is read-only on disk, the rewrite fails. Step 8's atomic-write strategy means the original isn't truncated; the failure is clean and the rollback path runs.

## Confirmation
**Confirmed by user:** yes
**Notes:** Signed off 2026-05-26.

## Cancellation
*(Fill only if status: cancelled)*
