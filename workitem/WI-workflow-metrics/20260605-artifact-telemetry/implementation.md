---
wi: WI-workflow-metrics/20260605-artifact-telemetry
phase: implementation
status: completed
date: 2026-06-05
---

## Architecture Notes

**Pure-core / thin-shell split.** All metric extraction in `metrics.ts` is string-in → record-out with zero fs imports, mirroring the small-exported-pure-function style of `embed.ts` (`shouldEmbedMessage`, `cosine`, `rrfMerge` — no class). Only `harvestTree(workitemRoot)` touches disk via `node:fs`. This keeps every extractor unit-testable on string fixtures with no temp-dir setup, the same seam `embed.ts` uses with `DAKO_EMBED_STUB`. This is the first time the MCP reads project files at all — confirmed no `DAKO_PROJECT_ROOT` exists anywhere; `archive_workitem` (`MongoStorage.ts:326`, `SqliteStorage.ts:448`) receives pre-read `documentation` content from the skill. The new tool follows that same convention: the skill supplies the absolute `workitem_root`.

**Storage parity pattern.** `saveWorkitemMetrics`/`getWorkitemMetrics` mirror the existing two-adapter discipline: SQLite uses `INSERT ... ON CONFLICT(wi, sub_feature) DO UPDATE` (idempotent upsert) in the prepared-statement style of `archiveWorkitem` at `SqliteStorage.ts:448`; Mongo uses `updateOne({wi, sub_feature}, {$set}, {upsert:true})` with a unique index created in the same init block as the `messages {embedding_model:1}` index at `MongoStorage.ts:83`. `phase_days`/`warnings` are JSON-stringified TEXT in SQLite (same convention as `tags` at `SqliteStorage.ts:89`) and native object/array in Mongo (same convention as `tags` in `remember`).

**Tool boundary.** `harvest_workitem_metrics` registered after `archive_workitem` in both the `ListToolsRequestSchema` block and the `CallToolRequestSchema` router (`server.ts:260`). It does not need the base64→Buffer boundary that `recall`/`recall_session_messages` use because it carries no embedding. `write` defaults to false → the handler skips `saveWorkitemMetrics` entirely, performing zero writes.

**Deliberate non-patterns.** Records carry `project` from the tool arg, never parsed from files — the harvest is single-project by construction, so per-file project parsing would be redundant and a divergence risk. Averages in `computeRollup` filter nulls before dividing (records missing a metric are excluded from that metric's average, NOT counted as 0) per AC-7 — the opposite of a naive `reduce(...,0)/length`.

**Constraints worked around.** The propose-phase artifact is named `approaches.md`, not `propose.md` — `parsePhaseDays` and `harvestTree` map the propose slot to `approaches.md`. Calendar-day deltas use UTC-midnight flooring to avoid TZ/DST drift (dates in frontmatter are bare `YYYY-MM-DD`). Pre-existing `tsc` baseline = 8 errors (7× TS7016 missing `@types/better-sqlite3` + 1× TS2345 MCP-SDK `ServerResult.task` drift in `server.ts:259`); this WI's new `metrics.test.ts` adds a 9th of the *identical* better-sqlite3 category (installing `@types/better-sqlite3` clears all of them at once). `metrics.ts` itself compiles clean. Out of scope per plan; tests run against emitted `.js`, same as `recall-session-messages`.

## Plan Deviations
| Step | Original plan | What actually happened | Reason |
|---|---|---|---|
| 4/6 | Register the tool in `server.ts`; tests import `handleHarvestWorkitemMetrics` from `server.js`. | Added an ESM main-guard around `main()` at `server.ts:305` — `if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])` — so importing the module no longer boots the stdio transport. | Without it, importing the handler in `metrics.test.ts` ran `main()`, connected `StdioServerTransport`, and kept the event loop alive → `node --test` hung indefinitely. The guard is the standard run-directly-vs-imported idiom; `fileURLToPath` was already imported. Behaviour when run as `node server.js` is unchanged. |
| 1 | `tableCells` splits a row on `\|`. | Rewrote `tableCells` (`metrics.ts:136`) to skip pipes inside backtick code spans and `\|` escapes, walking char-by-char instead of `split("|")`. Added regression test `parseAcMetrics ignores pipes inside code spans + escapes (AC-2)`. | Smoke-testing against the real `workitem/` tree showed WI-rag-long-sessions scoring 13/14 instead of 14/14: its AC-11 row contains `` `--collection memories\|messages\|all` `` and the inner pipe shifted the Satisfied column. Real artifacts (incl. this WI's own plan.md) routinely embed pipes in code spans, so the naive split systematically miscounted the headline metric. |

## Blockers
| # | Description | Resolution | Status |
|---|---|---|---|

## AC Pre-Check
| AC | Test / Evidence | Status |
|---|---|---|
| AC-1 | `metrics.test.ts::harvestTree one record per sub-feature; non-WI skipped (AC-1)` — fixture tree with `WI-alpha` (2 subs), `WI-beta` (1 sub) + non-WI `notes/` & `README.md`; asserts `records.length===3` and the non-WI entries skipped. Real-tree smoke: 14 records from 14 sub-feature folders, 0 top-level warnings. | COVERED |
| AC-2 | `parseAcMetrics all-yes → rate 1.0 + verdict (AC-2)`, `…mixed yes/no → 0.5 (AC-2)`, `…ignores pipes inside code spans + escapes (AC-2)`. Real-tree: WI-rag-long-sessions now 14/14=1.000 after the `tableCells` fix. `parseAcMetrics` at `metrics.ts:153`. | COVERED |
| AC-3 | `parseQaIterations counts QA Log data rows (AC-3)` (N=3) and `…no table → 0 (AC-3)`. `parseQaIterations` at `metrics.ts:189`. | COVERED |
| AC-4 | `parseReplans counts deviations + distinct dispatches (AC-4)` (dev=2, distinct dispatch=2 from 4 mentions of #1/#2) and `…absent → 0/0 (AC-4)`. | COVERED |
| AC-5 | `parseGaps None. → gaps_open false (AC-5)` (accepted_gaps "") and `…non-empty → gaps_open true + accepted text (AC-5)`. | COVERED |
| AC-6 | `parsePhaseDays whole-day deltas from previous present phase (AC-6)` (plan=2, review=0, total=2) and `…same-day → all zero (AC-6)`. UTC-midnight diff in `metrics.ts`. | COVERED |
| AC-7 | `computeRollup aggregates; null-metric excluded from its average (AC-7)` (avg over 2 non-null rates = 0.75, not /3) and `…avg_ac_pass_rate null when all rates null (AC-7)`. | COVERED |
| AC-8 | `[sqlite] saveWorkitemMetrics upsert keeps one row per (wi, sub_feature) (AC-8)` — double-write asserts `COUNT(*)==1` and value overwritten (qa 2→5). `[mongo]` equivalent gated on `mongoReachable()`. `workitem_metrics` table + `INSERT…ON CONFLICT` in `SqliteStorage.ts`; `updateOne(…,{upsert:true})` + unique index in `MongoStorage.ts`. | COVERED |
| AC-9 | `[sqlite] handler write:false writes nothing; write:true upserts (AC-9)` — `write:false` returns rollup text and leaves store empty; `write:true` upserts 3 records. Handler `handleHarvestWorkitemMetrics` at `server.ts:17`. | COVERED |
| AC-10 | 4 mirrors written byte-identical — sha256 `22bfc23e…ff8d` for `.claude/commands/`, `commands/`, `claude-plugin-release/commands/`, `adapters/opencode/.opencode/commands/wi-metrics.md`. | COVERED |
| AC-11 | `parseAcMetrics missing Satisfied column → null + warning (AC-11)`, `harvestTree malformed sub-feature → warnings, walk completes (AC-11)` (3 records returned despite garbled frontmatter + missing column), `harvestTree non-existent root → zero records + top-level warning (AC-11)` (no throw). | COVERED |
| AC-12 | Full `node --test` over all 6 suites = **73 pass / 0 fail / 0 cancelled**; `package.json` `test` script includes `metrics.test.js`. Pre-existing 5 suites unchanged (47 of the 73). tsc baseline errors confirmed pre-existing (no new error class; `metrics.ts` clean). | COVERED |

## QA Log
| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-12 (suite runnability) | FAIL → FIXED | `node --test metrics.test.js` hung — importing the handler booted the stdio server. Added the `server.ts` main-guard (Deviation 1); suite then ran 25/25 in ~0.7s. |
| 2 | AC-2 (real-tree validation) | FAIL → FIXED | Real-tree smoke showed 13/14 for a WI with a code-span pipe in its AC table. Rewrote `tableCells` (Deviation 2) + added regression test; WI-rag back to 14/14. |
| 3 | All 12 ACs | PASS | Full suite 73/73; real-tree harvest produces 14 records, rollup avg AC pass rate 0.9487, `wi_count_by_status {pass:10, accepted-with-gaps:3, unknown:1}` (unknown = the in-flight WI-workflow-metrics, correctly included). |

## Regression
**Test suite run:** yes — `node --test migrate.test.js embed.test.js embed-backfill.test.js recall-hybrid.test.js recall-session-messages.test.js metrics.test.js`
**Result:** pass — 73 tests, 0 fail, 0 cancelled, 0 skipped (Mongo-gated metrics/recall branches not registered: Mongo unreachable in this run, expected). Pre-existing 5 suites (47 tests) unchanged.
**Failures:** none.
Note: `npm test`'s leading `tsc` exits non-zero on the documented baseline errors (8 pre-existing + 1 same-category from the new test's better-sqlite3 import); `tsc` still emits `.js`, which `node --test` runs — identical handling to WI-rag-long-sessions. Fixing those belongs to the existing "TS housekeeping" backlog item, not this WI.
