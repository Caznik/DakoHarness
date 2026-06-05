---
wi: WI-metrics-gaps-parsing
created: 2026-06-05
updated: 2026-06-05
status: active
---

# WI-metrics-gaps-parsing

Follow-up bugfix to [[WI-workflow-metrics]]: `parseGaps` mis-extracted the `accepted_gaps` field — it kept markdown `**` bold markers and matched the phrase "Accepted gaps:" anywhere in the doc (including AC-evidence cells), not just the `## Verdict` line.

## Current State

| Field | Value |
|---|---|
| Phase | documentation |
| Blocked | no |

## Sub-features

| Sub-feature | State |
|---|---|
| 20260605-verdict-section-anchor | in-progress (intake, analyze, plan, implementation, review, documentation) |

## Active Blockers

_None._

## Key Decisions Log

| Date | Decision | Why |
|---|---|---|
| 2026-06-05 | Lightweight workitem (compact artifacts, no full interview) for a one-function regex fix | Surgical bugfix to `parseGaps` only; scope too small for full intake/analyze ceremony, but tracked for traceability per project norm. Driven autonomously under the user's standing grant. |
| 2026-06-05 | Anchor `accepted_gaps` extraction to the `## Verdict` section + strip `**` | Found by dogfooding `/wi-metrics` on the real tree: the whole-doc regex matched "Accepted gaps:" inside an AC-5 evidence cell of WI-workflow-metrics' own review.md, and kept the `**` from `**Accepted gaps:** none`. Anchoring to Verdict and stripping bold fixes both. |
| 2026-06-05 | Review verdict: pass — confirmed under autonomous grant | 28 metrics tests pass (3 new for bold-strip + section-anchor + outside-verdict cases), 76/76 full suite, real-tree re-harvest confirms clean accepted_gaps and the false positive gone. |

## Parking

_Not parked._

## Cancellation

_Not cancelled._
