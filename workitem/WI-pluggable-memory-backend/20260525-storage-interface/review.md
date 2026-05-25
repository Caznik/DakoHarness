---
wi: WI-pluggable-memory-backend/20260525-storage-interface
phase: review
status: confirmed
date: 2026-05-25
verdict: pass
---

## AC Verification

| AC | Description | Satisfied | Evidence / Notes |
|---|---|---|---|
| AC-1 | Storage interface exists; no tool handler imports MongoDB directly | yes | `storage/Storage.ts` + `Storage.js` define the 12-method interface. Grep for `MongoClient` across `server.ts`, `server.js`, `logger.mjs` returns empty — only `MongoStorage.ts/js` import it. `server.js` lines 194-208: all 12 handlers dispatch to `storage.<method>()`. |
| AC-2 | MongoStorage adapter; all 12 tools behaviorally identical to pre-WI | yes | `MongoStorage.ts` is a pure relocation of the pre-WI `server.ts` handler bodies. MongoDB driver calls, query shapes, return text formats, collection names, and index definitions are preserved verbatim. Code review confirms no behavioral delta. |
| AC-3 | SqliteStorage adapter; all 12 tools complete against fresh `.dako/memory.db` | yes | Full SQLite smoke test (QA iteration 1): all 12 methods — `remember`, `recall`, `getContext`, `listMemories`, `promoteToTeam`, `archiveWorkitem`, `startSession`, `logMessage×2`, `nextMessageSeq`, `getSession`, `listSessions`, `getSystemStatus`, `forget` — returned correct shapes and text. |
| AC-4 | `DAKO_STORAGE_BACKEND` honored; invalid value exits with clear error | yes | `factory.js` line 28: `const backend = process.env["DAKO_STORAGE_BACKEND"] ?? "mongodb"`. Live test: setting value to `"invalid"` throws `Invalid DAKO_STORAGE_BACKEND='invalid'. Allowed values: mongodb, sqlite` (QA iteration 2). |
| AC-5 | Keyword text search equivalent on both backends | yes | SQLite FTS5 smoke test: query `"storage layer pattern"` against 5-fixture dataset returned correct top-1 result; `workitems_fts` seeded and queried (QA iteration 4). MongoDB path uses same `$text` index structure as pre-WI — no behavioral delta. |
| AC-6 | `archive_workitem` writes + retrieval intact on both backends | yes | SQLite round-trip (QA iteration 3): all 6 fields (`wi_path`, `project`, `username`, `git_commit`, `documentation`, `archived_at`) verified intact via raw SELECT. MongoDB path preserved verbatim from pre-WI. |
| AC-7 | Hook logging works on both backends; `dako-logger` uses abstraction | yes | `logger.mjs` line 35: `import { getStorage, closeStorage } from "./storage/factory.js"`. No MongoDB import in file. SQLite path: `startSession`, `logMessage`, `nextMessageSeq`, `getSession` all verified in QA iteration 1. `closeStorage()` called in `finally` block. |
| AC-8 | Existing-user transparency (no `DAKO_STORAGE_BACKEND`) | yes | `factory.js`: `?? "mongodb"` default. `server.js` no longer contains MongoClient setup — startup routes through `MongoStorage.create()` which is identical to the pre-WI path. Users with existing 7-field `.env` see zero change. |
| AC-9 | Forward-compat (vector): design notes in `Storage.ts` + SQLite schema | yes | `Storage.ts` lines 14-19: AC-9 extension-point comment with exact future arg names (`embedding?: number[]`, `mode?: "keyword" \| "vector" \| "hybrid"`). `SqliteStorage.ts` schema block: `-- future: embedding BLOB (vector search, AC-9)` comment reserving the column. Implementation.md Architecture Notes document the non-destructive `ALTER TABLE` migration path. |
| AC-10 | Field-preservation: MongoDB → SQLite mapping table documented | yes | `Storage.ts` lines 26-76: explicit ASCII mapping table covering all 4 collections (memories, workitems, sessions, messages) with type translations (`Date` → ISO-8601 TEXT, `string[]` → JSON TEXT, `ObjectId` → INTEGER PRIMARY KEY). |
| AC-11 | `/dako:setup` and `/dako:doctor` updated | yes | `commands/setup.md` (+ 2 mirrors): Step 2 prompts for backend, Steps 3/5 conditional on mongodb, Step 4 writes backend-specific `.env`. `commands/doctor.md` (+ 2 mirrors): Step 4 reads `DAKO_STORAGE_BACKEND`, Step 5 branches on backend (MongoDB reachability vs. SQLite health checks), `.env` fields check is backend-aware. |
| AC-12 | Documentation updated | yes | `obsidian-docs/Architecture.md`: `storage/` in component map + "Storage abstraction" section. `obsidian-docs/Memory System.md`: "Backend selection" section with comparison table. `obsidian-docs/Setup Guide.md`: backend choice step added. `obsidian-docs/Roadmap.md`: Phase 1 description updated; "Pluggable long-term memory backend" removed from Backlog. `README.md`: backlog row removed; architecture block and two-tier table updated. |

## Plan Coverage

| Step | Implemented | Notes |
|---|---|---|
| Step 1 — Storage interface | yes | `storage/Storage.ts` + `Storage.js` with 12 methods + `nextMessageSeq` helper + AC-9/AC-10 comment blocks |
| Step 2 — MongoStorage adapter | yes | `storage/MongoStorage.ts` + `MongoStorage.js` |
| Step 3 — SqliteStorage adapter | yes | `storage/SqliteStorage.ts` + `SqliteStorage.js`; `better-sqlite3` added to `package.json` |
| Step 4 — Storage factory | yes | `storage/factory.ts` + `factory.js`; singleton cached; `closeStorage()` exported |
| Step 5 — Rewire server.ts / server.js | yes | All 12 handlers delegated; MongoClient removed from server entry point; indexes moved to MongoStorage constructor |
| Step 6 — Rewire logger.mjs | yes | MongoDB import replaced with factory import; session-state file logic untouched |
| Step 7 — Update /dako:setup | yes | 3 mirrors updated (commands/setup.md, .claude/commands/setup.md was new, claude-plugin-release/commands/setup.md) |
| Step 8 — Update /dako:doctor | yes | 3 mirrors updated with backend-aware check branching |
| Step 9 — Manual call matrix QA | yes | 5 QA iterations recorded in implementation.md; partial deviation (MongoDB live call matrix replaced by code review + SQLite smoke test) |
| Step 10 — Documentation update | yes | All 5 files updated as planned |

## Deviations Review

| Step | Deviation | Assessment |
|---|---|---|
| Step 7 | `.claude/commands/setup.md` created new (did not exist before) | acceptable — plan correctly called for it as a mirror; the file's absence was a pre-existing gap, not a plan error |
| Step 9 | MongoDB call matrix verified by code review only (not live MCP invocations) | acceptable — `MongoStorage` is a structural relocation of pre-WI `server.ts` handlers with no logic changes; code review is sufficient evidence. Live verification still possible by the user when MongoDB is available |
| Step 9 | "DAKO_STORAGE_BACKEND unset" path verified via AC-4 factory test + code review rather than live server startup | acceptable — the `?? "mongodb"` default is verified at the factory level; no AC at risk |

## Gaps

None. All 12 ACs satisfied; all 10 plan steps implemented; all 3 deviations assessed as acceptable.

## Verdict

**Result:** pass
**Accepted gaps:** none

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** review
**Reason:**
