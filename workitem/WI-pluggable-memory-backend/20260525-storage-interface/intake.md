---
wi: WI-pluggable-memory-backend/20260525-storage-interface
phase: intake
status: confirmed
date: 2026-05-25
---

## Request

Pluggable long-term memory backend. The current LTM MCP (`mcps/mongodb-memory/server.ts`) hard-codes MongoDB as the storage layer. Requiring MongoDB is the biggest adoption friction for new users — abstract the storage layer so alternative backends (PostgreSQL, SQLite, hosted) can be plugged in. MongoDB remains the default and preferred option.

This sub-feature scope: design and implement the storage abstraction itself, with the existing MongoDB implementation refactored to sit behind the new interface as the reference adapter. A second concrete backend (e.g. SQLite) is intentionally deferred to a follow-up sub-feature under this WI, so the interface gets validated by at least one alternative without bloating v1.

## Classification

**Type:** feature (architectural — storage abstraction)
**Scope:** core — touches `mcps/mongodb-memory/server.ts`, MCP tool handlers (remember, recall, get_context, promote_to_team, forget, archive_workitem, list_memories, log_message, start_session, list_sessions, get_session, get_system_status), `.env` schema, `setup.sh`/`setup.ps1`, `/dako:setup` skill, `obsidian-docs/`, and CLAUDE.md if backend selection becomes user-visible

## Routing Decision

**Flow:** full
**Rationale:** non-trivial architectural change; multiple viable interface shapes (driver-style vs. ORM-style vs. operation-bus); meaningful adoption risk (every existing user runs against MongoDB today and must not regress); benefits from explicit AC sign-off before code moves.
**Phases:** intake → analyze → propose → plan → implement → review → document → repo → archive

## Confirmation

**Confirmed by user:** yes

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:**
**Reason:**
