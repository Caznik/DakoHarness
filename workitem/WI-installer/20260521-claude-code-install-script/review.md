---
wi: WI-installer/20260521-claude-code-install-script
phase: review
status: confirmed
date: 2026-05-21
verdict: accepted-with-gaps
---

## AC Verification

| AC | Description | Satisfied | Evidence / Notes |
|---|---|---|---|
| AC-1 | All 19 commands available as `/dako:<name>` | static yes / runtime pending | 20 .md files in `commands/` (19 migrated + `/dako:setup`); plugin.json valid; `claude plugin validate .` passes. Runtime requires live `--plugin-dir .` test. |
| AC-2 | Hooks fire via PATH; no absolute path in hooks.json | static yes / runtime pending | `hooks.json` calls `dako-logger <event>`; `bin/dako-logger` resolves via `$DIR/logger.mjs` — no cwd dependency. Runtime requires hook firing with a live session. |
| AC-3 | `dako-stm` wrapper selects correct platform binary | static yes / runtime pending | `bin/dako-stm` uses `uname -s` case statement; `bin/dako-stm.bat` calls `dako-stm.exe`. All 3 platform binaries present. Mac/Linux runtime untested. |
| AC-4 | Long-term MCP starts via relative path | static yes / runtime pending | `.mcp.json`: `"args": ["./mcps/mongodb-memory/server.js"]`. Relative resolution from plugin install dir needs runtime verification. |
| AC-5 | `/dako:setup` sets `DAKO_PROJECT_ROOT` for target project | static yes / runtime pending | `commands/setup.md` present. Skill execution and MCP env var override need runtime testing. |
| AC-6 | Setup script creates `.env` with credentials | yes | `setup.sh` and `setup.ps1` both prompt for credentials and write `mcps/mongodb-memory/.env`. |
| AC-7 | Setup script writes CLAUDE.md memory protocol block | yes | Both scripts accept target project path and append the protocol block to `<target>/CLAUDE.md`. |
| AC-8 | Setup script starts MongoDB via Docker (or skips) | yes | Both scripts detect running container and skip; start it otherwise. Docker absence exits with clear error message. |
| AC-9 | `claude plugin validate` passes | yes | Passed with 1 expected warning: CLAUDE.md at plugin root not loaded — handled by setup scripts. No errors. |
| AC-10 | plugin.json has name, description, version, author | yes | `.claude-plugin/plugin.json`: `name: "dako"`, full description, `version: "1.0.0"`, `author: { name: "Caznik" }`. |

## Plan Coverage

| Step | Implemented | Notes |
|---|---|---|
| Step 1 — Plugin manifest | yes | `.claude-plugin/plugin.json` created |
| Step 2 — Migrate commands | yes | 20 files in `commands/` (19 migrated + 1 new `/dako:setup`) |
| Step 3 — Move logger.mjs | partial | `bin/logger.mjs` created; original `mcps/mongodb-memory/logger.mjs` kept (deviation logged) |
| Step 4 — Create hooks/hooks.json | yes | `hooks/hooks.json` with `dako-logger` wrapper (deviation logged) |
| Step 5 — Cross-compile binary | yes | `bin/dako-stm.exe`, `bin/dako-stm-linux`, `bin/dako-stm-darwin` |
| Step 6 — Platform wrapper scripts | yes | `bin/dako-stm` (Unix) and `bin/dako-stm.bat` (Windows) |
| Step 7 — Update .mcp.json | yes | `.mcp.json` updated with relative paths and `dako-stm` command |
| Step 8 — /dako:setup skill | yes | `commands/setup.md` |
| Step 9 — Setup scripts | yes | `setup.sh` and `setup.ps1` |
| Step 10 — Validate | yes | `claude plugin validate .` passes |

## Deviations Review

| Step | Deviation | Assessment |
|---|---|---|
| Step 3 | Original `mcps/mongodb-memory/logger.mjs` kept instead of deleted | acceptable — intent preserved; `bin/logger.mjs` is the plugin's canonical copy; keeping the original protects the existing standalone dev setup whose `.claude/settings.json` hooks reference it by absolute path |
| Step 4 | `hooks.json` calls `dako-logger` wrapper instead of `node logger.mjs` | acceptable — intent preserved and improved; wrapper correctly resolves the `.mjs` file via `$DIR` regardless of cwd, which `node logger.mjs` would not do |
| Step 10 | YAML quote fix on `recall.md` and `promote.md` | acceptable — bug fix discovered during validation; fixed in both `commands/` and `.claude/commands/` to keep copies in sync |

## Gaps

**Runtime-only ACs (1, 2, 3, 4, 5):** All five require a live plugin install to fully verify. These are inherent to config/script artifacts — no test suite exists, and the plan explicitly listed them as known risks. Static evidence is strong for each:
- AC-1: plugin manifest valid, command files present
- AC-2: hooks reference named wrapper, wrapper resolves by `$DIR`
- AC-3: all platform binaries + wrappers present, wrapper logic is straightforward
- AC-4: `.mcp.json` uses standard relative path
- AC-5: setup.md skill is present

These gaps are acceptable given the distribution model (`--plugin-dir`): the user will test them during first use.

## Verdict

**Result:** accepted-with-gaps
**Accepted gaps:** Runtime verification of AC-1, AC-2, AC-3, AC-4, AC-5 — deferred to first live `--plugin-dir` install. Static evidence is complete for all five.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** review
**Reason:**
