---
wi: WI-local-embedding-recall
phase: plan
status: confirmed
date: 2026-05-26
approach: (single direction — no /wi-propose phase needed; analyze pinned the shape)
---

## Context
**Selected approach:** Self-contained embedding wrapper module (`embed.ts`) shared between both Storage adapters and the new backfill script, with all model lifecycle (lazy load, singleton, model-id tracking) centralised there. Storage adapters store Float32 raw bytes per memory; in-app cosine over Float32 buffers for both backends (no `sqlite-vec`, no Atlas `vectorSearch` in v1). Server exposes one new MCP tool (`embed_query`) so the `/recall` skill can fetch a query embedding once and pass it to every variant call.

**Codebase notes from exploration:**
- `server.ts:195–212` hand-routes tool calls to `storage.<method>(args)` — adding `embed_query` means one new route plus one tool-list entry; updating `recall`'s schema means widening the existing entry.
- `Storage.ts:11–19` already reserved the AC-9 extension point comment block for this WI. The plan updates it to "filled in" and adds the two new fields to the AC-10 mapping table.
- `SqliteStorage.ts:68–154` runs schema init with `CREATE TABLE IF NOT EXISTS`. Adding columns is idempotent via `ALTER TABLE memories ADD COLUMN`, wrapped in try/catch to absorb the "duplicate column name" error on subsequent runs.
- `MongoStorage.ts:36–73` creates indexes in the factory. We add one new index `{embedding_model: 1}` here so the mismatch-skip filter is fast.
- `.claude/commands/recall.md:14–24` is the current skill — variant generation + N keyword `recall` calls + agent-side rank-fusion merge. The plan adds one preflight `embed_query` call and threads the embedding through each variant.
- The skill is mirrored at `commands/recall.md` (plugin-dir) and `claude-plugin-release/commands/recall.md` (marketplace) per the existing convention; all three need the same edit.
- `package.json` already proves the pattern for an npm-run-with-tsc script (the WI-sqlite-to-mongo-migration `migrate` entry). `embed-backfill` follows the same shape.

**Single new runtime dependency:** `@xenova/transformers` (~50MB installed; ONNX-Runtime-backed CPU inference). Model files are downloaded on first use to `node_modules/.cache/transformers/`.

**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14 (all 14).

## Implementation Sequence

### Step 1 — `embed.ts` shared module + dependency
**Satisfies:** AC-1, AC-3 (helper used by inline embed), AC-7 (cosine helper)
**Files:**
- `mcps/mongodb-memory/package.json` (add `@xenova/transformers`)
- `mcps/mongodb-memory/embed.ts` (new)
**Description:**
- Add `@xenova/transformers` to `dependencies`. Pin to a known-good minor (`^2.17.0` or similar — finalize at install time).
- Export from `embed.ts`:
  - `getModelId(): string` — returns `process.env["DAKO_EMBEDDING_MODEL"] ?? "Xenova/all-MiniLM-L6-v2"`.
  - `embedTexts(texts: string[]): Promise<Float32Array[]>` — lazy-loads the model behind a module-level singleton Promise; on first call writes one `[embed] loading <model>…` line to stderr; runs `pipeline("feature-extraction", model)`; calls the pipeline with `pooling: "mean", normalize: true` so vectors are unit-length; returns `Float32Array[]`.
  - `floatsToBytes(v: Float32Array): Buffer` and `bytesToFloats(b: Buffer): Float32Array` — raw bytes layout (4 × dim).
  - `cosine(a: Float32Array, b: Float32Array): number` — dot product (vectors are unit-norm by construction; no extra divide needed). Used by both adapters' vector-search loops.
  - `EMBED_STUB_KEY = "DAKO_EMBED_STUB"` and a test seam: if `process.env[EMBED_STUB_KEY]` is set, `embedTexts` falls back to a deterministic hash-based fake (`text → fixed vector via FNV-1a folding into the float positions`). This is what tests use so CI never downloads the real model.

### Step 2 — Extend `Storage` interface; fill the AC-9 reservation
**Satisfies:** AC-2 (interface-side mapping), AC-4 (signature), AC-13 (back-compat)
**Files:**
- `mcps/mongodb-memory/storage/Storage.ts`
**Description:**
- Widen `RecallArgs`:
  - `mode?: "keyword" | "vector" | "hybrid"` (optional; absent = auto-detect).
  - `embedding?: Buffer` (optional pre-computed query vector — Buffer here at the interface layer; the server boundary will decode base64).
- Add `EmbedQueryArgs` and `embedQuery(args: EmbedQueryArgs): Promise<ToolResult>` to the `Storage` interface.
- Replace the AC-9 extension-point comment block (currently in `Storage.ts:11–19`) with a "filled by WI-local-embedding-recall" note. Update the AC-10 mapping table for `memories` to include the two new fields: `embedding (Float32 bytes ↔ Buffer ↔ Binary subtype 0)`, `embedding_model (TEXT/string)`.
- No other interface methods change.

### Step 3 — `SqliteStorage`: schema migration + inline embed on remember + tri-mode recall
**Satisfies:** AC-2 (SQLite columns), AC-3 (SQLite inline embed + failure), AC-5 (RRF), AC-6 (single-side fallback), AC-7 (in-process cosine on SQLite), AC-8 (model-mismatch skip), AC-13 (back-compat)
**Files:**
- `mcps/mongodb-memory/storage/SqliteStorage.ts`
**Description:**
- In `create()` after the existing schema init, run two idempotent column adds inside try/catch: `ALTER TABLE memories ADD COLUMN embedding BLOB` and `ALTER TABLE memories ADD COLUMN embedding_model TEXT`. SQLite throws `SqliteError: duplicate column name` on subsequent runs — catch and ignore that one specific message; rethrow anything else.
- `remember()`: insert the row as today, capture `lastInsertRowid`. Then call `embedTexts([title + "\n" + content])`. On success: `UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?`. On embed failure (any throw): write a `[embed] inline embed failed for "<title>": <reason>` warning to stderr, leave both columns null, return the normal success ToolResult.
- New `embedQuery()`: returns `{ content: [{ type: "text", text: JSON.stringify({ embedding: <base64>, model: <id> }) }] }`. Server consumes the JSON.
- `recall()`: branch on `mode`. New helper `detectMode(project, suppliedMode)`:
  - If `suppliedMode` is set, return it (validated against the enum).
  - Else: `SELECT 1 FROM memories WHERE project = ? AND embedding_model = ? AND embedding IS NOT NULL LIMIT 1`. Found → `"hybrid"`. None → `"keyword"`.
  - For `mode = "vector"` with no matching embeddings → throw `Error("No embeddings for model '<id>' in project '<p>'. Run 'npm run embed-backfill' to embed existing memories.")`.
- Keyword half = the existing FTS5 code path, unchanged. Returns ordered list of rowids/rows.
- Vector half: load `query` embedding — if `args.embedding` is supplied, use it; else `embedTexts([query])`. Then `SELECT id, ..., embedding FROM memories WHERE project = ? AND embedding_model = ? AND embedding IS NOT NULL` (with optional type/include_team filters as today), compute cosine for each, take top `(2 × limit)` by score descending.
- Hybrid merge: fetch `(2 × limit)` from each side. Combine into a map keyed by row id. For each side, `rrf_part = 1 / (60 + rank)` (rank = 1 for top). Sum the two parts per row (missing side contributes 0). Sort by total desc, take top `limit`, render in the existing text format.
- Single-side fallback (AC-6): if FTS returns 0 or vector returns 0, the non-empty side's order is used directly (skip RRF math). Both empty → existing "No memories found" message.

### Step 4 — `MongoStorage`: same shape as Step 3 for MongoDB
**Satisfies:** AC-2 (Mongo fields), AC-3 (Mongo inline embed + failure), AC-5, AC-6, AC-7 (cosine on Mongo), AC-8, AC-13
**Files:**
- `mcps/mongodb-memory/storage/MongoStorage.ts`
**Description:**
- In `create()`, add `createIndex({ embedding_model: 1 })` so the mismatch-skip filter is server-side fast.
- `remember()`: do the existing `insertOne`. Then `embedTexts([title + "\n" + content])`. On success: `updateOne({_id: insertedId}, { $set: { embedding: new Binary(bytes, 0), embedding_model: getModelId() } })`. On failure: same stderr warning pattern as Step 3, leave fields out.
- `embedQuery()`: same shape as Step 3.
- `recall()`: same branching pattern. Keyword half = existing `$text` query, unchanged. Vector half: filter `{ project (or $or for include_team), embedding_model: currentModel, embedding: { $exists: true } }`, projection includes `embedding`. Pull candidates client-side, compute cosine via `bytesToFloats(doc.embedding.buffer)`, sort, take top `(2 × limit)`. Hybrid merge is identical to Step 3's RRF logic — factor it out into a shared helper in `embed.ts` or a private module-level function to keep the two adapters byte-identical on this math.
- Vector-half candidate-fetch limit: cap at `max(500, 2 × limit)` to keep memory bounded on large databases. Plan-phase choice; can be revisited.

### Step 5 — `server.ts`: register `embed_query` tool; widen `recall` schema
**Satisfies:** AC-1 (env exposed via embed_query), AC-4 (recall mode arg), AC-12 (skill can fetch the embedding)
**Files:**
- `mcps/mongodb-memory/server.ts`
**Description:**
- Widen the `recall` tool's `inputSchema.properties` to include:
  - `mode`: `{ type: "string", enum: ["keyword", "vector", "hybrid"], description: "Recall strategy. Default auto-detects: hybrid if embeddings exist, else keyword." }`
  - `embedding`: `{ type: "string", description: "Base64-encoded Float32 query embedding. If omitted, the server computes it from query." }`
- In the `recall` route, decode `args.embedding` from base64 to Buffer before calling `storage.recall(...)` (the interface takes Buffer, not base64).
- Register a new tool `embed_query`:
  - description: `"Compute an embedding for a query string using the configured DAKO_EMBEDDING_MODEL. Returns {embedding (base64 Float32), model (string)}. Used by the /recall skill to embed once and reuse across keyword variants."`
  - inputSchema: `{ type: "object", properties: { text: { type: "string" } }, required: ["text"] }`
- Add the route `if (name === "embed_query") return storage.embedQuery(args as any);`

### Step 6 — `embed-backfill.ts` one-shot script
**Satisfies:** AC-9, AC-10 (flags), AC-11 (idempotency)
**Files:**
- `mcps/mongodb-memory/embed-backfill.ts` (new)
- `mcps/mongodb-memory/package.json` (add `"embed-backfill": "tsc && node embed-backfill.js"` script)
**Description:**
- Mirror the migrate.ts pattern: load `.env` with `dotenv.config({ path, override: true })`, validate `DAKO_STORAGE_BACKEND`, open the matching backend directly via `better-sqlite3` or `mongodb`.
- Parse flags: `--dry-run`, `--force`. Unknown flag → exit 1 with one-line usage.
- BATCH = 32 (constant near the top; one place to tune).
- For SQLite path:
  - `SELECT id, title, content, embedding_model FROM memories ORDER BY id`
  - Iterate in 32-row chunks; per chunk: filter rows where `--force` is true OR `embedding_model != currentModel`; embed the surviving texts in one `embedTexts(batch)` call; for each result `UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?` (single transaction per chunk).
- For Mongo path:
  - `find({}, { projection: { _id: 1, title: 1, content: 1, embedding_model: 1 } })`
  - Cursor-iterate in 32-doc chunks; same filter; `bulkWrite([{ updateOne: { filter, update: { $set } } }, ...])`.
- Streamed progress: one line per chunk — `[batch N/total] embedded K, skipped M (running totals: …)`.
- Per-chunk error isolation: a thrown embed call for one chunk logs the error, increments error counter, continues to next chunk. (Different from the migrator's all-or-nothing semantics — backfill is repeatable, so partial progress is fine.)
- Final summary table: `rows-read | embedded | skipped | errors | duration_ms`. Exit 0 if errors == 0, exit 1 otherwise.
- `--dry-run`: same walk; print `would-embed N, would-skip M` per chunk; final summary with zero writes; exit 0.

### Step 7 — `/recall` skill update (three mirrored copies)
**Satisfies:** AC-12
**Files:**
- `.claude/commands/recall.md`
- `commands/recall.md` (plugin-dir mirror)
- `claude-plugin-release/commands/recall.md` (marketplace mirror)
**Description:**
- Insert a new Step 3.5 (between variant generation and the variant loop): "Call the `embed_query` MCP tool with `text = <original user keywords, un-expanded>`. Parse the returned JSON to extract `embedding`. If the call errors (e.g. embeddings not configured), proceed with `embedding = null` — the keyword path still works."
- Modify the variant `recall` call list (current Step 4): pass `embedding` argument on every call when present. The MCP server uses it server-side; the agent does not interpret it.
- No other skill behavior changes. The dedup/merge logic (current Steps 5–6) stays the same — server-side hybrid handles per-call cross-side fusion; agent-side fusion still aggregates across the keyword variants.

### Step 8 — Tests
**Satisfies:** AC-14, verification of every other AC
**Files:**
- `mcps/mongodb-memory/embed.test.ts` (new)
- `mcps/mongodb-memory/embed-backfill.test.ts` (new)
- `mcps/mongodb-memory/recall-hybrid.test.ts` (new — covers Storage.recall hybrid/vector/keyword for both backends; mongo-reachability-skip applies)
- `mcps/mongodb-memory/package.json` (`test` script already exists from the prior WI; new test files are picked up automatically by `node --test`)
**Description:**
- All tests run with `DAKO_EMBED_STUB=1` so `embedTexts` returns a deterministic fake (no model download in CI). The fake is exported from `embed.ts` so tests can also call it directly for setting up expectations.
- `embed.test.ts`: cosine math against known unit vectors; floats↔bytes round-trip; stub determinism (same input → same output); getModelId env reading.
- `recall-hybrid.test.ts`:
  - Seed Sqlite + (if reachable) Mongo with 6 memories: 3 embedded, 3 unembedded; 1 row with a deliberately wrong `embedding_model`.
  - `recall` with `mode: "keyword"` returns all FTS matches as today.
  - `recall` with `mode: "vector"` returns only embedded rows whose model matches; the wrong-model row is excluded.
  - `recall` with `mode: "vector"` against an empty embeddings set throws with a clear message.
  - `recall` with `mode = undefined` auto-detects: returns hybrid when embeddings exist; returns keyword when none do.
  - Hybrid: synthetic FTS rank and vector rank produce the expected RRF order (compute by hand: 1/(60+r_fts) + 1/(60+r_vec)).
  - Single-side fallback: a query that has 0 FTS hits but 2 vector hits returns the vector order.
  - Inline embed failure: monkey-patch `embedTexts` to throw; `remember` still succeeds; row has null embedding/model.
- `embed-backfill.test.ts`:
  - Seed Sqlite with 5 rows where 2 already have `embedding_model = current`.
  - Run backfill → 3 embedded, 2 skipped, 0 errors.
  - Re-run → 0 embedded, 5 skipped (AC-11 idempotency).
  - `--force` → 5 embedded, 0 skipped.
  - `--dry-run` → 0 writes; counts match the would-do plan.
  - Unknown flag → exit 1.

## Risks / Known Unknowns
1. **Transformers.js cold-start cost.** First embed after MCP boot loads the model (~1–3s CPU). Visible via the `[embed] loading…` log. If this turns out to hurt `remember` UX in practice, follow-up WI can add pre-warm-on-MCP-start. Not in v1 scope.
2. **`@xenova/transformers` install footprint.** ~50MB in `node_modules`. Worth a one-line note in the Setup Guide; otherwise inert.
3. **Test stub coverage vs. real model.** The deterministic fake exercises every code path but doesn't validate semantic quality. That's fine for AC tests — real-model quality is a manual smoke test the user does post-merge. Plan does NOT add a "real model" integration test in CI.
4. **SQLite `ALTER TABLE` race.** If two MCP processes open the same DB simultaneously at first startup, both might race the `ALTER TABLE`. SQLite serializes via the file lock, so one wins and the other catches "duplicate column name". The try/catch handles this. Probably never happens in practice (one MCP per project) but the safety net is free.
5. **MongoDB candidate-fetch memory.** For very large memory collections, pulling 2×limit (default 20 → 40 candidates) is fine. The cap at `max(500, 2×limit)` protects against pathological cases. If someone has >500 embedded memories for one project the vector search will sample only the first 500 the cursor returns — accuracy degrades. Worth noting; in practice DakoHarness collections are small.
6. **Mongo `Binary` ↔ Buffer interop.** The driver returns `Binary` instances on read; we extract `.buffer` to get a Node Buffer, then pass to `bytesToFloats`. Confirmed shape but worth eyeballing during implementation.
7. **Mixed-model state visibility.** A user who switches `DAKO_EMBEDDING_MODEL` mid-life ends up with two model populations in the DB. The recall path handles this (AC-8); the only signal to the user is the count divergence after `embed-backfill --force`. No explicit "mixed model warning" in v1.
8. **Skill files in three locations.** Standard sync convention — every previous WI that touched a skill faces the same chore. The plan calls out all three paths so the implementer can't miss one.

## Confirmation
**Confirmed by user:** yes
**Notes:** Signed off 2026-05-26.

## Cancellation
*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
