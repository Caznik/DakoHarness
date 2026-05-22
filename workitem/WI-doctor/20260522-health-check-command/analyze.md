---
wi: WI-doctor/20260522-health-check-command
phase: analyze
status: confirmed
date: 2026-05-22
---

## Requirements

1. Run all checks unconditionally and report results in a single summary table — no check blocks others
2. Checks are divided into two scopes:
   - **Global** (DakoHarness installation): ~/.dako/config, DAKO_HOME validity, server.js, node_modules, STM binary
   - **Project** (current cwd): .mcp.json entries, hooks configuration, .env file
3. MongoDB check: port reachable on configured host:port; .env exists with all 7 required fields
4. Hooks check: UserPromptSubmit, Stop, PreCompact are configured; live-trigger the hook command with a minimal payload and verify exit code 0
5. MCP checks: call a lightweight tool on each MCP (recall on LTM, get_recent_patterns on STM) and confirm a valid response
6. Each failed check outputs a specific remediation message (what to do, not just what's wrong)
7. After the table, for fixable failures (missing .mcp.json, missing .env fields), agent offers to fix them on the spot

## Out of Scope

- Auto-starting MongoDB (that belongs to /dako:setup)
- Full re-run of setup
- Checking hooks unrelated to DakoHarness
- Verifying git config or Claude Code version

## Open Questions

None — all design points resolved in interview.

## Acceptance Criteria

- [ ] **AC-1** — All checks complete and the summary table is shown regardless of individual failures; no check is skipped because a prior one failed
- [ ] **AC-2** — Global: `~/.dako/config` exists and contains a valid `DAKO_HOME`; `$DAKO_HOME/mcps/mongodb-memory/server.js` exists; `node_modules/mongodb` exists under that path
- [ ] **AC-3** — Global: platform-appropriate STM binary exists at `$DAKO_HOME/bin/dako-stm.exe` (Windows) or `$DAKO_HOME/bin/dako-stm` (Unix)
- [ ] **AC-4** — Project: `.env` exists at `$DAKO_HOME/mcps/mongodb-memory/.env` and contains all 7 fields: `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_HOST`, `MONGO_PORT`, `MONGO_DB`, `MONGO_URI`, `DAKO_AGENT`
- [ ] **AC-5** — Project: MongoDB is reachable on `MONGO_HOST:MONGO_PORT` from the configured `.env`
- [ ] **AC-6** — Project: `.mcp.json` exists in cwd with entries for both `dako-long-term-memory` and `dako-short-term-memory`
- [ ] **AC-7** — Project: `UserPromptSubmit`, `Stop`, and `PreCompact` hooks are configured; hook command is live-triggered with a minimal JSON payload and exit code 0 is verified
- [ ] **AC-8** — Live: `dako-long-term-memory` MCP responds to a lightweight `recall` call
- [ ] **AC-9** — Live: `dako-short-term-memory` MCP responds to a lightweight `get_recent_patterns` call
- [ ] **AC-10** — Each ❌ result includes a specific remediation message (exact command or step to fix it)
- [ ] **AC-11** — After the table, fixable failures (missing .mcp.json, incomplete .env) are offered as interactive remediations the agent can apply
- [ ] **AC-12** — `commands/doctor.md` and `claude-plugin-release/commands/doctor.md` are both written and identical

## Interview Notes

- Report-all: user wants the full picture in one pass, not stop-at-first-failure
- Remediation: report + offer to fix, not auto-fix silently
- Hooks: live trigger via shell execution of the hook command with minimal payload
- MCP ping: lightweight tool call is sufficient (no dedicated ping needed)
- Scope: both global (DAKO_HOME install) and project (cwd config)

## Sign-off
**Confirmed by user:** yes
**Date:** 2026-05-22
