---
name: wi-start
description: Start a new workitem — runs intake, decides routing, and drives the full development workflow.
---

## When to use
When a user asks for something that may qualify as a development task. Primary entry point for the workitem workflow.

## Steps

### 0. Check for active workitems
- Search `workitem/` recursively for `source_of_truth.md` files with `status: active`
- If found: warn — "Workitem **WI-X** is already active (phase: Y). Continue it with `/wi-next`, or start a new one?"
- If user says continue: invoke `/wi-next` instead
- If user says start new: proceed

### 1. Get the request
- If `$ARGUMENTS` is provided, use it as the initial request description
- Otherwise ask: "What would you like to build or change?"

### 2. Classify the request
Determine routing:
- **Full workflow** — new feature, refactor, significant bugfix, or any change that affects behaviour
- **Partial workflow** — user targets a specific phase ("just plan this", "just review this", "just write the docs")
- **Free flow** — general question, trivial change (typo, config tweak, one-liner) → no workitem created, proceed freely

### 3. Propose routing and names
- Choose `WI-<kebab-feature>` from the request (e.g. `WI-retry-logic`)
- Choose `<YYYYMMDD>-<kebab-sub-feature>` for the sub-feature (e.g. `20260521-http-client`)
- User can override names at this step
- Present: "I'll create **WI-X / YYYYMMDD-Y** and run [full / partial] workflow. Rationale: [why]. OK?"
- **Wait for explicit user confirmation before creating any files**

### 4. On confirmation — create structure
Create the workitem folder structure:

**`workitem/WI-<kebab-feature>/source_of_truth.md`** with:
- `wi`, `created`, `updated`, `status: active`
- Current State: phase → intake, blocked → no
- Sub-features table: the new sub-feature as `in-progress`
- Empty: Active Blockers, Key Decisions Log, Parking/Cancellation sections

**`workitem/WI-<kebab-feature>/<YYYYMMDD>-<kebab-sub-feature>/intake.md`** with:
- `wi`, `phase: intake`, `status: confirmed`, `date`
- Request: the user's original request (verbatim or close paraphrase)
- Classification: type + scope
- Routing Decision: flow, rationale, phases (if partial)
- Confirmation: confirmed by user → yes
- Empty Cancellation section

### 5. Route
- **Full workflow** → chain into `/wi-analyze`
- **Partial workflow** → chain into the requested phase command
- **Free flow** → inform user no workitem was created, proceed freely

### 6. On rejection
- Ask what to change (routing, names, or both)
- Re-propose and wait for new confirmation
