---
wi: WI-installer/20260521-claude-code-install-script
phase: plan
status: confirmed
date: 2026-05-21
approach: Approach A
---

## Context

**Selected approach:** Convert DakoHarness to a Claude Code plugin
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10

## Implementation Sequence

### Step 1 — Plugin manifest
**Satisfies:** AC-10
**Files:** `.claude-plugin/plugin.json` (new)
**Description:** Create the plugin manifest directory and file with `name: "dako"`, description, `version: "1.0.0"`, and author. This is the root identity of the plugin — drives namespacing of all commands as `/dako:<name>`.

### Step 2 — Migrate commands to plugin root
**Satisfies:** AC-1
**Files:** `commands/*.md` (19 new files)
**Description:** Copy all 19 `.md` files from `.claude/commands/` to `commands/` at the plugin root. The plugin system picks them up as `/dako:<name>` when loaded via `--plugin-dir`. The existing `.claude/commands/` stays in place for DakoHarness development use.

### Step 3 — Move logger.mjs to bin/ and fix .env path
**Satisfies:** AC-2 (partial)
**Files:** `bin/logger.mjs` (new), `mcps/mongodb-memory/logger.mjs` (deleted)
**Description:** Move `logger.mjs` to `bin/` so hooks can reference it by name without an absolute path. Update the dotenv line from `join(__dirname, ".env")` to `join(__dirname, "../mcps/mongodb-memory/.env")` so credentials are still found from the new location. `__dirname` is file-relative so this is stable regardless of cwd.

### Step 4 — Create hooks/hooks.json
**Satisfies:** AC-2
**Files:** `hooks/hooks.json` (new)
**Description:** Migrate hooks from `.claude/settings.json` to `hooks/hooks.json`. Commands reference `logger.mjs` by name only (no path) — resolved via `bin/` on PATH. Format mirrors the `hooks` object in `settings.json`.

### Step 5 — Cross-compile short-term memory binary
**Satisfies:** AC-3 (partial)
**Files:** `bin/dako-stm.exe`, `bin/dako-stm-linux`, `bin/dako-stm-darwin` (new)
**Description:** Cross-compile `mcps/short-term-memory/main.go` for all three platforms with `CGO_ENABLED=0`:
- `GOOS=windows GOARCH=amd64` → `bin/dako-stm.exe`
- `GOOS=linux   GOARCH=amd64` → `bin/dako-stm-linux`
- `GOOS=darwin  GOARCH=amd64` → `bin/dako-stm-darwin`

### Step 6 — Create platform wrapper scripts
**Satisfies:** AC-3
**Files:** `bin/dako-stm` (new, Unix), `bin/dako-stm.bat` (new, Windows)
**Description:** Unix `bin/dako-stm`: shell script that detects `$(uname -s)` and execs the matching platform binary with all args forwarded. Windows `bin/dako-stm.bat`: batch file that calls `dako-stm.exe %*`. Plugin `bin/` is on PATH so hooks and MCP config call `dako-stm` directly.

### Step 7 — Update plugin .mcp.json
**Satisfies:** AC-4
**Files:** `.mcp.json` (modified)
**Description:** Replace absolute paths with plugin-relative references:
- `dako-long-term-memory`: `node ./mcps/mongodb-memory/server.js`
- `dako-short-term-memory`: `dako-stm` (via PATH), `DAKO_PROJECT_ROOT` left empty — set per-project by `/dako:setup`

### Step 8 — Create /dako:setup skill
**Satisfies:** AC-5
**Files:** `commands/setup.md` (new)
**Description:** Skill that runs in the target project. Reads cwd as `DAKO_PROJECT_ROOT`, writes/updates the project's `.mcp.json` with the `dako-short-term-memory` entry setting `DAKO_PROJECT_ROOT` to the full project path, and reports what was written.

### Step 9 — Create setup scripts
**Satisfies:** AC-6, AC-7, AC-8
**Files:** `setup.ps1` (new), `setup.sh` (new)
**Description:** Both scripts: (1) check Docker is running — exit with clear error if not; (2) start MongoDB container or detect already running and skip; (3) prompt for MongoDB credentials (or use defaults) and write `mcps/mongodb-memory/.env`; (4) accept target project path as argument and append the CLAUDE.md memory protocol block to `<target>/CLAUDE.md`, creating the file if missing.

### Step 10 — Validate plugin
**Satisfies:** AC-9
**Files:** none
**Description:** Run `claude plugin validate`. Fix any structural issues reported. Run `claude --plugin-dir .` and verify `/dako:*` commands appear in `/help`.

## Risks / Known Unknowns

1. **logger.mjs .env path** — the dotenv path fix (Step 3) must be tested; `__dirname` is file-relative so should be stable, but verify at runtime.
2. **Plugin .mcp.json relative path** — Claude Code may resolve `./mcps/mongodb-memory/server.js` relative to the plugin install dir or the project root. Needs runtime verification (Step 7).
3. **DAKO_PROJECT_ROOT override** — unclear if a project-level `.mcp.json` can override plugin-level env vars without double-registering the server. May need to write the full server entry in the project `.mcp.json` (Step 8).
4. **bin/ PATH on Windows** — `.bat` resolution via `PATHEXT` needs testing. If `dako-stm.bat` is not resolved when hooks call `dako-stm`, wrapper approach fails on Windows.
5. **Cross-compilation on Windows** — building Linux/Mac binaries from Windows requires `CGO_ENABLED=0`. The short-term memory binary must be CGO-free for this to work.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
