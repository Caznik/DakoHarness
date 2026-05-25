---
wi: WI-semantic-recall/20260525-embedding-search
phase: propose
status: confirmed
date: 2026-05-25
triggered: no
---

## Approach A — Skill-side expansion with documented protocol in CLAUDE.md

**Summary:**
Update the `/recall` skill to generate up to 5 keyword variants (original + 1-4 paraphrases), call the existing `recall` MCP tool once per variant (in parallel where possible), then merge/dedupe/score results client-side. Add a parallel section to `CLAUDE.md` describing the expansion protocol so agent-initiated `recall` and `find_patterns` calls follow the same pattern without needing a dedicated skill. No MCP server changes.

**Pros:**
- Satisfies AC-6 literally — `recall` and `find_patterns` MCP schemas stay unchanged.
- All expansion logic lives in editable markdown (skill + CLAUDE.md) — no code deploys, no MCP server restart, fast to iterate.
- Future swap to local embeddings (option D) only touches the MCP write/query path; the skill protocol layer can stay or be repurposed.
- STM parity via CLAUDE.md description, not by duplicating skill files.
- Zero new dependencies; works on any DakoHarness install today.

**Cons:**
- Variant generation is non-deterministic — same query may produce different variants across runs. Mitigated by clear variant guidance in the skill instructions.
- N round-trips per recall instead of 1 (where N ≤ 5). At MongoDB-local latency this is sub-second; not a real concern but worth noting.
- Behavior depends on agent fidelity to the skill instructions; a different agent (future OpenCode/Pi target) will need its own equivalent prompt.

**Effort:** low

---

## Why this is the only viable approach

The analyze ACs constrain the design enough that no other meaningful path exists:

- **AC-6** ("MCP schemas unchanged") rules out a server-side multi-query variant of `recall`/`find_patterns`.
- **AC-3** ("STM follows the same protocol via CLAUDE.md") rules out a separate dedicated `/search` skill — the agent's own searches must use the protocol too, so it has to live in CLAUDE.md regardless.
- **AC-5** ("zero new dependencies") rules out caching layers, vector stores, or any new service.

The remaining choice — whether to keep the protocol in CLAUDE.md alone, in the `/recall` skill alone, or in both — is a writing decision, not an architectural one. Best practice: protocol lives in CLAUDE.md (single source of truth), `/recall` skill references it for the user-invoked path.

## Selected Approach

**Choice:** Approach A
**Rationale:** Only viable design given the analyze ACs. No real trade-off to surface; documenting it formally so the plan phase has a clear anchor.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** propose
**Reason:**
