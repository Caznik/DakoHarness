---
wi: WI-workflow-metrics/20260605-artifact-telemetry
phase: documentation
status: confirmed
date: 2026-06-05
project-docs-found: yes
---

## Project Documentation Updated
| File | Section | Change |
|---|---|---|
| `obsidian-docs/Roadmap.md` | Phases table + new "Phase 9 — Workflow metrics ✅" section | Added Phase 9 row and a full section describing the metrics computed, the `harvest_workitem_metrics` tool, the `/wi-metrics` skill, the `workitem_metrics` store, and the code-span parsing note. |
| `obsidian-docs/Workitem Workflow.md` | Commands → new "Reporting" subsection | Added the `/wi-metrics [<WI>] [--save]` command row and a note clarifying it reads artifacts only and never mutates workitem state. |

## Workitem Documentation

### What was built
A retroactive **workflow-metrics layer** that reads the markdown artifacts every workitem phase already produces and turns them into telemetry — no changes to how workitems are created, so it works over the entire existing `workitem/` history immediately.

User-facing surfaces added:
- **`/wi-metrics` skill** (in all 4 command locations: `.claude/commands/`, `commands/`, `claude-plugin-release/commands/`, `adapters/opencode/.opencode/commands/`). Usage `/wi-metrics [<WI>] [--save]`. Renders a per-workitem table (AC pass rate, verdict, QA iterations, replans, gaps, total days) followed by a project rollup. Read-only by default; `--save` persists a snapshot. A `<WI>` token filters the rendered rows to one workitem.
- **`harvest_workitem_metrics` MCP tool** on the `dako-long-term-memory` server. Input `{ project, workitem_root, write? }`; returns a JSON text block `{ records, rollup, warnings, persisted }`. `write` defaults to `false` (zero writes); `write: true` upserts one record per `(wi, sub_feature)`.
- **`workitem_metrics` store** — a new collection (MongoDB) / table (SQLite) holding one idempotent record per sub-feature, separate from the existing `workitems` archive collection.

Metrics computed per sub-feature: `ac_total`, `ac_satisfied`, `ac_pass_rate`, `verdict`, `qa_iterations`, `deviation_count`, `dispatch_count`, `gaps_open`, `accepted_gaps`, `total_days`, `phase_days`, plus `warnings`. The project rollup adds `avg_ac_pass_rate`, `avg_qa_iterations`, `total_replans`, `avg_replans`, `total_gaps_open`, `avg_total_days`, and `wi_count_by_status`.

### How it works
Non-obvious facts a reader can't get from the code alone:

- **Pure-core / thin-shell split (`mcps/mongodb-memory/metrics.ts`).** All extractors (`parseAcMetrics`, `parseQaIterations`, `parseReplans`, `parseGaps`, `parsePhaseDays`, `computeRollup`) are string-in → record-out with zero `fs` imports, so they're unit-testable on string fixtures. Only `harvestTree(workitemRoot, project)` touches disk. This mirrors the small-pure-function style of `embed.ts`.
- **The MCP reads project files for the first time.** There is no `DAKO_PROJECT_ROOT` anywhere; `archive_workitem` receives pre-read content from its skill. Following that convention, `harvest_workitem_metrics` takes an absolute `workitem_root` supplied by the `/wi-metrics` skill rather than discovering it server-side. A non-existent root returns zero records + a top-level warning (it never throws).
- **Markdown cell parsing is code-span-aware (`metrics.ts` `tableCells`).** A naive `split("|")` breaks on pipes inside `` `code` `` spans and `\|` escapes. Real AC rows contain these (e.g. `` `--collection memories|messages|all` ``), which shifts the Satisfied column and miscounts the pass rate. `tableCells` walks char-by-char, toggling on backticks and honouring `\|`. The Satisfied column is also located **by header name**, not fixed position.
- **Averages exclude missing metrics (`computeRollup`).** Records lacking a metric (e.g. an in-flight WI with no `review.md` yet → `ac_pass_rate: null`) are filtered out *before* dividing — they are not counted as 0. `wi_count_by_status` buckets a null verdict under `"unknown"`, which is how in-flight workitems show up.
- **Calendar-day spans only (`parsePhaseDays`).** Artifacts carry only a `date:` frontmatter (no intra-day timestamps), so spans are whole-day deltas between consecutive *present* phases (first present phase = 0), computed at UTC midnight via `Date.UTC` to avoid TZ/DST drift. The propose phase maps to `approaches.md`, not `propose.md`.
- **Per-sub-feature error isolation (`harvestTree`).** Each sub-feature is wrapped in try/catch; one garbled folder yields a record with `warnings` and the walk continues.
- **Idempotent upsert in both adapters.** SQLite: `workitem_metrics` table with `UNIQUE(wi, sub_feature)` + `INSERT … ON CONFLICT DO UPDATE` inside a transaction (`SqliteStorage.ts`), `phase_days`/`warnings` JSON-stringified, `gaps_open` as 0/1. MongoDB: `updateOne({wi, sub_feature}, {$set}, {upsert:true})` with a unique `{wi:1, sub_feature:1}` index (`MongoStorage.ts`), native objects/arrays.
- **Test-only fix: `server.ts` main-guard.** `main()` is now guarded by `if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])` so importing the module (the test imports `handleHarvestWorkitemMetrics`) doesn't boot the stdio transport and hang `node --test`. Production `node server.js` behaviour is unchanged.

### Usage
Render a metrics report for the current project (read-only):
```
/wi-metrics
```
Scope to one workitem:
```
/wi-metrics WI-doctor
```
Harvest and persist a snapshot to the `workitem_metrics` store:
```
/wi-metrics --save
```
Direct MCP tool call (what the skill issues under the hood):
```json
{
  "tool": "harvest_workitem_metrics",
  "arguments": {
    "project": "DakoHarness",
    "workitem_root": "C:/lab/Proyectos/DakoHarness/workitem",
    "write": false
  }
}
```
Example real-tree result at time of writing: 14 records, `avg_ac_pass_rate ≈ 0.95`, `wi_count_by_status { pass: 10, accepted-with-gaps: 3, unknown: 1 }` (the `unknown` being this workitem, still in flight).

### Known limitations
Review verdict was a clean `pass`, so there are no accepted gaps. Deliberately deferred scope:
- **Day-granularity timing only.** `phase_days`/`total_days` are whole days because artifacts store no intra-day timestamps; same-day phases read 0. Real per-phase durations would need live instrumentation of the wi-* commands — deferred (Backlog).
- **Single-project rollup.** Cross-project/team aggregation is out of scope; the harvest is single-project by construction (`project` comes from the tool arg, not parsed per file).
- **No trend/time-series.** Each harvest is a current snapshot; historical metric versioning and charts would belong to a future MongoDB-dashboard effort.
- **Mongo adapter executed-test pending.** The Mongo branch of the AC-8 idempotency test is gated on a reachable server and did not run in the implementing session (Mongo was down); it is verified by code-read + SQLite parity and will exercise when a server is reachable.
- **Pre-existing `tsc` baseline unchanged.** Missing `@types/better-sqlite3` and an MCP-SDK `ServerResult.task` signature drift remain (tracked under the "TS housekeeping" backlog item); tests run against emitted `.js`.

## Confirmation
**Confirmed by user:** yes
**Notes:** Confirmed under the autonomous-execution grant.

## Cancellation
