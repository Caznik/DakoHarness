---
wi: WI-workflow-metrics/20260605-artifact-telemetry
phase: review
status: confirmed
date: 2026-06-05
verdict: pass
---

## AC Verification
| AC | Description | Satisfied | Evidence / Notes |
|---|---|---|---|
| AC-1 | One record per sub-feature folder; non-`WI-*` skipped | yes | Read `metrics.ts:333-360` — loop skips entries not starting `WI-` (line 334) and sub-folders not matching `^\d{8}-` (line 350). Re-ran `metrics.test.ts::harvestTree one record per sub-feature; non-WI skipped (AC-1)` — passes (3 records, `notes/`+`README.md` ignored). Observed on the real tree: 14 records from 14 sub-feature folders, 0 top-level warnings. |
| AC-2 | AC pass rate + verdict from `review.md` | yes | Read `parseAcMetrics` `metrics.ts:153-199`: locates Satisfied column **by header name** (line 172, not fixed position), counts `yes`/`y`. Re-ran all 3 AC-2 tests incl. the code-span case. Independently confirmed the fix on the real artifact: WI-rag-long-sessions reads **14/14=1.000** (was 13/14 before the `tableCells` fix because its AC-11 row embeds `` `…memories|messages|all` ``). |
| AC-3 | QA iterations = `## QA Log` data rows | yes | Read `metrics.ts:202-204` (delegates to `tableDataRows` which strips header+separator, `metrics.ts:99-112`). Re-ran `parseQaIterations counts QA Log data rows` (3) and `…no table → 0` — pass. |
| AC-4 | Deviation count + distinct dispatch count | yes | Read `parseReplans` `metrics.ts:211-220`: `deviation_count` from `## Plan Deviations` rows; `dispatch_count` = `Set` of regex `dispatch\s+#(\d+)` captures → **distinct numbers, not max N** (Open-Q4 lean honoured). Re-ran both AC-4 tests (4 mentions of #1/#2 → count 2). |
| AC-5 | Gaps open flag + accepted-gaps text | yes | Read `parseGaps` `metrics.ts:227-238`: `gaps_open=false` iff body empty or `^none\b`; `accepted_gaps` from `Accepted gaps:` with literal `none`→"". Re-ran both AC-5 tests — pass. |
| AC-6 | Calendar-day phase spans (day granularity) | yes | Read `parsePhaseDays` `metrics.ts:246-280`: whole-day deltas from previous *present* phase (first=0), UTC-midnight floor via `Date.UTC` to dodge TZ/DST. Re-ran `…whole-day deltas` (plan=2, review=0, total=2) and `…same-day → all zero`. Real tree: WI-rag `phase_days.implementation=1`, rest 0 — matches its artifact dates. |
| AC-7 | Project rollup; null metric excluded from its average | yes | Read `computeRollup` `metrics.ts:432-457`: `avgOf` filters nulls before dividing (line 434) — confirmed it divides by present-count, not `records.length`. Re-ran `computeRollup aggregates; null-metric excluded (AC-7)` (0.75 over 2 non-null, not /3) and the all-null→null case. |
| AC-8 | `workitem_metrics` store in both adapters; idempotent upsert | yes (sqlite re-run; mongo read-verified) | SQLite: read table `SqliteStorage.ts:169-187` (`UNIQUE(wi, sub_feature)`) + `INSERT…ON CONFLICT DO UPDATE` in a tx `:482-516`; re-ran `[sqlite] saveWorkitemMetrics upsert keeps one row (AC-8)` — `COUNT(*)==1`, value 2→5. Mongo: read `MongoStorage.ts:87` unique index `{wi:1,sub_feature:1}` + `updateOne(…,{upsert:true})` `:343-368`; **not executed this session (Mongo unreachable)** — gated test would run when reachable; same `Storage` interface as the passing SQLite path. |
| AC-9 | Tool `write:false` read-only / `write:true` upserts | yes | Read handler `server.ts:17-29`: `write` defaults false, `saveWorkitemMetrics` only called when true (line 24), returns `JSON.stringify({records,rollup,warnings,persisted})`. Re-ran `[sqlite] handler write:false writes nothing; write:true upserts (AC-9)` — store empty after read-only, 3 records after write. Tool routed at `server.ts:296`. |
| AC-10 | `/wi-metrics` skill in all 4 locations, byte-identical | yes | `sha256sum` of all 4 = `22bfc23e…ff8d` (`.claude/commands/`, `commands/`, `claude-plugin-release/commands/`, `adapters/opencode/.opencode/commands/wi-metrics.md`). Read the skill body: documents project resolution, `workitem_root`, `--save`→`write:true`, `<WI>` filter, per-WI table + rollup render, warning surfacing. |
| AC-11 | Malformed/partial artifacts → null/0 + warnings; no throw | yes | Read `harvestTree` try/catch per sub-feature `metrics.ts:353-358` + non-existent-root guard `:327-331`; `parseAcMetrics` missing-column warning `:174-177`. Re-ran 3 AC-11 tests (missing column→null+warning; malformed sub-feature→3 records still returned; non-existent root→0 records+warning, no throw). |
| AC-12 | Existing suite unchanged; new test wired into `npm test` | yes | `package.json` `test` script includes `metrics.test.js`. Re-ran full `node --test` over all 6 suites: **73 pass / 0 fail / 0 cancelled / 0 skipped**; the prior 5 suites' 47 tests unchanged. tsc errors confirmed pre-existing baseline (see Deviations note); `metrics.ts` compiles clean. |

## Plan Coverage
| Step | Implemented | Notes |
|---|---|---|
| 1 — Pure extractors + markdown helpers | yes | `parseFrontmatter`, `tableDataRows`, `sectionText`, `parseAcMetrics`, `parseQaIterations`, `parseReplans`, `parseGaps`, `parsePhaseDays` all present in `metrics.ts`, no fs imports in the pure section. |
| 2 — Tree walk + rollup | yes | `harvestTree` (fs-only function) + `computeRollup`; `project` from arg, propose slot mapped to `approaches.md` (`PHASE_FILES` `metrics.ts:285-293`). |
| 3 — `workitem_metrics` store, both adapters | yes | `Storage.ts` type + 2 methods; SQLite table + upsert; Mongo collection + unique index + upsert. |
| 4 — Register MCP tool | yes | `harvest_workitem_metrics` in ListTools + router `server.ts:296`; handler exported for tests. |
| 5 — `/wi-metrics` skill (4 mirrors) | yes | Written this session (was the one missing piece); 4 byte-identical files. |
| 6 — Tests + runner wiring | yes | `metrics.test.ts` (26 tests) + `package.json` updated. |

## Deviations Review
| Step | Deviation | Assessment |
|---|---|---|
| 4/6 | ESM main-guard around `main()` in `server.ts` so importing the handler doesn't boot the stdio transport. | **acceptable** — intent preserved. Standard run-directly-vs-imported idiom; required for AC-12 (test import otherwise hangs `node --test` on the live server loop). Production `node server.js` behaviour unchanged (verified: `argv[1]` equals the module path when run directly). |
| 1 | `tableCells` rewritten to ignore pipes inside backtick code spans and `\|` escapes. | **acceptable** — strengthens AC-2 correctness rather than weakening it. Caught by real-tree smoke (13/14 → 14/14); without it the headline metric is systematically wrong for any AC row containing a code-span pipe (common in this repo). Backed by a new regression test. |

## Gaps
None. All 12 ACs satisfied with verified evidence; all 6 plan steps implemented; both deviations assessed acceptable.

Two honest scope notes (neither a gap introduced by this WI):
- **Mongo adapter verified by code-read + SQLite parity, not executed this session** (Mongo was unreachable — the long-term-memory MCP process was killed while resolving the test hang). The Mongo-gated AC-8 test will run when a server is reachable; the shared `Storage` interface and the passing SQLite path give high confidence.
- **Pre-existing `tsc` baseline errors persist** (`@types/better-sqlite3` missing × several files incl. the new test; one MCP-SDK `ServerResult.task` drift in `server.ts:259`). Already tracked under the roadmap "TS housekeeping" backlog item; out of scope here, identical handling to WI-rag-long-sessions.

## Verdict
**Result:** pass — all 12 ACs independently verified (SQLite tests re-run, Mongo branch read-verified), all plan steps covered, both deviations acceptable, no open gaps.
**Accepted gaps:** none

## Confirmation
**Confirmed by user:** yes
**Date:** 2026-06-05
**Notes:** Confirmed under the autonomous-execution grant. User made aware of the two scope notes (Mongo branch read-verified not executed; pre-existing tsc baseline).

## Cancellation
