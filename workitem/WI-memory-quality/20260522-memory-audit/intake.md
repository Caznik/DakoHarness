---
wi: WI-memory-quality/20260522-memory-audit
phase: intake
status: confirmed
date: 2026-05-22
---

## Request

Memory quality over time — deduplicate, flag stale, and merge contradicted memories to prevent long-lived projects from accumulating noise in long-term memory.

## Classification

**Type:** feature  
**Scope:** long-term memory MCP (server.js), possibly new slash commands, CLAUDE.md protocol

## Routing Decision

**Flow:** full workflow  
**Rationale:** Three distinct operations (deduplicate, flag stale, merge contradictions) may warrant different implementations and interaction models. Analyze phase needed to determine scope and approach before building anything.  
**Phases:** intake → analyze → propose → plan → implement → review → document → repo → archive

## Confirmation

**Confirmed by user:** yes

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:**
**Reason:**
