---
wi: WI-metrics-gaps-parsing/20260605-verdict-section-anchor
phase: implementation
status: completed
date: 2026-06-05
---

## Architecture Notes
Single-function change in `metrics.ts::parseGaps`. Reuses the existing `sectionText` helper to scope the search to `## Verdict` — no new helper, consistent with how `parseAcMetrics` already scopes to `## AC Verification`. The regex `/Accepted gaps:\s*\**\s*([^\n]*)/i` captures only the remainder of the line and tolerates the `**` after the colon; `replace(/\*+/g,"")` clears any residual bold before the `none`→"" normalisation.

## Plan Deviations
| Step | Original plan | What actually happened | Reason |
|---|---|---|---|

## Blockers
| # | Description | Resolution | Status |
|---|---|---|---|

## AC Pre-Check
| AC | Test / Evidence | Status |
|---|---|---|
| AC-1 | `metrics.test.ts::parseGaps strips markdown bold from Accepted gaps (AC-5)` — `**Accepted gaps:** none` → `""`. | COVERED |
| AC-2 | same test — `**Accepted gaps:** AC-3 deferred to follow-up` → exact text. | COVERED |
| AC-3 | `metrics.test.ts::parseGaps ignores 'Accepted gaps:' outside the Verdict section (AC-5)` — evidence-cell occurrence ignored, Verdict line read. | COVERED |
| AC-4 | Pre-existing `parseGaps None.` + `parseGaps non-empty` tests still pass; full suite **76/76**. Real-tree re-harvest: 3 open-gap WIs show clean accepted text, WI-workflow-metrics now `accepted_gaps=""` (false positive gone). | COVERED |

## QA Log
| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-1..AC-4 | PASS | `node --test metrics.test.js` 28/28; full suite 76/76; re-harvested real tree — accepted_gaps clean across all 14 records. |

## Regression
**Test suite run:** yes — `node --test` over all 6 suites
**Result:** pass — 76 tests, 0 fail, 0 cancelled.
**Failures:** none.
