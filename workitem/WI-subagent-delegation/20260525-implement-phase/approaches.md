---
wi: WI-subagent-delegation/20260525-implement-phase
phase: propose
status: confirmed
date: 2026-05-25
triggered: no
---

## Approach A — Custom sub-agent file + thin skill dispatcher

**Summary:** Create `.claude/agents/wi-implementer.md` carrying the full implement protocol (architecture → coding → QA → regression, scope discipline, failure conditions, replan request). Rewrite `.claude/commands/wi-implement.md` as a thin dispatcher: resolve workitem, invoke Agent tool with `subagent_type: "wi-implementer"`, handle the three return states (done / blocked / replan-requested). Markdown-only.

**Pros:**
- Reusable, discoverable via `subagent_type`
- Lowest per-call token cost (agent definition loaded once, not re-rendered each call)
- Matches the structure of the old-agents/ files the user is already comfortable with
- Zero new runtime dependencies — same pattern as [[WI-auto-registry-refresh]] and [[WI-semantic-recall]]

**Cons:**
- Adds one new file type to the project (`.claude/agents/`) — first agent file in the repo

**Effort:** low–medium

## Selected Approach

**Choice:** Approach A
**Rationale:** Only viable approach given the analyze ACs. AC-1 explicitly requires `.claude/agents/wi-implementer.md`; AC-2 requires the skill to be rewritten as a dispatcher. The user already locked these design choices via AskUserQuestion during analyze (agent location: `.claude/agents/wi-implementer.md` recommended; return format: terse + 3-5 highlights; replan: BLOCKED with REPLAN_REQUESTED). No trade-offs left to surface — propose is non-triggered.

## Confirmation

**Confirmed by user:** yes
**Notes:** User confirmed via "yes proceed to plan" — design direction was already settled during the analyze AskUserQuestion round; no additional approach trade-offs to weigh.

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** propose
**Reason:**
