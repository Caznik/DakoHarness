---
wi: WI-subagent-delegation/20260525-implement-phase
phase: plan
status: confirmed
date: 2026-05-25
approach: Approach A
---

## Context

**Selected approach:** Approach A — Custom sub-agent file + thin skill dispatcher
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12

## Exploration findings

- **Three-location skill mirror.** `.claude/commands/wi-implement.md`, `commands/wi-implement.md`, `claude-plugin-release/commands/wi-implement.md` are byte-identical (verified via diff). The skill rewrite must update all three.
- **No `.claude/agents/` directory exists** anywhere in the repo. This workitem establishes the three-location agent convention parallel to the skill convention: `.claude/agents/`, `agents/`, `claude-plugin-release/agents/`.
- **No prior `subagent_type` usage** in any command file. We're introducing the first Agent-tool dispatch pattern in a skill.
- **`obsidian-docs/Slash Commands.md`** has only a one-line table entry for `/wi-implement` (line 186) — minimal doc surface.
- **`/wi-implement` references `Explore agent`** in current step 5.1; this prose disappears when the skill becomes a dispatcher.

## Implementation Sequence

### Step 1 — Create `.claude/agents/wi-implementer.md` (canonical agent definition)
**Satisfies:** AC-1, AC-3, AC-4, AC-5, AC-7 (partial), AC-8 (partial)
**Files:** `.claude/agents/wi-implementer.md` (new)
**Description:**
Write the canonical sub-agent file. Structure:

- **Frontmatter:**
  ```yaml
  ---
  name: wi-implementer
  description: Repository-aware implementation sub-agent. Owns the full implement phase of a DakoHarness workitem — architecture review, TDD coding, QA loop with AC Pre-Check, regression testing — and writes implementation.md directly. Returns terse status to main.
  tools: Read, Edit, Write, Grep, Glob, Bash
  ---
  ```
- **Sections (in this order):**
  1. *Role and core principle* — execute the approved plan; never invent architecture or expand scope. Adapted from old `implementer.md` lines 6–43 but condensed.
  2. *Mandatory Inputs* — read `plan.md`, `analyze.md`, `source_of_truth.md`, then any code files the plan touches. Refusal-to-start clause if inputs missing.
  3. *Scope discipline* (AC-4) — explicit list of forbidden behaviors (no unplanned refactors, no architecture invention, no speculative abstractions). References `plan.md` and `analyze.md` as the only authoritative scope source.
  4. *Failure conditions* (AC-5) — explicit list of "STOP and return BLOCKED" triggers: plan ambiguous, AC ambiguous, architecture unclear, dependency missing, planned approach contradicts repository reality, required context missing.
  5. *Phase protocol* — the four sub-phases (Architecture review / TDD coding / QA loop / Regression) with content equivalent to current wi-implement.md 5.1–5.4 (AC-3). Architecture sub-phase uses sub-agent's own Read/Grep/Glob (no nested Agent calls).
  6. *AC Pre-Check protocol* — sub-agent must populate the AC Pre-Check table in `implementation.md` before returning `done`. Each row: AC ID, test file/line or evidence reference, status (COVERED / MISSING). Any MISSING row blocks the `done` return.
  7. *Replan Request Protocol* (AC-8) — when discovery shows the plan is fundamentally incompatible with repository state (not a minor deviation), write `## Replan Request` block in `implementation.md` (Discovery / Affected Plan Section / Proposed Direction), set status to `blocked-replan`, return `replan-requested -> <discovery>`. Adapted from old `implementer.md` lines 347–373.
  8. *Return contract* (AC-7) — exactly three valid return forms:
     - `done -> <path>` + 3–5 bullet highlights (what was built, key decisions, deviations logged, QA outcome)
     - `blocked -> <one-line reason>`
     - `replan-requested -> <one-line discovery>`
  9. *Forbidden actions* — no chat narration, no nested Agent calls, no edits outside the plan's scope.

### Step 2 — Mirror the agent file
**Satisfies:** AC-1 (full coverage across distribution channels)
**Files:** `agents/wi-implementer.md` (new), `claude-plugin-release/agents/wi-implementer.md` (new)
**Description:**
Copy `.claude/agents/wi-implementer.md` to the two mirror locations. Establishes the three-location convention for agents (parallel to skills). Plugin-installed users get the sub-agent at install time; dev-mode users use the `.claude/` copy. All three files stay byte-identical.

### Step 3 — Rewrite `.claude/commands/wi-implement.md` as dispatcher
**Satisfies:** AC-2, AC-6, AC-7 (skill side), AC-8 (skill side), AC-9
**Files:** `.claude/commands/wi-implement.md` (rewrite)
**Description:**
Replace the existing 5.1–5.4 inline protocol with a dispatcher protocol:

- **Step 1** (kept) — Resolve workitem, read `plan.md` and `analyze.md`.
- **Step 2** (new) — Initialize `implementation.md` with `status: in-progress` plus the **AC Pre-Check** section (empty table with one row per AC from `analyze.md`, status `MISSING` placeholder). The updated artifact template includes AC Pre-Check between Architecture Notes and Plan Deviations (AC-6).
- **Step 3** (new) — Dispatch via Agent tool with `subagent_type: "wi-implementer"`. Prompt contents: workitem path, full text of `plan.md` and `analyze.md`, path to `implementation.md`. Instruct the sub-agent to write all results directly to `implementation.md` and return the terse form.
- **Step 4** (new) — Handle three return states (AC-9):
  - `done -> <path>`: print highlights to user, update `source_of_truth.md` (current phase → implementation, updated → today), suggest `/wi-next`.
  - `blocked -> <reason>`: append blocker to `source_of_truth.md` Active Blockers, set `Blocked: yes`, surface to user.
  - `replan-requested -> <discovery>`: present three-option prompt to user (re-run `/wi-plan` / adjust scope manually and re-dispatch / cancel). On user choice "re-dispatch": run AC-8 max-1-replan-per-sub-feature check first (see Step 4).
- **Step 5** (new) — Max-1-replan enforcement (AC-8): skill writes a `replan-attempt: <N>` line to the workitem's `source_of_truth.md` Key Decisions Log on each dispatch. On a second dispatch that returns `replan-requested`, skill does NOT re-dispatch a third time — instead converts to `blocked -> max replans exceeded` and escalates to user.
- **Updated `implementation.md` template** (AC-6) — add AC Pre-Check section between Architecture Notes and Plan Deviations:
  ```markdown
  ## AC Pre-Check
  | AC | Test / Evidence | Status |
  |---|---|---|
  | AC-1 | <test file:function or evidence> | COVERED / MISSING |
  ```
  Add `blocked-replan` to the allowed status values in the frontmatter.

### Step 4 — Mirror the skill rewrite
**Satisfies:** AC-2 (full coverage across distribution channels)
**Files:** `commands/wi-implement.md` (rewrite), `claude-plugin-release/commands/wi-implement.md` (rewrite)
**Description:** Copy the new `.claude/commands/wi-implement.md` to both mirror locations. Maintains the byte-identical three-location skill convention.

### Step 5 — Update `obsidian-docs/Slash Commands.md`
**Satisfies:** AC-12
**Files:** `obsidian-docs/Slash Commands.md`
**Description:**
- Update the `/wi-implement` table row (currently line 186): change description from `Architecture → TDD coding → QA loop → regression` to `Dispatches the implement phase to the wi-implementer sub-agent (architecture → TDD coding → QA loop → regression)`.
- Add a brief subsection under the table (or near the "Adding a new command" section) titled "Sub-agents" with one paragraph: where agents live (`.claude/agents/` mirrored to `agents/` and `claude-plugin-release/agents/`), how they're invoked (Agent tool with `subagent_type`), and the current list (just `wi-implementer` for now).

### Step 6 — Smoke test the dispatch
**Satisfies:** AC-10
**Files:** none modified by this step — verifies behavior only. May create and delete a throwaway test workitem.
**Description:**
The cleanest evidence is to run the new `/wi-implement` against a real workitem and observe. Two options for the smoke test:
- **Option A (preferred):** Create a minimal `WI-subagent-smoke-test/20260525-trivial` workitem with one AC ("write a single file `test-marker.tmp` with the text 'hello' and add a trivial test"). Dispatch new `/wi-implement` against it. Verify: (a) Agent tool invoked with `subagent_type: "wi-implementer"`, (b) sub-agent writes `implementation.md` with populated AC Pre-Check, (c) main receives terse return + highlights, (d) `source_of_truth.md` updates. Then delete the test workitem and `test-marker.tmp`.
- **Option B (fallback if Option A blocked):** Inspect the dispatch wiring statically — read `wi-implement.md` and `wi-implementer.md` end-to-end, confirm all three return states are wired into the skill protocol, all three sub-agent return forms are produced by clear branches in the agent protocol. No live dispatch.

Implementer picks Option A unless live dispatch reveals a Claude Code configuration issue (e.g. `subagent_type` not resolved) — in which case fall back to Option B and log the blocker.

### Step 7 — Verify diff scope (AC-11)
**Satisfies:** AC-11
**Files:** none — verification only
**Description:**
Run `git status` and `git diff --stat`. Confirm changed files are exactly:
- 6 new: 3× `wi-implementer.md` (across `.claude/agents/`, `agents/`, `claude-plugin-release/agents/`) + workitem artifacts (intake, analyze, approaches, plan, implementation, review, documentation)
- 3 modified: 3× `wi-implement.md` (across the three skill locations)
- 1 modified: `obsidian-docs/Slash Commands.md`
- 1 modified: `workitem/WI-subagent-delegation/source_of_truth.md`
- No changes to: any `.json`, `.go`, `.js`, `.env`, `package.json`, `.mcp.json`, `settings.json`, `hooks/`, `mcps/`, `bin/`.

### Step 8 — Refresh skill registry
**Satisfies:** AC-12 (registry side)
**Files:** `.claude/skill-registry.md` (regenerated — gitignored, not committed)
**Description:**
Invoke `/registry-refresh` to re-read the updated `wi-implement.md` description. The session-start protocol handles this automatically next session, but doing it now keeps the in-session registry in sync with the rewritten skill.

## Risks / Known Unknowns

- **Claude Code agent file format.** I'm assuming the standard custom-agent frontmatter (`name`, `description`, `tools`) maps to invocation via Agent tool's `subagent_type` parameter. If Claude Code uses different discovery rules (e.g. a manifest, different field names, model selection requirement), Step 1 needs adjustment. **Mitigation:** Implementer verifies during architecture review by checking any Claude Code docs available locally (`~/.claude/`, harness install dir) before drafting the agent file. If discovery convention is unclear, log a blocker rather than guessing.

- **Three-location mirror for agents is unestablished convention.** No prior agent files exist, so we're inventing the mirroring pattern. **Mitigation:** Mirror by analogy to the skill convention (which is established and working). If the user prefers a different placement (e.g. only `.claude/agents/`, with plugin-release pulling from there at packaging time), this is a small re-arrangement.

- **Smoke test "Option A" dispatches a live sub-agent.** This is the first sub-agent invocation in the repo. If misconfigured, the dispatch may error in ways that aren't fully captured by `implementation.md` (e.g. Agent tool returns an error to main before sub-agent ever writes anything). **Mitigation:** If Option A fails, implementer falls back to Option B (static wiring inspection) and logs the blocker for follow-up.

- **AC Pre-Check enforceability.** The sub-agent prompt says "do not return `done` until AC Pre-Check is fully COVERED". This is a prompt-level enforcement, not a runtime check. A misbehaving sub-agent could still return `done` with MISSING rows. **Mitigation:** Main agent's `done` handler (Step 3 of skill) does a sanity check on `implementation.md` AC Pre-Check before accepting the return; if any row is MISSING, treat as blocked and surface to user. This was not explicitly in the analyze ACs but is the minimum guard that makes the AC Pre-Check meaningful — adding it to Step 3 of the skill.

- **Recursive self-test temptation.** Tempting to run new `/wi-implement` against THIS workitem's own implement phase. Avoid — the dispatcher under test would dispatch itself, and any bug becomes hard to diagnose. Stick to a separate trivial workitem for AC-10.

## Confirmation

**Confirmed by user:** yes
**Notes:** AC Pre-Check sanity guard in skill's `done` handler accepted as part of Step 3 (Risk #4 mitigation).

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
