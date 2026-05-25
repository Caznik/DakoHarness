---
name: doctor
description: Verify the full DakoHarness installation — checks storage backend, .env, hooks, both MCPs, and binaries in one shot. Reports ✅/❌ per component with remediation steps for failures.
---

## When to use
Run after installation or when something isn't working. All checks run unconditionally — no early exit on failure. Results are collected and reported in a single summary table.

## Steps

Accumulate results throughout all steps. Do not output per-step results as you go — only output the final summary table in Step 10.

### 1. Resolve DAKO_HOME

- Read `~/.dako/config`.
- If the file does not exist or `DAKO_HOME` is not set: record `DAKO_HOME | ❌ | ~/.dako/config missing — run /dako:setup`. For all checks that depend on DAKO_HOME (Steps 2, 3, 4, 5, and hook binary in Step 7), record each as `⚠️ skipped | DAKO_HOME not resolved` rather than attempting the check. All rows must still appear in the summary table.
- If set: record `DAKO_HOME | ✅ | <resolved path>`. Use `$DAKO_HOME` for all subsequent path construction.

### 2. Global — LTM server files

- Check `$DAKO_HOME/mcps/mongodb-memory/server.js` exists.
  - ✅: record `LTM server.js | ✅`
  - ❌: record `LTM server.js | ❌ | File missing — re-clone or restore from backup`
- Check `$DAKO_HOME/mcps/mongodb-memory/node_modules/mongodb` exists.
  - ✅: record `node_modules/mongodb | ✅`
  - ❌: record `node_modules/mongodb | ❌ | Run: npm install --prefix $DAKO_HOME/mcps/mongodb-memory`

### 3. Global — STM binary

- Determine platform binary path:
  - Windows: `$DAKO_HOME/bin/dako-stm.exe`
  - Unix (Linux/macOS): `$DAKO_HOME/bin/dako-stm`
- Check the binary exists.
  - ✅: record `STM binary | ✅`
  - ❌: record `STM binary | ❌ | Binary missing — run git pull in $DAKO_HOME or rebuild from mcps/short-term-memory/main.go`

### 4. Project — .env and backend detection

- Check `$DAKO_HOME/mcps/mongodb-memory/.env` exists.
  - ❌ if missing: record `.env (exists) | ❌ | File not found — run /dako:setup`. Record `.env (fields) | ⚠️ skipped | .env missing`. Set backend = `mongodb` (default). Skip Step 5.
- If present: read `DAKO_STORAGE_BACKEND` from it. If absent, default to `mongodb`.
  - Record `Backend selected | ✅ | <value>` (e.g. `mongodb` or `sqlite`).

  **mongodb backend — required fields:** `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_HOST`, `MONGO_PORT`, `MONGO_DB`, `MONGO_URI`, `DAKO_AGENT`
  **sqlite backend — required fields:** `DAKO_STORAGE_BACKEND`, `DAKO_SQLITE_PATH`, `DAKO_AGENT`

  - All required fields present and non-empty: record `.env (exists) | ✅` and `.env (fields) | ✅`
  - Any missing: record `.env (exists) | ✅` and `.env (fields) | ❌ | Missing: <list of missing fields> — run /dako:setup or edit .env manually`

### 5. Backend health check

#### If backend = mongodb

- Read `MONGO_HOST`, `MONGO_PORT`, `MONGO_URI` from `.env`.
- If `node_modules/mongodb` is missing (from Step 2): record `MongoDB reachable | ⚠️ skipped | node_modules missing — install first`.
- Otherwise:
  - Determine the absolute forward-slash path to: `$DAKO_HOME/mcps/mongodb-memory/node_modules/mongodb`
  - Write a temporary `.js` file with this content (substituting actual values):
    ```js
    var MC = require('<abs-path-to-mongodb>').MongoClient;
    MC.connect('<MONGO_URI>', { serverSelectionTimeoutMS: 3000 })
      .then(function(c) { c.close(); process.exit(0); })
      .catch(function() { process.exit(1); });
    ```
  - Run with `node`, then delete the file.
  - Exit 0: record `MongoDB reachable | ✅`
  - Exit 1: record `MongoDB reachable | ❌ | Cannot reach $MONGO_HOST:$MONGO_PORT — run: docker start mcp_mongodb`
- Record `SQLite DB writable | ⚠️ skipped | backend is mongodb`
- Record `FTS5 available | ⚠️ skipped | backend is mongodb`
- Record `SQLite write probe | ⚠️ skipped | backend is mongodb`

#### If backend = sqlite

- Record `MongoDB reachable | ⚠️ skipped | backend is sqlite`
- Read `DAKO_SQLITE_PATH` from `.env` (default `.dako/memory.db`).
- **SQLite DB writable:** attempt `mkdirSync` on the parent directory then open a `better-sqlite3` instance at the path.
  - Success: record `SQLite DB writable | ✅ | <path>`
  - Failure: record `SQLite DB writable | ❌ | Cannot open <path> — check permissions or DAKO_SQLITE_PATH`
- **FTS5 available:** if DB opened successfully, run `PRAGMA compile_options` and check for `ENABLE_FTS5`.
  - Found: record `FTS5 available | ✅`
  - Not found: record `FTS5 available | ❌ | SQLite build does not include FTS5 — install a standard SQLite distribution`
- **SQLite write probe:** if DB opened successfully, run `CREATE TABLE IF NOT EXISTS _doctor_probe (x TEXT); INSERT INTO _doctor_probe VALUES ('ok'); SELECT x FROM _doctor_probe; DROP TABLE _doctor_probe;`
  - Success: record `SQLite write probe | ✅`
  - Failure: record `SQLite write probe | ❌ | Write test failed — check disk space and file permissions`

### 6. Project — .mcp.json

- Check `.mcp.json` exists in cwd.
  - ❌ if missing: record `.mcp.json | ❌ | File not found — run /dako:setup`. Skip entry check.
- If present: parse and check for both MCP server entries.
  - `dako-long-term-memory` present: ✅ else ❌ with `"dako-long-term-memory entry missing"`
  - `dako-short-term-memory` present: ✅ else ❌ with `"dako-short-term-memory entry missing"`
  - Record `".mcp.json | ✅"` if both present, otherwise `".mcp.json | ❌ | <details>"`

### 7. Project — Hooks configuration

Check for DakoHarness hook entries in either of these locations:
- `.claude/settings.json` in cwd (dev / absolute-path mode)
- `$DAKO_HOME/hooks/hooks.json` (plugin mode)

For each of the three required events — `UserPromptSubmit`, `Stop`, `PreCompact`:
- ✅ if a non-empty hook entry exists in either file
- ❌ if missing — note: `"run /dako:setup or check $DAKO_HOME/hooks/hooks.json"`

Record `Hooks configured | ✅` if all three are present, otherwise `Hooks configured | ❌ | Missing: <list>`.

Then check that the hook command executable resolves:
- Read the command string from the config (e.g., `"dako-logger UserPromptSubmit"`), extract the executable (`dako-logger`).
- Check if it exists in PATH or at `$DAKO_HOME/bin/dako-logger` (Unix) / `$DAKO_HOME/bin/dako-logger.bat` (Windows).
- ✅: record `Hook command resolves | ✅`
- ❌: record `Hook command resolves | ❌ | dako-logger not found — add $DAKO_HOME/bin to PATH or use absolute path in hook config`

### 8. Live — LTM MCP ping

- Call the `dako-long-term-memory` MCP `recall` tool:
  - `project`: basename of cwd
  - `query`: `"doctor-ping"`
  - `limit`: 1
- ✅ if the tool responds (any result, including empty): record `LTM MCP (live) | ✅`
- ❌ if the call fails or MCP is not connected: record `LTM MCP (live) | ❌ | MCP not responding — restart Claude Code; verify .mcp.json LTM entry and backend status`

### 9. Live — STM MCP ping

- Call the `dako-short-term-memory` MCP `get_recent_patterns` tool:
  - `project`: basename of cwd
  - `days`: `"1"`
  - `limit`: `"1"`
- ✅ if the tool responds (any result, including empty): record `STM MCP (live) | ✅`
- ❌ if the call fails or MCP is not connected: record `STM MCP (live) | ❌ | MCP not responding — restart Claude Code; verify .mcp.json STM entry and binary path`

### 10. Summary table

Output all accumulated results:

| Check | Status | Notes |
|---|---|---|
| DAKO_HOME | ✅ / ❌ | path or error |
| LTM server.js | ✅ / ❌ | |
| node_modules/mongodb | ✅ / ❌ | |
| STM binary | ✅ / ❌ | |
| Backend selected | ✅ | mongodb or sqlite |
| .env (exists) | ✅ / ❌ | |
| .env (fields) | ✅ / ❌ | missing fields if any |
| MongoDB reachable | ✅ / ❌ / ⚠️ | |
| SQLite DB writable | ✅ / ❌ / ⚠️ | |
| FTS5 available | ✅ / ❌ / ⚠️ | |
| SQLite write probe | ✅ / ❌ / ⚠️ | |
| .mcp.json | ✅ / ❌ | |
| Hooks configured | ✅ / ❌ | missing events if any |
| Hook command resolves | ✅ / ❌ | |
| LTM MCP (live) | ✅ / ❌ | |
| STM MCP (live) | ✅ / ❌ | |

Then output a one-line verdict:
- All ✅: `"All checks passed. DakoHarness is healthy."`
- Any ❌: `"<N> check(s) failed — see remediation notes above."`

### 11. Remediation offers

For fixable failures, ask the user before acting:

- **Missing `.mcp.json`**: `"Want me to write .mcp.json for this project?"`
  - If yes: follow /dako:setup Step 6 logic (requires DAKO_HOME to be resolved)
- **Incomplete `.env` fields**: `"Want me to add the missing fields to .env?"`
  - If yes: prompt for each missing value and append to `.env`
