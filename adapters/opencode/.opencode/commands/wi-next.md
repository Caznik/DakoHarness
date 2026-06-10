---
name: wi-next
description: Advance the current active workitem to the next phase.
---

## When to use
After the user confirms a phase is complete. Drives the workflow forward automatically.

## Chaining on OpenCode

OpenCode has no agent-invokable slash-command tool — the agent cannot expand `/wi-<phase>` on its own the way Claude Code can. So wherever this command says "chain into `/wi-<phase>`", you **must read the command file `.opencode/commands/wi-<phase>.md` and execute its steps in this same turn**. Do not improvise the phase from memory, and do not just advance the phase pointer and stop — that is what drops Document / Repo / Archive.

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
- If the requirements support more than one viable implementation direction → `triggered: yes`, then read `.opencode/commands/wi-propose.md` and execute it
- If only one reasonable approach exists → `triggered: no`, create `approaches.md` with `triggered: no` and a brief rationale, then read `.opencode/commands/wi-plan.md` and execute it

### 5. Update `source_of_truth.md`
- Set `Current phase` to the next phase
- Set `updated` to today's date

### 6. Chain into next phase command
Read `.opencode/commands/wi-<phase>.md` for the next phase and execute its steps in this same turn. For example, when advancing `review → document`, read `.opencode/commands/wi-document.md` and run it. Do not stop after updating the phase pointer.

### On archive completion
- Set `source_of_truth.md` status → `completed`
- Report: "Workitem **WI-X** is complete. All phases done."
