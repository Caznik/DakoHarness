---
wi: WI-sqlite-to-mongo-migration
phase: intake
status: confirmed
date: 2026-05-26
---

## Request

SQLite → MongoDB migration: one-shot `npm run migrate` inside `mcps/mongodb-memory` that copies all four collections (memories, workitems, sessions, messages) from a SQLite backend to MongoDB per the AC-10 field map in `storage/Storage.ts`, then rewrites `DAKO_STORAGE_BACKEND` in `.env` from `"sqlite"` to `"mongodb"` on success. The tool itself flips the env var — the user does not have to.

## Classification

- **Type:** new feature
- **Scope:** `mcps/mongodb-memory/` (new migration script + `package.json` entry), reads SQLite via existing `SqliteStorage` adapter, writes MongoDB via existing `MongoStorage` adapter or native driver, modifies a `.env` file on success

## Routing Decision

- **Flow:** Full workflow
- **Rationale:** New behavior-affecting feature that moves user data between backends and rewrites configuration on success. Many small decisions need pinning down through analyze/plan (partial failure, idempotency, dry-run, backup, MongoDB-already-populated handling, verification step). Matches how `WI-pluggable-memory-backend` shipped.
- **Phases:** intake → analyze → propose (conditional) → plan → implement → review → document → repo → archive

## Confirmation

Confirmed by user → yes

## Cancellation

