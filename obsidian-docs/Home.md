---
tags: [dakoharness, index]
aliases: [DakoHarness, Index]
created: 2026-05-20
---

# DakoHarness

> An extensible harness for coding agents. Provides persistent memory, session logging, and custom workflows — installed once, used across every project your agent touches.

**First target:** Claude Code via Plugin Marketplace.  
**Future targets:** OpenCode, Pi.

---

## Navigation

| Doc | Description |
|---|---|
| [[Architecture]] | System overview and component map |
| [[Memory System]] | Two-tier memory: long-term + short-term |
| [[Session Logging]] | Hooks, session tracking, compaction recovery |
| [[Team Memory]] | Cross-project memory sharing |
| [[Workitem Workflow]] | Structured development workflow with traceability |
| [[Slash Commands]] | All available slash commands |
| [[Setup Guide]] | Prerequisites and installation |
| [[Roadmap]] | Phases, status, and backlog |

---

## What it solves

Coding agents start every session without memory. DakoHarness gives them:

- **Persistent memory** that survives across sessions, machines, and team members
- **Pull-based context** — memory is searched on demand, never preloaded
- **Session logging** — every conversation turn captured automatically via hooks
- **Team knowledge** — lessons can be promoted to team scope and discovered by any developer
- **Structured workflow** — intake → analyze → plan → implement → review → archive with full traceability

> [!TIP]
> Start with [[Setup Guide]] if you're installing for the first time.
