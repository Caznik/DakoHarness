---
wi: WI-installer/20260521-claude-code-install-script
phase: propose
status: confirmed
date: 2026-05-21
triggered: no
---

## Approach A — Convert DakoHarness to a Claude Code plugin

**Summary:** Restructure the DakoHarness repository to conform to the Claude Code plugin spec. Migrate all commands, hooks, and MCP configuration to plugin-standard locations. Add cross-platform binary wrapper, setup scripts, and a `/dako:setup` skill for per-project configuration.

**Pros:**
- Officially supported distribution path (community marketplace)
- No absolute paths — hooks reference binaries via `bin/` PATH
- Clean separation: plugin handles wiring, setup script handles one-time project config

**Cons:**
- Commands become namespaced (`/dako:wi-start` vs `/wi-start`) — minor UX change
- Cross-compilation for Mac/Linux requires Go toolchain during build

**Effort:** medium

## Selected Approach

**Choice:** Approach A
**Rationale:** Only one viable direction — the plugin spec dictates the structure, and all decisions about wrapper scripts, setup script, and `/dako:setup` were settled during analyze. No architectural trade-offs remained open.

## Confirmation

**Confirmed by user:** yes
**Notes:** triggered: no — propose phase skipped, proceeding directly to plan
