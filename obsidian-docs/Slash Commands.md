---
tags: [dakoharness, commands, skills]
created: 2026-05-20
---

# Slash Commands

Custom slash commands live in `.claude/commands/`. An auto-generated index is at `.claude/skill-registry.md` (see [[#/registry-refresh]]).

---

## /doctor

**Usage:** `/doctor`  
**File:** `commands/doctor.md`

Verify the full DakoHarness installation in one shot. Checks all components and reports ✅/❌ with remediation steps.

**Checks (in order):**
1. `DAKO_HOME` — `~/.dako/config` exists and path is valid
2. LTM server files — `server.js` and `node_modules/mongodb` present
3. STM binary — platform binary exists at `$DAKO_HOME/bin/`
4. `.env` — file exists and contains all 7 required fields
5. MongoDB reachability — TCP connection test via temp Node.js script
6. `.mcp.json` — exists in cwd with both MCP server entries
7. Hooks — `UserPromptSubmit`, `Stop`, `PreCompact` configured; hook binary resolves
8. LTM MCP (live) — `recall` tool call confirms MCP is responding
9. STM MCP (live) — `get_recent_patterns` call confirms MCP is responding

All checks run unconditionally. The summary table is always shown in full. Fixable failures (missing `.mcp.json`, incomplete `.env`) are offered as interactive remediations after the table.

**When to use:** After installation, when an MCP is not connecting, or when hooks stop firing.

---

## /checkpoint

**Usage:** `/checkpoint`  
**File:** `commands/checkpoint.md`

Save a structured context snapshot to short-term memory so work can be recovered after context compaction.

**What it saves:**
- Current task description
- Key decisions made this session not yet in long-term memory
- Active workitem path and phase (if any)

**When to use:** At any point in a long session before closing, or when context is getting large. Also triggered automatically every 15 turns by the CLAUDE.md protocol.

**Recovery:** At the start of a session after compaction, the agent calls `find_patterns(query: "context-snapshot")` to check for a recent snapshot and restore context from it. Snapshots expire automatically after 7 days via STM TTL — no manual cleanup needed.

---

## /memory-audit

**Usage:** `/memory-audit`  
**File:** `commands/memory-audit.md`

Audit all long-term memories for the current project across three sequential passes. Agent proposes every change — nothing is deleted or modified without explicit user confirmation.

**Passes (in order):**
1. **Deduplication** — identifies near-duplicate memory pairs by type and content similarity; user chooses which to keep
2. **Staleness** — flags memories older than 90 days; user keeps, updates, or deletes each
3. **Contradictions** — identifies memories with conflicting claims on the same subject; user selects resolution

After all three passes, prints a summary: "X duplicate(s) merged, Y stale resolved, Z contradiction(s) resolved."

**When to use:** Periodically on long-lived projects (e.g. monthly) to keep long-term memory accurate and noise-free. Also run after a major refactor that may have invalidated existing decisions or conventions.

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
