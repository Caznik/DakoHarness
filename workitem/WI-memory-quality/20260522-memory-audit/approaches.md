---
wi: WI-memory-quality/20260522-memory-audit
phase: propose
status: confirmed
date: 2026-05-22
triggered: no
---

## Selected Approach

**Choice:** New `list_memories` MCP tool + `/dako:memory-audit` skill command
**Rationale:** Only one viable direction — add `list_memories` to server.js for bulk retrieval, implement the three audit passes as a skill file the agent interprets. No alternative approaches were viable: `recall` FTS is unreliable for full scans, and a fully automated approach was ruled out in analyze (user confirmation required for every change).

## Confirmation

**Confirmed by user:** yes
