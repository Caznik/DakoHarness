---
wi: WI-subagent-delegation/20260525-implement-phase
phase: intake
status: confirmed
date: 2026-05-25
---

## Request

Sub-agent delegation for implementation — delegate the implement phase to a sub-agent so heavy file edits, codebase exploration, and QA iteration happen in a separate context window, leaving the main session lean and reducing the rate of compaction.

## Classification

**Type:** feature
**Scope:** modifies the `wi-implement` skill protocol so the implement phase executes inside a delegated sub-agent (Agent tool) rather than in the main conversation. Main context receives only the summary artifact, not the raw exploration/edit/QA chatter.

## Routing Decision

**Flow:** full workflow
**Rationale:** Real behaviour change to a core skill — affects how every future workitem runs its implement phase. Needs full requirements elicitation (which sub-agent type, what gets sent back, how plan deviations propagate, etc.) and a verifiable AC set before coding. Not a doc tweak, not a one-liner.
**Phases:** intake → analyze → propose → plan → implement → review → document → repo → archive

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** intake
**Reason:**
