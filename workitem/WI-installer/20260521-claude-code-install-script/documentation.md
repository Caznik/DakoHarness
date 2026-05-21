---
wi: WI-installer/20260521-claude-code-install-script
phase: documentation
status: confirmed
date: 2026-05-21
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `obsidian-docs/Roadmap.md` | Phase 5 row in table | Status: Planned → Done ✅; description updated |
| `obsidian-docs/Roadmap.md` | Phase 5 detail section | Replaced placeholder with full list of what was built (plugin structure, binaries, setup, distribution) |
| `obsidian-docs/Architecture.md` | Component map | Replaced with full plugin layout including `.claude-plugin/`, `commands/`, `hooks/`, `bin/`, and separation of standalone dev setup |
| `obsidian-docs/Architecture.md` | Hook pipeline | Added plugin hook resolution note (dako-logger, $DIR, bin/ PATH) |
| `obsidian-docs/Setup Guide.md` | Full file | Added plugin installation as the recommended path; retained standalone dev setup with a clear label |

---

## Workitem Documentation

### What was built

DakoHarness is now a Claude Code plugin named **dako**. Before this workitem, using DakoHarness in a project required manually copying absolute paths for MCPs, hooks, and binaries into each project's config files. After this workitem, loading the plugin with `--plugin-dir /path/to/DakoHarness` gives any project access to all DakoHarness features with no manual path configuration.

### How it works

**Plugin manifest** (`.claude-plugin/plugin.json`): Declares the plugin name `dako`. Claude Code uses this to namespace all commands — every `.md` file in `commands/` becomes `/dako:<filename>` when the plugin is loaded.

**bin/ on PATH**: The plugin system automatically adds the `bin/` directory to PATH for the session. This is how hooks and the MCP server reference executables by name without hardcoded paths.

**Hook chain**: `hooks/hooks.json` calls `dako-logger <event>`. `bin/dako-logger` (Unix) and `bin/dako-logger.bat` (Windows) are wrapper scripts that call `node "$DIR/logger.mjs"`, where `$DIR` is the directory of the wrapper script itself — not the cwd. This is the critical fix over naive `node logger.mjs`: Node does not PATH-search for `.mjs` files, so calling `node logger.mjs` resolves relative to cwd and fails when Claude Code is opened from a different directory.

**Cross-platform binary**: `mcps/short-term-memory/main.go` was cross-compiled with `CGO_ENABLED=0` for Windows (`.exe`), Linux (`-linux`), and macOS (`-darwin`). `bin/dako-stm` (Unix shell script) detects the OS via `uname -s` and execs the matching binary. `bin/dako-stm.bat` calls `dako-stm.exe` on Windows.

**Relative MCP paths**: `.mcp.json` now uses `"./mcps/mongodb-memory/server.js"` instead of an absolute path. Claude Code resolves this relative to the plugin install directory, which is the DakoHarness repo root.

**Per-project DAKO_PROJECT_ROOT**: The short-term MCP needs to know which project's patterns to serve. The plugin `.mcp.json` leaves `DAKO_PROJECT_ROOT` empty; running `/dako:setup` in the target project writes a project-level `.mcp.json` override that sets `DAKO_PROJECT_ROOT` to the project's absolute path.

**Two logger.mjs copies**: `bin/logger.mjs` is the plugin's canonical copy. `mcps/mongodb-memory/logger.mjs` was kept intact for the DakoHarness standalone dev setup, which still uses `.claude/settings.json` with absolute paths. Deleting it would break the dev setup.

### Usage

#### Using DakoHarness in a new project from scratch

These are the full steps for a developer who has never used DakoHarness before.

**Prerequisites:** Docker, Node.js 18+, Claude Code.

**Step 1 — Get DakoHarness**

```bash
git clone https://github.com/Caznik/DakoHarness
cd DakoHarness
npm install --prefix mcps/mongodb-memory
```

**Step 2 — Run the setup script**

The script starts MongoDB, creates the credentials file, and injects the memory protocol into your project's `CLAUDE.md`.

```bash
# Mac / Linux
./setup.sh /path/to/your-project

# Windows
.\setup.ps1 -TargetProject "C:\path\to\your-project"
```

What it does:
- Checks Docker is running (exits with a clear error if not)
- Starts a `mcp_mongodb` container (or skips if already running)
- Creates `mcps/mongodb-memory/.env` with MongoDB credentials
- Appends the DakoHarness memory protocol block to `<your-project>/CLAUDE.md`

**Step 3 — Open your project with the plugin loaded**

```bash
cd /path/to/your-project
claude --plugin-dir /path/to/DakoHarness
```

All 20 `/dako:*` commands are now available.

**Step 4 — Set the project root (once per project)**

Run this inside Claude Code in your project:

```
/dako:setup
```

This writes `.mcp.json` in your project with `DAKO_PROJECT_ROOT` set to the current directory. The short-term memory MCP uses this to store patterns scoped to your project.

**Step 5 — Verify**

```
/dako:recall test
```

No errors (even with no results) means the MCP servers are connected. You're done.

---

**All available commands:**
- `/dako:recall`, `/dako:promote`, `/dako:promote-team`, `/dako:session-end`, `/dako:registry-refresh`
- `/dako:wi-start`, `/dako:wi-next`, `/dako:wi-status`, `/dako:wi-park`, `/dako:wi-cancel`
- `/dako:wi-intake`, `/dako:wi-analyze`, `/dako:wi-propose`, `/dako:wi-plan`, `/dako:wi-implement`
- `/dako:wi-review`, `/dako:wi-document`, `/dako:wi-repo`, `/dako:wi-archive`
- `/dako:setup`

### Known limitations

The following ACs were accepted as static-only at review (runtime verification deferred to first live install):

- **AC-1** — `/dako:*` command resolution requires `--plugin-dir` with a running Claude Code session
- **AC-2** — Hook firing requires an active session; `dako-logger` PATH resolution is correct statically but untested live
- **AC-3** — `dako-stm` Mac/Linux binary selection is untested on those platforms; Windows path verified structurally
- **AC-4** — `.mcp.json` relative path resolution from the plugin install dir needs live verification
- **AC-5** — `/dako:setup` env var override needs live execution in a target project

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
