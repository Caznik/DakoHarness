---
wi: WI-workflow-metrics/20260605-artifact-telemetry
phase: analyze
status: confirmed
date: 2026-06-05
---

## Requirements

### Functional

1. **Harvester discovery** — A harvester walks `<DAKO_PROJECT_ROOT>/workitem/WI-*/` and, for each `WI-*` directory, discovers every `<YYYYMMDD>-<sub-feature>/` sub-folder. For each sub-feature it locates the per-phase artifacts (`intake.md`, `analyze.md`, `propose.md`/`approaches.md`, `plan.md`, `implementation.md`, `review.md`, `documentation.md`) and the WI-level `source_of_truth.md`. Missing artifacts are tolerated (the WI may be mid-flight).

2. **AC pass rate** — From `review.md`: parse the `## AC Verification` markdown table, counting total AC rows and rows whose Satisfied column is `yes`; emit `ac_total`, `ac_satisfied`, `ac_pass_rate = ac_satisfied / ac_total` (null when `ac_total = 0`), and the frontmatter `verdict` (`pass` / `fail` / absent → null).

3. **QA-loop iterations** — From `implementation.md`: parse the `## QA Log` table and emit `qa_iterations` = number of data rows (header + separator excluded). No `## QA Log` table or zero data rows → `qa_iterations = 0`.

4. **Replan / deviation count** — From `implementation.md`: `deviation_count` = number of data rows in the `## Plan Deviations` table. From `source_of_truth.md` Key Decisions Log: `dispatch_count` = number of entries matching `dispatch #<n>` (a resume/replan signal). Both default to 0 when absent.

5. **Gaps** — From `review.md`: `gaps_open` = true unless the `## Gaps` section text is exactly/starts with `None` (case-insensitive) or is empty; `accepted_gaps` = the text after `Accepted gaps:` in the Verdict section (`none` → empty).

6. **Calendar-day phase spans** — Collect the `date:` frontmatter from each present phase artifact, ordered intake → analyze → propose → plan → implementation → review → documentation. Emit `phase_days` = map of `<phase> → whole-day delta from the previous present phase's date` (first present phase = 0), and `total_days` = delta from `source_of_truth.md` `created` to the latest artifact `date`. Same-day transitions yield 0. Granularity is explicitly **days** (no intra-day timestamps exist).

7. **Project rollup** — Across all harvested sub-features that have the relevant metric, emit aggregates: `avg_ac_pass_rate`, `avg_qa_iterations`, `total_replans` (sum of deviation_count + dispatch_count) and `avg_replans`, `total_gaps_open`, `avg_total_days`, and `wi_count_by_status` (counts by `source_of_truth.md` `status`). WIs missing a metric are excluded from that metric's average (not counted as zero).

8. **Persistence** — A new `workitem_metrics` store, implemented in **both** storage adapters (`MongoStorage`, `SqliteStorage`) behind the `Storage` interface, upserts one record per `(wi, sub_feature)` keyed so re-harvest is idempotent (no duplicate rows). The project rollup is returned in the harvest result; persistence of per-sub-feature records happens only when the caller opts in (`write: true`).

9. **MCP tool** — A new `harvest_workitem_metrics` tool registered in `mcps/mongodb-memory/server.ts` with a schema accepting `{ project: string, write?: boolean }`; it returns the per-sub-feature metrics array plus the project rollup as structured text. Default `write` = false (read-only).

10. **`/wi-metrics` skill** — A new skill that calls `harvest_workitem_metrics` and renders a markdown report: a per-WI table (AC pass rate, verdict, QA iterations, replans, gaps, total days) followed by a project rollup summary block. `/wi-metrics <WI>` scopes the report to one workitem; `/wi-metrics --save` invokes the tool with `write: true`. Mirrored to every command location.

11. **Robustness** — A malformed or partially-written artifact (missing table, unparseable frontmatter, missing `Satisfied` column) sets the affected metric to null/0 and records a per-sub-feature `warnings[]` entry; the harvest continues to the next sub-feature without throwing (per-item error isolation, mirroring `embed-backfill`).

### Non-functional

- **No new runtime dependencies** — metric extraction is pure Node string/markdown-table parsing; reuses the existing TS/Node toolchain in `mcps/mongodb-memory`.
- **Adapter parity** — the `workitem_metrics` store exists in both `MongoStorage` and `SqliteStorage` with the same record shape, consistent with the pluggable-backend convention.
- **Tested via `node --test`** — fixture-based unit tests (sample artifact `.md` files) covering each extractor's happy path, an incomplete-WI path, and a malformed-table path, following the existing `recall-session-messages.test.ts` style.
- **Skill mirror parity** — `/wi-metrics` lands in all 4 command locations: `.claude/commands/`, `commands/`, `claude-plugin-release/commands/`, and `adapters/opencode/.opencode/commands/`.
- **Zero regression** — existing MCP tools and their tests pass unchanged; the new tool and store are additive.

## Out of Scope

- **Live per-phase instrumentation / real timestamps** — deferred; this WI harvests only what artifacts already record (day-granularity). Surfacing intra-day timing requires emitting timestamps from the wi-* commands, a separate follow-up.
- **Cross-project / team-wide metrics** — rollup is scoped to one `project`; aggregating across projects is out.
- **Trend/time-series storage or charts** — a single current-snapshot harvest only; no historical metric versioning or visualization (the MongoDB-dashboard backlog item would own that).
- **Gate-turnaround timing** — was considered but rests on the same missing-timestamp limitation as phase timing; not separately computed.
- **Editing the wi-* phase commands** — no changes to how artifacts are produced; harvest is read-only over existing output.

## Open Questions

1. Storage shape: separate `workitem_metrics` collection vs. a `metrics` field on existing `workitems` docs. **Lean:** separate `workitem_metrics` collection/table, keyed by `(wi, sub_feature)` — `workitems` is only populated at archive time, but metrics must work for in-flight WIs too.
2. Sub-feature vs. WI granularity for the per-WI report row. **Lean:** compute metrics per sub-feature folder (the real artifact unit), then aggregate to a WI-level row in the report; persist at sub-feature grain.
3. Default persistence behavior of `/wi-metrics`. **Lean:** read-only render by default; persist only on explicit `/wi-metrics --save` (tool `write: true`), so running the report never mutates storage unexpectedly.
4. How "dispatch #N" replans are counted when N repeats or is non-sequential. **Lean:** count distinct dispatch entries (rows), not max N, so it survives non-sequential numbering.

## Acceptance Criteria

- [ ] **AC-1** — Given a `workitem/` tree under `DAKO_PROJECT_ROOT` with multiple `WI-*/` dirs each containing `<date>-<sub>/` folders, when `harvest_workitem_metrics` runs, then it returns one metrics record per discovered sub-feature folder and skips non-`WI-*` entries. Verified by a fixture-tree test asserting the returned record count equals the sub-feature folder count.
- [ ] **AC-2** — Given a `review.md` whose `## AC Verification` table has 14 rows with 14 `yes`, when harvested, then the record reports `ac_total=14`, `ac_satisfied=14`, `ac_pass_rate=1.0`, `verdict="pass"`. A fixture with mixed yes/no asserts the fractional rate.
- [ ] **AC-3** — Given an `implementation.md` whose `## QA Log` table has N data rows, when harvested, then `qa_iterations=N`; given no `## QA Log` table, `qa_iterations=0`. Both branches covered by fixtures.
- [ ] **AC-4** — Given an `implementation.md` with a `## Plan Deviations` table of D rows and a `source_of_truth.md` decision log containing K `dispatch #<n>` entries, when harvested, then `deviation_count=D` and `dispatch_count=K`; absent tables yield 0. Verified by a fixture with both present and a fixture with neither.
- [ ] **AC-5** — Given a `review.md` with `## Gaps` text `None.`, `gaps_open=false`; given non-empty gap text, `gaps_open=true`; the `Accepted gaps:` value is extracted into `accepted_gaps` (`none` → empty string). Covered by two fixtures.
- [ ] **AC-6** — Given phase artifacts dated intake 2026-06-01, plan 2026-06-03, review 2026-06-03, when harvested, then `phase_days["plan"]=2`, `phase_days["review"]=0`, and `total_days` equals (latest date − `created`) in whole days. A same-day-WI fixture asserts all-zero spans.
- [ ] **AC-7** — Given ≥2 harvested sub-features with known per-item metrics, when the rollup is computed, then `avg_ac_pass_rate`, `avg_qa_iterations`, `total_replans`, `avg_replans`, `total_gaps_open`, `avg_total_days`, and `wi_count_by_status` match hand-computed values, and a sub-feature missing `ac_pass_rate` is excluded from that average (not averaged as 0). Verified by a multi-WI fixture test.
- [ ] **AC-8** — `Storage` interface gains a `saveWorkitemMetrics`/`getWorkitemMetrics` method (or equivalent) implemented by both `MongoStorage` and `SqliteStorage`; upserting the same `(wi, sub_feature)` twice leaves exactly one record (idempotent). Verified on the SQLite adapter (and the Mongo adapter when reachable) by a double-write test asserting count==1.
- [ ] **AC-9** — `harvest_workitem_metrics` is registered in `server.ts` with schema `{ project, write? }`; called with `write:false` it returns metrics + rollup as text and writes nothing to `workitem_metrics` (store count unchanged); with `write:true` it upserts per-sub-feature records. Both branches asserted.
- [ ] **AC-10** — `/wi-metrics` skill file exists in all 4 command locations with byte-identical content, documenting: project resolution, the `harvest_workitem_metrics` call, per-WI table + rollup rendering, the `<WI>` scoping arg, and the `--save` flag mapping to `write:true`. Verified by comparing the 4 files.
- [ ] **AC-11** — Given a sub-feature whose `review.md` has a malformed AC table (missing Satisfied column) and another with unparseable frontmatter, when harvested, then each affected record has the metric null/0 with a populated `warnings[]`, the harvest completes for all other sub-features, and the tool does not throw. Verified by a malformed-fixture test asserting total records still returned.
- [ ] **AC-12** — Existing `mcps/mongodb-memory` test suite (`migrate`, `embed`, `embed-backfill`, `recall-hybrid`, `recall-session-messages`) passes unchanged after the additions, and `npm test`'s test runner picks up the new metrics test file. Verified by a full `node --test` run.

## Interview Notes

- **Collection mechanism = retroactive harvest** (chosen at intake): parse existing artifact `.md` files; no changes to wi-* commands. Picked because it works over all 18+ existing workitems immediately with zero instrumentation.
- **Metric set** (user multi-select): all four feasible families included — AC pass rate, QA-loop iterations, replan/deviation count, and gaps/accepted-gaps. The infeasible ones (gate-turnaround) were dropped because they share the missing-timestamp limitation.
- **Timing = calendar-day spans** (user choice over skip/defer): user accepted day-granularity as honestly-labelled rather than dropping timing or waiting for live instrumentation. Agent surfaced that many WIs complete same-day so several spans will read 0 — accepted.
- **Output = new MCP tool + `/wi-metrics` report** (user choice): full read surface preferred over storage-only or report-file-only. Implies a registered tool and a mirrored skill.
- **Scope = per-WI + project rollup** (user choice): cross-WI aggregates wanted (avg pass rate, avg QA iterations, total replans), not just per-item rows.
- Agent-proposed leans recorded as Open Questions 1–4 (separate `workitem_metrics` store, per-sub-feature grain, read-only default, distinct-dispatch counting) for the plan to confirm.

## Sign-off
**Confirmed by user:** yes
**Date:** 2026-06-05
