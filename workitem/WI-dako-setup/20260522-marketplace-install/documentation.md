---
wi: WI-dako-setup/20260522-marketplace-install
phase: documentation
status: confirmed
date: 2026-05-22
project-docs-found: yes
---

## Project Documentation Updated
| File | Section | Change |
|---|---|---|
| `obsidian-docs/Setup Guide.md` | Step 4 — Set the project root | Updated description to reflect full setup flow |

## Workitem Documentation

### What was built
The `/dako:setup` command was expanded from a minimal tool that only wrote `.mcp.json` into a full first-time setup command. It now handles the complete DakoHarness onboarding for a project: MongoDB connectivity check with Docker fallback, `.env` credential setup, MongoDB connection test, `.mcp.json` configuration for both MCP servers with absolute paths, and `CLAUDE.md` memory protocol injection. This is the key enabler for marketplace installs, where users do not have access to the `setup.ps1`/`setup.sh` scripts.

### How it works
The command is a markdown skill file (`commands/setup.md`) — instructions the Claude Code agent follows at runtime, not executable code. Key design points:

- **DakoHarness path persistence**: On first run, the user provides the installation path. It is validated (checks for `mcps/mongodb-memory/server.js`) and written to `~/.dako/config`. All subsequent runs read from there automatically.
- **Idempotency**: Each of the five write operations (`.env`, `.mcp.json`, CLAUDE.md block) checks for the existing state first and skips if already present. A second run on a configured project produces a summary of skipped components with no errors.
- **Connection test**: Uses a temporary Node.js script that requires the `mongodb` package by absolute path — avoids the module resolution issue that occurs when requiring from a different directory than `node_modules`.
- **Hooks are intentionally excluded**: Project-level hooks (`.claude/settings.json`) are not written by this command. Marketplace installs rely on plugin hooks from `hooks/hooks.json`, which fire automatically. `--plugin-dir` users should run `setup.ps1`/`setup.sh` or add hooks manually.

### Usage
Run inside Claude Code from the target project directory:
```
/dako:setup
```
The command is interactive — it will ask for the DakoHarness installation path (first time only) and MongoDB credentials (first time only). Safe to re-run at any time.

### Known limitations
None — review verdict was pass with no accepted gaps.

## Confirmation
**Confirmed by user:** yes
**Notes:**

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
