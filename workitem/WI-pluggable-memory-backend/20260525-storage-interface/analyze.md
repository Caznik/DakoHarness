---
wi: WI-pluggable-memory-backend/20260525-storage-interface
phase: analyze
status: confirmed
date: 2026-05-25
---

## Requirements

### Functional

1. The LTM MCP server exposes a single internal **storage interface** that all MCP tool handlers call through. No tool handler talks to MongoDB driver APIs directly anymore.
2. The interface covers every operation backing the **12 current MCP tools** across **4 collections**:
   - `memories` — remember, recall, get_context, promote_to_team, forget, list_memories
   - `workitems` — archive_workitem (write); future readers welcome
   - `sessions` — start_session, get_session, list_sessions, (transitively) get_context
   - `messages` — log_message, (transitively) get_session, get_context
   - cross-cutting — get_system_status
3. Two concrete backend implementations ship in v1:
   - **MongoDB adapter** — wraps the existing MongoDB driver code; functionally identical to current behavior.
   - **SQLite adapter** — fresh implementation. Text search uses SQLite FTS5 (consistent with the existing STM Go MCP convention).
4. Backend selection is driven by a new `.env` field `DAKO_STORAGE_BACKEND` with allowed values `mongodb` (default) and `sqlite`. Unset → `mongodb`. Invalid value → server fails to start with a clear error message naming the field and the allowed values.
5. Keyword text search must work equivalently on both backends:
   - MongoDB: existing `$text` indexes on `memories` (`title` + `content`) and `workitems` (`documentation`).
   - SQLite: FTS5 virtual tables mirroring those fields.
6. The hook logger (`bin/dako-logger`, currently in `mcps/mongodb-memory/logger.mjs`) routes its session/message writes through the same storage abstraction — SQLite-backend users get session transcripts in the SQLite DB.
7. `/dako:setup` is updated:
   - Prompts the user to choose a backend (default `mongodb`).
   - On `mongodb` selection: existing 7-field MongoDB block plus `DAKO_STORAGE_BACKEND=mongodb`.
   - On `sqlite` selection: writes `DAKO_STORAGE_BACKEND=sqlite` and a `DAKO_SQLITE_PATH` field (default `.dako/memory.db`). MongoDB-specific env fields are skipped.
8. `/dako:doctor` is updated to gate MongoDB-specific checks behind backend selection. SQLite-backend users instead get `DB file present`, `FTS5 available`, and `Write check passes` rows.

### Forward-compat (no code in v1, design-only)

9. **Vector search is not required in v1**, but the interface and SQLite schema must be designed so adding a future `embedding: number[]` field plus a vector index can be done without an interface change or a breaking schema migration. (This is the path that "Local embedding model for recall" — separate backlog item — will eventually take.)
10. **SQLite-to-MongoDB sync** is not implemented in v1, but the SQLite schema must preserve every field present in the corresponding MongoDB documents (no information loss). A future tool must be able to read SQLite rows and insert them directly into MongoDB with no data reconstruction.

### Non-functional

11. **Transparent upgrade for existing users.** A user upgrading with the current `.env` (no `DAKO_STORAGE_BACKEND` field) sees zero functional change: MongoDB still selected, all data accessible, all 12 MCP tools work identically to before.
12. **Documentation updated.** `obsidian-docs/Architecture.md`, `obsidian-docs/Memory System.md`, `obsidian-docs/Setup Guide.md`, and `obsidian-docs/Roadmap.md` reflect the new abstraction and backend selection. `README.md` Backlog row "Pluggable long-term memory backend" is closed.

## Out of Scope

- **PostgreSQL backend** — deferred to a follow-up sub-feature under this WI.
- **Hosted memory backend** — deferred.
- **Cross-backend data migration CLI** (`dako migrate --from mongodb --to sqlite`) — transparent for existing users means no migration is required in v1.
- **SQLite → MongoDB sync tool** — deferred to a follow-up sub-feature; v1 only ensures the design doesn't preclude it (AC-10).
- **Vector search / embeddings** — covered separately by the existing "Local embedding model for recall" backlog item; v1 only ensures forward-compat (AC-9).
- **Schema migration tooling** for SQLite (alembic-style versioned migrations) — v1 starts from a clean schema per install. Migrations are future work if/when the schema evolves.

## Open Questions

- ~~**SQLite Node binding choice.**~~ **Resolved during analyze sign-off:** `better-sqlite3`. Preserves Node 18/20 compatibility (the Node 22+ built-in `node:sqlite` would force a runtime bump), mature FTS5 support, sync API matches the MCP tool handler shape, and `sqlite-vec` has a working `better-sqlite3` binding for the AC-9 forward-compat path.
- **Where the SQLite DB file lives.** Default proposal: `.dako/memory.db` (parallel to STM's `.dako/patterns.db`, but a separate file owned by the LTM MCP). User-configurable via `DAKO_SQLITE_PATH`. Confirmed in `/wi-plan` after looking at how `.dako/` is currently created.
- **Interface shape.** Driver-style (one method per logical op: `remember`, `recall`, ...) vs. repository pattern (`insert`, `find`, `update`, `delete` by collection) vs. operation-bus. To be decided in `/wi-propose`.

## Acceptance Criteria

- [ ] **AC-1** — A `Storage` interface exists in the LTM MCP TypeScript source (`mcps/mongodb-memory/`) covering every operation backing the 12 MCP tools. No MCP tool handler imports the MongoDB driver directly.
- [ ] **AC-2** — `MongoStorage` adapter implements the interface. With `DAKO_STORAGE_BACKEND=mongodb` (or unset), all 12 MCP tools return shapes and behaviors identical to the pre-WI implementation. Verified by a manual call matrix recorded in `implementation.md`.
- [ ] **AC-3** — `SqliteStorage` adapter implements the interface. With `DAKO_STORAGE_BACKEND=sqlite`, all 12 MCP tools complete successfully against a fresh `.dako/memory.db`. Return shapes match `MongoStorage` for the same inputs (modulo `_id` representation — SQLite uses an INTEGER PRIMARY KEY mapped to a stable string).
- [ ] **AC-4** — `DAKO_STORAGE_BACKEND` is honored: unset → mongodb; `mongodb` → MongoDB; `sqlite` → SQLite; any other value → server exits with a clear error naming the field and allowed values.
- [ ] **AC-5** — Keyword text search returns equivalent ranked results on both backends for the same query against the same dataset. Verified for both `memories` (title+content) and `workitems` (documentation) using a small fixture set recorded in `implementation.md`.
- [ ] **AC-6** — `archive_workitem` writes correctly on both backends; subsequent retrieval (raw read in MongoDB / `SELECT` in SQLite) shows all archived fields intact, including `wi_path`, `project`, `username`, `git_commit`, `documentation`, `archived_at`.
- [ ] **AC-7** — Hook logging works on both backends: a UserPromptSubmit / Stop / PreCompact cycle creates a `sessions` row plus the expected `messages` rows, retrievable via `get_session` and `list_sessions`. `dako-logger` is updated to use the abstraction.
- [ ] **AC-8** — Existing-user transparency: a user with the current 7-field `.env` (no `DAKO_STORAGE_BACKEND`) sees zero behavioral change — same connection, same data, same tool responses as the pre-WI build. Verified by running the call matrix from AC-2 against an untouched `.env`.
- [ ] **AC-9** — Forward-compat (vector): the `Storage` interface and SQLite schema include explicit design notes (in `implementation.md` Architecture Notes) describing exactly where a future `embedding` column / vector index would attach without changing existing method signatures or requiring a destructive migration.
- [ ] **AC-10** — Forward-compat (sync): every field stored in a MongoDB document is also represented in the corresponding SQLite row (allowing for type-mapping like `Date` → ISO string). A round-trip mapping table is documented in `implementation.md`.
- [ ] **AC-11** — `/dako:setup` and `/dako:doctor` updated: setup prompts for backend with `mongodb` default and writes the correct `.env` shape per choice; doctor checks the selected backend's health (MongoDB reachability OR SQLite file presence + FTS5 + write probe).
- [ ] **AC-12** — Documentation updated: `obsidian-docs/Architecture.md` (component map + new section on storage abstraction), `obsidian-docs/Memory System.md` (backend selection block), `obsidian-docs/Setup Guide.md` (SQLite path), `obsidian-docs/Roadmap.md` (close backlog row), `README.md` (backlog row removed/closed).

## Interview Notes

- **Data scope (Q1):** User picked "everything" — memories, workitems, sessions, messages all routed through the abstraction. Also added an explicit future ask: SQLite-backend users should later be able to sync up to MongoDB. Captured as AC-10 forward-compat.
- **Backend selection (Q2):** User picked explicit `DAKO_STORAGE_BACKEND` env var, **limited to mongodb and sqlite for v1**. PostgreSQL deferred even though the original backlog row mentioned it — caps v1 scope.
- **Vector / semantic search (Q3, with correction):** Agent's initial framing assumed semantic recall had shipped as embedding-based. Verified: WI-semantic-recall shipped Approach B (agent-side query expansion) and stores no embeddings. After correction, user picked "drop vector from v1 ACs; require forward-compat only" — captured as AC-9 design-only, no implementation cost in v1.
- **Migration (Q4):** "Transparent — no action required." No `.env` schema change forced on existing users; default backend stays MongoDB. Cross-backend data migration CLI explicitly out of scope.

## Sign-off

**Confirmed by user:** yes
**Date:** 2026-05-25
**Notes:** AC-7 (hook logger routes through the abstraction) explicitly confirmed as deliberate — wider blast radius accepted to keep the "everything routes through one backend" guarantee from Q1. SQLite Node binding locked as `better-sqlite3` to preserve Node 18/20 compat.
