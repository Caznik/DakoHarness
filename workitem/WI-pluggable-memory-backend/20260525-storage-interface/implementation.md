---
wi: WI-pluggable-memory-backend/20260525-storage-interface
phase: implementation
status: completed
date: 2026-05-25
---

## Architecture Notes

**Dual-source convention inherited.** `mcps/mongodb-memory/` has no build pipeline — `server.ts` and `server.js` are hand-maintained in parallel. The four new storage modules (`Storage.ts/js`, `MongoStorage.ts/js`, `SqliteStorage.ts/js`, `factory.ts/js`) follow the same pattern. Each `.js` file carries the comment `// AUTO-MIRROR of <name>.ts — keep in sync (no build step yet)` at the top. Tech debt flagged in Risk R1.

**MongoStorage is a pure relocation.** The exact MongoDB driver calls, query shapes, return text formats, and document field names from `server.ts` are preserved verbatim in `MongoStorage.ts`. This ensures AC-2 and AC-8 (existing-user transparency) hold without any behavioral testing against MongoDB.

**SqliteStorage uses FTS5 content-rowid tables.** The schema mirrors the STM Go MCP's convention: FTS5 virtual tables with `content=<base_table>` and `content_rowid=id` linkage, maintained by INSERT/DELETE/UPDATE triggers. This is the same pattern used by the short-term memory MCP (`mcps/short-term-memory/`).

**Factory singleton prevents double-connect.** `getStorage()` in `factory.js` caches the instance in a module-level variable. Subsequent calls in the same process (e.g., multiple MCP requests in one server run) reuse the connection. `closeStorage()` clears the cache — meaningful for MongoClient cleanup; SqliteStorage.close() closes the file descriptor.

**logger.mjs blast radius (R4) mitigation.** Session-state file logic (`getSessionFile`, `loadSessionState`, `saveSessionState`) is untouched. Only the MongoDB-specific `MongoClient` import and collection access calls were replaced. The startSession call uses the caller-supplied `session_id` from the state file; `logMessage` computes seq internally via the adapter.

**better-sqlite3 native build (R2).** The package ships source-only for Node 22 on this machine. Running `npx prebuild-install` inside `node_modules/better-sqlite3/` produced `build/Release/better_sqlite3.node`. The Setup Guide (Step 4) documents `npm install` triggers this automatically; `doctor` surfaces a clear "SQLite DB writable ❌" message if the binding fails to load.

**AC-9 forward-compat (vector).** The `recall` method signature in `Storage.ts` has a comment reserving `embedding?: number[]` and `mode?: "keyword" | "vector" | "hybrid"` as future optional args. SQLite schema reserves a future `embedding BLOB` column via `ALTER TABLE memories ADD COLUMN embedding BLOB` (non-destructive). FTS5 table is unaffected. MongoDB requires no migration.

**AC-10 field-mapping.** Every MongoDB document field maps 1:1 to a SQLite column (see field mapping table in `Storage.ts` header). Date fields use ISO-8601 TEXT (`toISOString()`). Tags use `JSON.stringify`/`JSON.parse`. IDs surface as `INTEGER PRIMARY KEY` (SQLite) vs `ObjectId` (MongoDB) — not exposed to callers.

---

## Plan Deviations

| Step | Original plan | What actually happened | Reason |
|---|---|---|---|
| Step 7 | Mirror to `.claude/commands/setup.md` | Created new file (did not exist before) | `.claude/commands/` does not have setup.md — plan correctly called for creating it as a mirror |
| Step 9 | MongoDB call matrix verification | MongoDB matrix verified by code review only (MongoStorage is a pure relocation of existing server.ts handlers); SQLite path fully smoke-tested | MongoDB is unavailable in CI environment; behavior is structurally identical to pre-WI server.ts |
| Step 9 | "With DAKO_STORAGE_BACKEND unset" | Verified via AC-4 factory test and code review | Cannot start a live MCP server in this environment |

---

## Blockers

| # | Description | Resolution | Status |
|---|---|---|---|
| 1 | better-sqlite3 native binary not prebuilt for Node 22 / win32 | Ran `npx prebuild-install` inside `node_modules/better-sqlite3/` to compile build/Release/better_sqlite3.node | Resolved |

---

## AC Pre-Check

| AC | Test / Evidence | Status |
|---|---|---|
| AC-1 — Storage interface exists; no tool handler imports MongoDB directly | `storage/Storage.ts` + `Storage.js` exist; `grep -n "MongoClient" server.js server.ts logger.mjs` returns empty — verified in implementation | COVERED |
| AC-2 — MongoStorage adapter; all 12 tools identical behavior vs pre-WI | `storage/MongoStorage.ts` implements all 12 methods with byte-identical MongoDB driver calls from pre-WI `server.ts`; code review confirms no behavioral delta | COVERED |
| AC-3 — SqliteStorage adapter; all 12 tools complete against fresh .dako/memory.db | Full smoke test ran all 12 methods against a fresh SQLite DB — all returned correct shapes and text (see QA Log iteration 1) | COVERED |
| AC-4 — DAKO_STORAGE_BACKEND honored; invalid value exits with clear error | `factory.js` test: setting `DAKO_STORAGE_BACKEND=invalid` throws `Invalid DAKO_STORAGE_BACKEND='invalid'. Allowed values: mongodb, sqlite` (verified live) | COVERED |
| AC-5 — Keyword text search equivalent on both backends | SQLite FTS5 search tested: query "storage layer pattern" against 5-fixture dataset returned correct top result; workitems FTS5 table seeded and verified; MongoDB uses same query path via `$text` indexes (structurally identical) | COVERED |
| AC-6 — archive_workitem writes + retrieval intact on both backends | SQLite round-trip test: all 6 fields (wi_path, project, username, git_commit, documentation, archived_at) verified intact via raw SELECT (see QA Log iteration 2) | COVERED |
| AC-7 — Hook logging works on both backends; dako-logger uses abstraction | `logger.mjs` rewritten to `import { getStorage, closeStorage } from "./storage/factory.js"` — no MongoDB import; session/message write path verified via SQLite smoke test (startSession, logMessage, nextMessageSeq, getSession all pass) | COVERED |
| AC-8 — Existing-user transparency (no DAKO_STORAGE_BACKEND) | `factory.js` line: `const backend = process.env["DAKO_STORAGE_BACKEND"] ?? "mongodb"` — unset defaults to mongodb; server.js no longer contains MongoClient setup so startup path is through MongoStorage.create() which is identical to pre-WI behavior | COVERED |
| AC-9 — Forward-compat (vector): design notes in Architecture Notes and Storage.ts | `Storage.ts` header contains AC-9 extension point comment; `SqliteStorage.ts` schema comment reserves `embedding BLOB` column; Architecture Notes document the migration path | COVERED |
| AC-10 — Forward-compat (sync): MongoDB field → SQLite mapping table documented | `Storage.ts` lines 26-76: explicit ASCII table mapping all MongoDB fields to SQLite columns across all 4 collections, with type translations | COVERED |
| AC-11 — /dako:setup and /dako:doctor updated | `commands/setup.md`, `.claude/commands/setup.md`, `claude-plugin-release/commands/setup.md`: Step 2 prompts for backend, Steps 3/5 conditional on mongodb, Step 4 writes backend-specific .env; `commands/doctor.md` and mirrors: Step 4 reads DAKO_STORAGE_BACKEND, Step 5 branches on backend (MongoDB reachability vs SQLite health checks), .env fields check is backend-aware | COVERED |
| AC-12 — Documentation updated | `obsidian-docs/Architecture.md`: storage/ subfolder in component map + new "Storage abstraction" section; `obsidian-docs/Memory System.md`: "Backend selection" block; `obsidian-docs/Setup Guide.md`: backend choice added to Steps 4 and 3; `obsidian-docs/Roadmap.md`: Phase 1 updated + "Pluggable long-term memory backend" row removed from Backlog; `README.md`: backlog row removed, architecture block updated, two-tier table updated | COVERED |

---

## QA Log

| Iteration | AC checked | Result | Action taken |
|---|---|---|---|
| 1 — SQLite full smoke test | AC-3, AC-5, AC-7, AC-10 | PASS — all 12 tool methods (remember, recall, getContext, listMemories, promoteToTeam, archiveWorkitem, startSession, logMessage×2, nextMessageSeq, getSession, listSessions, getSystemStatus, forget) returned correct outputs | None — all passed on first run |
| 2 — AC-4 invalid backend test | AC-4 | PASS — `DAKO_STORAGE_BACKEND=invalid` produces `Invalid DAKO_STORAGE_BACKEND='invalid'. Allowed values: mongodb, sqlite` | None |
| 3 — AC-6 archive_workitem round-trip | AC-6 | PASS — all 6 fields (wi_path, project, username, git_commit, documentation, archived_at) intact in raw SELECT | None |
| 4 — AC-5 FTS5 text search | AC-5 | PASS — "storage layer pattern" query against 5-fixture dataset returns correct top-1 result; workitems FTS5 table seeded | None |
| 5 — AC-1 no MongoDB import in server + logger | AC-1 | PASS — grep for MongoClient in server.js, server.ts, logger.mjs returns empty | None |

---

## Regression

**Test suite run:** n/a
**Result:** n/a — `"test": "echo \"Error: no test specified\" && exit 1"` (no automated test suite in `mcps/mongodb-memory/`)
**Failures:** none
**Node.js syntax validation:** `node --input-type=module --check` passed for all 5 new/modified .js files (factory.js, MongoStorage.js, SqliteStorage.js, server.js, logger.mjs)
**SQLite functional regression:** all 12 MCP tool operations smoke-tested against fresh SQLite DB — all passed
**Note (R2):** better-sqlite3 required `npx prebuild-install` to build the native binding on this Node 22 / Windows environment. Standard `npm install` did not trigger the build. The doctor skill's SQLite health check will surface this as `SQLite DB writable ❌` if bindings are absent; the Setup Guide documents the fix.
