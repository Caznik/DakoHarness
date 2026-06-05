---
wi: WI-metrics-gaps-parsing/20260605-verdict-section-anchor
phase: plan
status: confirmed
date: 2026-06-05
approach: N/A (single direction)
---

## Context
**AC coverage:** AC-1, AC-2, AC-3, AC-4

## Implementation Sequence

### Step 1 — Anchor + de-bold the accepted_gaps extraction
**Satisfies:** AC-1, AC-2, AC-3
**Files:** `mcps/mongodb-memory/metrics.ts` (`parseGaps`)
**Description:** Replace the whole-doc regex `/Accepted gaps:\s*(.*)/i` (run against `reviewMd`) with one run against `sectionText(reviewMd, /Verdict/)` — reusing the existing section helper so the search is scoped to `## Verdict`. Capture only the rest of that line (`[^\n]*`), tolerate optional `**` after the colon (`\**`), then strip any remaining `*` from the value (`replace(/\*+/g,"")`) before the `none`→"" check. Update the doc comment to state the Verdict-scoping + bold-stripping.

### Step 2 — Tests
**Satisfies:** AC-1, AC-2, AC-3, AC-4
**Files:** `mcps/mongodb-memory/metrics.test.ts`
**Description:** Add two `parseGaps` tests: (a) bold-stripping for `**Accepted gaps:** none` → "" and `**Accepted gaps:** AC-3 deferred` → text; (b) a doc with "Accepted gaps:" in an AC-evidence cell + a real Verdict line, asserting the Verdict line wins. Keep the two existing `parseGaps` tests (plain, no-bold) as the regression guard for AC-4; run the full suite.

## Risks / Known Unknowns
- `sectionText(/Verdict/)` must not match `## Deviations Review` or `## AC Verification` (no "Verdict" substring — confirmed). If a `review.md` lacked a `## Verdict` heading, `accepted_gaps` becomes "" — acceptable (more correct than matching noise), and all templates include `## Verdict`.

## Confirmation
**Confirmed by user:** yes
**Notes:** Autonomous grant; git stops before commit.
