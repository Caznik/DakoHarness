---
wi: WI-local-embedding-recall
phase: review
status: confirmed
date: 2026-05-26
verdict: pass
---

## AC Verification

| AC | Description | Satisfied | Evidence / Notes |
|---|---|---|---|
| AC-1 | `DAKO_EMBEDDING_MODEL` selects model; lazy download; default `Xenova/all-MiniLM-L6-v2` | yes | `embed.ts:41–45` reads `process.env["DAKO_EMBEDDING_MODEL"]` at call time. Tests `embed.test.ts::getModelId returns default…` and `…returns env value when set` verify both branches. Dynamic `import("@xenova/transformers")` inside the lazy-load promise = lazy download. |
| AC-2 | New `embedding` + `embedding_model` fields; existing rows still readable | yes | `SqliteStorage.ts:155–167` runs `ALTER TABLE memories ADD COLUMN embedding BLOB` / `embedding_model TEXT` inside the `addColumnIfMissing` helper that absorbs the "duplicate column name" error. `MongoStorage.ts:65–68` adds `createIndex({embedding_model: 1})`. `recall-hybrid.test.ts::[sqlite] inline embed happy path` and `[mongo] remember inline-embeds the row` verify the columns are populated post-`remember`. |
| AC-3 | Inline embed on `remember`; failure → insert succeeds, warn, null fields | yes | `SqliteStorage.ts:172–188` and `MongoStorage.ts:82–100` wrap `embedTexts` in try/catch. On failure: `console.error("[embed] inline embed failed for …")` and leave both fields null. `recall-hybrid.test.ts::[sqlite] inline embed failure — remember still inserts with null fields` asserts the exact contract. |
| AC-4 | `recall` accepts `mode` + `embedding`; auto-detect; `mode: "vector"` errors on no embeddings | yes | Auto-detect probe in both adapters' `recall` (`SqliteStorage.recall` + `MongoStorage.recall`) — checks for any matching-model embedding before deciding hybrid vs keyword. `recall-hybrid.test.ts::[sqlite] auto-detect: keyword when no embeddings exist` and `[sqlite] mode=vector throws helpful error when no embeddings exist` cover both paths. `server.ts:198–211` decodes base64 `embedding` to Buffer at the server boundary. |
| AC-5 | Hybrid = RRF k=60, equal weights, 2×limit candidates per side | yes | `embed.ts::rrfMerge` implements `score = 1/(60+rank_fts) + 1/(60+rank_vec)`. Tests `embed.test.ts::rrfMerge produces expected order on synthetic ranked inputs` (hand-computed) and `recall-hybrid.test.ts::[sqlite] hybrid mode merges FTS and vector with RRF` (end-to-end through SqliteStorage). |
| AC-6 | Single-side fallback: empty FTS or empty vector → other side's order | yes | `embed.test.ts::rrfMerge single-side fallback: empty FTS returns vector order` + `…empty vector returns FTS order` + `…both-empty returns empty`. End-to-end: `recall-hybrid.test.ts::[sqlite] single-side fallback: FTS-empty query returns vector order`. |
| AC-7 | In-process cosine over Float32 buffers; no native vector index | yes | `embed.ts::cosine` does dot-product over Float32Arrays (vectors are unit-norm by `pooling:"mean", normalize:true`). No `sqlite-vec`/Atlas `vectorSearch` import anywhere in the WI's code. Tests `embed.test.ts::cosine of identical unit vectors is 1, orthogonal is 0, opposite is -1` and `floatsToBytes / bytesToFloats round-trips` lock the math. |
| AC-8 | Vector half excludes mismatched-model rows; FTS half unaffected | yes | Both adapters' vector-side `WHERE`/filter includes `embedding_model = currentModel`. `recall-hybrid.test.ts::[sqlite] vector half excludes mismatched embedding_model (AC-8)` and `[mongo] inline embed + vector recall with mismatched-model exclusion` seed mixed-model rows and assert only the matching one is returned by vector mode. |
| AC-9 | `npm run embed-backfill` walks all rows; skips matching, embeds rest; final summary | yes | `embed-backfill.ts` mirrors migrator pattern: dotenv → validate backend → batch-iterate `memories`. Test `embed-backfill.test.ts::default run embeds missing rows; skips already-embedded ones` seeds 5 rows (2 pre-embedded), asserts all 5 embedded post-run with correct skip/embed counts. |
| AC-10 | `--dry-run`, `--force`, unknown-flag handling | yes | `embed-backfill.test.ts::--force re-embeds every row regardless of model match` + `…--dry-run performs no writes` + `…unknown flag exits non-zero` — three dedicated tests. |
| AC-11 | Idempotent re-run on fully-embedded DB | yes | `embed-backfill.test.ts::re-run on fully-embedded DB is idempotent (AC-11)` — explicit test asserting `0 embedded, 5 skipped, exit 0`. |
| AC-12 | `/recall` skill: embed_query preflight + threaded `embedding` arg | yes | All three skill mirrors (`.claude/commands/recall.md`, `commands/recall.md`, `claude-plugin-release/commands/recall.md`) carry Step 3.5 + Step 4 passthrough. `server.ts:179–187` registers the `embed_query` MCP tool. No automated test for slash command behavior (consistent with how the previous query-expansion shipped). |
| AC-13 | `Storage.recall` back-compat: no `mode`/`embedding` + no embeddings = today's output | yes | `RecallArgs` widened with **optional** fields only (no required fields added). `recall-hybrid.test.ts::[sqlite] auto-detect: keyword when no embeddings exist; vector excluded silently` calls `recall` with the today-shaped arg set and asserts FTS-only result format. |
| AC-14 | Test suite stubs the model (no CI download); covers all listed paths | yes | 26 tests across `embed.test.ts` (13), `embed-backfill.test.ts` (5), `recall-hybrid.test.ts` (9). All gated on `DAKO_EMBED_STUB=1` deterministic fake — no real model download. Mongo branches in `recall-hybrid.test.ts` reachability-skip on no-Mongo CI. |

**Result: 14/14 satisfied.**

## Plan Coverage

| Step | Implemented | Notes |
|---|---|---|
| Step 1 — `embed.ts` shared module + dependency | yes | `embed.ts` ships `getModelId`, `embedTexts`, `floatsToBytes`/`bytesToFloats`, `cosine`, `rrfMerge`, `stubEmbed`, and `EMBED_STUB_KEY`. `package.json` declares `@xenova/transformers` dep. |
| Step 2 — Extend `Storage` interface; fill AC-9 reservation | yes | `RecallArgs` widened with `mode?` + `embedding?`; `EmbedQueryArgs` + `embedQuery()` added to the interface; AC-9 extension-point comment and AC-10 mapping table updated. |
| Step 3 — `SqliteStorage`: schema migration + inline embed + tri-mode recall | yes | All three sub-features present. `addColumnIfMissing` helper instead of two inline try/catches (minor refactor). |
| Step 4 — `MongoStorage`: same shape as Step 3 | yes | Index added in factory; inline embed in `remember`; tri-mode recall with `vectorFetchLimit = Math.max(500, 2×limit)`. |
| Step 5 — `server.ts`: register `embed_query`; widen `recall` schema | yes | New tool + route; recall schema gains `mode` and `embedding` (base64); server decodes to Buffer before adapter call. |
| Step 6 — `embed-backfill.ts` one-shot script | yes | npm-run script wired; `--dry-run`, `--force`, per-batch error isolation; final summary; correct exit codes. |
| Step 7 — `/recall` skill update (three mirrored copies) | yes | All three files carry the new preflight + passthrough. |
| Step 8 — Tests | yes | 3 new test files; 26/26 pass. Real-model test omitted by design (stub seam covers code paths). |

**Result: 8/8 plan steps implemented.**

## Deviations Review

| Step | Deviation | Assessment |
|---|---|---|
| 3 | Auto-detect probe respects `include_team` (extends WHERE to `(project = ? OR scope = 'team')`) | **Acceptable — strengthens AC-4.** Plan didn't specify the team-scope interaction with the probe; the implementer picked the obvious-and-correct answer (probe uses the same scope filter as the rest of recall). Without it, team-scoped embeddings would be invisible to auto-detect. |
| 3 | `addColumnIfMissing(sql)` helper around the ALTER TABLE try/catch | **Acceptable — pure refactor.** Same behavior; eliminates duplicated try/catch. |
| 3 | Vector fetch limit guarded with `Math.max(2 × limit, 1)` | **Acceptable.** Defensive guard for `limit = 0`; never observable in practice but free. |
| 4 | Mongo `vectorFetchLimit = Math.max(500, 2 × limit)` | **Acceptable — matches plan.** Not a deviation; plan specified this verbatim. |
| 5 | Server boundary treats empty-string `embedding` as omitted | **Acceptable.** Defensive — accepts `null`/`""`/omitted interchangeably, all valid "no embedding" signals from the skill. |
| 6 | Mongo backfill `bulkWrite({ordered: false})` | **Acceptable — aligns with plan intent.** Plan specified per-chunk error isolation; `ordered: false` is the canonical way to express that on `bulkWrite`. |
| 8 | Test seam for inline-embed failure: unset `DAKO_EMBED_STUB` + bad model path (not monkey-patch) | **Acceptable.** ESM module cache prevents the plan's literal "monkey-patch embedTexts" approach without dependency injection. The implementer found an equivalent failure surface that exercises the same try/catch branch. No source-code seam needed. |
| — | Pre-existing tsc errors not fixed (`better-sqlite3` no types, `@xenova/transformers` not installed, `server.ts` strict ServerResult) | **Acceptable — out of scope.** Same exclusion as WI-sqlite-to-mongo-migration's review. `tsc` still emits JS; all 26 tests pass. These would need a real `npm install` (no-network sandbox); tracked separately. |

## Gaps

None.

## Verdict
**Result:** pass
**Accepted gaps:** none

## Confirmation
**Confirmed by user:** yes
**Notes:** Signed off 2026-05-26.

## Cancellation
*(Fill only if status: cancelled)*
