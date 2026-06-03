---
tags: [dakoharness, setup, installation, opencode]
created: 2026-06-03
---

# OpenCode Setup Guide

How to install DakoHarness for [OpenCode](https://opencode.ai). The harness gives OpenCode the
same two-tier memory, automatic session logging, and workitem workflow it provides for Claude Code.

The two memory **MCP servers are shared** with the Claude Code target — this adapter only adds the
OpenCode-specific glue (config, a logging plugin, ported commands/agents, and `AGENTS.md`). It lives
in `adapters/opencode/`.

> **New to how it maps?** OpenCode has no `settings.json` hooks, so session logging runs as a
> plugin (`.opencode/plugins/dako-logger.js`). Instructions live in `AGENTS.md` instead of
> `CLAUDE.md`, and MCP servers are registered in `opencode.json` (not `.mcp.json`).

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | Runs the long-term memory MCP and the logging plugin's logger |
| OpenCode | Latest | The CLI you'll run in your project |
| MongoDB | 6+ | Required for the `mongodb` backend (native **or** via Docker). **Not** needed for the `sqlite` backend |
| Docker | Any recent | Optional — only used to start MongoDB if it isn't already running |

---

## Step 1 — Get DakoHarness and install MCP dependencies

Clone the repo (once) and install the long-term memory MCP's Node dependencies:

```bash
git clone https://github.com/Caznik/DakoHarness
cd DakoHarness
npm install --prefix mcps/mongodb-memory
```

> You can skip the `npm install` — the setup script in Step 2 will offer to run it for you.

---

## Step 2 — Run the installer

From the DakoHarness repo root, run the adapter's setup script. With **no arguments** it is fully
interactive and asks for everything it needs.

**Windows (PowerShell):**
```powershell
.\adapters\opencode\setup.ps1
```

**Mac / Linux:**
```bash
adapters/opencode/setup.sh
```

It will ask you three things:

1. **Project path** — the folder where you want to use the harness (it re-prompts until you give a
   valid directory).
2. **Storage backend:**
   - `[1] mongodb` (default) — permanent, team-shareable; starts a Docker container and prompts for
     credentials if MongoDB isn't already on `localhost:27017`.
   - `[2] sqlite` — self-contained, no database server; stored in `.dako/memory.db`.
3. **Command scope:**
   - `[1] this project only` — installs into `<project>/.opencode/`.
   - `[2] all projects (global)` — installs into `~/.config/opencode/`.

### Non-interactive (optional)

Pre-answer everything via flags:

```powershell
# Windows
.\adapters\opencode\setup.ps1 -ProjectPath "C:\path\to\project" -Backend sqlite -CommandsScope project
```
```bash
# Mac / Linux — pass the path; answer the backend/scope prompts (or pipe them)
adapters/opencode/setup.sh /path/to/project
```

---

## What the installer creates

In your **project**:

```
your-project/
├── opencode.json              # MCP server registrations + "instructions": ["AGENTS.md"]
├── AGENTS.md                  # Memory Protocol block appended (created if absent)
└── .opencode/
    ├── dako.config.json       # harnessRoot / project / agent (read by the plugin)
    ├── plugins/
    │   └── dako-logger.js      # session logging (user prompts + assistant turns)
    ├── commands/              # 24 slash commands (memory + workitem workflow)*
    └── agents/
        └── wi-implementer.md   # implementation subagent*
```

\* If you chose **global** scope, `commands/` and `agents/` go to `~/.config/opencode/` instead.

In the **harness** (shared, written once):

- `mcps/mongodb-memory/.env` — backend selection + `DAKO_AGENT=opencode` (+ MongoDB credentials, or
  `DAKO_STORAGE_BACKEND=sqlite` / `DAKO_SQLITE_PATH`).

All generated files are written as **BOM-less UTF-8** so Node's `JSON.parse` and dotenv read them
cleanly.

---

## Step 3 — Start OpenCode and verify

```bash
cd /path/to/your/project
opencode
```

Then, inside OpenCode:

1. **`/doctor`** — full health check. It reports ✅/❌ for: storage backend, `.env`, `opencode.json`
   MCP entries, the logging plugin, the plugin config, and live pings to both MCP servers.
2. **`/recall test`** — confirms the long-term memory MCP responds (an empty result is still a pass).
3. **Confirm logging** — send a message, let the assistant reply, then check that the turn was saved:
   - **MongoDB:** look in the `agent_memory` database, `messages` collection, for documents with
     `agent: "opencode"`.
   - **SQLite:** open the DB at `DAKO_SQLITE_PATH` and check the `messages` table.

If all three pass, the harness is live.

---

## How memory and logging behave

- **Pull-based memory.** The agent does not preload memory at session start. It searches
  (`find_patterns` / `recall`) only when a task relates to past work, and saves
  (`remember_pattern` / `remember`) when you accept an approach or make a durable decision. The rules
  are in the `AGENTS.md` Memory Protocol block.
- **Automatic session logging.** The `dako-logger` plugin logs every user prompt (`chat.message`)
  and every assistant turn (captured from the event bus on `session.idle`). You never log manually.
  Session state is kept in `<project>/.opencode/.dako_session`, separate from any Claude Code state.
- **Compaction recovery.** On `experimental.session.compacting` the plugin injects a hint so the
  agent re-checks short-term memory for a `context-snapshot` after compaction.
- **Slash commands.** `/recall`, `/promote`, `/checkpoint`, `/session-end`, `/doctor`, and the full
  `/wi-*` workitem workflow are available — same behavior as the Claude Code target.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/doctor` says MCP not responding | Restart OpenCode (it loads MCPs at startup). Verify the absolute paths in `opencode.json` exist. |
| Plugin doesn't log anything | Confirm `.opencode/plugins/dako-logger.js` and `.opencode/dako.config.json` exist; check that `harnessRoot` in the config points at your DakoHarness clone. Restart OpenCode. |
| `node_modules` / MCP fails to start | Run `npm install --prefix mcps/mongodb-memory` from the harness root. |
| MongoDB unreachable | Start it: `docker start mcp_mongodb`. Or re-run setup and choose the **sqlite** backend. |
| Plugin can't find the harness | Set `DAKO_HARNESS_ROOT` in your shell, or fix `harnessRoot` in `.opencode/dako.config.json`. |
| Commands don't appear in OpenCode | Ensure `commands/` is under the project's `.opencode/` (or your global `~/.config/opencode/`). Re-run setup if needed. |

You can re-run the setup script at any time — it skips already-configured components and refreshes
paths, so it's safe for repair.

---

## Manual install (without the script)

If you prefer to wire it by hand:

1. **MCP deps:** `npm install --prefix mcps/mongodb-memory`.
2. **`.env`:** create `mcps/mongodb-memory/.env` with `DAKO_AGENT=opencode` plus either the
   `MONGO_*` variables or `DAKO_STORAGE_BACKEND=sqlite` + `DAKO_SQLITE_PATH=.dako/memory.db`.
3. **`opencode.json`** in your project (use absolute paths to the harness):
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "dako-long-term-memory": {
         "type": "local",
         "command": ["node", "/abs/path/DakoHarness/mcps/mongodb-memory/server.js"],
         "enabled": true,
         "environment": { "DAKO_AGENT": "opencode" }
       },
       "dako-short-term-memory": {
         "type": "local",
         "command": ["/abs/path/DakoHarness/bin/dako-stm.exe"],
         "enabled": true,
         "environment": { "DAKO_PROJECT_ROOT": "/abs/path/your-project" }
       }
     },
     "instructions": ["AGENTS.md"]
   }
   ```
   On Mac/Linux use `bin/dako-stm-darwin` or `bin/dako-stm-linux` instead of `dako-stm.exe`.
4. **Plugin:** copy `adapters/opencode/.opencode/plugins/dako-logger.js` to your project's
   `.opencode/plugins/`, and create `.opencode/dako.config.json`:
   ```json
   { "harnessRoot": "/abs/path/DakoHarness", "project": "your-project", "agent": "opencode" }
   ```
5. **Commands + agent:** copy `adapters/opencode/.opencode/commands/` and
   `adapters/opencode/.opencode/agents/` into your project's `.opencode/` (or `~/.config/opencode/`).
6. **`AGENTS.md`:** add the Memory Protocol block (see the adapter's `setup.ps1`/`setup.sh` for the
   exact text), or copy the relevant sections from `adapters/opencode/AGENTS.md`.

---

## See also

- `adapters/opencode/README.md` — adapter overview and the Claude↔OpenCode mapping table.
- [[Setup Guide]] — the Claude Code installation guide.
- [[Memory System]] · [[Session Logging]] · [[Workitem Workflow]]
