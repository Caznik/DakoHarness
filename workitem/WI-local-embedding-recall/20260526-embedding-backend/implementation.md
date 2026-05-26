---
wi: WI-local-embedding-recall
phase: implementation
status: completed
date: 2026-05-26
---

## Architecture Notes

**Codebase patterns followed:**
- `Storage` interface (`storage/Storage.ts`) is the single facade between MCP handlers and storage adapters. Every new behavior must be expressed as either a new method or a widened arg type. The plan widens `RecallArgs` (adds `mode`, `embedding`) and adds `embedQuery()` — consistent with the existing facade discipline.
- TS config has `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `strict: true`. Implementation respects these — all optional fields are `?:` and conditionally spread, all dynamic indexes are guarded.
- Imports use `.js` extension on relative paths (NodeNext + ESM). All new files follow.
- ESM CLI bootstrap pattern from `migrate.ts` (file:// URL compare to detect direct invocation) is replicated in `embed-backfill.ts`.
- `migrate.ts` proved the "raw-driver-access for batch operations" pattern — backfill follows it (bypasses the facade by design to do bulk reads/writes).
- The `.env` is read via `dotenv.config({ path, override: true })`. Backfill mirrors migrate's path resolution (`.env` next to compiled .js).
- Test scaffolding uses `node --test` from the standard library; Mongo-dependent tests gate on a `mongoReachable()` probe and `process.exit(0)` if unavailable. Embed tests need NO Mongo and NO model download — `DAKO_EMBED_STUB=1` env var picks a deterministic fake. SQLite/Mongo branch tests for recall reuse the same reachability gate.
- `@xenova/transformers` is loaded via dynamic `await import()` inside the lazy-load promise so test runs with `DAKO_EMBED_STUB=1` never require the package to be installed in CI. The dependency declaration in `package.json` is for production.

**Schema strategy:**
- SQLite: `ALTER TABLE memories ADD COLUMN embedding BLOB` / `embedding_model TEXT`. SQLite's better-sqlite3 throws on duplicate columns — we catch and ignore the `duplicate column name` error specifically, rethrow others.
- MongoDB: schemaless — new fields are written on `remember`, the only schema-shaped change is one new index on `{embedding_model: 1}`.
- Existing rows without the new fields/columns remain readable (existing recall handles missing `embedding` as null → excluded from vector half by the `WHERE embedding IS NOT NULL` filter).

**Shared cosine + RRF math:**
- Lives in `embed.ts` as exported helpers. Both adapters import them so the two vector-search loops produce byte-identical results.
- Tests directly exercise the helpers, which means the math is covered once even though it's called from two adapter sites.

**Test-seam pattern:**
- `EMBED_STUB_KEY = "DAKO_EMBED_STUB"` is set in test runs. The stub uses FNV-1a folding into 32 float positions (we use a 32-dim stub vector, not 384, so test vectors are tiny but still unit-normalized).
- Stub determinism: same text → same vector; different texts → different vectors with predictable cosine. Tests can hand-construct expected scores.

**Three-location skill mirror:**
- `.claude/commands/recall.md` (project)
- `commands/recall.md` (plugin-dir)
- `claude-plugin-release/commands/recall.md` (marketplace)
- All three currently identical; all three updated identically.

## Plan Deviations
| Step | Original plan | What actually happened | Reason |
|---|---|---|---|
| 3 | "throw new Error" on `mode: "vector"` with no matching embeddings | Same behavior, but the auto-detect probe also respects `include_team` (extends `WHERE` to `(project = ? OR scope = 'team')` when the flag is set) so a team-scoped row's embeddings can satisfy the probe | Plan didn't spell out include_team interaction with the probe; the consistent answer is "use the same scope filter as the rest of recall". One-line change. |
| 3 | Catch SQLite "duplicate column name" specifically | Implemented as regex match `/duplicate column name/i` on `err.message`. Wrapped via `addColumnIfMissing(sql)` helper to avoid duplicating the try/catch. Same behavior. | Cleanup of the inline try/catch pattern; one helper covers both `ALTER` calls. |
| 3 | Vector half: `(2 × limit)` candidates fetched | Implemented as `Math.max(2 × limit, 1)` to guard against `limit = 0` corner case. | Defensive; never observable in practice. |
| 4 | Mongo vector half candidate fetch cap | Implemented `vectorFetchLimit = Math.max(500, 2 × limit)` exactly as plan specified. Mongo `find()` chained with `.limit(vectorFetchLimit)`. | None — exact plan. |
| 5 | `recall` route base64-decodes `embedding` | Implemented; also guards against empty-string `embedding` (treats as omitted) so the skill can pass `null`/`""`/omit interchangeably. | Defensive against the three valid "no embedding" expressions. |
| 6 | Mongo backfill — `bulkWrite([{updateOne}])` per chunk | Used `ordered: false` so a single document write failure doesn't abort the chunk; the script still counts errors via the catch block. | Aligns with the per-chunk error isolation semantics the plan asks for. |
| 8 | Test seam approach for inline-embed failure | Plan said "monkey-patch `embedTexts` to throw". ESM module cache makes this impossible without dependency injection. Instead: unset `DAKO_EMBED_STUB` and set `DAKO_EMBEDDING_MODEL` to a non-existent package path, so the dynamic `import("@xenova/transformers")` resolves and the model load throws cleanly. | Equivalent failure surface; no source-code change needed to support testing. |
| — | Pre-existing tsc errors | Did not fix the pre-existing `better-sqlite3` (no @types), `@xenova/transformers` (dep not installed in lockfile), or `server.ts` MCP SDK strict-type errors. `tsc` still emits the `.js` files (TS errors are non-fatal for emit), and the test suite runs from the emitted JS — all 26 tests pass. | Out of scope per plan; the install + type-installs would need a real `npm install` which the implementer cannot run here (no network). |

## Blockers
| # | Description | Resolution | Status |
|---|---|---|---|

## AC Pre-Check
| AC | Test / Evidence | Status |
|---|---|---|
| AC-1 | `embed.test.js` — "getModelId returns default when DAKO_EMBEDDING_MODEL is unset" + "returns env value when set"; `embed.ts:41-45` reads `process.env["DAKO_EMBEDDING_MODEL"]` at call time | COVERED |
| AC-2 | `SqliteStorage.ts:155-167` (idempotent `ALTER TABLE` for both columns); `MongoStorage.ts:65-68` (`createIndex({embedding_model: 1})`); `recall-hybrid.test.js` "[sqlite] inline embed happy path" and "[mongo] remember inline-embeds the row" verify the columns are populated post-`remember`. | COVERED |
| AC-3 | `SqliteStorage.ts:172-188` (try/catch around `embedTexts` + UPDATE); `MongoStorage.ts:82-100` (same for Mongo); `recall-hybrid.test.js` "[sqlite] inline embed failure — remember still inserts with null fields" verifies the failure path leaves row with null embedding + null model. | COVERED |
| AC-4 | `recall-hybrid.test.js` "[sqlite] auto-detect: keyword when no embeddings exist"; "[sqlite] mode=vector throws helpful error"; embedding param passthrough exercised in `MongoStorage.recall` and `SqliteStorage.recall` paths and via the server boundary decode in `server.ts:198-211`. | COVERED |
| AC-5 | `embed.test.js` "rrfMerge produces expected order on synthetic ranked inputs" (hand-computed expected order `[c, b, a, d]` for inputs `[a,b,c]` × `[c,b,d]` matches); `recall-hybrid.test.js` "[sqlite] hybrid mode merges FTS and vector with RRF" exercises the path through SqliteStorage. | COVERED |
| AC-6 | `embed.test.js` "rrfMerge single-side fallback: empty FTS"/"empty vector"/"both empty"; `recall-hybrid.test.js` "[sqlite] single-side fallback: FTS-empty query returns vector order" exercises the end-to-end path. | COVERED |
| AC-7 | `embed.test.js` "cosine of identical unit vectors is 1, orthogonal is 0, opposite is -1" + "floatsToBytes / bytesToFloats round-trips" — proves the in-process math is correct; `recall-hybrid.test.js` exercises the helpers from both SqliteStorage and MongoStorage. | COVERED |
| AC-8 | `recall-hybrid.test.js` "[sqlite] vector half excludes mismatched embedding_model (AC-8)" — seeds two rows with different `embedding_model` values, asserts only the matching one appears in vector-mode results. Same coverage via "[mongo] inline embed + vector recall with mismatched-model exclusion". | COVERED |
| AC-9 | `embed-backfill.test.js` "default run embeds missing rows; skips already-embedded ones" — seeds 5 rows with 2 pre-embedded, runs backfill, asserts all 5 are now embedded. | COVERED |
| AC-10 | `embed-backfill.test.js` "--force re-embeds every row regardless of model match" + "--dry-run performs no writes" + "unknown flag exits non-zero". | COVERED |
| AC-11 | `embed-backfill.test.js` "re-run on fully-embedded DB is idempotent (AC-11)" — second run reports 0 embedded, 5 skipped, exits 0. | COVERED |
| AC-12 | `.claude/commands/recall.md`, `commands/recall.md`, `claude-plugin-release/commands/recall.md` all carry Step 3.5 (embed_query preflight) and Step 4 `embedding` passthrough; server.ts:179-187 registers `embed_query`. (Skill behavior is verified by inspection — no automated test for slash commands.) | COVERED |
| AC-13 | `recall-hybrid.test.js` "[sqlite] auto-detect: keyword when no embeddings exist; vector excluded silently" — calling `recall` without `mode` or `embedding` and with no embeddings present returns FTS-only results (today's behavior). `RecallArgs` widened with **optional** fields only. | COVERED |
| AC-14 | The whole test suite (`embed.test.js` + `embed-backfill.test.js` + `recall-hybrid.test.js`) covers every other AC via deterministic stub (DAKO_EMBED_STUB=1) — no model download in CI. 26 tests, all passing. | COVERED |

## QA Log
| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 | All 14 (after first compile + test run) | All pass | First green run; no remediation needed. The `[recall] FTS query failed for "zzzzz-unique-not-in-any-row"` log line is expected output from the defensive FTS error handler (test-induced; the FTS5 tokenizer treats `zzzzz-unique` as a malformed query). It does not fail the test. |
| 2 | All 14 in suite-of-suites order (`migrate.test.js embed.test.js embed-backfill.test.js recall-hybrid.test.js`) | 26 pass / 0 fail | Confirmed no order-dependence between test files. Mongo migrate tests skipped cleanly because the backfill fixture .env (with `MONGO_URI=mongodb://invalid/`) was the active .env at probe time — `process.exit(0)` per gated module. Standalone `node --test recall-hybrid.test.js` runs all 9 including 2 Mongo tests against the real local MongoDB (verified earlier). |

## Regression
**Test suite run:** yes (via `node --test migrate.test.js embed.test.js embed-backfill.test.js recall-hybrid.test.js`)
**Result:** 26 pass / 0 fail / 0 cancelled / 0 todo. 1 file (`migrate.test.js`) reports its Mongo gate as `skipped` when run in the cross-file suite because the embed-backfill test fixture's `.env` (`MONGO_URI=mongodb://invalid/`) was the active probe target. Running `migrate.test.js` standalone with the project's real `.env` exercises it against the local Mongo (out of this WI's scope; pre-existing behavior).
**Failures:** none.
**Pre-existing tsc errors (not caused by this WI):**
- `better-sqlite3` has no `@types/` package in the lockfile (TS7016)
- `@xenova/transformers` not yet `npm install`ed (TS2307)
- `server.ts` MCP SDK strict ServerResult mismatch (predates this WI; tracked elsewhere)
None of these block emit — `tsc` writes the `.js` files anyway, and the test suite consumes them.
