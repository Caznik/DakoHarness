---
wi: WI-installer/20260521-claude-code-install-script
phase: analyze
status: confirmed
date: 2026-05-21
---

## Requirements

1. Convert DakoHarness into a valid Claude Code plugin with name `dako`
2. Plugin manifest at `.claude-plugin/plugin.json` with name, description, version, author
3. All 19 existing commands migrated to `commands/` at plugin root — available as `/dako:<name>`
4. Hooks migrated from `settings.json` to `hooks/hooks.json`, referencing `logger.mjs` by name via `bin/` (no absolute paths)
5. `logger.mjs` moved to `bin/` so it is on PATH when hooks fire
6. Short-term memory Go binary cross-compiled for Windows, Mac (darwin), Linux — placed in `bin/` as platform binaries
7. A wrapper script (`bin/dako-stm` for Unix, `bin/dako-stm.bat` for Windows) detects OS and calls the correct binary
8. MCP configuration at plugin root `.mcp.json` — references server.js relatively, short-term memory via `dako-stm` (from PATH)
9. A `/dako:setup` skill that configures `DAKO_PROJECT_ROOT` for the current project (writes/updates the project's MCP config)
10. A setup script (`setup.sh` / `setup.ps1`) that: starts MongoDB via Docker, creates `.env`, writes the CLAUDE.md memory protocol block into the target project
11. Plugin must pass `claude plugin validate`
12. Plugin works via `--plugin-dir ./dakoharness` for local distribution; structured for community marketplace submission later

## Out of Scope

- Community marketplace submission (Phase 5 ships via `--plugin-dir`; submission is a follow-up)
- OpenCode / Pi / Codex CLI support
- Automatic Docker installation (user must have Docker pre-installed)
- MongoDB authentication changes (existing credentials unchanged)

## Open Questions

- **`DAKO_PROJECT_ROOT` per-project override**: the plugin `.mcp.json` can define the server, but `DAKO_PROJECT_ROOT` is project-specific. Does `/dako:setup` write a project-level `.mcp.json` override, or modify a settings file? Needs investigation of how Claude Code handles per-project env var overrides for plugin MCPs.
- **`bin/` on Windows PATH**: does Claude Code add the plugin `bin/` to PATH in a way that resolves `.bat` files on Windows? Needs verification.

## Acceptance Criteria

- [ ] **AC-1** — Running `claude --plugin-dir ./dakoharness` makes all 19 commands available as `/dako:<name>`
- [ ] **AC-2** — `UserPromptSubmit`, `Stop`, and `PreCompact` hooks fire correctly; `logger.mjs` is invoked via PATH (no absolute path in `hooks.json`)
- [ ] **AC-3** — `dako-stm` wrapper script correctly selects and runs the platform binary on Windows, Mac, and Linux
- [ ] **AC-4** — Long-term memory MCP (`server.js`) starts correctly via plugin `.mcp.json` relative path
- [ ] **AC-5** — `/dako:setup` run in a target project sets `DAKO_PROJECT_ROOT` so the short-term memory MCP serves that project
- [ ] **AC-6** — Setup script creates `.env` with MongoDB credentials in the correct location
- [ ] **AC-7** — Setup script writes the CLAUDE.md memory protocol block into the target project
- [ ] **AC-8** — Setup script starts MongoDB via Docker (or detects it is already running and skips)
- [ ] **AC-9** — `claude plugin validate` passes with no errors
- [ ] **AC-10** — `plugin.json` has `name: "dako"`, valid description, version, and author fields

## Interview Notes

- Namespace `dako` chosen over `dakoharness` for shorter command names (user preference)
- CLAUDE.md injection via setup script, not agent definition — keeps the plugin non-invasive
- Wrapper script chosen over duplicate binaries for cross-platform short-term memory
- `/dako:setup` skill handles per-project `DAKO_PROJECT_ROOT` — avoids hardcoded paths in the plugin `.mcp.json`
- Community marketplace submission deferred; `--plugin-dir` is the distribution method for Phase 5
- MongoDB/Docker setup handled by setup script + documentation (both, per user)

## Sign-off

**Confirmed by user:** yes
**Date:** 2026-05-21
