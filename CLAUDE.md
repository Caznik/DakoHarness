# DakoHarness

An extensible harness for coding agents. Provides a two-tier memory system (long-term MongoDB + short-term SQLite) and session logging via hooks. First target: Claude Code via Plugin Marketplace. Future targets: OpenCode, Pi, and others.

## Architecture

```
mcps/
  mongodb-memory/   Long-term memory MCP (Node.js, MongoDB)
  short-term-memory/ Short-term pattern memory MCP (Go, SQLite, 7-day TTL)
.claude/
  settings.json     Hook configuration (UserPromptSubmit + Stop)
  commands/         Custom slash commands (/recall, /promote, /promote-team, /session-end, /wi-*)
workitem/           Workitem traceability artifacts (source_of_truth.md + phase artifacts per WI)
.mcp.json           MCP server registrations
```

---

## Memory Protocol

You have two memory systems. Use them actively — they are the core of what is being built here.

### Session Start

Start every session blank. Do **not** preload memory. Wait for the user's first task, then decide if memory is relevant.

**After compaction:** Call `find_patterns` with `query: "context-snapshot"` and `project: "DakoHarness"` once. If a result is found, read it to understand where work was interrupted. No delete needed — STM TTL handles expiry automatically.

### During a Session — When to Search

Before starting a task, search memory only if the task seems related to past work:
- Call `find_patterns` with task keywords if it feels like something done recently in this project
- Call `recall` with keywords if you need a past decision or convention

Do not search memory for tasks that are clearly unrelated to past DakoHarness work.

### During a Session — When to Save

**Save to short-term memory** (`remember_pattern`) when:
- The user explicitly accepts an approach ("yes", "looks good", "do it that way", "perfect")
- A bug is fixed and the fix has a reusable pattern
- A code style or convention is established for the first time
- You try two approaches and the user picks one — save which one and why

**Save to long-term memory** (`remember`) when:
- An architectural decision is made that should outlast this week
- A convention is confirmed to be permanent ("always use X in this project")
- Something important is learned about the project that isn't obvious from the code
- A bug fix reveals a systemic issue worth tracking permanently

**Do not save** routine tool calls, exploratory attempts that were rejected, or information already derivable from the codebase.

### Context Checkpointing

Every 15 turns, call `remember_pattern` with the following fields to save a context snapshot to short-term memory:

- `project`: `"DakoHarness"`
- `agent`: `"claude-code"`
- `type`: `"context-snapshot"`
- `content`: structured as:
  ```
  Current task: <what is being worked on right now>
  Key decisions this session: <decisions made but not yet saved to LTM, or "none">
  Active workitem: <WI path and current phase, or "none">
  ```
- `reasoning`: `"Periodic context checkpoint"`

The same snapshot structure is used by `/dako:checkpoint` for on-demand saves. If `remember_pattern` fails (STM MCP down), note the failure — do not silently continue without saving.

### Before Starting a Task

If a task feels similar to something done recently, call `find_patterns` with relevant keywords before starting. Apply matching patterns unless the user indicates otherwise.

---

## Tool Reference

| Situation | Tool | Memory tier |
|---|---|---|
| After compaction — check for snapshot | `find_patterns` (query: "context-snapshot") | Short-term |
| User accepts an approach | `remember_pattern` | Short-term |
| Permanent architectural decision | `remember` type: `decision` | Long-term |
| Code convention established | `remember` type: `convention` | Long-term |
| Bug fixed with reusable lesson | `remember` type: `bug` | Long-term |
| Important project fact | `remember` type: `context` | Long-term |
| Before similar task | `find_patterns` | Short-term |
| Searching past decisions | `recall` | Long-term |

### Memory Types (long-term)

- `decision` — architectural or design choice with reasoning
- `convention` — naming rule, code style, pattern for this project
- `bug` — a bug and how it was fixed, to avoid repeating it
- `context` — important project fact not obvious from the code
- `lesson` — what went wrong and what was learned

---

## Memory Query Expansion

Both `recall` (LTM) and `find_patterns` (STM) are keyword-based — exact phrasing matters. To make vague or paraphrased queries return the right results, expand the query agent-side before calling either tool. This protocol applies to **any** memory search you initiate, not just the `/recall` slash command.

### When to expand

Any time the user's intent could be expressed in multiple ways. Skip expansion for short, unambiguous keyword searches (e.g. a specific function or file name).

### How to expand

1. Generate up to **5 total queries** — the original plus 1-4 paraphrases. A useful paraphrase varies the surface form (synonyms, alternative framings, related concepts) while preserving intent. Don't waste a variant on a trivial morphological change (singular/plural alone).
2. Call the target MCP tool **once per variant** with the same `project` and `limit`.
3. Merge the ranked result lists:
   - **LTM (`recall`)**: dedup by `[TYPE] title` (the prefix the MCP emits, e.g. `[DECISION] Use MongoDB`). Score = number of variants where the memory appeared. Tie-break by best (lowest) rank across those variants.
   - **STM (`find_patterns`)**: dedup by content fingerprint — first 80 characters of `content`, lowercased, whitespace-collapsed. Same rank-based scoring.
4. Sort merged results by score desc, then best rank asc. Present the top 5-10.

### Fallback

If a variant errors, skip it — the remaining variants still produce results. If every variant returns nothing, the search has genuinely missed; do not invent context.

---

## Skill Registry

A list of available slash commands is in `.claude/skill-registry.md`. Consult it when a user's request sounds like a workflow task that might match a command (e.g. "search memory", "end the session", "save this pattern"). Run `/registry-refresh` after adding or removing a command file.

---

## Workitem Workflow

Every development task can optionally go through the structured workitem workflow for full traceability. Artifacts are stored in `workitem/WI-<feature>/<date>-<sub-feature>/`.

### When to use the workflow

- **Full workflow** (`/wi-start`) — new feature, refactor, or significant bugfix that affects behaviour
- **Partial workflow** — user says "just plan this" or "just review this" → start at that phase
- **Free flow** — general questions, trivial changes (typos, config tweaks) → no workitem

### Phase sequence

```
Intake → Analyze → Propose* → Plan → Implement → Review → Document → Repo → Archive
```
*Propose is conditional — triggered only when multiple viable implementation directions exist.

### Gate rules

- **Human approval required**: Intake, Analyze (AC sign-off), Propose (approach selection), Plan, Review, Document, Repo
- **Automated**: Architecture sub-phase, QA loop, Regression, Archive

### Key rules

- Never create workitem files until the user explicitly confirms the routing decision
- Never commit/push/branch without explicit user approval (repo actions phase)
- Log all plan deviations silently in `implementation.md` — never discard them
- The QA loop exits only when all ACs pass or user accepts a known gap in writing

---

## Behavior Guidelines

- **Save the WHY, not just the what.** A memory without reasoning is useless. Include why the user accepted the approach, not just what was done.
- **Short-term first, promote to long-term if it proves durable.** If the same pattern appears across multiple sessions, it belongs in long-term memory.
- **One memory per insight.** Don't bundle multiple decisions into one entry — they should be searchable and retrievable independently.
- **Project name is always `"DakoHarness"`, agent is always `"claude-code"`** when calling memory tools in this project.
- Session transcripts are captured automatically by hooks — you do not need to log individual messages manually.
