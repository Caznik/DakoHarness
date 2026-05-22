---
wi: WI-dako-setup/20260522-marketplace-install
phase: implementation
status: completed
date: 2026-05-22
---

## Architecture Notes

The deliverable is a single markdown skill file (`commands/setup.md`) — agent instructions, not executable code. Skills are interpreted at runtime by the Claude Code agent, which executes the described steps using its available tools (Bash, PowerShell, Read, Write, etc.). This means:

- There is no compiled artifact or importable module — correctness is defined by whether the instructions lead the agent to satisfy all ACs.
- Platform detection (Windows vs Unix) is delegated to the agent, which already knows the host platform and will choose appropriate commands. The skill names what to detect, not which shell command to run.
- The connection test approach mirrors `setup.ps1`: a temp `.js` file that requires mongodb by absolute path (not via Node module resolution), run and then deleted. This avoids the `node_modules` path issue that broke `bin/logger.mjs` in the previous session.
- The `~/.dako/config` file uses `key=value` format (same as `.env`) for consistency and to make it easy for the agent to read with standard tools.

Existing pattern followed: other complex skills (wi-implement, wi-analyze) use numbered steps with clear sub-bullet decision trees and embedded code blocks for content to be written verbatim. The same structure is used here.

## Plan Deviations

| Step | Original plan | What actually happened | Reason |
|---|---|---|---|
| All (TDD) | Write tests first (Red), then implementation (Green) | ACs verified by inspection in QA Loop — no test-first cycle | The deliverable is a markdown skill file, not executable code. There are no testable units to write failing tests against. AC satisfaction is structural (does the instruction text cover the case?) rather than behavioral (does the code produce the right output?). |

## Blockers
| # | Description | Resolution | Status |
|---|---|---|---|

## QA Log

| Iteration | ACs checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-1 through AC-9 | All pass | None — implementation satisfies all ACs on first inspection |

**AC-1:** Step 2 covers port check → Docker start → re-check flow. ✅  
**AC-2:** Step 2 Docker-unavailable branch exits with actionable message. ✅  
**AC-3:** Step 3 reads existing `.env` defaults, falls back to `dako`/`harness`. ✅  
**AC-4:** Step 5 connection test warns on failure and does not abort. ✅  
**AC-5:** Step 4 writes all 7 fields, skips if file already present. ✅  
**AC-6:** Step 6 writes both MCP entries with absolute paths from `$DAKO_HOME`, skips if present. ✅  
**AC-7:** Step 7 checks for marker string, appends/creates/skips accordingly. ✅  
**AC-8:** Steps 4, 6, 7 each have explicit skip logic; Step 8 reports skipped items. ✅  
**AC-9:** Step 1 reads from `~/.dako/config`, validates path, falls back to asking the user; Step 6 constructs absolute paths from `$DAKO_HOME`. ✅  

## Regression
**Test suite run:** no
**Result:** n/a — no automated test suite exists for skill markdown files
**Failures:** none
