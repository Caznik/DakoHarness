---
name: wi-park
description: Pause the active workitem indefinitely without cancelling it.
---

## When to use
When work needs to stop temporarily but the workitem should not be closed.

## Steps

### 1. Find active workitem
- Search `workitem/` recursively for `source_of_truth.md` with `status: active`
- If none: report no active workitem
- If multiple: list them and ask which to park

### 2. Ask for reason
"Why is this workitem being parked?" — record the user's response verbatim

### 3. Update `source_of_truth.md`
- Set `status` → `parked`
- Set `updated` → today
- Fill Parking / Cancellation section:
  - **Reason:** user's response
  - **At phase:** current phase from Current State
  - **Sub-feature:** active sub-feature folder name

### 4. Confirm to user
"Workitem **WI-X** parked at phase [Y]. Resume it any time with `/wi-next`."
