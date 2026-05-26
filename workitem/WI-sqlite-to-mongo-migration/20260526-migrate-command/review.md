---
wi: WI-sqlite-to-mongo-migration
phase: review
status: confirmed
date: 2026-05-26
verdict: pass
---

## AC Verification

| AC | Description | Satisfied | Evidence / Notes |
|---|---|---|---|
| AC-1 | `npm run migrate` reads `.env` and migrates four collections | yes | `migrate.ts:37` resolves `.env` next to the script; `migrate.ts:70` loads it; `migrate.ts:119–124` build plans for all four collections in `COLLECTIONS = ["memories", "workitems", "sessions", "messages"]` (line 40). Verified by `migrate.test.ts:175` (happy path). |
| AC-2 | Settings from `.env` only; missing → non-zero with key + path | yes | `migrate.ts:63–66` errors out with the expected `.env` path when missing. `migrate.ts:89–96` enumerates missing required keys (`DAKO_SQLITE_PATH`, `MONGO_URI`, `MONGO_DB`) and names them in the error message. Verified by `migrate.test.ts:335` (missing env keys). |
| AC-3 | Field translation per AC-10 mapping table | yes | `buildMemoriesPlan` (`migrate.ts:260–283`) drops integer `id`, `JSON.parse`s `tags`, converts ISO `timestamp` → `new Date()`. Same pattern in `buildWorkitemsPlan` / `buildSessionsPlan` / `buildMessagesPlan` (lines 285–323). ObjectIds are not generated manually — the Mongo driver assigns `_id` on insert (per AC-3 intent). Happy-path test asserts `tags` is an array, `timestamp instanceof Date`, and no integer `id` on the resulting Mongo docs. |
| AC-4 | Merge by natural key — skip if key exists in Mongo | yes | `dedupAgainstMongo` (`migrate.ts:327–387`) implements all four natural keys exactly as specified: memories=(project,agent,type,title), workitems=wi_path, sessions=session_id, messages=(session_id, seq). Bonus: also dedupes within the input batch (line 338) so duplicates inside SQLite don't slip through. Verified by `migrate.test.ts:295` (dedup) and `migrate.test.ts:272` (re-runnability). |
| AC-5 | Atomicity: rollback on any failure | yes | The `try/catch` at `migrate.ts:111–247` is the single failure sink. Three failure paths feed it: (a) insert error captures partial `insertedIds` from `BulkWriteError` at `migrate.ts:158–177` then re-throws; (b) verification mismatch throws at `migrate.ts:185/188`; (c) `.env` rewrite failure bubbles out of `rewriteEnvBackend`; (d) SQLite rename failure first reverts `.env` (`migrate.ts:210–218`) then re-throws. In the catch: Mongo `rollback` runs (`migrate.ts:391–398`, `deleteMany({_id:{$in:ids}})` per collection), `.env` is reverted if it was rewritten (`migrate.ts:242–245`). Verified by `migrate.test.ts:359` and `:399`. |
| AC-6 | Verification: read == inserted + skipped per collection | yes | `migrate.ts:184` asserts Mongo delta equals inserted count; `migrate.ts:187` asserts read == inserted + skipped. Both throw on mismatch into the AC-5 catch. |
| AC-7 | `--dry-run` — zero writes, zero side effects | yes | `migrate.ts:129–137` branches before any insert/rewrite/rename and returns 0. Verified by `migrate.test.ts:244` (asserts `.env` byte-equal before/after, Mongo collections empty, SQLite still in place). |
| AC-8 | `.env` rewrite preserves formatting; appends if missing | yes | `rewriteEnvBackend` (`migrate.ts:402–462`): detects CRLF vs LF (line 405), preserves trailing-newline-or-not (lines 406, 411–413, 450), preserves quote style (lines 427–432, handles `"..."` and `'...'`), preserves trailing comments (lines 435–440), appends `KEY=value` if missing (line 446). Atomic write via `.env.tmp` + `renameSync` (lines 453–461), with tmp cleanup on failure. Three dedicated pure-function tests at `migrate.test.ts:464`, `:478`, `:492`. |
| AC-9 | SQLite renamed to `.bak-<unix-timestamp>` on success | yes | `migrate.ts:204–219`: closes handle first (Windows lock concern), computes target with `Math.floor(Date.now()/1000)`, `renameSync`, on failure reverts `.env` before bubbling to catch. Happy-path test asserts SQLite original path missing and a `memory.db.bak-*` file exists. |
| AC-10 | Pre-flight no-op when backend already `mongodb` / empty / unset | yes | `migrate.ts:72–78`: trims env var, treats `""` and `"mongodb"` identically as "no-op", prints `Backend is already mongodb — nothing to migrate.` and returns 0. Verified by `migrate.test.ts:218`. |
| AC-11 | Per-collection streamed lines + final summary table | yes | Streaming progress: `migrate.ts:194–196` writes `[<collection>] inserted N, skipped M (N+M/T) ✓` per collection. Dry-run uses `…dry-run` suffix at line 133. Final summary: `printSummary` (`migrate.ts:470–481`) renders a column-aligned table (`collection | read | inserted | skipped | duration_ms`) and the `.env updated:` + `SQLite renamed:` lines plus a total wall time. |
| AC-12 | Exit codes: 0 on success/no-op, non-zero on any failure | yes | `main()` returns numeric codes: `return 0` at lines 77 (no-op), 136 (dry-run), 225 (success); `return 1` at lines 65, 82, 95, 100, 247 (catch). Bootstrap at `migrate.ts:497` propagates to `process.exit(code)`. Every test asserts `process.exitCode`. |
| AC-13 | Re-runnability — second run after success hits AC-10 | yes | After success `.env` says `mongodb`, so the next invocation exits at the AC-10 pre-flight (line 75). Verified by `migrate.test.ts:272`. The rolled-back failure case naturally degrades to a first-run-equivalent because both `.env` and Mongo are restored — AC-4 dedup absorbs any residual edge cases. |

**Result: 13/13 satisfied.**

## Plan Coverage

| Step | Implemented | Notes |
|---|---|---|
| Step 1 — CLI scaffolding, env load, pre-flight | yes | `migrate.ts:59–101`; `package.json` `migrate` script added. |
| Step 2 — Schema-aware SQLite reader | yes | `migrate.ts:260–323` (four `build*Plan` functions). |
| Step 3 — Mongo target reader & natural-key dedup | yes | `migrate.ts:327–387` (`dedupAgainstMongo`). |
| Step 4 — Dry-run path | yes | `migrate.ts:129–137`. |
| Step 5 — Insert with rollback tracking | yes | `migrate.ts:147–179` (capture both success `insertedIds` and partial-success ids on `BulkWriteError`). |
| Step 6 — Post-copy verification | yes | `migrate.ts:181–189`. |
| Step 7 — Streamed per-collection progress | yes | `migrate.ts:194–196` (run) + line 133 (dry-run). |
| Step 8 — `.env` rewrite preserving formatting | yes | `migrate.ts:200–202` + `rewriteEnvBackend` 402–462. |
| Step 9 — SQLite rename to `.bak-<timestamp>` | yes | `migrate.ts:204–219` (close handle, rename, revert `.env` on failure). |
| Step 10 — Final summary | yes | `migrate.ts:222–223` + `printSummary` 470–481. |
| Step 11 — Tests (re-runnability + golden paths) | yes | `migrate.test.ts` — 11 tests; `tests 11 / pass 11 / fail 0 / skipped 0`. |

**Result: 11/11 plan steps implemented.**

## Deviations Review

| Step | Deviation | Assessment |
|---|---|---|
| 1 | Added `override: true` to `dotenv.config` | **Acceptable.** Doesn't change single-shot CLI semantics. Required for the multi-call test fixture to reload a freshly-written `.env`. The runtime behaviour for `npm run migrate` is unchanged. |
| 5 | On `insertMany` failure, probe `err.result.insertedIds`, `err.insertedIds`, `err.insertedDocs` to capture partial inserts before re-throwing | **Acceptable — strengthens AC-5.** The plan stated that `result.insertedIds` would carry partial successes, but in practice the driver puts them on the thrown `BulkWriteError`. Without this fix, the duplicate-key test left 1 stranded doc — i.e. AC-5 would have failed silently. The defensive multi-shape probe also future-proofs against `mongodb` driver minor-version drift. |

## Gaps

None.

## Verdict
**Result:** pass
**Accepted gaps:** none

## Confirmation
**Confirmed by user:** yes
**Notes:** Signed off 2026-05-26.

## Cancellation
*(Fill only if status: cancelled)*
