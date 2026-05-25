---
wi: WI-auto-registry-refresh/20260525-session-start-detection
phase: propose
status: confirmed
date: 2026-05-25
triggered: no
---

## Approach A — CLAUDE.md Session Start protocol addition

**Summary:** Add a "Registry Freshness" sub-step to CLAUDE.md `## Memory Protocol` → `### Session Start`. The agent compares mtimes of `.claude/commands/*.md` against `.claude/skill-registry.md` on session start; on staleness, invokes `/registry-refresh` and prints the one-line notice. No new code, no hooks, no settings edits.

**Pros:**
- Zero new infrastructure — markdown only
- Consistent with the agent-driven memory protocol pattern already in CLAUDE.md
- Trivially reversible (delete the protocol line)
- Same low-risk pattern used by the recently completed WI-semantic-recall

**Cons:**
- Depends on the agent following CLAUDE.md (hooks would be deterministic) — acceptable: refresh is cheap, a missed check just means manually running `/registry-refresh` once

**Effort:** low

## Selected Approach

**Choice:** Approach A
**Rationale:** Only viable option given AC-5 (CLAUDE.md trigger), AC-7 (zero new dependencies). Hook-based alternative was rejected during analyze for the same reasons that drove WI-semantic-recall toward agent-side expansion: keep the implementation pure markdown, reversible, and infrastructure-free.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** propose
**Reason:**
