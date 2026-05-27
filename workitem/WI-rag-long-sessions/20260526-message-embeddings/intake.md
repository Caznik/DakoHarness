---
wi: WI-rag-long-sessions
phase: intake
status: confirmed
date: 2026-05-26
---

## Request

RAG for long sessions: extend the long-term memory MCP so the `messages` collection gains semantic recall, leveraging the embedding infrastructure shipped in WI-local-embedding-recall.

Concrete deliverables:

1. `messages` schema gains `embedding` + `embedding_model` fields in both `MongoStorage` and `SqliteStorage`.
2. `log_message` embeds `content` inline at insert time, with the same failure semantics as `remember` (insert succeeds, warn on embed failure).
3. New MCP tool `recall_session_messages({ project, query, session_id?, since?, limit })` returns top-k semantically similar messages, optionally scoped to a session or time window.
4. `embed-backfill` script gains a flag (e.g. `--collection messages`) to also backfill the messages collection.
5. New or extended `/recall-session` skill so the agent can pull semantically relevant past turns on demand mid-conversation — useful for compaction recovery and very long sessions.

Implementation rides on the existing embedding infrastructure: in-app cosine over Float32 buffers, mirroring the memories path. No new runtime dependencies.

## Classification

- **Type:** new feature
- **Scope:** `mcps/mongodb-memory/` — `Storage.ts` (new method + arg type), `MongoStorage.ts` + `SqliteStorage.ts` (messages-collection embedding storage + vector search), `server.ts` (new tool registration), `embed-backfill.ts` (collection flag), three skill mirrors for `/recall-session` (or extension of `/recall`).

## Routing Decision

- **Flow:** Full workflow
- **Rationale:** Multi-touch behavior change across runtime (`log_message`), both storage adapters, the backfill script, and a new agent surface. Decisions to pin in analyze/plan: embed-at-insert latency budget (every conversation turn pays ~50–200ms); embedded text shape (content only vs. role+content); session-scoping default (current session vs. project-wide); time-window semantics; hybrid vs. vector-only retrieval; new skill vs. flag on existing `/recall`; integration with compaction recovery; whether system messages get embedded.
- **Phases:** intake → analyze → propose (conditional) → plan → implement → review → document → repo → archive

## Confirmation

Confirmed by user → yes

## Cancellation

