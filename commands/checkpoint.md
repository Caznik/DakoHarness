---
name: checkpoint
description: Save a structured context snapshot to short-term memory so work can be recovered after context compaction.
---

## When to use
Run manually at any point in a long session to ensure the current state is recoverable. Also triggered automatically every 15 turns by the CLAUDE.md protocol.

## Steps

### 1. Determine current task
- If the current task is obvious from the conversation, use it
- If ambiguous, ask: "What should I record as the current task?"

### 2. Identify key decisions not yet in LTM
- Review decisions made this session that have not yet been saved via `remember`
- If none, record "none"

### 3. Check for active workitem
- Search `workitem/` for a `source_of_truth.md` with `status: active`
- If found: record the WI path and current phase
- If none: record "none"

### 4. Save snapshot to STM
Call `remember_pattern` with:
- `project`: basename of cwd
- `agent`: `"claude-code"`
- `type`: `"context-snapshot"`
- `content`:
  ```
  Current task: <from Step 1>
  Key decisions this session: <from Step 2>
  Active workitem: <from Step 3>
  ```
- `reasoning`: `"Manual context checkpoint via /dako:checkpoint"`

### 5. Report result
- On success: "Context snapshot saved to short-term memory."
- On failure (MCP not responding): "STM MCP is not reachable — snapshot not saved. Run /dako:doctor to diagnose."
