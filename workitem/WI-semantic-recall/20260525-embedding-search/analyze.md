---
wi: WI-semantic-recall/20260525-embedding-search
phase: analyze
status: confirmed
date: 2026-05-25
---

## Requirements

1. **Agent-side query expansion** — when the user (or agent) searches memory, the query is expanded into multiple keyword variants and all are run against the existing keyword index. No embedding model, no API key, no new infrastructure.
2. **Variant generation** — the agent generates up to 5 variants per call: the original query plus 1-4 paraphrases that cover synonyms, alternative phrasings, and related concepts.
3. **Hybrid result model** — results from all variants are merged, deduped, and ranked by combined match score (sum of per-variant scores). Original `recall` MCP tool surface stays the same; expansion lives in the skill layer.
4. **Both memory tiers** — expansion applies to both LTM (`/recall` skill, `recall` MCP tool) and STM (`find_patterns` MCP tool). The expansion protocol is documented in `CLAUDE.md` so any agent-initiated memory search also uses it.
5. **Graceful behavior** — there is no "service" to fail. If a variant returns nothing, the remaining variants still produce results. If all return nothing, behavior matches today's `recall`.
6. **No new dependencies** — fully offline, works on any setup that runs DakoHarness today. Zero added install footprint.
7. **Future-friendly** — the architecture must not paint us into a corner. A later switch to local embeddings (option D) should be addable without breaking the skill or the MCP contract.

## Out of Scope

- **Local embedding models** (Transformers.js, Ollama, sentence-transformers) — added to backlog as future enhancement; not delivered in this workitem.
- **Hosted embedding APIs** (Voyage, OpenAI, Cohere) — not pursued; conflicts with the self-hosted/no-key ethos.
- **Atlas Vector Search** or any vector store — not needed; no embeddings are stored.
- **Backfill of existing memories** — not needed; expansion is query-time only.
- **Changes to `remember` / `remember_pattern`** — write path is untouched.
- **Reranking via an LLM call** — merge is deterministic (dedupe + score sum). Agent does not re-read results to reorder.

## Open Questions

None at sign-off.

## Acceptance Criteria

- [ ] **AC-1** — The `/recall <query>` skill generates up to 5 keyword variants per call (original + 1-4 paraphrases) and runs each against the `recall` MCP tool.
- [ ] **AC-2** — Results from all variants are merged into a single set, deduped (by `title` + `type` for LTM; by content fingerprint for STM), and sorted by the sum of per-variant match scores, descending.
- [ ] **AC-3** — STM access via `find_patterns` follows the same expansion protocol. The protocol is described once in `CLAUDE.md` so agent-initiated calls (not just `/recall`) use it.
- [ ] **AC-4** — Manual smoke test: at least **3 paraphrased queries** against the live DakoHarness LTM return memories that the unexpanded keyword search misses or ranks much lower. The test queries and expected hits are recorded in `implementation.md` QA Log.
- [ ] **AC-5** — Zero new runtime dependencies. No model download, no API key, no environment variable. Works offline on a fresh DakoHarness install.
- [ ] **AC-6** — The variant cap (5) is enforced in the skill instructions, not as a hardcoded limit in the MCP tool. The MCP `recall` and `find_patterns` schemas are unchanged.
- [ ] **AC-7** — `README.md` Backlog updated: "Semantic search for recall" row is replaced by a new "Local embedding model for recall" entry preserving the option D path.
- [ ] **AC-8** — Documentation reflects the new behavior: `/recall` description in `README.md` slash commands table and `obsidian-docs/Slash Commands.md` /recall section both describe expansion.

## Interview Notes

- Initial pass framed this as embedding-based search. User pushed back: "not everyone can afford an embedding model or run one locally." Agent surfaced five real options (improved keyword, agent-side expansion, agent-side reranking, local embedding, hosted API). User picked **B (agent-side expansion)** and explicitly asked to **keep D (local embedding) in the backlog**.
- Hybrid query model confirmed — neither replace keyword nor add a separate `recall_semantic` tool. Expansion is invisible to callers.
- Scope explicitly extended to STM (`find_patterns`), not just LTM. Both tiers share the protocol via `CLAUDE.md`.
- Merge strategy chosen: dedupe + simple score sum, no agent reranking. Keeps behavior deterministic and cheap.
- Variant cap of 5 chosen for predictable cost and good coverage of common paraphrases.

## Sign-off

**Confirmed by user:** yes
**Date:** 2026-05-25

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** analyze
**Reason:**
