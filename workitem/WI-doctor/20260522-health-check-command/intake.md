---
wi: WI-doctor/20260522-health-check-command
phase: intake
status: confirmed
date: 2026-05-22
---

## Request

Add a `/dako:doctor` health check command that verifies the full DakoHarness installation in one shot — MongoDB reachability, .env validity, hooks configuration, both MCPs responding, and STM binary present.

## Classification

**Type:** feature
**Scope:** new slash command (`commands/doctor.md`)

## Routing Decision

**Flow:** full workflow
**Rationale:** New command with its own multi-step logic; warrants full traceability.
**Phases:** intake → analyze → propose → plan → implement → review → document → repo → archive

## Confirmation

**Confirmed by user:** yes

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:**
**Reason:**
