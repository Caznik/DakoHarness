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
| 5 — Installer | Planned | Install script, cross-platform binaries, Plugin Marketplace manifest |
| 6 — Multi-agent | Planned | Adapters for OpenCode, Pi, Codex CLI |

---

## Phase 1 — Memory foundation ✅

- Long-term memory MCP (MongoDB / Node.js / TypeScript)
- Short-term memory MCP (Go / SQLite / FTS5 / 7-day TTL)
- Session logging via Claude Code hooks (UserPromptSubmit, Stop)
- CLAUDE.md memory protocol
- Slash commands: /recall, /promote, /session-end
- `forget` tool for deleting stale memories

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

## Phase 5 — Installer (Planned)

- Install script that writes `.mcp.json`, `settings.json` (with correct absolute paths), CLAUDE.md block, `.gitignore` entries
- CLAUDE.md template for target projects
- Cross-platform short-term memory binary (Go cross-compile for Mac / Linux / Windows)
- Claude Plugin Marketplace manifest

> [!NOTE]
> Go cross-compilation for the short-term memory binary is planned here. Until then, only the Windows `.exe` is pre-built.

---

## Phase 6 — Multi-agent (Planned)

Per-agent adapter layer for:
- OpenCode
- Pi
- Codex CLI

---

## Backlog

| Item | Description |
|---|---|
| Auto registry-refresh on session start | If short-term memory shows recent command file changes, auto-run `/registry-refresh` at next session start |
| Context7 / Notion / Jira MCPs | External knowledge source integrations |
| Model routing | Route tasks to different models based on complexity |
| Permission harness | Structured permission management layer |
| MongoDB dashboard | Visual interface for browsing sessions and memories |

---

## Related

- [[Architecture]] — current system state
- [[Home]] — project overview
