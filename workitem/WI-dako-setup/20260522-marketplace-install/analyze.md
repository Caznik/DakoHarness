---
wi: WI-dako-setup/20260522-marketplace-install
phase: analyze
status: confirmed
date: 2026-05-22
---

## Requirements

1. **MongoDB check** — detect whether MongoDB is already running on port 27017 (Docker or native)
2. **Docker fallback** — if MongoDB is not running, attempt to start a `mcp_mongodb` Docker container; if Docker is not available, exit with a clear, actionable error message
3. **Credential prompt** — ask the user for MongoDB username and password; show existing `.env` values as defaults if the file exists, otherwise default to `dako`/`harness`
4. **`.env` write** — write `mcps/mongodb-memory/.env` in the DakoHarness installation directory with all required fields (`MONGO_USER`, `MONGO_PASSWORD`, `MONGO_HOST`, `MONGO_PORT`, `MONGO_DB`, `MONGO_URI`, `DAKO_AGENT`); skip if file already exists
5. **Connection test** — after credentials are confirmed, test MongoDB connectivity; warn if the test fails but do not abort
6. **`.mcp.json` write** — write `.mcp.json` in the current project directory with both MCP server registrations (`dako-long-term-memory`, `dako-short-term-memory`) using absolute paths and correct `DAKO_PROJECT_ROOT`; skip if file already exists
7. **CLAUDE.md injection** — append the DakoHarness memory protocol block to the current project's `CLAUDE.md`; create the file if it doesn't exist; skip if the block is already present
8. **DakoHarness path detection** — the command must correctly locate the DakoHarness installation directory at runtime to write `.env` and generate correct absolute paths in `.mcp.json`
9. **Idempotency** — a second run on an already-configured project skips all already-present components without errors
10. **Summary output** — on completion, report what was done and what was skipped, and suggest `/dako:recall test` to verify

## Out of Scope

- Splitting `/dako:setup` into two separate commands
- Node.js or Go version checks
- Uninstall / teardown
- Overwriting existing `.env`, `.mcp.json`, or CLAUDE.md block — skip only

## Open Questions

- How does the command detect the DakoHarness installation path? (Claude Code may or may not expose plugin directory — needs investigation in planning)

## Acceptance Criteria

- [ ] **AC-1** — When MongoDB is not running and Docker is available, running `/dako:setup` in a project starts a `mcp_mongodb` container and proceeds
- [ ] **AC-2** — When MongoDB is not running and Docker is not available, `/dako:setup` exits with a message that tells the user how to resolve it (install Docker or start MongoDB manually)
- [ ] **AC-3** — The credential prompt shows existing `.env` values as defaults if the file exists; shows `dako`/`harness` if it does not
- [ ] **AC-4** — After credentials are accepted, `/dako:setup` tests the MongoDB connection and reports success or a warning (but does not abort on failure)
- [ ] **AC-5** — `/dako:setup` writes a valid `mcps/mongodb-memory/.env` with all required fields; skips if the file already exists
- [ ] **AC-6** — `/dako:setup` writes `.mcp.json` in the current project directory with correct absolute paths for both MCP servers and `DAKO_PROJECT_ROOT` set to the current directory; skips if already present
- [ ] **AC-7** — `/dako:setup` appends the memory protocol block to the project's `CLAUDE.md`; creates `CLAUDE.md` if absent; skips if the block is already there
- [ ] **AC-8** — Running `/dako:setup` a second time on an already-configured project produces no errors and reports what was skipped
- [ ] **AC-9** — The DakoHarness installation path is resolved correctly so all written paths are absolute and valid

## Interview Notes

- Expand existing `/dako:setup` rather than creating a new `/dako:install` command
- MongoDB handling: replicate setup script logic (check port 27017 → Docker → error)
- Idempotency: skip silently if already configured
- CLAUDE.md injection: yes, same as setup scripts
- Credential prompt: interactive, show existing `.env` defaults

## Sign-off
**Confirmed by user:** yes
**Date:** 2026-05-22
