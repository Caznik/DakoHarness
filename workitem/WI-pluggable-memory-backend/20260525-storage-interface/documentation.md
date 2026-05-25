---
wi: WI-pluggable-memory-backend/20260525-storage-interface
phase: documentation
status: confirmed
date: 2026-05-25
project-docs-found: yes
---

## Project Documentation Updated

| File | Section | Change |
|---|---|---|
| `CLAUDE.md` | Architecture tree | Updated `mongodb-memory/` description to `Long-term memory MCP (Node.js, MongoDB or SQLite via DAKO_STORAGE_BACKEND)` |
| `README.md` | Architecture tree | Added `storage/` subfolder; updated `mongodb-memory/` description to include SQLite adapter |
| `README.md` | Two-tier memory table | Updated long-term tier row: `MongoDB or SQLite (pluggable via DAKO_STORAGE_BACKEND)` |
| `README.md` | Backlog table | Removed `Pluggable long-term memory backend` row (shipped) |
| `obsidian-docs/Architecture.md` | Component map | Added `storage/` tree with `Storage.ts/js`, `MongoStorage.*`, `SqliteStorage.*`, `factory.*` |
| `obsidian-docs/Architecture.md` | New section | Added "Storage abstraction" — describes interface + factory + backend selection |
| `obsidian-docs/Memory System.md` | New section | Added "Backend selection (long-term tier)" — comparison table, default behavior, invalid-value behavior |
| `obsidian-docs/Setup Guide.md` | Steps 2–5 | Added Step 2 backend choice prompt; Steps 3 and 5 gated on `mongodb` backend; Step 4 writes backend-specific `.env` |
| `obsidian-docs/Roadmap.md` | Phase 1 description | Updated to mention pluggable backend and hook logger routing through abstraction |
| `obsidian-docs/Roadmap.md` | Backlog | Removed `Pluggable long-term memory backend` row (shipped) |

---

## Workitem Documentation

### What was built

The long-term memory MCP (`mcps/mongodb-memory/`) previously required MongoDB for all storage. This workitem introduces a **pluggable storage abstraction**: a TypeScript interface (`Storage`) with 12 methods — one per MCP tool — backed by two adapters. The backend is selected at startup via a single `.env` field (`DAKO_STORAGE_BACKEND`).

**MongoDB adapter** (`MongoStorage`) wraps the pre-existing MongoDB driver code with no behavioral changes. Users who do not set `DAKO_STORAGE_BACKEND` continue running MongoDB exactly as before — zero migration required.

**SQLite adapter** (`SqliteStorage`) is a fresh implementation using `better-sqlite3`. It creates a local file at `.dako/memory.db` (next to the STM `patterns.db`), with FTS5 virtual tables for text search — the same convention used by the short-term memory MCP.

The hook logger (`logger.mjs`) was also updated to route its session and message writes through the same abstraction, so SQLite users get complete session transcripts in their local database.

`/dako:setup` and `/dako:doctor` were updated to handle both backends: setup prompts for the backend choice and writes the correct `.env` shape; doctor branches its health checks based on which backend is active.

### How it works

**Interface location:** `mcps/mongodb-memory/storage/Storage.ts` (TypeScript source) + `Storage.js` (hand-mirrored, since the project has no build pipeline — `.mcp.json` runs `server.js` directly). All 4 new modules follow the same `.ts` + `.js` dual-source pattern.

**Factory singleton:** `storage/factory.ts/js` exports `getStorage()` and `closeStorage()`. `getStorage()` reads `DAKO_STORAGE_BACKEND`, instantiates the right adapter on first call, and caches it for the process lifetime. An invalid value throws `Invalid DAKO_STORAGE_BACKEND='<value>'. Allowed values: mongodb, sqlite` — the server catches this at startup and exits non-zero.

**SQLite schema:** Four tables — `memories`, `workitems`, `sessions`, `messages` — with FTS5 virtual tables (`memories_fts`, `workitems_fts`) kept in sync via INSERT/DELETE/UPDATE triggers. Schema is created idempotently on first open (`CREATE TABLE IF NOT EXISTS …`). Dates are stored as ISO-8601 TEXT for MongoDB round-trip compatibility (AC-10).

**Forward-compat hooks (design-only, no code):**
- *Vector search (AC-9):* `recall` args reserve `embedding?: number[]` and `mode?` as future optional fields. SQLite schema reserves a future `embedding BLOB` column via a non-destructive `ALTER TABLE`.
- *SQLite→MongoDB sync (AC-10):* every MongoDB document field maps 1:1 to a SQLite column (see field mapping table in `Storage.ts` header), so a future migration tool needs no data reconstruction.

**MongoStorage connection-failure hint (R5 mitigation):** if `MongoClient.connect()` fails, the error is re-thrown with `"…To switch to a self-contained backend, set DAKO_STORAGE_BACKEND=sqlite in .env"`.

### Usage

**Existing users (no change required):**
The default is `mongodb`. If `DAKO_STORAGE_BACKEND` is absent from `.env`, the server behaves identically to the pre-WI build.

**New SQLite install:**
Run `/dako:setup` and choose `[2] sqlite` when prompted. This writes:
```
DAKO_STORAGE_BACKEND=sqlite
DAKO_SQLITE_PATH=.dako/memory.db
DAKO_AGENT=claude-code
```
No MongoDB required. The database file is created automatically on first use.

**Switching an existing install to SQLite:**
Add `DAKO_STORAGE_BACKEND=sqlite` to `mcps/mongodb-memory/.env`. Existing MongoDB data is not migrated automatically (cross-backend migration is out of scope for v1).

**Doctor check:**
`/dako:doctor` now reports `Backend selected | ✅ | mongodb` or `sqlite` as an early row. SQLite health checks (`SQLite DB writable`, `FTS5 available`, `SQLite write probe`) replace the MongoDB reachability check when `backend = sqlite`.

**Node 22 / Windows note (R2):**
`better-sqlite3` ships prebuilt binaries for Node 18/20 but may require a native compile on Node 22 (`npx prebuild-install` inside `node_modules/better-sqlite3/`). `npm install` in the `mcps/mongodb-memory/` directory will attempt this automatically. If it fails, doctor surfaces `SQLite DB writable ❌`.

### Known limitations

None — review verdict was **pass** with no accepted gaps.

The following items are explicitly out of scope for v1 (per analyze.md):
- Cross-backend data migration CLI
- SQLite → MongoDB sync tool
- Vector/embedding storage (forward-compat design only)
- Schema migration tooling for SQLite

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** documentation
**Reason:**
