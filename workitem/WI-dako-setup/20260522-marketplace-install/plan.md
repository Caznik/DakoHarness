---
wi: WI-dako-setup/20260522-marketplace-install
phase: plan
status: confirmed
date: 2026-05-22
approach: Approach C
---

## Context
**Selected approach:** Approach C — Persist DakoHarness path in `~/.dako/config`
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9

## Implementation Sequence

### Step 1 — DakoHarness path resolution via config file
**Satisfies:** AC-9
**Files:** `commands/setup.md`
**Description:** At the start of every run, the skill instructs the agent to check `~/.dako/config` for a `DAKO_HOME` key. If present, validate the path (check that `mcps/mongodb-memory/server.js` exists there). If missing or invalid, ask the user for the DakoHarness installation path, validate it, and write it to `~/.dako/config` (create the directory if needed). All subsequent steps use `$DAKO_HOME` to construct absolute paths.

### Step 2 — MongoDB check and Docker fallback
**Satisfies:** AC-1, AC-2
**Files:** `commands/setup.md`
**Description:** Detect if MongoDB is running on `localhost:27017`. On Windows: `Test-NetConnection -ComputerName localhost -Port 27017`. On Unix: `bash -c '(echo >/dev/tcp/localhost/27017) 2>/dev/null && echo up || echo down'`. If not running: check `docker info`. If Docker available, check for existing `mcp_mongodb` container and start it if absent. If Docker not available, output a clear error message with instructions (`Install Docker or start MongoDB manually on port 27017`) and stop.

### Step 3 — Credential prompt with defaults
**Satisfies:** AC-3
**Files:** `commands/setup.md`
**Description:** Read existing values from `$DAKO_HOME/mcps/mongodb-memory/.env` if the file exists. Ask the user for MongoDB username (default from `.env` or `dako`) and password (default from `.env` or `harness`). Construct `MONGO_URI=mongodb://<user>:<pass>@localhost:27017/agent_memory?authSource=admin`. If `.env` already exists, read credentials silently from it for the connection test — do not prompt again.

### Step 4 — Write `.env` (skip if present)
**Satisfies:** AC-5
**Files:** `commands/setup.md` → writes `$DAKO_HOME/mcps/mongodb-memory/.env`
**Description:** If `.env` does not exist, write it with the seven required fields (`MONGO_USER`, `MONGO_PASSWORD`, `MONGO_HOST=localhost`, `MONGO_PORT=27017`, `MONGO_DB=agent_memory`, `MONGO_URI`, `DAKO_AGENT=claude-code`). If it already exists, skip and record "skipped: .env already present" for the summary.

### Step 5 — MongoDB connection test
**Satisfies:** AC-4
**Files:** `commands/setup.md`
**Description:** If `$DAKO_HOME/mcps/mongodb-memory/node_modules/mongodb` exists, run a quick connection test via a temporary Node.js script (same approach as setup.ps1 — write temp file, run, delete). Report success or a warning if the test fails. Do not abort on failure.

### Step 6 — Write `.mcp.json` (skip if present)
**Satisfies:** AC-6, AC-9
**Files:** `commands/setup.md` → writes `.mcp.json` in cwd
**Description:** If `.mcp.json` does not exist in cwd, write it with both MCP server entries using absolute paths derived from `$DAKO_HOME`. On Windows: STM binary is `$DAKO_HOME/bin/dako-stm.exe`. On Unix: `$DAKO_HOME/bin/dako-stm`. `DAKO_PROJECT_ROOT` is set to the current working directory. If `.mcp.json` already exists, skip and record for summary.

### Step 7 — Inject CLAUDE.md memory protocol block (skip if present)
**Satisfies:** AC-7
**Files:** `commands/setup.md` → writes or appends to `CLAUDE.md` in cwd
**Description:** Check if `CLAUDE.md` exists in cwd. If it does, search for the marker string `DakoHarness — Memory Protocol` to detect an existing block. If not found, append the full block. If `CLAUDE.md` doesn't exist, create it. If the block is already present, skip and record for summary.

### Step 8 — Summary report
**Satisfies:** AC-8
**Files:** `commands/setup.md`
**Description:** Output a table of what was done vs. skipped for each component (`.env`, `.mcp.json`, `CLAUDE.md`). Suggest `/dako:recall test` to verify the MCPs are connected. This output is identical on first run and re-runs, making idempotency visible to the user.

## Out-of-scope note
Project-level hooks (`.claude/settings.json`) are NOT written by this command. Marketplace installs handle session logging via plugin hooks (`hooks/hooks.json`) automatically. Users in `--plugin-dir` mode should use `setup.ps1`/`setup.sh` or add hooks manually.

## Risks / Known Unknowns
- **Platform detection in a skill**: The agent must detect Windows vs. Unix to choose the right MongoDB check command and STM binary path. Reliable via `$IsWindows` or `$env:OS`, but the skill instructions must handle both branches explicitly.
- **Credential prompt in skill context**: Credentials are collected conversationally (agent asks in chat), not via `Read-Host`. The skill must define what to ask and in what order.
- **`~/.dako/config` format**: Simple `key=value` (same as `.env`) for consistency and easy parsing.
- **Step 3 idempotency tension**: If `.env` exists, skip writing it but still read credentials from it silently for the connection test.

## Confirmation
**Confirmed by user:** yes
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
