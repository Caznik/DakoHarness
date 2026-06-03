# DakoHarness — OpenCode adapter

This folder adapts DakoHarness to run on [OpenCode](https://opencode.ai). It provides the same
two-tier memory, session logging, and workitem workflow as the Claude Code target — wired through
OpenCode's native config, plugin, command, and agent systems.

The **memory MCP servers are shared**, not duplicated. This adapter only supplies the OpenCode glue
and points OpenCode at the existing servers in the repo's `mcps/` directory.

---

## What maps to what

| Concern | Claude Code | OpenCode (this adapter) |
|---|---|---|
| MCP registration | `.mcp.json` (`mcpServers`) | `opencode.json` (`mcp`, `type: "local"`, `command` array) |
| Session logging | `settings.json` hooks (UserPromptSubmit / Stop / PreCompact) → `logger.mjs` | `.opencode/plugins/dako-logger.js` (chat.message + event bus) → shared `logger.mjs` |
| Compaction hook | `PreCompact` hook | `experimental.session.compacting` plugin hook |
| Agent instructions | `CLAUDE.md` | `AGENTS.md` |
| Slash commands | `.claude/commands/*.md` | `.opencode/commands/*.md` |
| Subagents | `.claude/agents/*.md` (`tools:` CSV) | `.opencode/agents/*.md` (`mode: subagent`, `tools:` map) |
| Agent identity | `claude-code` | `opencode` |
| Long-term memory MCP | `mcps/mongodb-memory/` (shared) | same |
| Short-term memory MCP | `mcps/short-term-memory/` (shared `dako-stm` binary) | same |

### How session logging works on OpenCode

OpenCode has no `settings.json` hooks, so logging is a plugin (`.opencode/plugins/dako-logger.js`):

- **`chat.message`** — fires when the user sends a prompt → logged as a `user` message.
- **`event` bus** — `message.updated` (role `assistant`) marks the assistant message; `message.part.updated`
  accumulates its streamed text; `session.idle` flushes the completed turn as an `assistant` message.
- **`experimental.session.compacting`** — injects a recovery hint so the agent re-checks STM after compaction.

The plugin shells out to the shared, agent-agnostic `mcps/mongodb-memory/logger.mjs`, which routes
through the same `DAKO_STORAGE_BACKEND` (MongoDB or SQLite) as the long-term memory MCP. It sets
`DAKO_AGENT=opencode` and keeps OpenCode session state in `<project>/.opencode/.dako_session`,
separate from any Claude Code session state.

`logger.mjs` accepts the assistant text directly via `payload.content` (OpenCode has no JSONL
transcript like Claude Code); Claude Code's `transcript_path` path is unchanged and still works.

---

## Prerequisites

- **Node.js** v18+ (long-term memory MCP + logger)
- **MongoDB** 6+ (native or Docker) — or use the SQLite backend (`DAKO_STORAGE_BACKEND=sqlite`)
- **OpenCode** CLI
- The repo's MCP deps installed once: `npm install --prefix mcps/mongodb-memory` (from the repo root)

---

## Setup

The setup script does **everything** in one run. It's interactive — invoke it with no arguments
and it asks for the project path, storage backend, and where to install the commands:

```powershell
# Windows
.\adapters\opencode\setup.ps1
```

```bash
# Mac / Linux
adapters/opencode/setup.sh
```

You can also pre-answer to make it non-interactive:

```powershell
.\adapters\opencode\setup.ps1 -ProjectPath "C:\path\to\project" -Backend sqlite -CommandsScope project
```
```bash
adapters/opencode/setup.sh /path/to/project    # then answer the backend / scope prompts
```

The script:

1. Offers to run `npm install` for the MCP deps if they're missing.
2. Configures the chosen **storage backend** — MongoDB (starts a Docker container if needed and
   prompts for credentials) or SQLite (no server) — and writes the shared
   `mcps/mongodb-memory/.env` with `DAKO_AGENT=opencode`.
3. Writes `opencode.json` in your project (MCP registrations + `instructions: ["AGENTS.md"]`),
   using absolute paths to the shared MCP servers.
4. Installs `.opencode/plugins/dako-logger.js` and writes `.opencode/dako.config.json`
   (absolute `harnessRoot`, project name, `agent: "opencode"`).
5. Copies the slash commands and the `wi-implementer` subagent — into the project's `.opencode/`
   or your global `~/.config/opencode/`, per your choice.
6. Appends the **Memory Protocol** block to your project's `AGENTS.md`.

Then start OpenCode in the project and run `/doctor` for a full health check, or `/recall test`
to confirm the MCPs are connected.

> All generated files (`opencode.json`, `dako.config.json`, `.env`, `AGENTS.md`) are written as
> BOM-less UTF-8 so Node's `JSON.parse` and dotenv read them cleanly.

> **Plugin path resolution.** The plugin finds the harness via, in order: the `DAKO_HARNESS_ROOT`
> env var, the `harnessRoot` field in `.opencode/dako.config.json`, then a path relative to the
> plugin file. Setup writes `dako.config.json` for you, so no env var is required. (The config lives
> in `.opencode/`, not `.opencode/plugins/`, because OpenCode scans `plugins/` for plugin modules.)

---

## Files in this adapter

```
adapters/opencode/
├── README.md                      this file
├── opencode.json                  template config (paths are placeholders; setup writes the real one)
├── AGENTS.md                      OpenCode port of CLAUDE.md (memory + workitem protocol)
├── setup.ps1 / setup.sh           project wiring scripts
└── .opencode/
    ├── package.json               plugin dir manifest (types only; no runtime deps)
    ├── skill-registry.md          generated command index (/registry-refresh regenerates it)
    ├── plugins/
    │   └── dako-logger.js          session-logging plugin (replaces Claude hooks)
    ├── commands/                  23 slash commands (memory + workitem workflow)
    └── agents/
        └── wi-implementer.md       implementation subagent (OpenCode frontmatter)
```

The `opencode.json` at the adapter root uses `__HARNESS_ROOT__` / `__PROJECT_ROOT__` placeholders
and is a reference template — `setup` writes a concrete `opencode.json` into your project with real
absolute paths.

---

## Verification

- `/doctor` — full health check (storage backend, .env, opencode.json MCP entries, logging plugin,
  plugin config, live MCP pings).
- `/recall test` — confirms the long-term memory MCP responds.
- Send a message, let the assistant reply, then check the `messages` collection (MongoDB) or the
  SQLite DB to confirm the turn was logged with `agent: "opencode"`.
