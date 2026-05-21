---
tags: [dakoharness, setup, installation]
created: 2026-05-20
---

# Setup Guide

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | Required for long-term MCP and logger |
| Docker | Any recent | Required for MongoDB |
| Claude Code | Latest | Target agent |
| Go | 1.21+ | Only needed to rebuild the short-term binary |

> [!NOTE]
> Go is only needed if you need to recompile the short-term memory binary. Pre-built binaries are provided for Windows. Cross-platform binaries (Mac/Linux) are planned for Phase 5.

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
