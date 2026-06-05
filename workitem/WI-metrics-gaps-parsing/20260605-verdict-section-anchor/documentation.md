---
wi: WI-metrics-gaps-parsing/20260605-verdict-section-anchor
phase: documentation
status: confirmed
date: 2026-06-05
project-docs-found: yes
---

## Project Documentation Updated
| File | Section | Change |
|---|---|---|
| — | — | None. Internal parsing fix with no user-facing surface change; the Roadmap "Phase 9" and Workitem Workflow command reference already describe `/wi-metrics` accurately. |

## Workitem Documentation

### What was built
A correctness fix to the workflow-metrics harvester's `parseGaps` (`mcps/mongodb-memory/metrics.ts`). The `accepted_gaps` field it returns is now clean: markdown bold is stripped and the value is read only from the `## Verdict` section.

### How it works
`parseGaps` previously ran `/Accepted gaps:\s*(.*)/i` over the entire `review.md`. Two defects followed: (1) it kept the `**` from `**Accepted gaps:** none` (yielding `"** none"`), and (2) it matched the first occurrence of the literal phrase anywhere — which for WI-workflow-metrics' own review was inside an AC-5 evidence cell, not the Verdict line. The fix scopes the search to `sectionText(reviewMd, /Verdict/)` (reusing the same helper `parseAcMetrics` uses for `## AC Verification`), captures only the rest of that line, tolerates `**` after the colon, and strips residual `*` before the `none`→"" check. `gaps_open` and all other metrics were already correct and are untouched.

### Usage
No interface change. Re-run `/wi-metrics` (or `/wi-metrics --save` to persist corrected values) and the per-WI "gaps" column / `accepted_gaps` field reflect the clean text.

### Known limitations
None. If a `review.md` had no `## Verdict` heading, `accepted_gaps` would be `""` — acceptable and more correct than matching stray text; all phase templates include `## Verdict`.

## Confirmation
**Confirmed by user:** yes
**Notes:** Confirmed under autonomous grant.
