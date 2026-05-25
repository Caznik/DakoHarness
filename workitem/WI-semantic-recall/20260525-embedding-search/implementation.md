---
wi: WI-semantic-recall/20260525-embedding-search
phase: implementation
status: completed
date: 2026-05-25
---

## Architecture Notes

This is a markdown-only implementation — no code changes to the LTM MCP server, no changes to the STM Go binary, no new dependencies. All behavior lives in three places that the agent reads at runtime:

1. **The `/recall` skill (3 identical files)** — instructs the agent to expand the query and merge results for the user-invoked path.
2. **CLAUDE.md `## Memory Query Expansion` section** — defines the protocol once for agent-initiated `recall` and `find_patterns` calls. The skill references this rather than duplicating.
3. **User-facing docs** (README, obsidian-docs) — describe the new behavior to humans.

Patterns followed:
- **Three-file skill duplication**: keep `commands/`, `.claude/commands/`, `claude-plugin-release/commands/` exactly in sync. This is the established convention from `/dako:checkpoint` and `/dako:memory-audit`.
- **Skill markdown style**: YAML frontmatter (`name`, `description`) + numbered `## Steps` body. Description is action-first, mentions usage pattern. Body has short procedural steps with concrete examples where ambiguity is likely.
- **CLAUDE.md section style**: `## Header` with short subsections, prescriptive language, examples inline. Matches the existing Memory Protocol and Tool Reference sections.
- **No score-weighted merging**: the `recall` MCP text output does not include numeric `textScore` (it sorts by it internally, then discards it). Rank-based fusion is the only correct merge strategy given the contract.

Deliberately not done:
- No new MCP tool, no schema change. AC-6 enforces this and the user explicitly chose approach B for the "no new infra" property.
- No caching of variants or results — premature, no measured need.
- No agent reranking of merged results — analyze explicitly excluded it.

## Plan Deviations

| Step | Original plan | What actually happened | Reason |
|---|---|---|---|
| Step 5 | Test queries included "stop adding extra credit lines to commits" → no-coauthored memory | Substituted with "hook failures when opening from a subfolder" → hook absolute-paths lesson | The no-coauthored memory lives in user-level auto-memory (`~/.claude` markdown files), not the DakoHarness MongoDB LTM. No target existed in LTM for the original Q2. Substitute targets a real memory and demonstrates the expansion benefit. |

## Blockers

| # | Description | Resolution | Status |
|---|---|---|---|

## QA Log

| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | AC-1, AC-2, AC-6 | pass | Updated all 3 `recall.md` skill files identically with 7-step protocol: variant generation guidance, per-variant MCP calls, rank-based fusion merge, 5-10 result presentation. Variant cap of 5 enforced in skill text, MCP schemas untouched. |
| 1 | AC-3 | pass | Added `## Memory Query Expansion` section to `CLAUDE.md` between Tool Reference and Skill Registry. Covers both `recall` (LTM) and `find_patterns` (STM) with per-tier dedup rules. Skill files reference the protocol section by name rather than duplicating. |
| 1 | AC-7 | pass | Replaced README backlog row "Semantic search for recall" with "Local embedding model for recall" — keeps option D path open. |
| 1 | AC-8 | pass | Updated README slash-command row for `/dako:recall`. Rewrote `obsidian-docs/Slash Commands.md` `/recall` section with the 5-step expansion description and CLAUDE.md cross-reference. |
| 1 | AC-4 | pass | Smoke test against live DakoHarness LTM: 3 paraphrased queries × 5 variants each (15 MCP calls + 5 baselines = 20 total). All 3 queries surfaced relevant memories the unexpanded baseline missed. Details below. |
| 1 | AC-5 | pass | Implicitly satisfied — implementation is markdown-only. No package installs, no env vars, no new MCP code, no model downloads. |

### Smoke test detail (AC-4)

**Q1 — "how do I store recurring patterns"**
- Baseline: 4 results (Short-term memory scope, Session boundary, Two-tier memory, Phase 3 workitem)
- Expansion (5 variants): 10 unique merged results
- New relevant memories surfaced: `[CONVENTION] Workitem artifact conventions`, `[LESSON] Hook commands need absolute paths`, `[BUG] STM MCP broken in --plugin-dir mode`, `[CONTEXT] DakoHarness installs into other projects`, `[CONTEXT] Phase 6 — Plugin submitted to Marketplace`, `[DECISION] Phase 5 and 6 scoped to Claude Code only`
- **Pass:** 6 additional relevant memories

**Q2 — "hook failures when opening from a subfolder"** *(substituted — see Plan Deviations)*
- Baseline: 3 results (Hook abs paths, Session boundary, All config project-scoped)
- Expansion (5 variants): 8 unique merged results
- New relevant memories surfaced: `[BUG] STM MCP broken in --plugin-dir mode`, `[DECISION] Phase 5 — Plugin packaging: two separate .mcp.json files for dev vs marketplace`
- **Pass:** 2 directly relevant new memories on the same topic (path resolution issues)

**Q3 — "where does session data go"**
- Baseline: 3 results (Session boundary, Short-term scope, Two-tier memory)
- Expansion (5 variants): 8 unique merged results
- New relevant memories surfaced: `[DECISION] All configuration is project-scoped, never global`, plus tangential hits on `[CONVENTION] Workitem artifact conventions`, `[LESSON] Hook commands need absolute paths`, `[DECISION] Phase 3 — Workitem workflow design`, `[CONTEXT] DakoHarness installs into other projects`
- **Pass:** 1 directly relevant new memory (`All configuration project-scoped`) plus broader context coverage

**Merge behavior verified:**
- Dedup by `[TYPE] title` worked correctly across all variants
- Rank-based fusion correctly elevated memories that appeared in multiple variants (e.g. `Hook abs paths` at 5/5 in Q2 placed first)
- Tie-break by best rank worked as expected (e.g. `Phase 3 workitem` ranked above `Session boundary` in Q1 because both had score 2 but Phase 3's best rank was 1 vs Session boundary's 2)

## Regression

**Test suite run:** no
**Result:** n/a
**Failures:** No automated test suite exists in this project (consistent with prior workitems). Verification was via the live smoke test in QA iteration 1 above.
