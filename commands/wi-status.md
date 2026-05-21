---
name: wi-status
description: Show the current state of the active workitem.
---

## When to use
To check where a workitem stands — current phase, blockers, sub-feature history.

## Steps

### 1. Find active workitem
- Search `workitem/` recursively for `source_of_truth.md` files with `status: active`
- If none found: report "No active workitem. Use `/wi-start` to begin one."
- If multiple found: list all active workitems and their current phases
- If exactly one: proceed

### 2. Read and display `source_of_truth.md`
Show the user:
- Workitem ID and active sub-feature
- Current phase and blocked status
- Sub-features table (all sub-features and their completion status)
- Active blockers (if any) — highlight prominently
- Key Decisions Log (last 3 entries)

### 3. Show available actions
Based on current state, suggest next steps:
- If active and not blocked: "`/wi-next` — advance to next phase"
- If blocked: "`/wi-next` after resolving blocker: [description]"
- Always offer: "`/wi-park` — pause this workitem | `/wi-cancel` — cancel it"
