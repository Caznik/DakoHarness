---
wi: WI-doctor/20260522-health-check-command
phase: plan
status: confirmed
date: 2026-05-22
approach: Approach A
---

## Context
**Selected approach:** Single markdown skill file
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12

---

## Implementation Sequence

### Step 1 — Write commands/doctor.md
**Satisfies:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11
**Files:** `commands/doctor.md`
**Description:** Write the full skill file. Structure:
- Frontmatter: `name: doctor`, `description: one-liner`
- Step 1 — Resolve DAKO_HOME: read `~/.dako/config`; if missing, record ❌ with remediation "run /dako:setup"
- Step 2 — Global checks: verify `$DAKO_HOME/mcps/mongodb-memory/server.js` and `node_modules/mongodb` exist
- Step 3 — STM binary check: confirm platform binary exists (`bin/dako-stm.exe` / `bin/dako-stm`)
- Step 4 — .env check: file exists and contains all 7 required fields
- Step 5 — MongoDB reachability: attempt TCP connection to `$MONGO_HOST:$MONGO_PORT` (same temp-JS pattern as setup.md Step 5)
- Step 6 — .mcp.json check: file exists in cwd with both `dako-long-term-memory` and `dako-short-term-memory` entries
- Step 7 — Hooks check: read hooks config (`.claude/settings.json` or `hooks/hooks.json`); confirm UserPromptSubmit, Stop, PreCompact are present; pipe a minimal JSON payload to the configured command and check exit code 0
- Step 8 — LTM MCP ping: call `recall` with `query: "doctor-ping"` and confirm a response is returned (any result, including empty, counts as ✅)
- Step 9 — STM MCP ping: call `get_recent_patterns` and confirm a response
- Step 10 — Summary table: one row per check, ✅/❌, remediation message inline for failures
- Step 11 — Remediation offer: for each fixable failure (missing `.mcp.json`, incomplete `.env`), ask the user "Want me to fix this?" and apply if yes

### Step 2 — Sync to claude-plugin-release
**Satisfies:** AC-12
**Files:** `claude-plugin-release/commands/doctor.md`
**Description:** Copy `commands/doctor.md` verbatim to the release package. Both files must be identical.

### Step 3 — Remove from Roadmap backlog
**Satisfies:** (housekeeping)
**Files:** `obsidian-docs/Roadmap.md`, `README.md`
**Description:** Delete the `/dako:doctor` row from the backlog table in both files.

---

## Risks / Known Unknowns

- **Live hook trigger writes to MongoDB** — piping a real payload to the hook command will create a test log entry. Acceptable side effect, but worth noting. If undesirable, doctor can fall back to verifying the command path resolves rather than executing it.
- **Hooks config location differs** — dev mode uses absolute paths in `.claude/settings.json`; plugin mode uses `hooks/hooks.json` with `dako-logger`. Doctor must check both locations.
- **STM MCP chicken-and-egg** — the STM ping (AC-9) requires the STM MCP to already be connected to Claude Code. If STM is down, the ping call itself will fail. This is actually the desired behavior (it accurately reports the MCP as down), but it means the ping result reflects Claude Code's current MCP state, not an independent probe.

## Confirmation
**Confirmed by user:** yes
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
