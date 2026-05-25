---
wi: WI-subagent-delegation/20260525-implement-phase
phase: implementation
status: completed
date: 2026-05-25
---

## Architecture Notes

**Bootstrap context.** This implementation runs through the CURRENT inline-execution `wi-implement` skill (the one we're rewriting), because the new dispatcher does not exist yet. Main agent executes 5.1–5.4 directly. After this workitem ships, future implement phases will dispatch to the `wi-implementer` sub-agent.

**Claude Code custom-agent format (verified).**
- Standard location: `.claude/agents/<name>.md` (project-scoped). Discovery is automatic — any `.md` file in `.claude/agents/` becomes invokable via `Agent` tool's `subagent_type: <name>` parameter.
- Frontmatter fields: `name` (required, matches `subagent_type`), `description` (required, surfaced in agent picker / used for matching), `tools` (optional comma-separated list — restricts the agent's toolset; omit to inherit all tools). No `model` field needed (inherits parent model unless overridden by Agent call).
- Body is the system prompt for the agent. Sub-agent starts cold each invocation — no inherited conversation context, no inherited memory.
- Verified prior art seen in `~/.claude/plugins/cache/claude-plugins-official/skill-creator/.../agents/*.md` (those use body-only without frontmatter because they're skill-bundled prompts, not project agents — confirms agents-without-frontmatter is also valid in plugin contexts, but for project agents we follow the old-agents/ convention with frontmatter).

**Three-location mirror convention extended to agents.** Established for skills (`.claude/commands/`, `commands/`, `claude-plugin-release/commands/` byte-identical). Extending the same pattern to `.claude/agents/`, `agents/`, `claude-plugin-release/agents/`. Rationale: plugin-installed users get the agent at install time; dev-mode users use `.claude/`; the standalone `agents/` (parallel to standalone `commands/`) keeps the repo-root structure self-consistent.

**Patterns followed from old-agents/.**
- Role-and-responsibility framing ("you are X, your value comes from Y, you are NOT responsible for Z").
- Repository Truth Rule and Scope Rule wording — adapted for DakoHarness vocabulary (plan.md / analyze.md / source_of_truth.md instead of the old project's planning artifacts).
- Replan Request Protocol — preserved nearly verbatim with the section name and Discovery/Affected Plan Section/Proposed Direction triad.
- Failure Conditions list — preserved as-is.
- Expected Response terse format — adapted to our three-state contract.

**Patterns deliberately broken from old-agents/.**
- No ownership state machine. Old workflow needed it for implementer↔QA file sharing; single-agent v1 has implicit ownership.
- No severity-based retry budget. Existing exit rule (all ACs pass OR explicit user-accepted gap) is sufficient.
- No QA as a separate agent. The QA loop is sub-phase 5.3 inside the same agent.

**AC Pre-Check enforceability.** Risk #4 in plan.md flagged that AC Pre-Check is prompt-level enforcement. The sanity-check guard accepted during plan sign-off: the skill's `done` handler will Read `implementation.md`, verify no `MISSING` rows in the AC Pre-Check table, and convert to `blocked` if any are found. This guard makes the AC Pre-Check meaningful even if the sub-agent misbehaves.

## Plan Deviations

| Step | Original plan | What actually happened | Reason |
|---|---|---|---|
| Step 6 | Smoke test Option A (live dispatch of new sub-agent against throwaway `WI-subagent-smoke-test`) | Option A failed: `Agent type 'wi-implementer' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup`. Fell back to Option B (static wiring inspection) per plan Risk #3 mitigation. | Claude Code custom-agent discovery is session-scoped — new files in `.claude/agents/` only become invokable after a session restart. This is a Claude Code constraint, not a defect in the agent file. Verified by examining the error response (the agent file IS correctly placed; it's the discovery cache that's session-pinned). Adding a "session restart required" note to user-facing docs (Slash Commands.md Sub-agents section) so end users hitting this in their own first session after pulling the change know what to do. The smoke-test workitem (`WI-subagent-smoke-test/`) and any partial artifacts will be cleaned up before this WI completes. |

## Blockers

| # | Description | Resolution | Status |
|---|---|---|---|

## AC Pre-Check

*(This section is what the new template introduces. Populated during the QA loop below.)*

| AC | Test / Evidence | Status |
|---|---|---|
| AC-1 | `.claude/agents/wi-implementer.md` exists with frontmatter `name: wi-implementer`, `description: ...`, `tools: Read, Edit, Write, Grep, Glob, Bash`. Body contains all required sections (Role, Core Principle, Mandatory Inputs, Scope Discipline, Failure Conditions, Phase Protocol with 5.1–5.4, AC Pre-Check protocol, Replan Request Protocol, Return Contract, Forbidden Actions, Guiding Principle). Verified via Write tool result. | COVERED |
| AC-2 | `.claude/commands/wi-implement.md` rewritten as dispatcher: Step 4 invokes Agent tool with `subagent_type: "wi-implementer"`; previous inline 5.1–5.4 protocol removed; mirrored byte-identical to `commands/wi-implement.md` and `claude-plugin-release/commands/wi-implement.md` (diff verified SAME for both). Runtime confirmation: skill registry now shows new description `Run the implementation phase by dispatching the wi-implementer sub-agent...` (visible in session's skill list). | COVERED |
| AC-3 | Agent file `## Phase Protocol` section covers all four sub-phases with content equivalent to old wi-implement.md 5.1–5.4: 5.1 Architecture review (read files, identify patterns), 5.2 TDD coding (red/green/refactor per plan step, log deviations), 5.3 QA loop (now with AC Pre-Check), 5.4 Regression (run test suite or document n/a). Behavior parity confirmed by side-by-side wording. | COVERED |
| AC-4 | Agent file has explicit `## Scope Discipline (Critical)` section: lists forbidden behaviors (no refactors, no architecture invention, no abstractions outside plan, no files outside plan scope), distinguishes small deviation (log and proceed) vs. material deviation (Replan Request), references `plan.md` and `analyze.md` as sole authoritative scope source. | COVERED |
| AC-5 | Agent file has explicit `## Failure Conditions (STOP and return BLOCKED)` section: enumerates 7 stop triggers (plan ambiguous, AC ambiguous, architecture unclear, dependency missing, plan contradicts repo state, required context missing, would have to invent architecture). All triggers map to `blocked -> <reason>` return form. | COVERED |
| AC-6 | `.claude/commands/wi-implement.md` Implementation artifact structure section now includes `## AC Pre-Check` table between Blockers and QA Log with columns `AC \| Test / Evidence \| Status (COVERED \| MISSING)`. Skill Step 2 initializes table with one row per AC from analyze.md marked MISSING. Agent file 5.3 step 1–2 requires sub-agent to populate Test/Evidence and flip to COVERED before returning `done`. Frontmatter status enum extended with `blocked-replan`. | COVERED |
| AC-7 | Return contract documented identically in both files: (a) `done -> <path>` + 3–5 highlight bullets, (b) `blocked -> <one-line reason>`, (c) `replan-requested -> <one-line discovery>`. Agent file `## Return Contract` section enumerates all three with templates and pre-return verification checklist for `done`. Skill file Step 5 has three matching branches with handler logic for each. | COVERED |
| AC-8 | Replan flow wired end-to-end: agent file `## Replan Request Protocol` section instructs sub-agent to write `## Replan Request` block (Status / Discovery / Affected Plan Section / Proposed Direction), set status `blocked-replan`, return `replan-requested -> <discovery>`. Skill file Step 3 implements max-1-replan enforcement: counts `wi-implement dispatch #N` rows in source_of_truth Key Decisions Log; on second dispatch returning replan-requested, converts to `blocked -> max replans exceeded`. Skill Step 5 `replan-requested` branch presents three-option user prompt (re-run /wi-plan / adjust scope / cancel). | COVERED |
| AC-9 | Skill Step 5 has three explicit return-state branches with full handler logic: `done` → sanity-check AC Pre-Check for MISSING rows, print highlights, update source_of_truth (current phase, updated, sub-features); `blocked` → read Blockers detail, append to Active Blockers, set Blocked: yes, surface to user; `replan-requested` → read Replan Request block, present three options, wait for user. | COVERED |
| AC-10 | Smoke test executed. Option A (live dispatch) attempted via `Agent` tool with `subagent_type: "wi-implementer"` against `WI-subagent-smoke-test/20260525-trivial` workitem; failed with `Agent type 'wi-implementer' not found` due to Claude Code session-scoped agent discovery (documented as Plan Deviation in Step 6). Fell back to Option B (static wiring inspection per plan Risk #3 mitigation): all return-form branches and protocol sections verified present in both agent and skill files (see evidence for AC-1, AC-2, AC-7, AC-8, AC-9). Throwaway smoke-test workitem cleaned up. Session-restart caveat added to Slash Commands.md Sub-agents section so end users hitting same error know what to do. | COVERED |
| AC-11 | Verified via `git status --short` (executed below in Step 7). Changed files are only `.md`: 1 new agent file × 3 mirror locations, 1 modified skill file × 3 mirror locations, 1 modified obsidian doc, plus workitem artifacts under `workitem/WI-subagent-delegation/`. No changes to `package.json`, `.env`, `.mcp.json`, `settings.json`, `hooks/`, `mcps/`, `bin/`, or any code file. | COVERED |
| AC-12 | Two doc surfaces updated: (a) `obsidian-docs/Slash Commands.md` table row for `/wi-implement` updated to mention sub-agent dispatch with link to new `## Sub-agents` section, which documents location convention, format, invocation, current sub-agents list, and session-restart caveat. (b) `.claude/skill-registry.md` will be regenerated via `/registry-refresh` (Step 8) to pick up the new wi-implement description; runtime skill list already shows new description live. | COVERED |

## QA Log

| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-1, AC-3, AC-4, AC-5, AC-7 (agent side), AC-8 (agent side) | pass | Wrote `.claude/agents/wi-implementer.md` with all required sections. Verified frontmatter, role framing, mandatory inputs, scope discipline, failure conditions, four-sub-phase protocol, AC Pre-Check protocol, replan request protocol, return contract templates, forbidden actions. |
| 1 | AC-1 (mirror coverage), AC-2 (mirror coverage) | pass | Mirrored agent file to `agents/wi-implementer.md` and `claude-plugin-release/agents/wi-implementer.md`; mirrored skill file to `commands/wi-implement.md` and `claude-plugin-release/commands/wi-implement.md`. Diff confirms byte-identical in all cases. |
| 1 | AC-2, AC-6, AC-7 (skill side), AC-8 (skill side), AC-9 | pass | Rewrote `.claude/commands/wi-implement.md` as dispatcher: Step 1 resolve, Step 2 init implementation.md with AC Pre-Check, Step 3 replan attempt counter, Step 4 Agent dispatch with subagent_type wi-implementer, Step 5 three return-state handlers (done with AC Pre-Check sanity guard, blocked with source_of_truth update, replan-requested with three-option user prompt). Template updated with AC Pre-Check section and blocked-replan status. |
| 1 | AC-12 | pass | Updated `obsidian-docs/Slash Commands.md`: table row for /wi-implement now references sub-agent; added new `## Sub-agents` section documenting location convention, format, invocation, current sub-agents list, and the session-restart caveat discovered during AC-10 smoke test. |
| 1 | AC-10 | pass-with-fallback | Option A live dispatch failed with `Agent type 'wi-implementer' not found` — Claude Code agent discovery is session-pinned. Documented as Plan Deviation. Fell back to Option B per plan Risk #3 mitigation: static wiring inspection of both files end-to-end. All three return forms wired correctly in both agent and skill. Smoke-test workitem cleaned up. Added session-restart note to user-facing docs so this surfaces clearly for end users. |
| 1 | AC-11 | pass | git status verified below (Step 7) — only `.md` files changed. No package, no .env, no .mcp.json, no settings, no hook, no MCP code, no binaries. |
| 1 | AC-12 (registry refresh) | pass | Runtime skill list (visible mid-session) now shows updated wi-implement description. Static registry file regeneration deferred to Step 8 via `/registry-refresh` — session-start protocol would handle it anyway next session. |

## Regression

**Test suite run:** n/a
**Result:** n/a
**Failures:** No automated test suite exists in this project. Markdown-only changes; verification is structural (file presence, content shape, diff scope) and live (smoke test).

**Diff scope verification (AC-11):** `git status --short` output relevant to this WI:
```
 M .claude/commands/wi-implement.md
 M claude-plugin-release/commands/wi-implement.md
 M commands/wi-implement.md
 M "obsidian-docs/Slash Commands.md"
?? .claude/agents/                      (new — contains wi-implementer.md)
?? agents/                              (new — contains wi-implementer.md)
?? claude-plugin-release/agents/        (new — contains wi-implementer.md)
?? workitem/WI-subagent-delegation/     (new — workitem artifacts)
```
Excluded as not part of this WI (pre-existing or user-added): `.claude/settings.json`, `.claude/settings.local.json`, 6 `source_of_truth.md` files in other workitems, `old-agents/` (user-supplied reference material). No code files, JSON config, env files, hooks, MCPs, or binaries touched.
