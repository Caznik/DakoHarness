---
name: wi-intake
description: Run or re-run the intake phase on a specified workitem.
---

## When to use
When intake needs to be completed or re-run on an existing workitem.
For new workitems, use `/wi-start` instead.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` should be a workitem path (e.g. `WI-memory-layer/20260521-short-term-memory`)
- If not provided: list all workitems under `workitem/` and ask which one
- Read `source_of_truth.md` for context

### 2. Get the request
- If `intake.md` already exists: read it, ask — "Re-running intake or continuing where it left off?"
- Otherwise: ask the user what they need

### 3. Classify and propose routing
- **Full workflow** — development request affecting behaviour
- **Partial workflow** — user targets specific phases (list them)
- **Free flow** — general question or trivial change
- Show the routing decision + rationale to the user
- **Wait for explicit confirmation before writing files**

### 4. On confirmation — write artifact
Write `workitem/WI-<kebab-feature>/<YYYYMMDD>-<kebab-sub-feature>/intake.md`:

```
---
wi: <path>
phase: intake
status: confirmed
date: <YYYY-MM-DD>
---

## Request
<verbatim or close paraphrase>

## Classification
**Type:** feature | refactor | bugfix | other
**Scope:** <why this qualifies as a dev request>

## Routing Decision
**Flow:** full | partial | free
**Rationale:** <why>
**Phases:** <if partial: list phases>

## Confirmation
**Confirmed by user:** yes
**Notes:** <any redirections from routing discussion>

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** intake
**Reason:** <reason>
```

### 5. Update `source_of_truth.md`
- Set `Current phase` → intake
- Set `updated` → today
