---
name: wi-analyze
description: Run the analyze phase — interview the user, elicit requirements, and produce signed-off acceptance criteria.
---

## When to use
After intake is confirmed. Can also be run standalone on an existing workitem to re-analyze requirements.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path (e.g. `WI-memory-layer/20260521-short-term-memory`)
- If not provided: list workitems and ask which one
- Read `intake.md` to understand the original request

### 2. Interview the user
- Ask focused questions to surface requirements — what must the system do?
- Make suggestions where the user hasn't considered something (both user-stated and agent-suggested items are valid requirements)
- Push for specificity: vague requirements produce bad acceptance criteria
- Cover: happy path, error cases, performance expectations, constraints
- Continue until no open ambiguities remain

### 3. Draft `analyze.md`
Prepare the artifact for user review:

```
---
wi: <path>
phase: analyze
status: pending
date: <YYYY-MM-DD>
---

## Requirements
<structured list of what the system must do>

## Out of Scope
<what was discussed but explicitly excluded>

## Open Questions
<known gaps that remain unresolved at sign-off>

## Acceptance Criteria
- [ ] **AC-1** — <testable, specific criterion>
- [ ] **AC-2** — <testable, specific criterion>
...

## Interview Notes
<key exchanges that shaped requirements — especially agent-suggested items the user accepted>

## Sign-off
**Confirmed by user:** no
**Date:**
```

### 4. Present for sign-off
- Show the full draft to the user
- Ask: "Does this capture everything? Any ACs to add, change, or remove?"
- Iterate until the user explicitly confirms

### 5. On sign-off
- Set `status` → `confirmed`, `Sign-off confirmed by user` → yes, fill date
- Write `analyze.md`
- Update `source_of_truth.md`: current phase → analyze, updated → today

### Cancellation
If the user cancels during this phase:
- Write `analyze.md` with `status: cancelled`, fill Cancellation section
- Update `source_of_truth.md`
