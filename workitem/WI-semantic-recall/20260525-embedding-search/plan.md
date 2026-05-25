---
wi: WI-semantic-recall/20260525-embedding-search
phase: plan
status: confirmed
date: 2026-05-25
approach: Approach A
---

## Context

**Selected approach:** Skill-side expansion with documented protocol in CLAUDE.md (only viable design under analyze ACs).
**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8

### Codebase notes from exploration

- All three `recall.md` skill files (in `commands/`, `.claude/commands/`, `claude-plugin-release/commands/`) are identical and trivial — they call the `recall` MCP tool once with the raw query and a hard limit of 5. They will all be updated to identical new content.
- `recall` MCP handler (`server.js:208`) uses MongoDB `$text` search with `textScore` projection and sorts by score — but **the formatted text output does not include the numeric score**. The skill therefore cannot do score-weighted merging; it must use rank-based fusion (count of appearances across variants, tie-break by best rank). This is the standard Reciprocal-Rank-Fusion-lite approach for merging ranked lists of unknown absolute scores.
- The dedup key for LTM is `[TYPE] title` (what the MCP emits and what `forget` matches on). For STM, exact format will be confirmed in implementation; CLAUDE.md will specify "content fingerprint" generically.
- CLAUDE.md already has section headers for Memory Protocol / Tool Reference / Workitem Workflow / Behavior Guidelines — the new expansion section fits cleanly between Tool Reference and Skill Registry.

## Implementation Sequence

### Step 1 — Update `/recall` skill with expansion logic
**Satisfies:** AC-1, AC-2, AC-6
**Files:**
- `commands/recall.md`
- `.claude/commands/recall.md`
- `claude-plugin-release/commands/recall.md`

**Description:**
Rewrite the three (identical) `/recall` skill files to add agent-side query expansion:

1. Determine project name (unchanged).
2. If no query provided, ask user (unchanged).
3. **New:** generate up to 4 paraphrase variants of the query — synonyms, related concepts, alternative phrasings. Combined with the original, cap total at **5 variants**. Include short guidance on what makes a useful variant (e.g. "rephrase 'how do I save patterns' as 'store recurring approaches', 'persist conventions', 'remember code styles'"). The cap lives in the skill instructions, not in any MCP code.
4. **New:** call the `recall` MCP tool once per variant with the same `project` and `limit: 5` per call.
5. **New:** merge results across variants using rank-based fusion:
   - Dedup key: `[TYPE] title` (the prefix the MCP emits)
   - Score per result: count of variants where it appeared
   - Tie-break: best (lowest) rank across the variants where it appeared
6. Present merged results grouped by type (unchanged), now sorted by combined score desc.
7. If all variants return nothing, behavior matches today's `recall`: report plainly, suggest proceeding without context.

Update YAML frontmatter `description` to reflect the new behavior: `"Search long-term memory with query expansion — generates paraphrased variants and merges results. Usage: /recall <keywords>"`.

### Step 2 — Add Memory Query Expansion protocol to CLAUDE.md
**Satisfies:** AC-3, AC-6
**Files:** `CLAUDE.md`

**Description:**
Insert a new section `## Memory Query Expansion` between `## Tool Reference` and `## Skill Registry`. The section describes the protocol so agent-initiated calls to `recall` (LTM) and `find_patterns` (STM) use it without needing a dedicated wrapper skill per tool.

Section contents:
- When to expand: any keyword-style memory search where the user's intent could be expressed in multiple ways.
- Variant generation: up to 5 total (original + up to 4 paraphrases). Guidance on what makes a useful variant.
- Execution: one call per variant against the same MCP tool.
- Merge for LTM (`recall`): dedup by `[TYPE] title`, rank-based score, tie-break by best rank.
- Merge for STM (`find_patterns`): dedup by content fingerprint (first 80 chars normalized — exact rule defined in implementation against the live STM output format), same rank-based score.
- Fallback: if a variant errors, skip it; remaining variants still produce results.

`/recall` skill file references this section by name rather than duplicating the protocol body. The cap is enforced by the protocol description.

### Step 3 — Update README.md backlog
**Satisfies:** AC-7
**Files:** `README.md`

**Description:**
In the Backlog table, replace the row `| Semantic search for recall | Embedding-based recall so vague or paraphrased queries find the right memories, not just exact keyword matches |` with `| Local embedding model for recall | Optional local embedding backend (e.g. Transformers.js, sentence-transformers) for true semantic search beyond agent-side query expansion |`. Keeps the door open for option D from the propose discussion.

### Step 4 — Update user-facing documentation
**Satisfies:** AC-8
**Files:**
- `README.md` (slash commands table)
- `obsidian-docs/Slash Commands.md` (/recall section)

**Description:**
- README slash commands table: update the `/dako:recall <keywords>` row description from "Search long-term memory for past decisions, conventions, and lessons" to "Search long-term memory with query expansion — agent generates paraphrases and merges results across variants".
- `obsidian-docs/Slash Commands.md` `/recall` section: replace the existing Steps block with a brief description of the new behavior — query expansion, rank-based merge, deduplication — and link to the `## Memory Query Expansion` section of CLAUDE.md (or the protocol summary if linking isn't natural in Obsidian context).

### Step 5 — Smoke test against live DakoHarness LTM
**Satisfies:** AC-4, AC-5
**Files:** `workitem/WI-semantic-recall/20260525-embedding-search/implementation.md` (QA Log table)

**Description:**
Run a side-by-side smoke test against the live DakoHarness LTM with at least 3 paraphrased queries that should historically miss or rank poorly:
- e.g. "how do I store recurring patterns" (vs. memories about `remember_pattern`)
- e.g. "stop adding extra credit lines to commits" (vs. the no-coauthored feedback memory)
- e.g. "where does session data go" (vs. memories about sessions/messages collections)

For each query, run:
1. Unexpanded — direct `recall` MCP call with the original query.
2. Expanded — via the updated `/recall` skill.

Pass condition: in at least 3 of the test queries, the expanded result surfaces a relevant memory that the unexpanded query missed or ranked significantly lower. Record query, unexpanded result count/titles, expanded result count/titles, and pass/fail per query in `implementation.md` QA Log.

AC-5 (zero new dependencies) is satisfied implicitly — no new packages, services, or env vars are introduced. The smoke test running successfully on the existing install is the evidence.

## Risks / Known Unknowns

| # | Risk | Mitigation |
|---|---|---|
| 1 | `recall` MCP doesn't expose numeric scores in its text output → can't do score-weighted merging | Use rank-based fusion (count of appearances + best-rank tiebreak) which works on order alone. Already designed in. |
| 2 | Variant quality is agent-dependent — same agent may produce shallow or near-duplicate variants on different runs | Skill instructions include concrete examples of good vs poor variants. If quality is visibly weak in the smoke test, tighten the guidance and re-test. |
| 3 | STM `find_patterns` output format may differ from `recall`, making the dedup rule ("first 80 chars normalized") wrong | Confirm during implementation by calling `find_patterns` once and inspecting output. Adjust the rule before writing CLAUDE.md. |
| 4 | Agent must generate variants + run N MCP calls + merge in one slash-command turn | This is a normal multi-tool turn. If the skill is unclear, iterate on phrasing — no architectural change needed. |
| 5 | `/recall` MCP currently called with `limit: 5` — multiplied by 5 variants is 25 max results before dedup. Could feel noisy in presentation. | Cap presented results to top 5-10 by merged score. Define in skill instructions. |

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
