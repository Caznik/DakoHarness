---
name: wi-cancel
description: Cancel the active workitem or current phase. All files are kept.
---

## When to use
When a workitem or phase should be abandoned. Never deletes files.

## Steps

### 1. Find active workitem
- Search `workitem/` recursively for `source_of_truth.md` with `status: active`
- If none: report no active workitem
- If multiple: list them and ask which to cancel

### 2. Clarify scope
Ask: "Cancel the **entire workitem** (WI-X) or just the **current phase** ([phase name])?"

### 3. Ask for reason
"Why is this being cancelled?" — record verbatim

### 4. Update files

**If cancelling the entire workitem:**
- Set `source_of_truth.md` status → `cancelled`
- Fill Parking / Cancellation section: reason, phase at cancellation, sub-feature
- Set the current phase artifact (e.g. `plan.md`) status → `cancelled`
- Fill its Cancellation section: `Cancelled at phase: <phase>`, `Reason: <reason>`

**If cancelling the current phase only:**
- Set the current phase artifact status → `cancelled`
- Fill its Cancellation section: `Cancelled at phase: <phase>`, `Reason: <reason>`
- Set `source_of_truth.md` `updated` → today
- Do NOT change `source_of_truth.md` status (workitem remains active)

### 5. Confirm to user
"Cancelled. All files preserved in `workitem/WI-X/`. No files were deleted."
