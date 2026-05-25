---
wi: WI-auto-registry-refresh/20260525-session-start-detection
phase: analyze
status: confirmed
date: 2026-05-25
---

## Requirements

1. At session start, the agent checks whether `.claude/skill-registry.md` is stale relative to the command files in `.claude/commands/`.
2. "Stale" is defined by file mtime: any `.claude/commands/*.md` with a modification time newer than `.claude/skill-registry.md` makes the registry stale. A missing registry file also counts as stale.
3. If stale, the agent silently invokes `/registry-refresh` and prints a one-line notice using the existing `/registry-refresh` confirmation format (`Registry refreshed — N skills indexed.`).
4. If fresh, the check is a silent no-op — no log line, no tool call.
5. The check is triggered by a new step in the CLAUDE.md **Session Start** section. No new hook, no settings.json changes, no MCP changes.
6. Always on by default. No env var, no config flag.
7. Behavior is robust to missing `.claude/commands/` directory (e.g. plugin-only installs where commands live elsewhere) — skip silently in that case.

## Out of Scope

- Hook-based detection (rejected in favor of CLAUDE.md instruction)
- Tracking refresh state in STM (mtime is sufficient)
- Diffing which commands changed (auto-refresh is silent — the registry itself is the diff)
- Mid-session re-checks (e.g. after creating a new command file in the same session)
- Auto-refresh in any directory other than `.claude/commands/`
- Changes to the three skill mirror locations (`commands/`, `claude-plugin-release/commands/`) — only `.claude/commands/` is indexed by the registry

## Open Questions

None at sign-off.

## Acceptance Criteria

- [ ] **AC-1** — CLAUDE.md `## Memory Protocol` → `### Session Start` (or a new `### Registry Freshness` subsection placed near it) describes the freshness check protocol with explicit mtime-comparison rule.
- [ ] **AC-2** — Protocol text specifies: registry stale ⇔ any `.claude/commands/*.md` mtime > `.claude/skill-registry.md` mtime, OR `.claude/skill-registry.md` does not exist.
- [ ] **AC-3** — Protocol text specifies that on stale detection the agent invokes `/registry-refresh` and emits a one-line notice matching the existing format.
- [ ] **AC-4** — Protocol text specifies that on a fresh registry the check is fully silent.
- [ ] **AC-5** — Protocol text specifies that if `.claude/commands/` does not exist, the check is skipped silently.
- [ ] **AC-6** — Smoke test: with a freshly built registry, simulating session start produces no refresh and no output. After touching one `.claude/commands/*.md` file, simulating session start triggers a refresh and the expected notice.
- [ ] **AC-7** — Zero new runtime dependencies (no MCP changes, no hook code, no settings.json edits, no env vars).
- [ ] **AC-8** — Documentation updated: README.md backlog row removed, `obsidian-docs/Memory System.md` or `Slash Commands.md` mentions the auto-refresh behavior where appropriate.

## Interview Notes

- User picked all four recommended answers: mtime comparison, silent auto-refresh, CLAUDE.md instruction trigger, always on.
- Reasoning carried forward from design discussion: registry-refresh is cheap and safe; agent-driven check keeps the implementation pure markdown with no new infra (matches the ethos established by [[WI-semantic-recall/20260525-embedding-search]]).
- Explicitly chose CLAUDE.md trigger over hook to avoid touching hook code and settings.json — same "no new code" pattern.

## Sign-off

**Confirmed by user:** yes
**Date:** 2026-05-25
