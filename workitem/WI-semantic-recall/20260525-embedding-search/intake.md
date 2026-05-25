---
wi: WI-semantic-recall/20260525-embedding-search
phase: intake
status: confirmed
date: 2026-05-25
---

## Request

Add semantic/embedding-based search to `recall` so vague or paraphrased queries find the right memories, not just exact keyword matches. This is the last major outstanding item on the memory layer — once delivered, the memory system is feature-complete.

## Classification

**Type:** feature
**Scope:** LTM MCP server (`mcps/mongodb-memory/server.js`), `recall` tool surface, memory write path (embedding generation), and one-time backfill of existing memories.

## Routing Decision

**Flow:** full workflow
**Rationale:** Significant architectural decision with multiple viable directions — embedding backend (local vs API), storage strategy (Atlas Vector Search vs in-process), query semantics (replace vs hybrid). The propose phase will surface trade-offs explicitly. AC needs to be precise about quality expectations and fallback behavior.
**Phases:** all (intake → analyze → propose → plan → implement → review → document → repo → archive)

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** intake
**Reason:**
