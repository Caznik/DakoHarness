---
wi: WI-workflow-metrics
created: 2026-06-05
updated: 2026-06-05
status: completed
---

# WI-workflow-metrics

Workflow telemetry layer — harvest per-phase workitem artifacts into metrics (AC pass rate, QA-loop iterations, replan frequency, time per phase) stored alongside the existing `workitems` MongoDB collection.

## Current State

| Field | Value |
|---|---|
| Phase | archive |
| Blocked | no |

## Sub-features

| Sub-feature | State |
|---|---|
| 20260605-artifact-telemetry | completed (all phases) |

## Active Blockers

_None._

## Key Decisions Log

| Date | Decision | Why |
|---|---|---|
| 2026-06-05 | Run full workflow for the metrics layer | New cross-cutting capability touching the MCP storage layer and wi-* phases; not phase-specific or trivial, so it warrants full traceability. |
| 2026-06-05 | Collect metrics by retroactive harvest of existing artifact `.md` files (not live instrumentation) | User selected this at intake — works on all existing workitems immediately with zero changes to the wi-* commands; live emission left as a possible follow-up. |
| 2026-06-05 | Metric set = AC pass rate + QA-loop iterations + replan/deviation count + gaps/accepted-gaps; timing as calendar-day spans | These four families are fully recoverable from existing artifact tables; gate-turnaround dropped because it needs intra-day timestamps that don't exist. Day-granularity timing accepted as honestly-labelled rather than deferred. |
| 2026-06-05 | Output = new `harvest_workitem_metrics` MCP tool + `/wi-metrics` report skill; per-WI + project rollup | User wanted a full read surface and cross-WI aggregates, not storage-only or per-item-only. |
| 2026-06-05 | Persist to a separate `workitem_metrics` store (both adapters), read-only by default (`--save` opts in) | In-flight WIs aren't in the `workitems` collection (archive-only), so metrics need their own store; read-only default avoids surprise writes when just viewing a report. |
| 2026-06-05 | analyze.md signed off; skipping propose phase | Approach is settled — the open questions are agent leans to confirm in plan, not competing viable directions, so no propose phase is warranted. |
| 2026-06-05 | Plan: isolate pure extractors (`metrics.ts`) from the single fs-touching `harvestTree`; tool receives absolute `workitem_root` from the skill | MCP has never read project files (no `DAKO_PROJECT_ROOT`); keeping extraction string-in/record-out makes 9 of 12 ACs unit-testable on fixtures without fs, mirroring how `archive_workitem` lets the caller supply paths. |
| 2026-06-05 | Plan signed off; user granted autonomous execution ("as if dangerously-skip-permissions") — proceeding plan→implement without per-gate prompts | User explicitly requested momentum; git/repo actions remain the one carve-out requiring explicit approval. |
| 2026-06-05 | wi-implement dispatch #1 for 20260605-artifact-telemetry | initial |
| 2026-06-05 | Implementation completed inline (sub-agent dispatch declined by user) — all 12 ACs COVERED, 73/73 tests pass | User rejected the wi-implementer sub-agent and said "keep going"; finished in main context. Two in-flight fixes: ESM main-guard in server.ts (test-import hang) and code-span-aware `tableCells` (real-tree smoke caught a 13/14 AC miscount on pipes inside code spans). |
| 2026-06-05 | Review verdict: pass, no gaps — confirmed under autonomous grant | All 12 ACs independently verified (SQLite re-run, Mongo branch read-verified as it was unreachable); both deviations acceptable. Scope notes recorded: Mongo not executed this session; pre-existing tsc baseline unchanged. |
| 2026-06-05 | Documentation: updated Roadmap (new Phase 9) + Workitem Workflow command ref; wrote documentation.md | Roadmap is the capability tracker that prompted this WI; Workitem Workflow doc is the canonical command reference. Confirmed under autonomous grant. |
| 2026-06-05 | Repo: committed 44 files as 91e33e0 on branch feat/WI-workflow-metrics | User explicitly approved the suggested commit message; branched off main first per the no-commit-on-main rule. Commit scoped to WI files + recompiled artifacts; unrelated pre-existing working-tree changes left untouched. |
| 2026-06-05 | Pushed branch to origin; archived to MongoDB workitems collection — WI completed | User approved push + archive. Pushed feat/WI-workflow-metrics (PR link issued). Archive done via the storage layer's archiveWorkitem directly (MCP server was down but MongoDB reachable; identical code path), tagged with commit 91e33e0; verified present in workitems collection. |

## Parking

_Not parked._

## Cancellation

_Not cancelled._
