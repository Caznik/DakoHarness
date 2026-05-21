---
tags: [dakoharness, setup, installation]
created: 2026-05-20
---

# Setup Guide

There are two ways to install DakoHarness:

1. **Plugin install (recommended)** — load as a Claude Code plugin via `--plugin-dir`. All commands, hooks, and binaries are managed by the plugin system.
2. **Standalone dev setup** — manual configuration for developing or extending DakoHarness itself.

---

## Plugin Installation (Recommended)

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | Required for long-term MCP and logger |
| MongoDB | 6+ | Native install **or** via Docker — see Step 2 |
| Docker | Any recent | Optional — only needed if MongoDB is not already running |
| Claude Code | Latest | Must support `--plugin-dir` |

### Step 1 — Get DakoHarness

```bash
git clone https://github.com/Caznik/DakoHarness
cd DakoHarness
npm install --prefix mcps/mongodb-memory
```

### Step 2 — Run the setup script

From the DakoHarness repo root, run the setup script for your platform. Pass the path to the project where you want to use DakoHarness.

**Mac / Linux:**
```bash
./setup.sh /path/to/your/project
```

**Windows:**
```powershell
.\setup.ps1 -ProjectPath "C:\path\to\your\project"
```

The script:
1. Checks if MongoDB is already running on port 27017 — if so, Docker is skipped entirely
2. If MongoDB is not running: starts a `mcp_mongodb` Docker container (Docker must be installed)
3. If MongoDB is not running and Docker is not available: exits with a clear error
4. Prompts for MongoDB credentials — shows existing `.env` values as defaults (or `dako`/`harness` on first run); press Enter to accept
5. Writes `mcps/mongodb-memory/.env` with the provided credentials
6. Tests the MongoDB connection and warns if it fails (does not abort)
7. Appends the DakoHarness memory protocol block to `<your-project>/CLAUDE.md`

### Step 3 — Open your project with the plugin

```bash
cd /path/to/your/project
claude --plugin-dir /path/to/DakoHarness
```

All 20 `/dako:*` commands are now available in this session.

### Step 4 — Set the project root (once per project)

Run this inside Claude Code, in your project directory:

```
/dako:setup
```

This writes `.mcp.json` in the current project with `DAKO_PROJECT_ROOT` set to its path. The short-term memory MCP uses this to scope patterns to your project. You only need to run this once per project.

### Step 5 — Verify

```
/dako:recall test
```

No errors (even with no results) means both MCP servers are connected and the plugin is fully operational.

> [!NOTE]
> You need to repeat Step 3 each time you open Claude Code — the `--plugin-dir` flag is not persisted globally. If you want it permanent, add it to your shell alias or Claude Code settings.

---

## Standalone Dev Setup

Use this only if you are developing or extending DakoHarness itself. All paths are absolute — see the warning below.

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | Required for long-term MCP and logger |
| MongoDB | 6+ | Native install or via Docker |
| Docker | Any recent | Optional — only needed if MongoDB is not already running |
| Claude Code | Latest | Target agent |
| Go | 1.21+ | Only needed to rebuild the short-term binary |

---

## Step 1 — Start MongoDB

```bash
docker run -d \
  --name mcp_mongodb \
  -e MONGO_INITDB_ROOT_USERNAME=dako \
  -e MONGO_INITDB_ROOT_PASSWORD=harness \
  -p 27017:27017 \
  mongo:7
```

---

## Step 2 — Install Node.js dependencies

```bash
cd mcps/mongodb-memory
npm install
```

---

## Step 3 — Configure environment

Create `mcps/mongodb-memory/.env`:

```env
MONGO_USER=dako
MONGO_PASSWORD=harness
MONGO_HOST=localhost
MONGO_PORT=27017
MONGO_DB=agent_memory
MONGO_URI=mongodb://dako:harness@localhost:27017/agent_memory?authSource=admin

DAKO_AGENT=claude-code
# DAKO_PROJECT=MyProject   # optional — defaults to cwd basename
```

---

## Step 4 — Register MCP servers

Add to `.mcp.json` at your project root. **Always use absolute paths.**

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

> [!WARNING]
> Claude Code resolves hook and MCP paths relative to its launch directory. Relative paths break when Claude Code is opened from a subdirectory. Always use absolute paths.

---

## Step 5 — Configure hooks

Add to `.claude/settings.json` at your project root:

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
    "PreCompact": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node /absolute/path/to/DakoHarness/mcps/mongodb-memory/logger.mjs PreCompact"
      }]
    }],
    "SessionStart": []
  }
}
```

---

## Step 6 — Generate the skill registry

Open Claude Code and run:

```
/registry-refresh
```

This creates `.claude/skill-registry.md` with all available commands indexed.

---

## Step 7 — Add CLAUDE.md instructions

Copy the Memory Protocol section from the DakoHarness `CLAUDE.md` into your project's own `CLAUDE.md`. This tells the agent how and when to use the memory tools.

---

## Verify the setup

Check that everything is connected:

```
/recall test
```

If no errors appear (even if no results are returned), the MCP servers are running correctly.

You can also check MongoDB directly:

```bash
docker exec mcp_mongodb mongosh \
  "mongodb://dako:harness@localhost:27017/agent_memory?authSource=admin" \
  --eval "db.sessions.countDocuments()"
```

---

## Related

- [[Architecture]] — how the components connect
- [[Session Logging]] — what gets logged and when
- [[Memory System]] — how to use memory once installed
