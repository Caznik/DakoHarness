---
wi: WI-context-management/20260522-compaction-and-pressure
phase: propose
status: confirmed
date: 2026-05-22
triggered: no
---

## Selected Approach

**Choice:** Agent-side STM save
**Rationale:** Only one viable direction — remove PreCompact hook, agent writes structured context snapshots to STM periodically and on demand. Hook-based and local-file alternatives were ruled out during analyze: hooks can't call STM MCP directly, and local files add a new persistence mechanism with no benefit over STM.

## Confirmation

**Confirmed by user:** yes
