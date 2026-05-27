---
wi: WI-rag-long-sessions/20260526-message-embeddings
phase: review
status: confirmed
date: 2026-05-27
verdict: pass
---

## AC Verification
| AC | Description | Satisfied | Evidence / Notes |
|---|---|---|---|
| AC-1 | `embedding` + `embedding_model` on `messages` (both adapters); Mongo `{ embedding_model: 1 }` index | yes | `SqliteStorage.ts:184-185` idempotent `addColumnIfMissing`; `MongoStorage.ts:83` `createIndex`. Existing-row back-compat exercised by mixed-model test. |
| AC-2 | `log_message` inline-embeds `role + ": " + content`; failure leaves null fields + stderr warning | yes | Happy path: `recall-session-messages.test.ts::[sqlite] logMessage inline-embeds long user messages` and `[mongo]` counterpart. Failure: `[sqlite] logMessage embed failure: row inserted with null fields (AC-2 failure)`. |
| AC-3 | Skip rules (empty / <20 chars / role=tool); silent skip; null fields | yes | 5 unit tests in `embed.test.ts shouldEmbedMessage`; end-to-end `[sqlite] logMessage skips empty / short / tool messages (AC-3)`. |
| AC-4 | `recall_session_messages` tool registered with full schema; server base64-decodes `embedding` | yes | `server.ts:137-152` schema; `server.ts:246-256` route mirrors `recall` decode. |
| AC-5 | Vector-only retrieval with filter + capped candidate fetch + in-app cosine; ISO-8601 `since` validation | yes | `SqliteStorage.ts:497-564`; `MongoStorage.ts:377-458`. Validation test `…invalid since throws (AC-5 validation)`. |
| AC-6 | Default scope project-wide; `session_id` narrows | yes | `[sqlite] recallSessionMessages — project-wide search across sessions (AC-6)` + session-filtered test; mirrored on Mongo. |
| AC-7 | Render format `[<sid8>] [<iso>] [<role>]: <content>`; empty → "No matching messages found …" | yes | `SqliteStorage.ts:559-561`, `MongoStorage.ts:450-455`; empty-result tests on both adapters. |
| AC-8 | Mixed-model rows excluded from results | yes | `[sqlite] recallSessionMessages — mixed-model rows excluded (AC-8)`; Mongo equivalent injects wrong-model row. |
| AC-9 | Caller-supplied `embedding` skips server embed | yes | `[sqlite] recallSessionMessages — caller-supplied embedding skips server embed (AC-9)`; adapters use `bytesToFloats` directly when arg present. |
| AC-10 | `/recall-session` skill mirrored in 3 locations with full steps | yes | All 3 mirrors byte-identical (verified by sub-agent); empty-result handling documented. |
| AC-11 | `embed-backfill --collection memories|messages|all` with both flag forms; unknown value exits 1 | yes | `embed-backfill.ts:66-94`; 7 new tests cover all forms incl. invalid + orphan-flag exit. |
| AC-12 | CLAUDE.md one-line `/recall-session` compaction hint; no hook changes | yes | `CLAUDE.md:30`. |
| AC-13 | 11 AC-13 test cases covered + Mongo branches gated on reachability | yes | All 11 mapped explicitly in implementation.md AC Pre-Check. |
| AC-14 | Zero regression on memories `recall` + zero-flag `embed-backfill` | yes | Existing 7 `recall-hybrid.test.js` + 5 baseline `embed-backfill.test.js` tests pass; default `collection = "memories"`. |

## Plan Coverage
| Step | Implemented | Notes |
|---|---|---|
| 1 — Schema migrations on `messages` (both adapters + Mongo index) | yes | AC-1. |
| 2 — `shouldEmbedMessage` + `MESSAGE_MIN_LEN` in `embed.ts` | yes | Centralized as planned; 5 unit tests in `embed.test.ts`. |
| 3 — `MongoStorage.logMessage` inline embed + UPDATE | yes | Failure-tolerant pattern from `remember()`. |
| 4 — `SqliteStorage.logMessage` inline embed + UPDATE | yes | Uses `lastInsertRowid`. |
| 5 — `recallSessionMessages` on both adapters; SQLite JOINs to `sessions` | yes | Vector-only; in-app cosine; capped candidates. |
| 6 — `Storage.ts` interface extension | yes | New `RecallSessionMessagesArgs` + facade method. |
| 7 — `recall_session_messages` tool registration in `server.ts` | yes | AC-4. |
| 8 — `embed-backfill --collection` flag | yes | AC-11. |
| 9 — `/recall-session` skill (3 mirrors) | yes | Done in dispatch #1; verified intact in dispatch #2. |
| 10 — CLAUDE.md compaction hint | yes | Done in dispatch #1; verified intact in dispatch #2. |
| 11 — Tests (AC-13) | yes | 11 mapped cases + 1 bonus + 5 unit tests for `shouldEmbedMessage`. |

## Deviations Review
| Step | Deviation | Assessment |
|---|---|---|
| 11 | Extended `mcps/mongodb-memory/package.json` `test` script to include `recall-session-messages.test.js` in the `node --test` argument list. | acceptable — without it AC-13 coverage would be invisible to `npm test`. Intent preserved. |
| 11 | Added bonus "invalid since throws" test for AC-5 ISO-8601 validation (plan Risk #4) not in AC-13's explicit 11 cases; also hardened `mongoReachable()` probe with try/catch around `close()`. | acceptable — strengthens AC-5 coverage; probe hardening is defensive copy of hybrid test pattern. |

## Gaps
None. All 14 ACs satisfied with concrete evidence; all 11 plan steps implemented; both deviations assessed acceptable.

Note: pre-existing TS errors in `npm test`'s `tsc` step (missing `@types/better-sqlite3`, `@xenova/transformers` types, MCP SDK signature drift) confirmed by the sub-agent to be unchanged from the baseline before this WI. Out of scope; not a gap introduced here. Worth a future housekeeping WI.

## Verdict
**Result:** pass
**Accepted gaps:** none

## Confirmation
**Confirmed by user:** yes
**Date:** 2026-05-27
**Notes:**

## Cancellation
