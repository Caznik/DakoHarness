---
name: recall
description: "Search long-term memory with query expansion — agent generates paraphrased variants and merges results. Usage: /recall <keywords>"
---

Search long-term memory for context relevant to the keywords the user provided, using agent-side query expansion so paraphrased queries still find the right memories. Behavior is governed by the **Memory Query Expansion** protocol in `CLAUDE.md`.

## Steps

1. Determine the project name: use the `DAKO_PROJECT` environment variable if set, otherwise use the basename of the current working directory.

2. If no keywords were provided in args, ask the user what they want to search for before proceeding.

3. **Generate variants.** Produce up to **5 total queries** — the original plus 1-4 paraphrases. A useful paraphrase varies the surface form while preserving intent:
   - Synonyms: "save" ↔ "store" ↔ "persist" ↔ "remember"
   - Different specificity: "memory" ↔ "long-term memory" ↔ "MongoDB memories"
   - Inverse framing: "how do I X" ↔ "X tooling"
   Skip trivial variants (singular/plural only) — they add cost without adding coverage.

3.5. **Embed once for the vector side.** Call the `embed_query` MCP tool with `text = <original user keywords, un-expanded>`. Parse the returned JSON to extract the `embedding` field (a base64 Float32 vector). If the call errors (e.g. embeddings not configured on this server), proceed with `embedding = null` — the keyword path still works.

4. **Run all variants.** For each variant, call the `recall` tool with:
   - `project`: the project name from step 1
   - `query`: the variant
   - `limit`: 5
   - `embedding`: the value from step 3.5 (only if present; omit otherwise). The server handles per-call cross-side hybrid fusion automatically when an embedding is supplied.

5. **Merge results** using rank-based fusion:
   - Dedup key: `[TYPE] title` (the prefix the MCP emits, e.g. `[DECISION] Use MongoDB`)
   - Score per memory: number of variants where it appeared
   - Tie-break: best (lowest) rank across the variants where it appeared
   - Sort descending by score, then ascending by best rank

6. **Present** the top 5-10 merged results grouped by memory type (DECISION, CONVENTION, BUG, CONTEXT, LESSON). Show the title and content clearly. You may note variant coverage (e.g. "matched 3/5 variants") to signal confidence.

7. If all variants return nothing, say so plainly and suggest the user proceed without prior context — do not invent or infer memories that weren't returned.
