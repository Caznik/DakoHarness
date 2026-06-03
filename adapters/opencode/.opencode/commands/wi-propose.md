---
name: wi-propose
description: Run the propose phase — generate approaches, surface trade-offs, and record the selected direction.
---

## When to use
After analyze is confirmed, when trade-offs exist between implementation directions.
Also invoked by `/wi-next` when multiple viable directions are detected.
**Always produces `approaches.md`** — even when only one approach exists.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path
- If not provided: list workitems and ask which one
- Read `intake.md` and `analyze.md`

### 2. Determine if triggered
- Do the requirements and AC support more than one viable implementation direction?
- If yes: `triggered: yes` — generate 2-3 distinct approaches
- If no: `triggered: no` — document the single obvious approach with rationale, skip to step 4

### 3. Generate and present approaches (if triggered)
For each approach: name, summary, pros, cons, effort (low/medium/high)
- Present all approaches clearly — no recommendation bias unless the user asks
- Ask: "Which approach fits best for your context?"
- Record the user's selection and their reasoning

### 4. Write `approaches.md`

```
---
wi: <path>
phase: propose
status: pending
date: <YYYY-MM-DD>
triggered: yes | no
---

## Approach A — <Name>
**Summary:** <what this approach does>
**Pros:**
- ...
**Cons:**
- ...
**Effort:** low | medium | high

## Approach B — <Name>   *(only if triggered: yes)*
...

## Selected Approach
**Choice:** Approach A | B | C
**Rationale:** <user's reasoning, or why this was the only option>

## Confirmation
**Confirmed by user:** no
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** propose
**Reason:**
```

### 5. Present for confirmation
- Show `approaches.md` draft
- Ask: "Is this the right direction?"
- Iterate if needed

### 6. On confirmation
- Set `status` → `confirmed`, `Confirmed by user` → yes
- Write `approaches.md`
- Log the decision in `source_of_truth.md` Key Decisions Log
- Update `source_of_truth.md`: current phase → propose, updated → today
