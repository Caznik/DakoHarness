---
wi: WI-doctor/20260522-health-check-command
phase: documentation
status: confirmed
date: 2026-05-22
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `README.md` | Slash commands | Added `/dako:doctor` row |
| `obsidian-docs/Slash Commands.md` | Top of command list | Added full `/doctor` section with check list and when-to-use |
| `obsidian-docs/Roadmap.md` | Backlog | Removed `/dako:doctor` entry (delivered) |
| `README.md` | Backlog | Removed `/dako:doctor` entry (delivered) |

## Workitem Documentation

### What was built

A new slash command `/dako:doctor` that verifies the full DakoHarness installation in a single run. It checks twelve components across two scopes — the global DakoHarness installation and the current project configuration — and reports ✅/❌ for each in a summary table. Failures include inline remediation instructions. After the table, the agent offers to fix remediable issues (missing `.mcp.json`, incomplete `.env`) interactively.

The command is implemented as `commands/doctor.md` and mirrored to `claude-plugin-release/commands/doctor.md`.

### How it works

The command is a markdown skill file interpreted by the agent at runtime, following the same pattern as all other DakoHarness commands. Key design choices:

- **Accumulate-then-report**: The agent collects all results before outputting anything. No per-step output — one table at the end. This is enforced by the "Accumulate results…" instruction at the top of the Steps section.
- **DAKO_HOME dependency handling**: If `~/.dako/config` is missing or invalid, dependent checks (Steps 2–5, hook binary in Step 7) are recorded as `⚠️ skipped (DAKO_HOME not resolved)` rather than being silently absent — all 12 rows always appear in the table.
- **MongoDB reachability**: Uses the same temp JS file + MongoClient pattern as `/dako:setup`, with a 3-second timeout and absolute-path `require()`.
- **MCP pings**: LTM is pinged via `recall` with `query: "doctor-ping"`; STM via `get_recent_patterns` with `days: "1"`. Any valid response (including empty) counts as ✅.
- **Hooks check**: Verifies hook entries exist in `.claude/settings.json` (dev mode) or `hooks/hooks.json` (plugin mode), then checks the hook executable resolves in PATH or at `$DAKO_HOME/bin/`. Full live execution was intentionally omitted (see Known Limitations).

### Usage

```
/dako:doctor
```

No arguments. Run from any project directory that has DakoHarness configured. Example output:

```
| Check                 | Status | Notes                        |
|-----------------------|--------|------------------------------|
| DAKO_HOME             | ✅     | C:/lab/Proyectos/DakoHarness |
| LTM server.js         | ✅     |                              |
| node_modules/mongodb  | ✅     |                              |
| STM binary            | ✅     |                              |
| .env (exists)         | ✅     |                              |
| .env (fields)         | ✅     |                              |
| MongoDB reachable     | ✅     |                              |
| .mcp.json             | ✅     |                              |
| Hooks configured      | ✅     |                              |
| Hook command resolves | ✅     |                              |
| LTM MCP (live)        | ✅     |                              |
| STM MCP (live)        | ✅     |                              |

All checks passed. DakoHarness is healthy.
```

### Known limitations

**AC-7 (accepted):** The hooks check verifies that hook entries are configured and that the hook executable resolves in PATH or at `$DAKO_HOME/bin/`. It does not execute the hook command with a live payload. Full execution was intentionally omitted because running the hook would write a spurious log entry to MongoDB. Path resolution proves the hook is wired; actual runtime behaviour is not verified.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
