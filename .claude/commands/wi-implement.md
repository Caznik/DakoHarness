---
name: wi-implement
description: Run the implementation phase — architecture review, TDD coding, QA loop, and regression testing.
---

## When to use
After plan is confirmed. The most critical phase — follow the plan strictly and log all deviations.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path
- If not provided: list workitems and ask which one
- Read `plan.md` and `analyze.md`
- Create `implementation.md` with `status: in-progress`

---

### 5.1 — Architecture

2. Use the Explore agent to map existing patterns in the files the plan will touch
3. Identify: patterns to follow, anti-patterns to avoid, architectural constraints from the surrounding code
4. Write findings to `implementation.md` Architecture Notes — the WHY of how this fits, not the what

---

### 5.2 — Coding (TDD)

5. For each plan step, in sequence:
   - **Red**: write the test(s) first — they must fail before any implementation
   - **Green**: write the minimum implementation to make tests pass
   - **Refactor**: clean up while keeping tests green
   - Inline comments only when the WHY is non-obvious to a future reader
   - If a plan deviation is needed: log it immediately and silently in `implementation.md` Plan Deviations table — **never discard a deviation**

---

### 5.3 — QA Loop

6. After all plan steps are coded:
   - Check each AC from `analyze.md` — does the implementation satisfy it?
   - Log each iteration in `implementation.md` QA Log: iteration number, ACs checked, result, action taken
   - For failed ACs: fix and re-iterate
   - Exit conditions (either is sufficient):
     - All ACs pass
     - User explicitly accepts a known gap in writing
   - **Never exit by weakening an AC — only by satisfying it or explicit user acceptance**

---

### 5.4 — Regression

7. Run the existing test suite
8. Log result in `implementation.md` Regression section
9. If failures:
   - Caused by this implementation → fix before proceeding, do not suppress or skip tests
   - Pre-existing → flag to the user with details, do not mark as passed

---

### Implementation artifact structure

```
---
wi: <path>
phase: implementation
status: in-progress | completed | blocked | cancelled
date: <YYYY-MM-DD>
---

## Architecture Notes
<how this fits the existing codebase — patterns followed, patterns deliberately broken and why>

## Plan Deviations
| Step | Original plan | What actually happened | Reason |
|---|---|---|---|

## Blockers
| # | Description | Resolution | Status |
|---|---|---|---|

## QA Log
| Iteration | AC checked | Result | Action taken |
|---|---|---|---|

## Regression
**Test suite run:** yes | no
**Result:** pass | fail | partial
**Failures:** <list if any>
```

### 10. On completion
- Set `implementation.md` status → `completed`
- Update `source_of_truth.md`: current phase → implementation (completed), updated → today

### On blocker
- Set `implementation.md` status → `blocked`
- Add blocker to `source_of_truth.md` Active Blockers table
- Update `source_of_truth.md` `Blocked` → yes
