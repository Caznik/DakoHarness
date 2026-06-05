---
wi: WI-workflow-metrics/20260605-artifact-telemetry
phase: plan
status: pending
date: 2026-06-05
approach: N/A (propose skipped — single settled direction)
---

## Context

**Selected approach:** Retroactive markdown harvest. A new pure-parser module (`metrics.ts`) extracts metrics from artifact file *contents*; a thin filesystem walk in the same module discovers and reads the `workitem/` tree; a new `harvest_workitem_metrics` MCP tool wires the walk to optional persistence in a new `workitem_metrics` store (both adapters); a `/wi-metrics` skill renders the report.

**Architecture note (drives Step ordering):** The MCP has never read project files — `archive_workitem` receives pre-read content from the skill, and no `DAKO_PROJECT_ROOT` exists anywhere (verified). This WI introduces the first fs reads inside the MCP. To keep that testable, all metric *extraction* is pure string-in → record-out (no fs), and only a single `harvestTree(workitemRoot)` function touches the disk. The tool receives the absolute `workitem_root` from the skill (which knows the repo cwd), mirroring how `archive_workitem` lets the caller supply paths.

**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12 *(all 12 covered — map at end)*

## Implementation Sequence

### Step 1 — Pure metric extractors + markdown helpers (`metrics.ts`)
**Satisfies:** AC-2, AC-3, AC-4, AC-5, AC-6, AC-11
**Files:** `mcps/mongodb-memory/metrics.ts` (new)
**Description:** New module with no fs imports, so every extractor is unit-testable on string fixtures. Implement small markdown helpers first (shared by the rest):
- `parseFrontmatter(md): Record<string,string>` — read the leading `---`-fenced YAML block; tolerate missing/garbled blocks by returning `{}` (feeds AC-11).
- `tableDataRows(md, headingRegex): string[]` — locate a `## <heading>` section, return its markdown table rows excluding the header and `|---|` separator. Returns `[]` when the section or table is absent.
- `sectionText(md, headingRegex): string` — raw text of a `## <heading>` section body.

Then the extractors, each returning a typed partial of the metric record and pushing to a `warnings: string[]` on parse trouble rather than throwing:
- `parseAcMetrics(reviewMd)` → `{ ac_total, ac_satisfied, ac_pass_rate, verdict }`. Count rows of the `## AC Verification` table; `ac_satisfied` = rows whose Satisfied cell (the 3rd `|`-column, lowercased, trimmed) is `yes`; `ac_pass_rate = ac_total ? ac_satisfied/ac_total : null`; `verdict` from frontmatter (`pass`/`fail`/null). Missing Satisfied column → push warning, leave counts as parsed. **AC-2, AC-11.**
- `parseQaIterations(implMd)` → `qa_iterations` = `tableDataRows(md, /QA Log/).length`; no table → 0. **AC-3.**
- `parseReplans(implMd, sotMd)` → `{ deviation_count, dispatch_count }`. `deviation_count` = `tableDataRows(implMd, /Plan Deviations/).length`. `dispatch_count` = count of distinct lines in `sotMd` matching `/dispatch #\d+/i` (distinct rows, not max N — Open Q4 lean). **AC-4.**
- `parseGaps(reviewMd)` → `{ gaps_open, accepted_gaps }`. `gaps_open` = false iff `sectionText(/Gaps/)` trimmed is empty or starts with `none` (case-insensitive); `accepted_gaps` = text after `Accepted gaps:` in the Verdict section, `none`→"". **AC-5.**
- `parsePhaseDays(phaseDates, createdDate)` → `{ phase_days: Record<phase,number>, total_days }`. Input is the ordered list `[intake, analyze, propose, plan, implementation, review, documentation]` of `{phase, date|null}`; for each present phase, whole-day delta from the previous *present* phase's date (first present = 0); `total_days` = whole-day delta `created → max(date)`. Use UTC midnight diff to avoid TZ/DST drift. **AC-6.**

Follow the existing module style in `embed.ts` (small exported pure functions, no class). No new deps — pure string work.

### Step 2 — Tree walk + record assembly + rollup (`metrics.ts`)
**Satisfies:** AC-1, AC-7, AC-11
**Files:** `mcps/mongodb-memory/metrics.ts` (same module)
**Description:** Add the only fs-touching function plus the aggregator:
- `harvestTree(workitemRoot): { records: WorkitemMetricsRecord[] }`. Use `node:fs` to list `workitemRoot/WI-*` dirs (skip non-`WI-` entries → AC-1); for each, read `source_of_truth.md`; list its `<YYYYMMDD>-*` sub-folders; for each sub-folder read whatever phase artifacts exist and call the Step-1 extractors. Wrap each sub-feature's processing in try/catch so one unreadable/garbled sub-feature yields a record with `warnings` and the walk continues (AC-11). Each record carries `{ wi, sub_feature, project, ...metrics, warnings }`.
- `computeRollup(records)` → aggregates: `avg_ac_pass_rate`, `avg_qa_iterations`, `total_replans` (Σ deviation_count+dispatch_count), `avg_replans`, `total_gaps_open`, `avg_total_days`, `wi_count_by_status`. Averages exclude records missing that metric (filter nulls before dividing — explicitly *not* counting them as 0, per AC-7). **AC-7.**

`project` for records comes from the tool arg (the harvest is single-project), not parsed from files.

### Step 3 — `workitem_metrics` store: interface + both adapters
**Satisfies:** AC-8
**Files:** `mcps/mongodb-memory/storage/Storage.ts`, `storage/SqliteStorage.ts`, `storage/MongoStorage.ts`
**Description:**
- `Storage.ts`: add `WorkitemMetricsRecord` type and two interface methods: `saveWorkitemMetrics(records: WorkitemMetricsRecord[]): Promise<ToolResult>` and `getWorkitemMetrics(project: string): Promise<WorkitemMetricsRecord[]>`. Add the new collection to the field-mapping doc comment block (keep the doc convention at the top of the file current).
- `SqliteStorage.ts`: add a `CREATE TABLE IF NOT EXISTS workitem_metrics (...)` to the schema init block (alongside the `workitems` table at line ~117) with columns `wi, sub_feature, project, ac_total, ac_satisfied, ac_pass_rate, verdict, qa_iterations, deviation_count, dispatch_count, gaps_open, accepted_gaps, total_days, phase_days TEXT (JSON), warnings TEXT (JSON), harvested_at TEXT` and `UNIQUE(wi, sub_feature)`. Implement `saveWorkitemMetrics` as `INSERT ... ON CONFLICT(wi, sub_feature) DO UPDATE` (idempotent — AC-8). Follow the prepared-statement style of `archiveWorkitem` at line 448.
- `MongoStorage.ts`: mirror — `updateOne({wi, sub_feature}, {$set:{...}}, {upsert:true})`; add a `createIndex({ wi:1, sub_feature:1 }, {unique:true})` in the same init spot the `messages` `{embedding_model:1}` index was added (line ~83). Store `phase_days`/`warnings` as native objects/arrays.

### Step 4 — Register `harvest_workitem_metrics` MCP tool
**Satisfies:** AC-9
**Files:** `mcps/mongodb-memory/server.ts`
**Description:** Add a tool entry in the `ListToolsRequestSchema` block (after `archive_workitem`, line ~220): schema `{ project: string, workitem_root: string, write?: boolean(default false) }`. In the `CallToolRequestSchema` router (line ~260) add `if (name === "harvest_workitem_metrics")` → call `harvestTree(args.workitem_root)`, `computeRollup`, then when `args.write` is true call `storage.saveWorkitemMetrics(records)`; always return a text block containing both the per-record array and the rollup (JSON, mirroring how other tools serialize results). `write:false` must perform zero writes (AC-9). Follow the routing style at server.ts:260.

### Step 5 — `/wi-metrics` skill (4 mirrors)
**Satisfies:** AC-10
**Files (new, byte-identical):** `.claude/commands/wi-metrics.md`, `commands/wi-metrics.md`, `claude-plugin-release/commands/wi-metrics.md`, `adapters/opencode/.opencode/commands/wi-metrics.md`
**Description:** Skill instructs the agent to: resolve the project name and the absolute path to the repo's `workitem/` dir; call `harvest_workitem_metrics` with `{project, workitem_root, write:false}` (or `write:true` when invoked as `/wi-metrics --save`); render a per-WI table (columns: WI, AC pass rate, verdict, QA iters, replans, gaps, total days) followed by a project-rollup summary block; `/wi-metrics <WI>` filters the rendered rows to that workitem. Match the structure/length discipline of the existing `recall-session.md` mirror set (verified 4 locations exist via git status). After writing, the 4 files must be byte-identical (AC-10).

### Step 6 — Tests + test-runner wiring
**Satisfies:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-11, AC-12
**Files:** `mcps/mongodb-memory/metrics.test.ts` (new), `mcps/mongodb-memory/package.json`
**Description:** `node --test` suite following `recall-session-messages.test.ts` style:
- String-fixture tests for each Step-1 extractor: AC table all-yes / mixed (AC-2), QA Log N-rows / no-table (AC-3), deviations+dispatch present / absent (AC-4), gaps None / non-empty + accepted-gaps (AC-5), phase-days multi-date + same-day all-zero (AC-6).
- A temp fixture-tree test for `harvestTree`: write a couple of `WI-*/<date>-*/` folders + a non-`WI` dir under a `mkdtemp` dir, assert record count = sub-feature count and non-WI skipped (AC-1); include one deliberately-malformed sub-feature asserting the walk still returns all records with a populated `warnings` (AC-11).
- `computeRollup` test with hand-computed aggregates incl. a null-metric record excluded from its average (AC-7).
- SQLite `saveWorkitemMetrics` double-write test asserting row count stays 1 (AC-8); Mongo equivalent gated on `mongoReachable()`.
- A `harvest_workitem_metrics` handler test asserting `write:false` leaves the store empty and `write:true` upserts (AC-9) — reuse the temp-tree fixture.
- Add `metrics.test.js` to the `test` script's `node --test` argument list in `package.json` so it runs under `npm test` (AC-12); confirm the existing 5 suites still pass unchanged (AC-12 regression).

## Risks / Known Unknowns

- **Table-column parsing brittleness.** Extractors key off the *position* of the Satisfied column in `## AC Verification`. If a real `review.md` reorders columns, the count is wrong. Mitigation: match the header row to find the Satisfied column index rather than hardcoding column 3; *if* the header lacks a "Satisfied" cell, push a warning and set the metric null (AC-11 path) rather than guessing.
- **`workitem_root` resolution.** The tool trusts the skill to pass an absolute path. If the agent passes a relative or wrong path, `harvestTree` should treat a non-existent root as zero records + a top-level warning, not throw. Observation that triggers deviation: if MCP cwd turns out to reliably equal the repo root in practice, we could default `workitem_root` to `join(cwd, "workitem")` — but do not rely on it; keep it a required arg.
- **`propose` artifact filename.** Existing WIs use `approaches.md` (not `propose.md`) for the propose phase. `parsePhaseDays` must look for `approaches.md` when mapping the propose slot, else that phase always reads absent. Confirmed via the file listing in this WI's exploration.
- **Pre-existing `tsc` errors.** `npm test` runs `tsc` first, which exits non-zero on baseline TS errors unrelated to this WI (documented in the roadmap backlog). Tests still execute via the emitted `.js`. Do not attempt to fix those here (out of scope); just confirm the new test file emits and runs, matching how `recall-session-messages` coped.

## Confirmation
**Confirmed by user:** yes
**Notes:** User granted autonomous execution ("execute as if dangerously-skip-permissions") — plan sign-off treated as granted; proceeding to implement. Git/repo actions explicitly excluded from auto-execution.

## Cancellation
*(n/a)*
