---
wi: WI-auto-registry-refresh/20260525-session-start-detection
phase: intake
status: confirmed
date: 2026-05-25
---

## Request

Auto registry-refresh on session start — detect when `.claude/commands/` has changed since the last registry build and refresh `.claude/skill-registry.md` automatically so the index is never stale.

## Classification

**Type:** feature
**Scope:** small — session-start behavior addition

## Routing Decision

**Flow:** full workflow
**Rationale:** Affects session-start behavior; locking in ACs around trigger mechanism and staleness detection is worth the small overhead.
**Phases:** intake → analyze → propose → plan → implement → review → document → repo → archive

## Confirmation

**Confirmed by user:** yes

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:**
**Reason:**
