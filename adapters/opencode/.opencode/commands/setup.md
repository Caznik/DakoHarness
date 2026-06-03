---
name: setup
description: Full first-time setup for DakoHarness in the current project — storage backend choice, .env, opencode.json MCP registrations, dako-logger plugin, and AGENTS.md injection. Safe to re-run; already-configured components are skipped.
---

## When to use
Once after installing the dako plugin in a new project. Also safe to re-run to verify or repair an existing configuration — already-present components are skipped without errors.

## Steps

### 1. Resolve DakoHarness installation path

- Check if `~/.dako/config` exists. If it does, read the `DAKO_HOME` value from it.
- Validate the path: confirm that `<DAKO_HOME>/mcps/mongodb-memory/server.js` exists.
- If the file is missing, the value is absent, or validation fails: ask the user —
  `"Where is DakoHarness installed? (e.g. C:\lab\Proyectos\DakoHarness or /home/user/DakoHarness)"`
- Once a valid path is provided:
  - Create `~/.dako/` if it does not exist.
  - Write `DAKO_HOME=<path>` to `~/.dako/config`.
- Use `$DAKO_HOME` for all subsequent path construction. When embedding paths in JSON, convert backslashes to forward slashes.

### 2. Choose storage backend

- If `<DAKO_HOME>/mcps/mongodb-memory/.env` already exists: read `DAKO_STORAGE_BACKEND` from it (default `mongodb` if absent). Skip prompting and use the existing backend silently — record the existing value in the summary.
- If `.env` does not yet exist: prompt the user:

  ```
  Storage backend:
    [1] mongodb (default) — requires MongoDB; permanent storage; team-shareable
    [2] sqlite            — self-contained; no database server needed; stored in .dako/memory.db
  Choice [1]:
  ```

  - `1` or empty → backend = `mongodb`
  - `2` → backend = `sqlite`

- Record the chosen backend. Use it to determine which subsequent steps apply.

### 3. MongoDB check and credentials (mongodb backend only)

> Skip this entire step if backend = `sqlite`. Record `"MongoDB — skipped (sqlite backend)"`.

- Check if MongoDB is accessible on `localhost:27017`.
- If accessible: proceed to credential prompting.
- If not accessible:
  - Check if Docker is available (`docker info`).
  - If Docker is available:
    - Check if a container named `mcp_mongodb` already exists (running or stopped).
    - If it exists but is stopped: run `docker start mcp_mongodb`.
    - If it does not exist: run:
      ```
      docker run -d --name mcp_mongodb \
        -e MONGO_INITDB_ROOT_USERNAME=dako \
        -e MONGO_INITDB_ROOT_PASSWORD=harness \
        -p 27017:27017 mongo:7
      ```
    - Wait briefly, then re-check port 27017 to confirm it is now accessible.
  - If Docker is not available: stop and report —
    `"MongoDB is not running on port 27017 and Docker is not available. Install Docker or start MongoDB manually on port 27017, then re-run /setup. Alternatively, choose the sqlite backend."`

- Check if `<DAKO_HOME>/mcps/mongodb-memory/.env` already exists.
  - If it exists: read `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_HOST`, `MONGO_PORT`, `MONGO_DB` from it to use as defaults. Skip prompting and use these values silently (needed for Step 5).
  - If not: use defaults `dako` / `harness` / `localhost` / `27017` / `agent_memory`.
- If `.env` does not yet exist, ask the user (show default in brackets):
  - `"MongoDB username [<default>]:"`
  - `"MongoDB password [<default>]:"`
  - `"Advanced MongoDB config? (host/port/db) [y/N]:"`
    - If `y`: ask:
      - `"MongoDB host [localhost]:"`
      - `"MongoDB port [27017]:"`
      - `"MongoDB database [agent_memory]:"`
    - If `N` or empty: use `localhost`, `27017`, `agent_memory`.
  - Accept empty input to keep any default.
- Construct: `MONGO_URI=mongodb://<user>:<pass>@<host>:<port>/<db>?authSource=admin`

### 4. Write .env (skip if already present)

- If `<DAKO_HOME>/mcps/mongodb-memory/.env` already exists: skip. Record `".env — skipped (already present)"`.
- Otherwise write the file based on the chosen backend:

  **mongodb backend:**
  ```
  MONGO_USER=<user>
  MONGO_PASSWORD=<pass>
  MONGO_HOST=<host>
  MONGO_PORT=<port>
  MONGO_DB=<db>
  MONGO_URI=<uri>
  DAKO_AGENT=opencode
  DAKO_STORAGE_BACKEND=mongodb
  ```

  **sqlite backend:**
  ```
  DAKO_STORAGE_BACKEND=sqlite
  DAKO_SQLITE_PATH=.dako/memory.db
  DAKO_AGENT=opencode
  ```

  Record `".env — written"`.

### 5. Test MongoDB connection (mongodb backend only)

> Skip this entire step if backend = `sqlite`. Record `"Connection test — skipped (sqlite backend)"`.

- Check if `<DAKO_HOME>/mcps/mongodb-memory/node_modules/mongodb` exists.
- If it does not: skip and record `"Connection test — skipped (node_modules not found; run: npm install --prefix <DAKO_HOME>/mcps/mongodb-memory)"`.
- If it exists:
  - Determine the absolute forward-slash path to the mongodb package:
    `<DAKO_HOME>/mcps/mongodb-memory/node_modules/mongodb`
  - Write a temporary `.js` file with this content (substituting actual values):
    ```js
    var MC = require('<abs-path-to-mongodb>').MongoClient;
    MC.connect('<MONGO_URI>', { serverSelectionTimeoutMS: 3000 })
      .then(function(c) { c.close(); process.exit(0); })
      .catch(function() { process.exit(1); });
    ```
  - Run the temp file with `node`, then delete it.
  - If exit code 0: record `"Connection test — passed"`.
  - If exit code 1: record `"Connection test — WARNING: could not connect. Check credentials and MongoDB status."`. Do not abort.

### 6. Write opencode.json MCP registrations (merge if present)

- Determine the platform-appropriate short-term memory binary path:
  - Windows: `<DAKO_HOME>/bin/dako-stm.exe`
  - Unix (Linux/macOS): `<DAKO_HOME>/bin/dako-stm`
- Use forward slashes in all paths.
- The MCP entries to ensure exist (OpenCode `mcp` schema — note `type: "local"` and `command` as an **array**):
  ```json
  {
    "mcp": {
      "dako-long-term-memory": {
        "type": "local",
        "command": ["node", "<DAKO_HOME>/mcps/mongodb-memory/server.js"],
        "enabled": true,
        "environment": { "DAKO_AGENT": "opencode" }
      },
      "dako-short-term-memory": {
        "type": "local",
        "command": ["<platform-binary>"],
        "enabled": true,
        "environment": { "DAKO_PROJECT_ROOT": "<cwd-forward-slashes>" }
      }
    }
  }
  ```
- If `opencode.json` does **not** exist in cwd: write it with the `$schema`, the `mcp` block above, and `"instructions": ["AGENTS.md"]`. Record `"opencode.json — written"`.
- If `opencode.json` already exists: parse it and merge — add the two `mcp` entries if absent (do not clobber unrelated keys or other MCP servers). If both entries already exist, skip. Record `"opencode.json — merged"` or `"opencode.json — skipped (entries present)"`.

### 6b. Install the dako-logger plugin (skip if already present)

OpenCode has no settings.json hooks — session logging runs as a plugin.

- Ensure the directory `.opencode/plugins/` exists in cwd.
- If `.opencode/plugins/dako-logger.js` already exists: skip copying. Record `"plugin — skipped (already present)"`.
- Otherwise copy `<DAKO_HOME>/adapters/opencode/.opencode/plugins/dako-logger.js` to `.opencode/plugins/dako-logger.js`. Record `"plugin — installed"`.
- Write `.opencode/dako.config.json` (always — refresh paths) with forward slashes. Place it in
  `.opencode/`, **not** inside `.opencode/plugins/` (OpenCode scans plugins/ for plugin modules):
  ```json
  {
    "harnessRoot": "<DAKO_HOME>",
    "project": "<project name — DAKO_PROJECT or cwd basename>",
    "agent": "opencode"
  }
  ```
  Record `"plugin config — written"`.

### 7. Inject AGENTS.md memory protocol (skip if already present)

- Check if `AGENTS.md` exists in cwd.
- If it exists: search its content for the string `DakoHarness — Memory Protocol`.
  - If found: skip. Record `"AGENTS.md — skipped (block already present)"`.
- If `AGENTS.md` does not exist or the block is absent:
  - If appending to an existing file, add a blank line before the block.
  - Write the following block verbatim (do not include the code fence markers in the output):

```
---

## DakoHarness — Memory Protocol

You have two memory systems. Use them actively.

### Session Start

Start every session blank. Do **not** preload memory. Wait for the user's first task, then decide if memory is relevant.

**After compaction:** Call `get_context` once to check for compaction snapshots (tag `auto-cleanup`). If found, read to understand where work was interrupted, then delete with `forget`.

### During a Session — When to Search

- Call `find_patterns` with task keywords if the task feels like something done recently
- Call `recall` with keywords if you need a past decision or convention
- Do not search memory for tasks clearly unrelated to past work

### During a Session — When to Save

**Short-term** (`remember_pattern`): user accepts an approach, bug fixed with reusable pattern, convention established.
**Long-term** (`remember`): architectural decision, permanent convention, systemic bug lesson, important project fact.

### Tool Reference

| Situation | Tool |
|---|---|
| After compaction — check snapshot | `get_context` |
| User accepts an approach | `remember_pattern` |
| Architectural decision | `remember` type: decision |
| Convention established | `remember` type: convention |
| Bug fixed | `remember` type: bug |
| Before similar task | `find_patterns` |
| Searching past decisions | `recall` |
```

  - If file was created: record `"AGENTS.md — created"`.
  - If block was appended: record `"AGENTS.md — block appended"`.

### 8. Summary

Output a result table:

| Component | Result |
|---|---|
| DakoHarness path (`DAKO_HOME`) | `<resolved-path>` |
| Storage backend | mongodb / sqlite |
| MongoDB | running / started via Docker / skipped |
| `.env` | written / skipped |
| Connection test | passed / warning / skipped |
| `opencode.json` | written / merged / skipped |
| `dako-logger` plugin | installed / skipped |
| plugin config | written |
| `AGENTS.md` | created / appended / skipped |

Then output:
`"Setup complete. Run /recall test to verify the MCPs are connected. Restart OpenCode to load the newly registered MCP servers and the dako-logger plugin."`
