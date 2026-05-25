---
name: wi-implement
description: Run the implementation phase by dispatching the wi-implementer sub-agent (architecture → TDD coding → QA loop with AC Pre-Check → regression). Handles done / blocked / replan-requested return states.
---

## When to use
After plan is confirmed. This skill is a thin dispatcher — the actual implementation work runs inside the `wi-implementer` sub-agent, in its own context window. Main handles only dispatch and return-state routing.

## Steps

### 1. Resolve workitem
- `$ARGUMENTS` → workitem path (e.g. `WI-foo/20260525-bar`)
- If not provided: list workitems and ask which one
- Read `plan.md` and `analyze.md` — you'll pass their full text to the sub-agent's prompt

### 2. Initialize `implementation.md`
Create `<workitem>/implementation.md` with the template in the "Implementation artifact structure" section below. Frontmatter `status: in-progress`. The AC Pre-Check table starts with one row per AC from `analyze.md`, all marked `MISSING` (the sub-agent will populate Test / Evidence and flip to `COVERED`).

### 3. Check replan attempt counter
Read `source_of_truth.md` Key Decisions Log. Count rows whose Decision starts with `wi-implement dispatch #` for this sub-feature.

- If count is **0** or **1** → proceed (this dispatch is allowed).
- If count is **2 or more** AND the previous dispatch returned `replan-requested` → do NOT dispatch a third time. Treat as `blocked -> max replans exceeded for sub-feature` and skip to Step 5 with `blocked` handling.

Append a new row to Key Decisions Log: `<today> | wi-implement dispatch #<N> for <sub-feature> | <reason: initial / post-replan / post-blocker-fix>`.

### 4. Dispatch the sub-agent
Invoke the `Agent` tool with:
- `subagent_type`: `"wi-implementer"`
- `description`: `"Implement <sub-feature>"` (short)
- `prompt`: a self-contained brief structured as:
  ```
  Workitem: <workitem path>
  
  Implementation.md path: <absolute path to implementation.md>
  
  --- plan.md ---
  <full text of plan.md>
  
  --- analyze.md ---
  <full text of analyze.md>
  
  Execute your full phase protocol. Write all results to implementation.md.
  Return one of: done -> <path> + 3-5 highlights / blocked -> <reason> / replan-requested -> <discovery>.
  ```

Do **not** add any other instructions to the prompt — the sub-agent's system prompt (the agent file body) already contains the full protocol. Adding inline instructions risks contradicting the agent file.

### 5. Handle the return
Parse the sub-agent's return. It will start with one of the three prefixes:

#### Return: `done -> <path>`
1. **Sanity-check the AC Pre-Check.** Read `implementation.md` AC Pre-Check section. If any row has status `MISSING`, do NOT accept the return as done. Convert to `blocked -> sub-agent returned done but AC Pre-Check has MISSING rows: <list>` and proceed to the blocked branch below.
2. Otherwise: print the highlights to the user (the 3–5 bullets the sub-agent returned).
3. Update `source_of_truth.md`:
   - Current phase → `implementation`
   - `updated` → today's date
   - Sub-features table: add `implementation` to Phases completed for this sub-feature
4. Tell the user: "Implementation complete. Run `/wi-next` to proceed to review."

#### Return: `blocked -> <reason>`
1. Read `implementation.md` Blockers table for full detail.
2. Update `source_of_truth.md`:
   - Append blocker row to Active Blockers table with description from the sub-agent
   - Set `Blocked: yes`
3. Surface to user: "Implementation blocked: `<reason>`. See `<path>` Blockers section for detail. Resolve and re-run `/wi-implement <workitem path>` when ready."

#### Return: `replan-requested -> <discovery>`
1. Read `implementation.md` `## Replan Request` section for full detail (Discovery / Affected Plan Section / Proposed Direction).
2. Show all three fields to the user.
3. Present three options:
   - **Re-run `/wi-plan`** — generate a new plan addressing the discovery. After plan is confirmed, re-run `/wi-implement` (this will be dispatch #2; max-1-replan rule applies).
   - **Adjust scope manually** — user edits `analyze.md` ACs and/or `plan.md` steps, then re-runs `/wi-implement`.
   - **Cancel the workitem** — run `/wi-cancel`.
4. Wait for the user's choice. Do not act autonomously on a replan — the user must choose.

### 6. On completion: hand back to user
Do not auto-chain into `/wi-review`. The user runs `/wi-next` when they're ready.

---

## Implementation artifact structure

This is the template for `implementation.md`. The new section vs. previous versions is **AC Pre-Check**.

```markdown
---
wi: <path>
phase: implementation
status: in-progress | completed | blocked | blocked-replan | cancelled
date: <YYYY-MM-DD>
---

## Architecture Notes
<how this fits the existing codebase — patterns followed, patterns deliberately broken and why>

## Plan Deviations
| Step | Original plan | What actually happened | Reason |
|---|---|---|---|

## Blockers
| # | Description | Resolution | Status |
|---|---|---|---|

## AC Pre-Check
| AC | Test / Evidence | Status |
|---|---|---|
| AC-1 | <test file::function or evidence ref> | COVERED \| MISSING |

## QA Log
| Iteration | AC checked | Result | Action taken |
|---|---|---|---|

## Regression
**Test suite run:** yes | no | n/a
**Result:** pass | fail | partial | n/a
**Failures:** <list if any>
```

When the sub-agent returns `replan-requested`, the artifact will also contain:

```markdown
## Replan Request
**Status:** REPLAN_REQUESTED
**Discovery:** <...>
**Affected Plan Section:** <...>
**Proposed Direction:** <...>
```

---

## Why dispatch (vs. inline)

Earlier versions of this skill ran the implement phase inline in the main agent's context window. Heavy file edits, exploration, and QA iteration consumed main's context, accelerating compaction. Dispatching to a dedicated sub-agent keeps that work in a separate window — main receives only the terse return and reads `implementation.md` on demand.

The sub-agent is defined in `.claude/agents/wi-implementer.md` (mirrored in `agents/` and `claude-plugin-release/agents/`). It carries the full protocol (architecture review, TDD coding, QA loop with AC Pre-Check, regression, Replan Request) as its system prompt.

For the underlying protocol, see `.claude/agents/wi-implementer.md`.
