---
name: wi-metrics
description: "Report workflow telemetry harvested from workitem artifacts (AC pass rate, QA iterations, replans, gaps, time per phase). Usage: /wi-metrics [<WI>] [--save]"
---

Harvest per-phase workitem artifacts into workflow metrics and render a report. Reads the existing `.md` artifacts under `workitem/` — it does not change how workitems are produced. Use it to see how the workflow is performing across all workitems, or to inspect one.

## Steps

1. Determine the project name: use the `DAKO_PROJECT` environment variable if set, otherwise the basename of the current working directory.

2. Resolve the absolute path to the repo's `workitem/` directory (the `workitem` folder at the project root). This is the `workitem_root` the tool needs — the MCP does not know the project layout, so you must pass it explicitly.

3. **Parse optional args.**
   - `--save` → call the tool with `write: true` (persists one record per `(wi, sub_feature)` to the `workitem_metrics` store). Without it, the harvest is read-only (`write: false`) and nothing is written.
   - Any non-flag token is a workitem filter, e.g. `WI-doctor` → render only rows for that WI. `/wi-metrics` with no token reports every workitem.

4. **Call `harvest_workitem_metrics`** with:
   - `project`: from step 1
   - `workitem_root`: the absolute path from step 2
   - `write`: true only if `--save` was passed, else false

5. **Parse the returned JSON** — it has `{ records, rollup, warnings, persisted }`. Each record carries: `wi`, `sub_feature`, `ac_pass_rate` (0–1 or null), `verdict`, `qa_iterations`, `deviation_count`, `dispatch_count`, `gaps_open`, `accepted_gaps`, `total_days`, `phase_days`, `warnings`. If a `<WI>` filter was given, keep only records whose `wi` matches.

6. **Render a per-WI table** with columns: WI / sub-feature, AC pass rate (as a percentage, `—` when null), verdict, QA iters, replans (`deviation_count + dispatch_count`), gaps (`open` if `gaps_open` else `clean`; append accepted-gap text when present), total days. One row per record.

7. **Render the project rollup** beneath the table as a short summary block from `rollup`: average AC pass rate, average QA iterations, total + average replans, total open gaps, average total days, and the workitem count by verdict status (`wi_count_by_status`). When a `<WI>` filter was applied, note that the rollup still reflects the whole project (the tool computes it before filtering) — recompute over the filtered rows yourself if a scoped rollup is wanted.

8. **Surface warnings.** If `warnings` (top-level) or any record's `warnings[]` is non-empty, list them briefly under the report so malformed/incomplete artifacts are visible rather than silently skewing the numbers. Do not invent metrics for records that came back null.

9. If `--save` was used, confirm persistence (`persisted: true`) and how many records were written.
