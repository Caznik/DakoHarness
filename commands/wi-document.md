---
name: wi-document
description: Run the documentation phase — update existing project docs and write the workitem documentation record.
---

## When to use
After review is confirmed. Can also be run standalone on an existing workitem.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path
- If not provided: list workitems and ask which one
- Read `plan.md`, `review.md`, `analyze.md`

### 2. Find existing project documentation
- Look for README.md, docs/, wiki files, or equivalent documentation in the project root
- If found: identify sections relevant to what was built

### 3. Update project docs (if found)
- Add or update only what this workitem changed — do not restructure unrelated sections
- Record each file and section touched in `documentation.md` Project Documentation Updated table

### 4. Write workitem documentation
Write `documentation.md` with two parts:

**Part 1 — Project Documentation Updated** (only if project docs exist):
- Table of files and sections changed

**Part 2 — Workitem Documentation** (always written):
- "What was built" — written for a developer unfamiliar with this workitem; no jargon from the session
- "How it works" — key implementation details not obvious from the code
- "Usage" — how to use the new feature (if applicable)
- "Known limitations" — any accepted gaps from `review.md`

```
---
wi: <path>
phase: documentation
status: pending
date: <YYYY-MM-DD>
project-docs-found: yes | no
---

## Project Documentation Updated
*(Fill if project-docs-found: yes)*
| File | Section | Change |
|---|---|---|

## Workitem Documentation

### What was built
<description for a developer unfamiliar with this workitem>

### How it works
<key implementation details not obvious from code>

### Usage
<how to use the new feature, if applicable>

### Known limitations
<accepted gaps from review.md — empty if verdict was pass>

## Confirmation
**Confirmed by user:** no
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
```

### 5. Present for sign-off
- Show project doc changes (diff or summary) and workitem doc
- Ask: "Anything to add or correct?"
- Iterate until confirmed

### 6. On confirmation
- Set `status` → `confirmed`, `Confirmed by user` → yes
- Write `documentation.md`
- Update `source_of_truth.md`: current phase → documentation, updated → today
