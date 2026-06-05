---
wi: WI-metrics-gaps-parsing/20260605-verdict-section-anchor
phase: analyze
status: confirmed
date: 2026-06-05
---

## Requirements

### Functional
1. `parseGaps` must extract `accepted_gaps` only from the `## Verdict` section of `review.md`, not from any other occurrence of the literal "Accepted gaps:" elsewhere in the document (e.g. an AC-evidence cell).
2. Markdown bold markers (`**`) around the label/value must be stripped, so `**Accepted gaps:** none` yields `""` and `**Accepted gaps:** AC-3 deferred` yields `AC-3 deferred`.
3. Existing behaviour preserved: `gaps_open` logic unchanged; a literal `none` (any casing) → `""`; a plain `Accepted gaps: <text>` (no bold) still works.

### Non-functional
- No new dependencies; pure string change in `metrics.ts`.
- Covered by `node --test`; existing 5 suites + the metrics suite stay green.

## Out of Scope
- The `**` noise on other free-text fields — `accepted_gaps` is the only affected field; no other metric carries markdown through.
- Re-persisting historical `workitem_metrics` rows — none were saved (`/wi-metrics` ran read-only); next `--save` will store the corrected values.

## Acceptance Criteria
- [ ] **AC-1** — Given a `review.md` whose `## Verdict` has `**Accepted gaps:** none`, `parseGaps` returns `accepted_gaps === ""` (no `**`/`none` leakage). Verified by `metrics.test.ts::parseGaps strips markdown bold from Accepted gaps`.
- [ ] **AC-2** — Given `**Accepted gaps:** AC-3 deferred to follow-up`, returns exactly `AC-3 deferred to follow-up`. Same test.
- [ ] **AC-3** — Given a doc where "Accepted gaps:" appears in an AC-evidence cell AND in `## Verdict`, `parseGaps` reads the Verdict line only. Verified by `metrics.test.ts::parseGaps ignores 'Accepted gaps:' outside the Verdict section`.
- [ ] **AC-4** — Pre-existing `parseGaps` tests and the full suite still pass (no regression). Full `node --test` run.

## Sign-off
**Confirmed by user:** yes
**Date:** 2026-06-05
