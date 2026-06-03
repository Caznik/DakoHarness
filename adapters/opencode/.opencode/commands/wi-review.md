---
name: wi-review
description: Run the review phase — verify every AC and plan step against the implementation, produce a verdict.
---

## When to use
After implementation is complete. Can also be run standalone to audit an existing workitem.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path
- If not provided: list workitems and ask which one
- Read `analyze.md`, `plan.md`, `implementation.md`

### 2. AC verification
For each AC in `analyze.md`:
- Does the implementation satisfy it?
- Provide evidence: point to specific code, test, or observable behaviour — not just "yes"
- Mark: satisfied / not satisfied

### 3. Plan coverage
For each step in `plan.md`:
- Was it implemented?
- Mark: yes / partial / no

### 4. Deviations review
Pull each row from `implementation.md` Plan Deviations:
- Assess: acceptable (intent preserved) or concern (AC impact)?

### 5. Identify gaps
- Any AC not satisfied → gap
- Any plan step not implemented → gap
- Any deviation assessed as concern → gap

### 6. Write `review.md`

```
---
wi: <path>
phase: review
status: pending
date: <YYYY-MM-DD>
verdict: pass | fail | accepted-with-gaps
---

## AC Verification
| AC | Description | Satisfied | Evidence / Notes |
|---|---|---|---|
| AC-1 | ... | yes / no | ... |

## Plan Coverage
| Step | Implemented | Notes |
|---|---|---|
| Step 1 | yes / partial / no | ... |

## Deviations Review
| Step | Deviation | Assessment |
|---|---|---|
| Step 2 | ... | acceptable / concern |

## Gaps
<ACs or steps not fully satisfied — with explanation>

## Verdict
**Result:** pass | fail | accepted-with-gaps
**Accepted gaps:** <list any the user explicitly accepted>

## Confirmation
**Confirmed by user:** no
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** review
**Reason:**
```

### 7. Present to user
- Show full analysis: AC table, plan coverage, deviations, gaps
- For each gap: "Accept this gap or send back to implementation?"
  - If send back: set `implementation.md` status → `in-progress`, update `source_of_truth.md`, chain into `/wi-implement`
  - If accept: record in Accepted gaps

### 8. Determine verdict
- `pass` — all ACs satisfied, all steps implemented, no unaccepted concerns
- `fail` — gaps exist that the user has not accepted (send back to implementation)
- `accepted-with-gaps` — gaps exist but user explicitly accepted each one

### 9. On confirmation
- Set `status` → `confirmed`, verdict → final, `Confirmed by user` → yes
- Write `review.md`
- Update `source_of_truth.md`: current phase → review, updated → today
