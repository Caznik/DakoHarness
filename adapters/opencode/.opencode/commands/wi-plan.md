---
name: wi-plan
description: Run the plan phase — explore the codebase and produce a sequenced implementation plan tied to acceptance criteria.
---

## When to use
After propose is confirmed (or analyze if propose was skipped). Can also be run standalone.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path
- If not provided: list workitems and ask which one
- Read `intake.md`, `analyze.md`, `approaches.md`

### 2. Explore the codebase
Use the Explore agent to:
- Understand files and areas the implementation will touch
- Map existing patterns, conventions, and architectural constraints
- Identify any related code that could affect or be affected by the change

### 3. Draft the implementation sequence
- Break the work into ordered, named steps
- Each step: name, files to create or modify, description (what AND why)
- Each step references at least one AC ID from `analyze.md`
- **Verify full AC coverage**: every AC must appear in at least one step — flag any uncovered AC before presenting

### 4. Identify risks
- Anything uncertain that could cause a plan deviation during implementation
- Known gaps in the codebase understanding

### 5. Write `plan.md`

```
---
wi: <path>
phase: plan
status: pending
date: <YYYY-MM-DD>
approach: Approach A | B | C
---

## Context
**Selected approach:** <name from approaches.md>
**AC coverage:** AC-1, AC-2, AC-3  *(full list of ACs this plan addresses)*

## Implementation Sequence

### Step 1 — <Name>
**Satisfies:** AC-X
**Files:** <files to create or modify>
**Description:** <what to do and why>

### Step 2 — <Name>
**Satisfies:** AC-Y, AC-Z
**Files:** <files>
**Description:** <what to do and why>

## Risks / Known Unknowns
<anything uncertain that could affect the plan>

## Confirmation
**Confirmed by user:** no
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
```

### 6. Present for sign-off
- Show the full plan with AC coverage map
- Explicitly call out any AC not covered — the plan is incomplete if any AC is missing
- Ask: "Does this plan look right? Anything to add or change?"
- Iterate until confirmed

### 7. On confirmation
- Set `status` → `confirmed`, `Confirmed by user` → yes
- Write `plan.md`
- Update `source_of_truth.md`: current phase → plan, updated → today
