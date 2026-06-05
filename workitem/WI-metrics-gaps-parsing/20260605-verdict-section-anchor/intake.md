---
wi: WI-metrics-gaps-parsing/20260605-verdict-section-anchor
phase: intake
status: confirmed
date: 2026-06-05
---

# Intake — Fix accepted_gaps parsing

## Request
> fix the accepted_gaps parsing in a follow-up

Follows the first live `/wi-metrics` run, which surfaced that `parseGaps` (`mcps/mongodb-memory/metrics.ts`) returns a noisy `accepted_gaps`: values like `"** none"` (markdown bold not stripped) and, for WI-workflow-metrics, the string captured from inside an AC-5 evidence cell rather than the `## Verdict` line.

## Classification
- **Type:** Bugfix (parsing correctness)
- **Scope:** `parseGaps` in `metrics.ts` + its tests only. No schema, tool, or skill changes. `gaps_open`, pass rates, and verdicts are already correct and untouched.

## Routing Decision
- **Flow:** Lightweight workitem — compact artifacts, no requirements interview.
- **Rationale:** One-function regex fix with a clear, observed defect. Free-flow rejected (it's behaviour-affecting and deserves a record); full workflow rejected (no trade-offs to interview, scope is a single function).

## Confirmation
- Confirmed by user: **yes** ("fix … in a follow-up"); driven autonomously under standing grant.
