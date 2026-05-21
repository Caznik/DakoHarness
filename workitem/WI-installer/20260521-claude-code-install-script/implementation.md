---
wi: WI-installer/20260521-claude-code-install-script
phase: implementation
status: completed
date: 2026-05-21
---

## Architecture Notes

- Plugin root IS the DakoHarness repo root — no new directory nesting needed
- hooks/hooks.json format is identical to the hooks object in settings.json; no format change
- bin/ is added to PATH automatically by the plugin system — logger.mjs and dako-stm callable by name
- commands/ mirrors .claude/commands/ exactly — same .md frontmatter format, no conversion needed
- logger.mjs uses ESM import.meta.url/__dirname via fileURLToPath — __dirname is file-relative, stable after move to bin/
- .mcp.json stays at repo root; plugin system reads it from there; relative paths resolve from plugin install dir
- No unit test suite exists for config/script files — validation is runtime-based via claude plugin validate and manual AC checks
- Keeping mcps/mongodb-memory/logger.mjs in place for the standalone dev setup (deviation from plan Step 3 — see deviations)

## Plan Deviations

| Step | Original plan | What actually happened | Reason |
|---|---|---|---|
| Step 3 | Delete mcps/mongodb-memory/logger.mjs | Kept original in place; created bin/logger.mjs as a separate copy | Deleting the original would break the existing standalone dev setup whose hooks still reference the absolute path in .claude/settings.json |
| Step 4 | hooks.json calls `node logger.mjs` by name | hooks.json calls `dako-logger` wrapper; added bin/dako-logger and bin/dako-logger.bat | Node does not PATH-search for .mjs script files — `node logger.mjs` resolves relative to cwd, not PATH. A named wrapper is required. |
| Step 10 | YAML frontmatter in recall.md and promote.md | Both files had unquoted description values with `<` and `[` characters; fixed by wrapping in double quotes | YAML treats `<` and `[` as special characters — unquoted causes parse error during `claude plugin validate` |

## Blockers

| # | Description | Resolution | Status |
|---|---|---|---|

## QA Log

| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-9 (validate passes), AC-10 (plugin.json fields) | FAIL (YAML parse errors on recall.md, promote.md) | Quoted description values in both files — fixed in commands/ and .claude/commands/ |
| 2 | AC-9 | PASS (1 expected warning: CLAUDE.md at plugin root not loaded — handled by setup scripts) | None |
| 3 | AC-2 (hooks no absolute paths) | FAIL (hooks.json called `node logger.mjs` — Node does not PATH-search .mjs) | Created bin/dako-logger and bin/dako-logger.bat wrappers; updated hooks.json to call `dako-logger <event>` |
| 4 | AC-1 (20 commands present), AC-2 (dako-logger wrapper in bin/), AC-3 (platform binaries + wrappers in bin/), AC-4 (.mcp.json relative path), AC-5 (setup.md skill), AC-6 (setup scripts create .env), AC-7 (setup scripts write CLAUDE.md), AC-8 (setup scripts start Docker), AC-10 (plugin.json fields) | PASS (static checks) | None — runtime ACs (1, 2, 3, 4, 5) require manual testing with live plugin install |

## Regression

**Test suite run:** no
**Result:** n/a — no existing test suite for config/script files; `claude plugin validate .` run as proxy check (passed)
**Failures:** none
