---
wi: WI-subagent-delegation/20260525-implement-phase
phase: analyze
status: confirmed
date: 2026-05-25
---

## Requirements

**Core delegation behavior**
1. The `wi-implement` skill must dispatch the implement phase to a dedicated sub-agent (Claude Code custom agent), not run it inline in the main conversation.
2. The sub-agent definition lives at `.claude/agents/wi-implementer.md` and is invoked via the Agent tool with `subagent_type: "wi-implementer"`.
3. The sub-agent owns the full current implement phase: architecture review (5.1), TDD coding (5.2), QA loop (5.3), regression (5.4). One sub-agent call covers all four sub-phases.
4. The sub-agent writes `implementation.md` directly (the existing artifact, with one new section — see req 6).

**Return contract**
5. The sub-agent returns one of three terse forms to main:
   - **done**: `done -> <implementation.md path>` plus 3–5 bullet highlights (what was built, key decisions, deviations logged, QA outcome)
   - **blocked**: `blocked -> <one-line reason>` — main reads `implementation.md` Blockers section for detail
   - **replan**: `replan-requested -> <one-line discovery>` — main triggers the replan flow

**Sub-agent guardrails (carried from old `implementer.md`, adapted for single-agent v1)**
6. The `implementation.md` template gains an **AC Pre-Check** section — a table mapping each AC from `analyze.md` to a test/evidence reference and a status (`COVERED` / `MISSING`). Sub-agent fills this before declaring done.
7. The sub-agent prompt enforces scope discipline explicitly: no unplanned refactors, no architecture invention, no speculative abstractions. Wording adapted from old `implementer.md` Scope Rule and Repository Truth Rule.
8. The sub-agent prompt enforces an explicit **Failure Conditions** list — stop and return BLOCKED if: plan ambiguous, any AC ambiguous, architecture unclear, dependency missing, planned approach contradicts repository state. (Adapted from old `implementer.md` Failure Conditions.)
9. The sub-agent has a curated tool list in its frontmatter: `Read, Edit, Write, Grep, Glob, Bash`. No nested Agent calls in v1 — sub-agent does its own exploration with Grep/Glob/Read rather than spawning the Explore agent.

**Replan escalation (carried from old `implementer.md` Replan Request Protocol)**
10. When the sub-agent discovers the plan is fundamentally incompatible with repository reality (vs. a minor deviation it can adapt around), it must:
    - Write a `## Replan Request` block in `implementation.md` with: Discovery, Affected Plan Section, Proposed Direction
    - Set `implementation.md` status to `blocked-replan`
    - Return the `replan-requested` form
11. On `replan-requested`, the main agent surfaces three options to the user: (a) re-run `/wi-plan` for an updated plan, (b) adjust scope manually and re-dispatch, (c) cancel the workitem. Max **one** replan per sub-feature — on second dispatch that returns `replan-requested`, main returns `BLOCKED` instead and escalates to user.

**Main agent (skill) responsibilities**
12. `wi-implement.md` becomes a thin dispatcher: (a) resolve workitem (existing step 1), (b) read `plan.md` and `analyze.md`, (c) initialize `implementation.md` with `status: in-progress` (existing), (d) dispatch sub-agent with workitem path + full plan/AC content, (e) handle the three return states.
13. On `done`: main updates `source_of_truth.md` (current phase → implementation, updated → today), prints the highlights, suggests `/wi-next`.
14. On `blocked`: main adds the blocker to `source_of_truth.md` Active Blockers, sets `Blocked: yes`, surfaces to user.
15. On `replan-requested`: main runs req 11 flow.

**Implementation constraints**
16. Zero new runtime dependencies. No MCP changes, no hook changes, no settings.json edits. Markdown-only implementation (same pattern as [[WI-auto-registry-refresh]] and [[WI-semantic-recall]]).
17. Existing skill artifacts (`implementation.md` structure, `source_of_truth.md` flow) remain backward-compatible — adding a new section is non-breaking.

## Out of Scope

- **Separate QA sub-agent.** Old workflow split implementer ↔ qa via shared file with ownership states. v1 keeps QA loop inside the same sub-agent. Splitting later → future sub-feature under this WI.
- **Reviewer / documenter / planner sub-agents.** Phases `/wi-review`, `/wi-document`, `/wi-plan` continue to run in main. Future sub-features may delegate them.
- **Severity-based retry budgets** (CRITICAL/MAJOR/MINOR cycle limits from old workflow). Existing exit rule (all ACs pass OR user-accepted gap) is sufficient.
- **Ownership state machine** (`IMPLEMENTER_ACTIVE` / `QA_REVIEW` / `APPROVED` / etc.). Needed only when two agents share a file; not needed for one sub-agent owning the phase.
- **Per-step delegation** (one Agent call per plan step). v1 dispatches once for the whole phase.
- **Heuristic auto-skip / inline opt-out flag.** Every implement run delegates — predictable single code path.
- **Mid-phase user interaction by sub-agent.** Sub-agent returns BLOCKED to surface questions; never calls AskUserQuestion directly.
- **Delegating phases other than implement.** Out of scope this sub-feature.
- **Cross-workitem pattern memory** (old `documenter.md` section 4 — `documentation/patterns/<feature-type>-<WI-ID>.md`). Not in scope; could revisit if the LTM memory layer proves insufficient.

## Open Questions

- None.

## Acceptance Criteria

- [ ] **AC-1** — `.claude/agents/wi-implementer.md` exists with valid Claude Code custom-agent frontmatter (`name: wi-implementer`, `description`, `tools: Read, Edit, Write, Grep, Glob, Bash`) and a complete implementation protocol body.
- [ ] **AC-2** — `.claude/commands/wi-implement.md` is rewritten so its protocol dispatches to the `wi-implementer` sub-agent via the Agent tool. The skill no longer contains the architecture / coding / QA / regression steps inline — those live in the agent file.
- [ ] **AC-3** — The sub-agent prompt covers all four sub-phases (architecture review, TDD coding, QA loop, regression) with content equivalent to the current `wi-implement.md` 5.1–5.4 (no behavior loss).
- [ ] **AC-4** — The sub-agent prompt contains an explicit **Scope discipline** section: no unplanned refactors, no architecture invention, no speculative abstractions, no scope creep. Wording references the workitem's `plan.md` and `analyze.md` as the source of truth.
- [ ] **AC-5** — The sub-agent prompt contains an explicit **Failure conditions** list (stop and return BLOCKED if plan ambiguous, AC ambiguous, architecture unclear, dependency missing, planned approach contradicts repository state, required context missing).
- [ ] **AC-6** — The `implementation.md` template in `wi-implement.md` includes an **AC Pre-Check** section: a table with columns `AC | Test / Evidence | Status (COVERED \| MISSING)`. The sub-agent prompt requires this section to be filled before returning `done`.
- [ ] **AC-7** — The sub-agent's return contract is documented in both the agent file and the skill file: `done -> <path>` + 3–5 highlight bullets / `blocked -> <reason>` / `replan-requested -> <discovery>`. No other return formats are accepted.
- [ ] **AC-8** — Replan flow: sub-agent prompt instructs to write a `## Replan Request` block (Discovery / Affected Plan Section / Proposed Direction), set `implementation.md` status to `blocked-replan`, and return `replan-requested`. Skill enforces the **max-1-replan-per-sub-feature** rule (skill tracks dispatch count in `source_of_truth.md` Key Decisions Log, or in-memory within the skill execution).
- [ ] **AC-9** — On `done`, main updates `source_of_truth.md` (current phase → implementation, updated → today's date), prints the highlights to the user, and suggests `/wi-next`. On `blocked`, main updates `source_of_truth.md` Active Blockers and sets `Blocked: yes`. On `replan-requested`, main presents the three-option prompt (re-plan / adjust scope / cancel).
- [ ] **AC-10** — Smoke test: dispatch the new `/wi-implement` against a trivial test workitem (or this very workitem, recursively) and verify (a) sub-agent is actually invoked via Agent tool, (b) `implementation.md` is written by the sub-agent with the AC Pre-Check section populated, (c) main receives the terse return form, (d) `source_of_truth.md` updates correctly.
- [ ] **AC-11** — Zero new runtime dependencies. Diff contains only `.md` files (skill, agent definition) plus the workitem artifacts. No `package.json`, no `.env` field, no `.mcp.json`, no settings.json, no hook, no MCP code changes.
- [ ] **AC-12** — Documentation: `.claude/skill-registry.md` regenerated (auto via session-start protocol or `/registry-refresh`); `obsidian-docs/Slash Commands.md` for `/wi-implement` updated to mention sub-agent delegation. No CLAUDE.md change needed (delegation is a skill-internal mechanism, not a session-level protocol).

## Interview Notes

**User clarification (compacted-context turn):** user shared four `old-agents/` markdown files (implementer, qa, reviewer, documenter) from a prior project. Stated scope: build a "first version" of sub-agent delegation for implement only; extend later. Confirmed multi-agent split (QA as separate agent, reviewer, documenter) is **not** in scope for v1.

**Patterns adopted from old `implementer.md` (with adaptation):**
- *Mandatory Inputs* → maps to existing wi-implement step 1 (read plan + analyze + source_of_truth). Already covered, but the sub-agent prompt restates explicitly because it starts cold.
- *Repository Truth Rule* + *Scope Rule* → AC-4 (Scope discipline section in agent prompt).
- *Self-Validation checklist* → adapted into the AC Pre-Check table (req 6, AC-6) — more traceable than a freeform checklist because each row points at a specific test.
- *Replan Request Protocol* → req 10–11, AC-8. Adapted to fit our skill-vs-sub-agent split (sub-agent writes the block, main triggers user prompt).
- *Expected Response: "done -> <file>"* → AC-7 (return contract).
- *Failure Conditions* list → AC-5.
- *Ownership state machine* → **rejected**, single-agent ownership is implicit.

**Patterns rejected from old workflow:**
- QA-as-separate-agent — splitting requires the ownership state machine and adds round-trips for marginal v1 gain. Future workitem.
- Severity-based retry budget — existing exit rule is enough at our scale.
- Cross-workitem pattern memory file — duplicates what LTM memory already provides.

**Design decision: sub-agent does its own exploration (no nested Agent calls).** Current wi-implement 5.1 uses the Explore agent. v1 sub-agent uses Read/Grep/Glob directly. Reasons: (a) nested Agent calls compound token cost, (b) Explore is read-only and returns excerpts — sub-agent already has Read/Grep with no excerpt limit, (c) keeps the dispatch graph one level deep, easier to reason about.

**Design decision: max 1 replan per sub-feature.** Old `implementer.md` had the same cap. Reasoning: if `plan_v2` also fails, the problem is upstream (analyze ACs or user understanding) — escalation to user is correct, not a third auto-attempt.

**Design decision: skill tracks dispatch count.** Either via an in-memory counter during the skill execution, or by appending dispatch records to `source_of_truth.md` Key Decisions Log. Plan phase will pick between these two.

## Sign-off

**Confirmed by user:** yes
**Date:** 2026-05-25
