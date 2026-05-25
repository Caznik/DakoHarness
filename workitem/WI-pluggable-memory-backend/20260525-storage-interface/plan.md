---
wi: WI-pluggable-memory-backend/20260525-storage-interface
phase: plan
status: confirmed
date: 2026-05-25
approach: Approach A — Domain-method facade
---

## Context

**Selected approach:** Domain-method facade — one method per MCP tool operation, two adapters (MongoStorage, SqliteStorage), backend selected by `DAKO_STORAGE_BACKEND` env var.

**AC coverage:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12 *(all 12 covered)*

**Codebase notes from exploration:**
- LTM MCP currently hand-maintains both `server.ts` and `server.js` (no build script in `package.json`; `.mcp.json` runs `server.js` directly). The dual-source pattern will be inherited by the new storage modules.
- `logger.mjs` is a third entry point — independent MongoClient connection, used by hooks for session logging. Must also route through the abstraction (AC-7).
- `get_context` is single-collection (memories only) — no multi-collection join to abstract.
- No existing test suite (`"test": "echo ... exit 1"`). AC verification will be a manual call matrix recorded in `implementation.md`, consistent with prior workitems.
- 4 indexes currently created at server startup: `memories.{title,content}` text, `memories.scope`, `workitems.{project,wi_path}` compound, `workitems.documentation` text. Index creation will move into the MongoStorage constructor.

## Implementation Sequence

### Step 1 — Define `Storage` interface
**Satisfies:** AC-1, AC-9, AC-10
**Files:**
- `mcps/mongodb-memory/storage/Storage.ts` (new)
- `mcps/mongodb-memory/storage/Storage.js` (new — hand-mirror per existing dual-source convention)

**Description:**
TypeScript interface with exactly 12 methods, one per current MCP tool: `remember`, `recall`, `getContext`, `promoteToTeam`, `forget`, `listMemories`, `archiveWorkitem`, `startSession`, `logMessage`, `getSession`, `listSessions`, `getSystemStatus`. Plus one helper used by the hook logger: `nextMessageSeq(session_id)` (currently inlined as `countDocuments({session_id})`). Each method returns the same shape the existing MongoDB handlers return (typed via shared `MemoryRecord`, `WorkitemRecord`, `SessionRecord`, `MessageRecord` types).

Top-of-file design-note comment block covers:
- **AC-9 hook:** "Vector-search extension point — `recall` args may grow an optional `embedding?: number[]` and `mode?: 'keyword' | 'vector' | 'hybrid'` in a future workitem without breaking the interface."
- **AC-10 field-mapping table:** explicit ASCII table mapping each MongoDB document field to the SQLite column it corresponds to (with type translations like `Date` → `TEXT` ISO-8601).

### Step 2 — Implement `MongoStorage` adapter
**Satisfies:** AC-2, AC-5 (Mongo path), AC-6 (Mongo path), AC-7 (Mongo path)
**Files:**
- `mcps/mongodb-memory/storage/MongoStorage.ts` (new) + `.js` mirror

**Description:**
Wraps existing MongoDB driver usage. Constructor opens MongoClient (using `MONGO_URI` / fallback fields from `.env`), creates the 4 existing indexes, holds collection refs. Each interface method calls the exact same operations currently in `server.ts` handlers — behavior identical, just relocated.

### Step 3 — Implement `SqliteStorage` adapter
**Satisfies:** AC-3, AC-5 (SQLite path), AC-6 (SQLite path), AC-7 (SQLite path), AC-9 (schema design), AC-10 (field preservation)
**Files:**
- `mcps/mongodb-memory/storage/SqliteStorage.ts` (new) + `.js` mirror
- `mcps/mongodb-memory/package.json` (add `better-sqlite3` dependency)

**Description:**
Uses `better-sqlite3`. Constructor:
1. Reads `DAKO_SQLITE_PATH` (default `.dako/memory.db`). Creates `.dako/` with `mkdirSync({ recursive: true })`.
2. Runs schema-init SQL idempotently (`CREATE TABLE IF NOT EXISTS …`).
3. Schema:
   - `memories` (id INTEGER PK, project TEXT, agent TEXT, type TEXT, title TEXT, content TEXT, tags TEXT JSON, scope TEXT, timestamp TEXT ISO, plus future-reserved column placeholders documented in comments — no extra columns created until needed).
   - `memories_fts` FTS5 virtual table on `title, content` with content-rowid linkage.
   - `workitems` (id INTEGER PK, wi_path TEXT, project TEXT, username TEXT, git_commit TEXT, documentation TEXT, archived_at TEXT ISO).
   - `workitems_fts` FTS5 on `documentation`.
   - `sessions` (session_id TEXT PK, project TEXT, agent TEXT, cwd TEXT, started_at TEXT ISO).
   - `messages` (id INTEGER PK, session_id TEXT, role TEXT, content TEXT, seq INTEGER, timestamp TEXT ISO; index on (session_id, seq)).
4. Each interface method maps to prepared SQL statements (synchronous — better-sqlite3 is sync).
5. ID translation: SQLite INTEGER rowids surface to callers as stable string IDs (`"mem-<rowid>"`), preserving the abstraction's `string` ID contract.

### Step 4 — Storage factory + backend selection
**Satisfies:** AC-4, AC-8 (default-mongodb path)
**Files:**
- `mcps/mongodb-memory/storage/factory.ts` (new) + `.js` mirror

**Description:**
Reads `process.env.DAKO_STORAGE_BACKEND`:
- unset or `mongodb` → instantiate and return `MongoStorage` (singleton-cached).
- `sqlite` → instantiate and return `SqliteStorage` (singleton-cached).
- any other value → throw `Error("Invalid DAKO_STORAGE_BACKEND='<value>'. Allowed values: mongodb, sqlite")`. The MCP server's startup catches and prints this to stderr, then exits non-zero.

Also exposes a `closeStorage()` helper so the logger can clean up its connection between invocations.

### Step 5 — Rewire `server.ts` / `server.js` handlers
**Satisfies:** AC-1, AC-2, AC-3, AC-8 (transparent for existing users)
**Files:**
- `mcps/mongodb-memory/server.ts` (modified) + `server.js` (mirror)

**Description:**
- Replace every `db.collection(...)` call site (12 tool handlers) with `storage.<method>(args)`.
- Remove direct `MongoClient` management; replace startup with `const storage = await getStorage();`.
- Remove the 4 explicit `createIndex` calls — they move into MongoStorage's constructor.
- Top-of-file imports lose `mongodb` (only used by adapters now); imports add `./storage/factory.js`.
- All MCP tool registrations and return shapes stay byte-identical from a caller's perspective.

### Step 6 — Rewire `logger.mjs` (hooks entry point)
**Satisfies:** AC-7
**Files:**
- `mcps/mongodb-memory/logger.mjs` (modified)

**Description:**
- Replace direct `MongoClient` import + collection access with `import { getStorage, closeStorage } from "./storage/factory.js"`.
- The session-id state file (`getSessionFile`, `loadSessionState`, `saveSessionState`) is untouched — that logic is storage-agnostic.
- "Ensure session" block now calls `storage.startSession({session_id, project, agent, cwd})` only on the new-conversation branch; `storage.nextMessageSeq(session_id)` for the seq counter; `storage.logMessage({session_id, role, content})` for both UserPromptSubmit and Stop events.
- `closeStorage()` in the `finally` (idempotent — Mongo closes, SQLite is a no-op since better-sqlite3 connections are cheap).

### Step 7 — Update `/dako:setup` skill
**Satisfies:** AC-11 (setup portion)
**Files:**
- `commands/setup.md` (modified)
- `.claude/commands/setup.md` (mirror)
- `claude-plugin-release/commands/setup.md` (mirror)

**Description:**
Add a new step early in the skill: prompt the user with "Storage backend: [1] mongodb (default) [2] sqlite". On `mongodb`, the existing 7-field MongoDB block runs, plus appending `DAKO_STORAGE_BACKEND=mongodb` to `.env`. On `sqlite`, skip MongoDB fields entirely and write only:
```
DAKO_STORAGE_BACKEND=sqlite
DAKO_SQLITE_PATH=.dako/memory.db
DAKO_AGENT=claude-code
```
`.mcp.json` write step unchanged (same LTM server entry — the server picks its backend at startup).

### Step 8 — Update `/dako:doctor` skill
**Satisfies:** AC-11 (doctor portion)
**Files:**
- `commands/doctor.md` (modified)
- `.claude/commands/doctor.md` (mirror)
- `claude-plugin-release/commands/doctor.md` (mirror)

**Description:**
- New early step reads `DAKO_STORAGE_BACKEND` from `.env` (default `mongodb` if absent). Records `Backend selected | ✅ | <value>`.
- MongoDB-specific check (current Step 5 "MongoDB reachability") becomes conditional on backend == `mongodb`. On `sqlite`: record `⚠️ skipped | backend is sqlite` and run three new checks instead:
  - `SQLite DB writable | ✅/❌ | path` — `mkdirSync` parent dir then open `better-sqlite3` instance.
  - `FTS5 available | ✅/❌` — `pragma compile_options` includes `ENABLE_FTS5`.
  - `SQLite write probe | ✅/❌` — insert+select+delete a sentinel row.
- `.env (fields)` check (Step 4 of doctor) becomes backend-aware: mongodb backend requires the 7 MONGO_* fields; sqlite backend requires only `DAKO_STORAGE_BACKEND`, `DAKO_SQLITE_PATH`, `DAKO_AGENT`.
- LTM MCP live ping (Step 8 of doctor) stays backend-agnostic (calls `recall` — works on either).

### Step 9 — Manual call matrix verification (QA loop work)
**Satisfies:** AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-10
**Files:**
- `workitem/WI-pluggable-memory-backend/20260525-storage-interface/implementation.md` (QA Log + Architecture Notes)

**Description:**
Per the QA loop in `/wi-implement`:
1. With `DAKO_STORAGE_BACKEND` unset (existing-user simulation): invoke each of the 12 MCP tools once with a realistic arg set. Record outputs in QA Log. Confirms AC-8 transparency.
2. With `DAKO_STORAGE_BACKEND=mongodb` explicit: re-invoke a sample (remember + recall + get_context + archive_workitem + start_session/log_message/get_session round-trip). Confirms AC-2 / AC-7 (Mongo path).
3. With `DAKO_STORAGE_BACKEND=sqlite` against a fresh `.dako/memory.db`: invoke each of the 12 tools. Confirms AC-3 / AC-5 / AC-6 / AC-7 (SQLite path).
4. Text-search equivalence (AC-5): seed both backends with 5 identical memory fixtures, run the same `recall` query, assert top-3 results overlap (any order). Phrasing matches AC-5's "equivalent" wording.
5. Field-preservation round-trip table (AC-10): document the mongo-field → sqlite-column mapping with sample values from a real `archive_workitem` call.

### Step 10 — Documentation update
**Satisfies:** AC-12
**Files:**
- `obsidian-docs/Architecture.md` — add `storage/` subfolder to component map; new subsection "Storage abstraction" describing the interface + backend factory.
- `obsidian-docs/Memory System.md` — add "Backend selection" block (env var, defaults, when to use sqlite).
- `obsidian-docs/Setup Guide.md` — add the backend-choice prompt to the setup flow; document `.dako/memory.db` location for sqlite users.
- `obsidian-docs/Roadmap.md` — remove "Pluggable long-term memory backend" from `## Backlog`; add closing note to Phase 1 (memory foundation) summary.
- `README.md` — remove the corresponding backlog row.

## Risks / Known Unknowns

- **R1 — TS/JS dual-source fragility.** `mcps/mongodb-memory/` has no build script; `server.ts` and `server.js` are hand-mirrored. New storage modules inherit this pattern (4 new .ts + 4 .js mirrors). Forgetting to update the .js side breaks the running server. **Mitigation:** top-of-file comment in each `.js` mirror reading `// AUTO-MIRROR of <name>.ts — keep in sync (no build step yet)`; flag as tech debt for a future "tsc build pipeline" workitem.
- **R2 — `better-sqlite3` native build on Windows.** May require Visual Studio Build Tools if prebuilt binaries unavailable. **Mitigation:** better-sqlite3 ships prebuilds for Node 18/20/22 across Win/Mac/Linux x64; Setup Guide documents the install command; doctor's SQLite check surfaces a clear "binding not loadable" error.
- **R3 — Text-search ranking divergence.** Mongo `$text` (TF-IDF) and SQLite FTS5 (BM25) rank differently for the same query. **Mitigation:** AC-5 verification is "top-N overlap, any order", not "exact rank match". Documented in implementation.md.
- **R4 — `logger.mjs` blast radius.** Hook logger fires on every prompt/turn. A bug breaks session logging silently. **Mitigation:** preserve all session-state-file logic untouched; only swap MongoDB call sites; live smoke test with one prompt+stop cycle before declaring AC-7 covered.
- **R5 — Existing user with MongoDB unreachable.** Default-to-mongodb means a user who stopped Mongo gets a connection error rather than a hint about the SQLite alternative. **Mitigation:** MongoStorage constructor catches connection failures and re-throws with `"MongoDB connection failed: <reason>. To switch to a self-contained backend, set DAKO_STORAGE_BACKEND=sqlite in .env"`.
- **R6 — `.dako/` directory shared with STM.** STM owns `.dako/patterns.db`; LTM SQLite would add `.dako/memory.db`. No filename collision, but both processes may `mkdir` simultaneously. **Mitigation:** `mkdirSync({ recursive: true })` is idempotent — already standard practice.
- **R7 — better-sqlite3 transitive deps + .env (fields) doctor check.** The doctor's `.env` fields check currently insists on the 7 MongoDB fields. After this WI, the check must branch on backend or it will false-alarm for sqlite users. **Mitigation:** explicitly covered by Step 8 — flagged here so it doesn't get missed in QA.

## Confirmation

**Confirmed by user:** yes
**Notes:** R1 (TS/JS dual-source) accepted as-stated — no separate tsc-build sub-feature introduced mid-workitem.

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** plan
**Reason:**
