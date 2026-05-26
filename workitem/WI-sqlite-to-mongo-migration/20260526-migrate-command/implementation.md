---
wi: WI-sqlite-to-mongo-migration
phase: implementation
status: completed
date: 2026-05-26
---

## Architecture Notes

**Repository placement & module shape.** The migrator lives at `mcps/mongodb-memory/migrate.ts` — same directory as `server.ts`, sharing `package.json`, `tsconfig.json`, and the `.env` file it will read/rewrite. `tsconfig.json` is configured with `"module": "NodeNext"` + `"verbatimModuleSyntax": true` + `"isolatedModules": true`, so the migrator must use the same `.js` import extensions and `type` imports the rest of the project uses (see `server.ts` line 6 — `import * as dotenv from "dotenv"`). The `package.json` already has `"type": "module"`, so the emitted JS is ESM.

**Env loading pattern.** `server.ts:9` already establishes the convention: `dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), ".env") })`. The migrator reuses this exact pattern so the resolved `.env` path matches what the server reads — same file the migrator will rewrite at Step 8.

**Env-var names (corrected from analyze.md).** `factory.ts:32–42` is the source of truth: `MONGO_URI` (not `MONGODB_URI`), `MONGO_DB` (not `DAKO_DB`), `DAKO_SQLITE_PATH`, `DAKO_STORAGE_BACKEND`. `plan.md` already corrects these; the migrator uses the factory's names so the migration target matches what the server will subsequently connect to.

**Bypassing the Storage facade.** `Storage.ts` is intentionally a domain-method facade (`remember`, `recall`, etc.) — it doesn't expose `getAllRows(collection)` or `insertMany(collection, docs[])`. The plan calls for raw driver access (`better-sqlite3` and `mongodb` directly). Decision is correct: a one-off migration tool would force generic CRUD methods onto the interface that no production tool handler needs. The pattern from `SqliteStorage.create()` (using `better-sqlite3` directly) and `MongoStorage.create()` (using `MongoClient` directly) is mirrored here for the same reason — these factories already deal with raw drivers when the facade abstraction would get in the way.

**Field translation source of truth.** The AC-10 mapping table in `Storage.ts:21–75` is the canonical translation spec. Critically: SQLite `id INTEGER` is dropped (Mongo generates `_id`), `tags TEXT` is JSON-parsed back into an array, ISO-8601 TEXT becomes JS `Date`, and `session_id TEXT PRIMARY KEY` in the `sessions` table stays as a normal field — Mongo lets the driver assign a new `_id`.

**Indexes are not the migrator's concern.** `MongoStorage.create()` calls `createIndex(...)` for the four indexes (lines 61–70). Whenever the running MCP starts up after migration, it will create them on first use (idempotent). The migrator therefore does NOT create indexes — only data is moved.

**No test runner is configured.** `package.json` script `test` is the default `echo "Error: no test specified" && exit 1`. The plan adds `node --test` (Node ≥18 built-in) so we get tests without new deps. Test file is `migrate.test.ts`; built into `migrate.test.js`; runs via `node --test migrate.test.js`.

**Better-sqlite3 file lock on Windows.** Empirically `better-sqlite3` holds an exclusive lock on Windows until the `Database` handle's `close()` is called. Step 9 sequences this: close the SQLite handle BEFORE `fs.renameSync`. Same constraint affects WAL/SHM sidecar files (`-wal`, `-shm`) — they're auto-deleted when the handle closes cleanly.

**`.env` rewrite must preserve user formatting.** The current `.env` (read above) uses LF line endings, has a blank line between the MONGO_ block and the DAKO_AGENT line, and does NOT have a `DAKO_STORAGE_BACKEND` key (so the running MCP defaults to `mongodb`). The migrator must (a) detect line endings, (b) preserve blanks and comments, (c) append the key if it's not present. Atomic write via `.tmp` + `renameSync` protects against partial writes.

**Rollback semantics — manual not transactional.** `docker-compose.yml` in this folder is a single-node Mongo (no replica set), which means multi-doc transactions are NOT available. The plan's manual `deleteMany({ _id: { $in: insertedIds } })` per collection is the only portable choice. The driver returns `result.insertedIds` as a sparse object `{0: ObjectId, 1: ObjectId, ...}` — must convert to `Object.values(result.insertedIds)` before tracking.

**Order of operations on success: data → verify → `.env` → rename.** If we renamed SQLite first, then `.env` rewrite failed, the system would be in a degenerate state (no SQLite, no `mongodb` flag). With `.env` first then rename: a rename failure has `.env` already flipped — the revert step rewrites `.env` back to `sqlite`. This is captured in plan Step 9.

**No agent calls allowed; using Read/Grep/Glob only.** Confirmed compliance with sub-agent constraints.

## Plan Deviations
| Step | Original plan | What actually happened | Reason |
|---|---|---|---|
| 1 | dotenv.config({ path }) | dotenv.config({ path, override: true }) | Default dotenv caches process.env across calls. Tests invoking main() multiple times in one process would otherwise see stale values. override:true makes the function safe for repeated in-process use without changing behavior for single-shot CLI invocation. |
| 5 | `collection.insertMany(toInsert, { ordered: true })` and push `insertedIds` on success only | Wrapped insertMany in try/catch; on BulkWriteError, probe `err.result.insertedIds`, `err.insertedIds`, and `err.insertedDocs` to capture *partial* inserts that happened before the error, push them into the rollback tracker, then re-throw | Plan said "the already-inserted ones in the same call are in `result.insertedIds`" but didn't show that on error the partial result is on the *error object*, not a return value. Without this, the duplicate-key test left 1 stranded document in Mongo because the partial success wasn't tracked. Probes multiple shapes for cross-driver-version safety. |

## Blockers
| # | Description | Resolution | Status |
|---|---|---|---|

## AC Pre-Check
| AC | Test / Evidence | Status |
|---|---|---|
| AC-1  | `migrate.test.ts` test `happy path — migrates all four collections, flips .env, renames SQLite` (asserts mongo counts for all 4 collections, .env flipped, SQLite renamed) | COVERED |
| AC-2  | `migrate.test.ts` test `missing env keys — non-zero exit, no side effects` + `migrate.ts:71–92` (validates env vars, names path in error) | COVERED |
| AC-3  | `migrate.test.ts::happy path` — asserts `tags` is array (not JSON string), `timestamp instanceof Date`, integer `id` absent, `_id` generated by Mongo. Translation logic: `migrate.ts:184–245` (buildMemoriesPlan, buildWorkitemsPlan, etc.) | COVERED |
| AC-4  | `migrate.test.ts` tests `dedup — second migration with same content skips everything` and `verification rollback` (which exercises dedup against pre-existing Mongo doc). Logic: `migrate.ts:248–308` (dedupAgainstMongo per natural key) | COVERED |
| AC-5  | `migrate.test.ts` test `insert-failure rollback — duplicate ObjectId triggers rollback, Mongo empty, .env unchanged, SQLite untouched` asserts memories collection empty after failure, `.env` byte-identical, SQLite still in place. Logic: `migrate.ts:158–179` (capture partial insertedIds on error) + `migrate.ts:191–207` (catch block: rollback, revert .env if rewritten) | COVERED |
| AC-6  | `migrate.ts:154–169` — verification asserts `delta == inserted.length` AND `readCount == inserted.length + skipCount` per collection; mismatch throws and falls into the rollback catch. Demonstrated in test `verification rollback` (dedup+verify path). | COVERED |
| AC-7  | `migrate.test.ts` test `dry-run — exit 0, Mongo empty, .env unchanged, SQLite untouched` (byte-equal .env before/after; Mongo counts all 0). Logic: `migrate.ts:122–131`. | COVERED |
| AC-8  | Three dedicated pure-function tests in `migrate.test.ts`: `rewriteEnvBackend — replaces existing key, preserves other lines and EOL`, `rewriteEnvBackend — appends key when missing, preserves CRLF`, `rewriteEnvBackend — preserves double-quoted value`. Plus happy-path test asserts `MONGO_URI=` line still present after rewrite. Logic: `migrate.ts:316–375`. | COVERED |
| AC-9  | `migrate.test.ts::happy path` asserts SQLite original path missing and a `memory.db.bak-*` file exists in tmp dir. Logic: `migrate.ts:182–193` (close handle, rename, revert .env on failure). | COVERED |
| AC-10 | `migrate.test.ts` test `pre-flight no-op — backend already mongodb -> exit 0, no side effects`. Logic: `migrate.ts:67–70` (empty/unset/mongodb all return 0). | COVERED |
| AC-11 | Test output captured in test-output.log shows: `[memories] inserted 2, skipped 0 (2+0/2) ✓` per collection lines, and full summary table with `collection \| read \| inserted \| skipped \| duration_ms` followed by `.env updated:` and `SQLite renamed:` lines. Logic: `migrate.ts:172–177` (streaming) + `migrate.ts:378–392` (printSummary). | COVERED |
| AC-12 | All test assertions check exit code: 0 on happy path / pre-flight / dry-run / dedup; non-zero on missing env / insert failure. Centralised return values in `main()`. | COVERED |
| AC-13 | `migrate.test.ts` test `re-runnability — second run after success hits pre-flight no-op` (second invocation returns 0, counts unchanged). | COVERED |

## QA Log
| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-1..AC-13 (initial test run) | 9 pass, 2 fail (re-runnability, insert-failure rollback) | Diagnosed: (a) dotenv caches process.env so second in-process load saw stale `sqlite` value; (b) on BulkWriteError, partial insertedIds live on the error object not a return value, so rollback found nothing to delete |
| 2 | AC-1..AC-13 (after fixes) | 11/11 pass | Fix 1: added `override: true` to dotenv.config in migrate.ts. Fix 2: wrapped insertMany in try/catch and probed `err.result.insertedIds`, `err.insertedIds`, `err.insertedDocs` to capture partial-success ids for rollback. Logged as Plan Deviation rows. |

## Regression
**Test suite run:** yes (`node --test migrate.test.js`)
**Result:** pass — `tests 11 / pass 11 / fail 0 / skipped 0`
**Failures:** none.

Notes:
- The package.json `test` script previously was `echo "Error: no test specified" && exit 1`. There were no other tests in this MCP. New `test` script runs `tsc && node --test migrate.test.js`.
- Pre-existing TypeScript errors in `server.ts` (MCP SDK type mismatch on tools/call response) and `better-sqlite3` (missing @types) exist in both `migrate.ts`/`migrate.test.ts` and the pre-WI codebase. `tsc` still emits JS despite them (consistent with how the project has been building all along — `server.js` is committed). Not introduced by this WI.
- Other MCPs in the repo (`mcps/short-term-memory` Go) have no test suite to run; only this Node MCP gained tests with this WI.
