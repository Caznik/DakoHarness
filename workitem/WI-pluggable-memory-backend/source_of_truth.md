---
wi: WI-pluggable-memory-backend
created: 2026-05-25
updated: 2026-05-25
status: completed

---

## Current State

**Current phase:** archive
**Blocked:** no

## Sub-features

| Sub-feature | Status | Phases completed |
|---|---|---|
| 20260525-storage-interface | completed | all |

## Active Blockers

| # | Description |
|---|---|

## Key Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-25 | v1 scope: mongodb + sqlite only (no PostgreSQL) | User capped backend choices to two in Q2; PostgreSQL deferred to follow-up sub-feature |
| 2026-05-25 | All four collections routed through abstraction (incl. sessions/messages and dako-logger) | User Q1 answer — keeps "everything routes through one backend" guarantee |
| 2026-05-25 | Vector search dropped from v1; forward-compat only (AC-9) | Verified WI-semantic-recall shipped keyword expansion, not embeddings — premise corrected mid-analyze |
| 2026-05-25 | Transparent upgrade for existing users — no .env change required (default = mongodb) | User Q4 answer; minimal adoption friction |
| 2026-05-25 | SQLite Node binding: `better-sqlite3` | Preserves Node 18/20 compatibility; mature FTS5; sqlite-vec binding available for AC-9 forward-compat |
| 2026-05-25 | Interface shape: Approach A (domain-method facade) | 1-to-1 mapping with 12 MCP tools; per-adapter query freedom; AC-9 vector path attaches locally to `recall`; avoids leaky filter abstraction from Approach B |
| 2026-05-25 | wi-implement dispatch #1 for 20260525-storage-interface | initial |

## Parking / Cancellation

