# DakoHarness

An extensible harness for coding agents. Provides a two-tier memory system, session logging, and custom workflows — installed once, used across every project your agent touches.

**First target:** Claude Code via Plugin Marketplace.  
**Future targets:** OpenCode, Pi, and others.

---

## What it does

Coding agents start every session without memory. DakoHarness gives them persistent, searchable memory that survives across sessions, machines, and team members:

- **Long-term memory** — architectural decisions, conventions, bug fixes, and lessons stored in MongoDB. Permanent, cross-agent, shareable across teams.
- **Short-term memory** — accepted patterns and recent approaches stored in SQLite. Machine-local, project-scoped, 7-day TTL.
- **Session logging** — every conversation turn is captured automatically via hooks (no manual logging needed).
- **Team memory** — lessons valuable beyond one project can be promoted to team scope and discovered by any developer on any project.

---

## Architecture

```
DakoHarness/
├── .claude-plugin/
│   └── plugin.json             Plugin manifest (name: "dako")
├── commands/                   20 plugin commands — available as /dako:<name>
│   ├── setup.md                Full first-time project setup
│   ├── recall.md               /dako:recall — search long-term memory
│   ├── promote.md              /dako:promote — short-term → long-term
│   ├── promote-team.md         /dako:promote-team — project → team scope
│   ├── session-end.md          /dako:session-end
│   ├── registry-refresh.md     /dako:registry-refresh
│   └── wi-*.md                 Workitem workflow (14 commands)
├── hooks/
│   └── hooks.json              Plugin hooks (UserPromptSubmit, Stop)
├── bin/                        Cross-platform executables (auto-added to PATH by plugin system)
│   ├── dako-logger / .bat      Session logging hook wrapper
│   └── dako-stm*               Short-term MCP binaries (Windows, Linux, macOS)
├── mcps/
│   ├── mongodb-memory/         Long-term memory MCP (Node.js + TypeScript)
│   │   ├── server.ts/js        MCP server — remember, recall, get_context,
│   │   │                       promote_to_team, forget, archive_workitem, …
│   │   └── logger.mjs          Session logging hook companion
│   └── short-term-memory/      Short-term memory MCP source (Go + SQLite)
│       └── main.go             MCP server — remember_pattern, find_patterns,
│                               get_recent_patterns
├── claude-plugin-release/      Self-contained marketplace submission package
├── workitem/                   Workitem traceability artifacts
├── setup.sh / setup.ps1        Manual infrastructure setup scripts
└── CLAUDE.md                   Agent instructions — memory and workitem protocol
```

### Two-tier memory model

| Tier | Storage | Scope | TTL | When to use |
|---|---|---|---|---|
| Long-term | MongoDB | Project or Team | Permanent | Architectural decisions, conventions, bugs, lessons |
| Short-term | SQLite (FTS5) | Project, machine-local | 7 days | Accepted approaches, recent patterns |

---

## Prerequisites

- **Node.js** v18+ (for the long-term memory MCP and logger)
- **Go** 1.21+ (for the short-term memory MCP, only needed to rebuild the binary)
- **MongoDB** 6+ — native install **or** via Docker
- **Docker** — optional, only needed if MongoDB is not already running
- **Claude Code** CLI

---

## Setup

### Plugin install (recommended)

Clone the repo and run the setup script for your platform, passing the path to the project you want to use DakoHarness with:

```bash
git clone https://github.com/Caznik/DakoHarness
cd DakoHarness
npm install --prefix mcps/mongodb-memory

# Mac / Linux
./setup.sh /path/to/your/project

# Windows
.\setup.ps1 -ProjectPath "C:\path\to\your\project"
```

Then open your project with the plugin:

```bash
cd /path/to/your/project
claude --plugin-dir /path/to/DakoHarness
```

See the [Setup Guide](obsidian-docs/Setup%20Guide.md) for full instructions including verification steps.

---

### Manual / dev setup

Use this if you are developing or extending DakoHarness itself.

### 1. Start MongoDB

```bash
docker run -d \
  --name mcp_mongodb \
  -e MONGO_INITDB_ROOT_USERNAME=dako \
  -e MONGO_INITDB_ROOT_PASSWORD=harness \
  -p 27017:27017 \
  mongo:7
```

### 2. Install Node.js dependencies

```bash
cd mcps/mongodb-memory
npm install
```

### 3. Configure environment

Copy or create `mcps/mongodb-memory/.env`:

```env
MONGO_USER=dako
MONGO_PASSWORD=harness
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=agent_memory
MONGO_URI=mongodb://dako:harness@localhost:27017/agent_memory?authSource=admin

DAKO_AGENT=claude-code
# DAKO_PROJECT=MyProject   # optional override; defaults to cwd basename
```

### 4. Register MCP servers

Add to `.mcp.json` in your project root (update paths to match your install location):

```json
{
  "mcpServers": {
    "dako-long-term-memory": {
      "command": "node",
      "args": ["/absolute/path/to/DakoHarness/mcps/mongodb-memory/server.js"]
    },
    "dako-short-term-memory": {
      "command": "/absolute/path/to/DakoHarness/mcps/short-term-memory/short-term-memory.exe",
      "env": {
        "DAKO_PROJECT_ROOT": "/absolute/path/to/your/project"
      }
    }
  }
}
```

> **Always use absolute paths.** Claude Code resolves hook commands relative to its launch directory — relative paths break when opened from a subdirectory.

### 5. Configure hooks

Add to `.claude/settings.json` in your project (update paths):

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node /absolute/path/to/DakoHarness/mcps/mongodb-memory/logger.mjs UserPromptSubmit"
      }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node /absolute/path/to/DakoHarness/mcps/mongodb-memory/logger.mjs Stop"
      }]
    }],
    "SessionStart": []
  }
}
```

### 6. Copy CLAUDE.md instructions

Copy the memory protocol section from `CLAUDE.md` into your project's own `CLAUDE.md` (or add the `.mcp.json` block and slash commands to an existing one).

---

## Memory system

### When the agent searches memory

The agent does **not** preload memory at session start. Memory is pull-based:

- Before a task that seems related to past work → `find_patterns` with keywords
- When a past decision or convention is needed → `recall` with keywords
- After context compaction → `get_context` to check for compaction snapshots

### When the agent saves memory

**Short-term** (`remember_pattern`) — triggered when:
- The user accepts an approach ("yes", "looks good", "do it")
- A bug fix has a reusable pattern
- A code style or convention is established

**Long-term** (`remember`) — triggered when:
- An architectural decision is made that should outlast this week
- A convention is confirmed permanent
- A bug fix reveals a systemic issue
- An important project fact isn't obvious from the code

### Memory types (long-term)

| Type | Use for |
|---|---|
| `decision` | Architectural or design choice with reasoning |
| `convention` | Naming rule, code style, pattern for this project |
| `bug` | A bug and how it was fixed |
| `context` | Important project fact not obvious from the code |
| `lesson` | What went wrong and what was learned |

### Memory scope

| Scope | Visible to |
|---|---|
| `project` (default) | Only this project |
| `team` | All projects on the same MongoDB instance |

Use `/promote-team` to elevate a project memory to team scope when it contains a broadly applicable lesson.

---

## Slash commands

| Command | Description |
|---|---|
| `/dako:setup` | Full first-time project setup — MongoDB, .env, .mcp.json, CLAUDE.md injection |
| `/dako:doctor` | Health check — verify MongoDB, .env, hooks, both MCPs, and STM binary in one shot |
| `/dako:checkpoint` | Save a structured context snapshot to short-term memory for compaction recovery |
| `/dako:memory-audit` | Audit long-term memories — deduplicate, flag stale (90+ days), resolve contradictions |
| `/dako:recall <keywords>` | Search long-term memory for past decisions, conventions, and lessons |
| `/dako:promote [keywords]` | Promote a short-term pattern to permanent long-term memory |
| `/dako:promote-team [keywords]` | Promote a project memory to team scope (visible across all projects) |
| `/dako:session-end` | Review patterns from this session, promote durable ones, save in-progress context |
| `/dako:registry-refresh` | Regenerate the skill registry after adding or removing a command |
| `/dako:wi-start` | Start a new workitem — entry point for the structured development workflow |
| `/dako:wi-next` | Advance the active workitem to the next phase |
| `/dako:wi-status` | Show current workitem state and phase |
| `/dako:wi-park` / `/dako:wi-cancel` | Pause or cancel an active workitem |
| `/dako:wi-<phase>` | Run a specific phase individually (intake, analyze, propose, plan, implement, review, document, repo, archive) |

---

## Session logging

Every conversation is logged automatically via Claude Code hooks:

- **UserPromptSubmit** — logs the user's message to the `messages` collection
- **Stop** — reads the last assistant turn from the JSONL transcript and logs it
- **PreCompact** — saves the last 3 assistant turns before context compression (compaction snapshot)

Sessions are stored in MongoDB under `agent_memory`:
- `sessions` — one document per conversation with project, agent, cwd, and start time
- `messages` — all turns, ordered by `seq`, linked to `session_id`

### Session boundary detection

Each session gets a unique UUID. Boundaries are detected automatically: Claude Code sends a stable `session_id` in every hook payload. When it changes (new conversation), a new DakoHarness session is created. State is persisted in `.claude/.dako_session`.

### Compaction recovery

When Claude Code compacts context:
1. The `PreCompact` hook saves a snapshot to MongoDB tagged `auto-cleanup`
2. On the next session start, if the agent finds an `auto-cleanup` snapshot, it reads where work was interrupted and deletes the snapshot
3. This is handled via `CLAUDE.md` instructions — no prompt-type hooks needed

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| 1 — Memory foundation | Done ✅ | Long-term MCP, short-term MCP, session logging, slash commands |
| 2 — Memory hardening | Done ✅ | Compaction recovery, session boundaries, team scope, skill registry |
| 3 — Development workflow | Done ✅ | Workitem workflow, 14 wi-* commands, artifact templates, workitem archive |
| 4 — Skill registry | Done ✅ | Auto-generated index, /registry-refresh (delivered in Phase 2) |
| 5 — Installer | Done ✅ | Claude Code plugin ("dako"), cross-platform binaries, setup scripts, --plugin-dir distribution |
| 6 — Marketplace | Under review 🔄 | Submitted to community marketplace — awaiting review |
| 7 — Multi-agent | Backlog | Adapters for OpenCode, Pi |

### Backlog

| Item | Description |
|---|---|
| Sub-agent delegation for implementation | Delegate coding tasks to sub-agents to keep the main context clean and enable parallel work across plan steps |
| Pluggable long-term memory backend | Abstract the storage layer so alternatives to MongoDB (PostgreSQL, SQLite, hosted) are supported; MongoDB remains default |
| Semantic search for recall | Embedding-based recall so vague or paraphrased queries find the right memories, not just exact keyword matches |
| Auto registry-refresh on session start | If short-term memory shows recent command file changes, auto-run `/registry-refresh` at next session start |
| RAG for long sessions | Analyze whether a retrieval-augmented approach improves memory recall in very long sessions where context compaction discards relevant history |
| Multi-agent adapters | Phase 7 — OpenCode, Pi |
| Model routing | Route tasks to different models based on complexity |
| Permission harness | Structured permission management layer |
| MongoDB dashboard | Visual interface for browsing sessions and memories |
| Context7 / Notion / Jira MCPs | External knowledge source integrations |

---

## Project name and agent

When calling memory tools in a project, always pass:
- `project`: the project name (or `DAKO_PROJECT` env var, falls back to cwd basename)
- `agent`: `"claude-code"` (or the agent identifier for other targets)
