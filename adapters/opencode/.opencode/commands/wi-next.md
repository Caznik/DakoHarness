---
name: wi-next
description: Advance the current active workitem to the next phase.
---

## When to use
After the user confirms a phase is complete. Drives the workflow forward automatically.

## Steps

### 1. Find active workitem
- Search `workitem/` recursively for `source_of_truth.md` files with `status: active`
- If none found: tell the user — suggest `/wi-start`
- If multiple found: list them and ask which one to advance
- If exactly one: proceed with it

### 2. Read current phase
- Read `source_of_truth.md` → `Current phase` field

### 3. Determine next phase

| Current phase | Next phase |
|---|---|
| intake | analyze |
| analyze | propose (if trade-offs exist) or plan (if approach is obvious) |
| propose | plan |
| plan | implement |
| implement | review |
| review | document |
| document | repo |
| repo | archive |
| archive | — workitem complete |

### 4. Analyze → Propose decision
When transitioning from `analyze`:
- Read `analyze.md` requirements and acceptance criteria
- If the requirements support more than one viable implementation direction → `triggered: yes`, chain into `/wi-propose`
- If only one reasonable approach exists → `triggered: no`, create `approaches.md` with `triggered: no` and a brief rationale, then chain into `/wi-plan`

### 5. Update `source_of_truth.md`
- Set `Current phase` to the next phase
- Set `updated` to today's date

### 6. Chain into next phase command
Invoke the corresponding `/wi-<phase>` command for the next phase.

### On archive completion
- Set `source_of_truth.md` status → `completed`
- Report: "Workitem **WI-X** is complete. All phases done."
