---
tags: [dakoharness, commands, skills]
created: 2026-05-20
---

# Slash Commands

Custom slash commands live in `.claude/commands/`. An auto-generated index is at `.claude/skill-registry.md` (see [[#/registry-refresh]]).

---

## /recall

**Usage:** `/recall <keywords>`  
**File:** `.claude/commands/recall.md`

Search long-term memory for past decisions, conventions, bugs, and lessons.

**Steps:**
1. Calls `recall` with the given keywords against the current project
2. Groups results by memory type (DECISION, CONVENTION, BUG, CONTEXT, LESSON)
3. Reports plainly if nothing is found — never invents context

**When to use:** Before starting work that may have relevant prior decisions or known pitfalls.

---

## /promote

**Usage:** `/promote [keywords]`  
**File:** `.claude/commands/promote.md`

Promote a short-term pattern to permanent long-term memory.

**Steps:**
1. Finds candidate patterns (by keyword search or lists all recent ones)
2. Infers the memory type from content; asks user to confirm if ambiguous
3. Calls `remember` with the pattern's reasoning (WHY, not just what)

**When to use:** When a recently accepted approach deserves to outlast the 7-day TTL.

---

## /promote-team

**Usage:** `/promote-team [keywords]`  
**File:** `.claude/commands/promote-team.md`

Promote a project memory to team scope, making it searchable across all projects.

**Steps:**
1. Finds the candidate memory by keyword search
2. Validates the memory is broadly applicable (not project-specific)
3. Calls `promote_to_team` — updates `scope` field in MongoDB

**When to use:** When a lesson or decision could benefit developers on other projects. See [[Team Memory]].

---

## /session-end

**Usage:** `/session-end`  
**File:** `.claude/commands/session-end.md`

End-of-session cleanup — review short-term patterns, promote durable ones, save in-progress context.

**Steps:**
1. Loads short-term patterns and current long-term memory in parallel
2. For each short-term pattern: skip if already in long-term, promote if durable
3. Saves a "Next session: …" context memory if there is unfinished work
4. Reports what was promoted, what was skipped, and why

**When to use:** At the end of a meaningful working session before closing Claude Code.

---

## /registry-refresh

**Usage:** `/registry-refresh`  
**File:** `.claude/commands/registry-refresh.md`

Regenerate `.claude/skill-registry.md` by scanning all command files.

**Steps:**
1. Globs all `.md` files in `.claude/commands/` (excluding itself)
2. Reads `name` and `description` from each file's YAML frontmatter
3. Writes the registry table with a "When to use" column

**When to use:** After adding, removing, or renaming a command file.

> [!NOTE]
> `.claude/skill-registry.md` is gitignored — it is always generated locally from the command files.

---

---

## Workitem workflow

14 commands for the structured development workflow. See [[Workitem Workflow]] for the full specification.

### Unified drivers

| Command | Description |
|---|---|
| `/wi-start [description]` | Start a workitem — routing + intake + drives full workflow |
| `/wi-next` | Advance active workitem to next phase |
| `/wi-status` | Show active workitem state and available actions |
| `/wi-park` | Pause active workitem without cancelling |
| `/wi-cancel` | Cancel active workitem or current phase — files always kept |

> Unified commands auto-detect the active workitem from `source_of_truth.md`.

### Individual phase commands

| Command | Phase | Description |
|---|---|---|
| `/wi-intake <path>` | 1 | Run or re-run intake on an existing workitem |
| `/wi-analyze <path>` | 2 | Requirements interview + acceptance criteria sign-off |
| `/wi-propose <path>` | 3 | Generate approaches, surface trade-offs, record selection |
| `/wi-plan <path>` | 4 | Explore codebase + produce sequenced plan tied to ACs |
| `/wi-implement <path>` | 5 | Architecture → TDD coding → QA loop → regression |
| `/wi-review <path>` | 6 | Verify every AC and plan step → produce verdict |
| `/wi-document <path>` | 7 | Update project docs + write workitem documentation record |
| `/wi-repo <path>` | 8 | Suggest commit message — never touches git without approval |
| `/wi-archive <path>` | 9 | Archive completed workitem to MongoDB |

> Individual commands require the workitem path as `$ARGUMENTS` (e.g. `WI-retry-logic/20260521-http-client`).

---

## Adding a new command

1. Create a `.md` file in `.claude/commands/` with YAML frontmatter:
   ```yaml
   ---
   name: my-command
   description: One-line description of what it does.
   ---
   ```
2. Write the steps the agent should follow in the file body
3. Run `/registry-refresh` to update the index

---

## Related

- [[Memory System]] — tools the memory commands invoke
- [[Team Memory]] — /promote-team workflow
- [[Workitem Workflow]] — full specification for the wi-* commands
- [[Architecture#Component map]] — where command files live
