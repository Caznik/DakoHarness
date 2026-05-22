---
name: wi-archive
description: Archive the completed workitem to long-term memory (MongoDB workitems collection). Final phase.
---

## When to use
After repo actions are confirmed. The final phase of any workitem.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path
- If not provided: list workitems and ask which one
- Read `documentation.md` and `source_of_truth.md`

### 2. Collect metadata
- `wi_path`: workitem folder + sub-feature (e.g. `WI-memory-layer/20260521-short-term-memory`)
- `project`: current project name (from env `DAKO_PROJECT` or cwd basename)
- `username`: from `git config user.name` — skip if unavailable
- `git_commit`: from `git rev-parse HEAD` — skip if no git repo or not committed yet
- `documentation`: full text of `documentation.md` "Workitem Documentation" section

### 3. Call `archive_workitem` MCP tool
Use the `dako-long-term-memory` MCP server `archive_workitem` tool with the collected metadata.

### 4. Mark workitem complete
- Set `source_of_truth.md` status → `completed`
- Set `updated` → today
- Set the sub-feature row in Sub-features table → `completed`, phases completed → `all`

### 5. Report to user
- "Workitem **WI-X** archived to long-term memory."
- If verdict was `accepted-with-gaps`: remind the user the gaps are documented in `review.md`
- "All phases complete."
