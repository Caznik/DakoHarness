---
tags: [dakoharness, roadmap, planning]
created: 2026-05-20
---

# Roadmap

## Phases

| Phase | Status | Description |
|---|---|---|
| 1 — Memory foundation | Done ✅ | Long-term MCP, short-term MCP, session logging, slash commands |
| 2 — Memory hardening | Done ✅ | Compaction recovery, session boundaries, team scope, skill registry |
| 3 — Development workflow | Done ✅ | Workitem workflow, 14 wi-* commands, artifact templates, workitems archive |
| 4 — Skill registry | Done ✅ | Delivered early in Phase 2 |
| 5 — Installer | Done ✅ | Claude Code plugin ("dako"), cross-platform binaries, setup scripts, --plugin-dir distribution |
| 6 — Marketplace | Under review 🔄 | Submitted to community marketplace — awaiting review |
| 7 — Multi-agent | Backlog | Adapters for OpenCode, Pi, Codex CLI |

---

## Phase 1 — Memory foundation ✅

- Long-term memory MCP (Node.js + TypeScript; pluggable storage backend — MongoDB or SQLite)
- Short-term memory MCP (Go / SQLite / FTS5 / 7-day TTL)
- Session logging via Claude Code hooks (UserPromptSubmit, Stop); hook logger routes through storage abstraction
- CLAUDE.md memory protocol
- Slash commands: /recall, /promote, /session-end
- `forget` tool for deleting stale memories
- Storage abstraction layer (`storage/` subfolder): `Storage` interface, `MongoStorage` adapter, `SqliteStorage` adapter, backend factory

---

## Phase 2 — Memory hardening ✅

- **Compaction recovery** — PreCompact hook saves snapshot; CLAUDE.md drives recovery on next session
- **Session boundary detection** — `claude_session_id` in `.dako_session`; new conversation auto-creates new session
- **Team scope** — `scope` field on memories; `promote_to_team` MCP tool; `/promote-team` command; `include_team` flag on `recall`
- **Skill registry** — `.claude/skill-registry.md`; `/registry-refresh` command

---

## Phase 3 — Development workflow ✅

Architecture principle: **structured traceability via workitems, human gates at every major phase**

### Workitem workflow
Full intake → analyze → propose → plan → implement → review → document → repo → archive pipeline.
Every task gets a folder under `workitem/WI-<feature>/` with per-phase artifact files.

### Commands (14 total)
**Unified:** `/wi-start`, `/wi-next`, `/wi-status`, `/wi-park`, `/wi-cancel`  
**Individual phases:** `/wi-intake`, `/wi-analyze`, `/wi-propose`, `/wi-plan`, `/wi-implement`, `/wi-review`, `/wi-document`, `/wi-repo`, `/wi-archive`

### Artifact templates
Per-phase `.md` files with YAML frontmatter, status tracking, and acceptance criteria linkage.
`source_of_truth.md` at the workitem level tracks overall state and sub-features.

### MongoDB
New `workitems` collection — completed workitems archived via `archive_workitem` MCP tool.

See [[Workitem Workflow]] for full documentation.

---

## Phase 5 — Installer ✅

DakoHarness is now a proper Claude Code plugin distributed via `--plugin-dir`.

### Plugin structure (`name: "dako"`)
- `.claude-plugin/plugin.json` — manifest; drives `/dako:*` command namespacing
- `commands/` — 20 `.md` files (19 migrated from `.claude/commands/` + new `/dako:setup`)
- `hooks/hooks.json` — `UserPromptSubmit`, `Stop`, `PreCompact` hooks via `dako-logger` wrapper
- `bin/` — executables and wrappers; auto-added to PATH on marketplace installs, manual PATH setup required for `--plugin-dir` mode

### Cross-platform binaries (`bin/`)
| File | Platform |
|---|---|
| `dako-stm.exe` | Windows |
| `dako-stm-linux` | Linux (amd64) |
| `dako-stm-darwin` | macOS (amd64) |
| `dako-stm` | Unix wrapper (uname detection) |
| `dako-stm.bat` | Windows wrapper |
| `dako-logger` | Unix hook wrapper |
| `dako-logger.bat` | Windows hook wrapper |

### Setup
- `setup.sh` / `setup.ps1` — start MongoDB via Docker, create `.env`, inject CLAUDE.md memory protocol into target project
- `/dako:setup` skill — set `DAKO_PROJECT_ROOT` per project

### Distribution
Loaded via `--plugin-dir ./DakoHarness` or `claude plugin install`. Community marketplace submission is a follow-up.

See [[Setup Guide]] for installation steps.

> [!NOTE]
> Runtime ACs (command resolution, hook firing, MCP path resolution) require a live `--plugin-dir` test. Static validation passes (`claude plugin validate .`).

---

## Phase 6 — Marketplace (Under review 🔄)

The `dako` plugin has been submitted to the Claude Code Community Marketplace. Once approved, users can install it with a single command instead of cloning the repo and using `--plugin-dir`.

### Submitted
- Plugin folder (`claude-plugin-release/`) validated with `claude plugin validate`
- Submitted via `claude.ai/settings/plugins/submit`
- Currently awaiting marketplace review

### Post-approval
- Update Setup Guide with `claude plugin install dako` as the primary install path
- Announce to users

---

## Phase 7 — Multi-agent (Backlog)

Per-agent adapter layer for:
- OpenCode
- Pi

---

## Backlog

| Item | Description |
|---|---|
| Sub-agent delegation for implementation | The entire implementation phase currently runs inside the main agent, consuming its context window. Delegate coding tasks to sub-agents via the Agent tool to keep the main context clean and enable parallel work across plan steps. |
| Context management improvements | Broaden compaction recovery into a proactive strategy: smarter pre-compaction snapshots, context pressure monitoring, and tighter integration between the two-tier memory system and in-session context usage. |
| Memory quality over time | Memories only accumulate — no signal for stale, contradicted, or duplicated entries. Add a review/consolidation process: deduplicate across sessions, flag memories superseded by newer decisions, and merge contradictions. Matters most after months of active use. |
| Semantic search for recall | `recall` uses keyword/text search. Embedding-based semantic search would make long-term memory useful for vague or paraphrased queries (e.g. "how should I structure the data layer?" finding "always use the repository pattern"). |
| RAG for long sessions | Analyze whether a retrieval-augmented approach improves memory recall in very long sessions where context compaction discards relevant history |
| Multi-agent adapters | Phase 7 — OpenCode, Pi |
| Context7 / Notion / Jira MCPs | External knowledge source integrations |
| Model routing | Route tasks to different models based on complexity |
| Permission harness | Structured permission management layer |
| MongoDB dashboard | Visual interface for browsing sessions and memories |

---

## Related

- [[Architecture]] — current system state
- [[Home]] — project overview
