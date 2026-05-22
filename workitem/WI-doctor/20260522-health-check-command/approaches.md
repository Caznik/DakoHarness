---
wi: WI-doctor/20260522-health-check-command
phase: propose
status: confirmed
date: 2026-05-22
triggered: no
---

## Approach A — Single markdown skill file

**Summary:** Write `commands/doctor.md` as an agent skill following the same structure as `setup.md` — numbered steps, each check as a step, summary table at the end.
**Rationale:** All other commands are markdown skill files. No executable logic is needed; the agent performs each check via tool calls and shell commands. One approach, no real alternatives.
**Effort:** low

## Selected Approach

**Choice:** Approach A
**Rationale:** Only viable direction — no trade-offs to surface.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** propose
**Reason:**
