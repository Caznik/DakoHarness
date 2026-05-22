---
wi: WI-context-management/20260522-compaction-and-pressure
phase: intake
status: confirmed
date: 2026-05-22
---

## Request

Context management improvements — proactive compaction strategy, context pressure monitoring, and tighter two-tier memory integration. Directly motivated by a problem observed this session: 6 compaction snapshots accumulated in long-term memory without being cleaned up, and short-term memory was silently failing for an unknown period before it was noticed.

## Classification

**Type:** feature  
**Scope:** core memory loop — CLAUDE.md protocol, hook behaviour, and potentially new MCP tooling or commands

## Routing Decision

**Flow:** full workflow  
**Rationale:** Scope is fuzzy; a proper analyze phase is needed to define what "proactive compaction," "context pressure monitoring," and "tighter two-tier integration" mean in concrete, testable terms before any implementation.  
**Phases:** intake → analyze → propose → plan → implement → review → document → repo → archive

## Confirmation

**Confirmed by user:** yes

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:**
**Reason:**
