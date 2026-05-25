---
wi: WI-pluggable-memory-backend/20260525-storage-interface
phase: propose
status: confirmed
date: 2026-05-25
triggered: yes
---

## Context

The analyze phase locked everything except **the shape of the storage abstraction itself**. Three viable shapes exist; the choice has real downstream consequences for how tool handlers are written, how SQLite/MongoDB asymmetries leak, and how AC-9 (vector forward-compat) attaches later.

## Approach A — Domain-method facade

**Summary:**
The `Storage` interface exposes one method per logical MCP-tool operation — exactly 12 methods matching the 12 current tools (`remember`, `recall`, `getContext`, `promoteToTeam`, `forget`, `listMemories`, `archiveWorkitem`, `startSession`, `logMessage`, `getSession`, `listSessions`, `getSystemStatus`). Each adapter (`MongoStorage`, `SqliteStorage`) implements all 12. Tool handlers become one-liners: `return await storage.recall(args)`. Each adapter is free to choose its own internal query strategy.

**Pros:**
- 1-to-1 with MCP tools — trivial to navigate (`Ctrl+click` from tool handler to adapter impl).
- Each adapter optimizes per operation (Mongo `$text` + sort by `$meta`; SQLite FTS5 + `bm25`).
- Forward-compat for vector (AC-9) is local: extend the `recall` signature with an optional `embedding?: number[]` — no other method touched.
- Strong type safety — every operation has its own typed args/return.
- No leaky filter/query abstraction — adapter internals stay private.

**Cons:**
- 12-method interface — larger surface area than B.
- Some boilerplate duplication ("wrap an `insertOne`") repeated across adapters.
- Adding a 13th MCP tool requires touching the interface and both adapters.

**Effort:** medium

---

## Approach B — Repository pattern (per-collection CRUD + textSearch)

**Summary:**
Four repos behind the abstraction: `MemoriesRepo`, `WorkitemsRepo`, `SessionsRepo`, `MessagesRepo`. Each exposes a small uniform contract: `insert`, `findOne`, `find`, `updateOne`, `deleteMany`, `textSearch`. Tool handlers become orchestration code — `recall` calls `memories.textSearch(...)`; `getContext` calls three repos and assembles. Adapters provide a Mongo-flavoured and SQLite-flavoured implementation of each repo.

**Pros:**
- Smaller, uniform interface (6 methods × 4 repos = repeating shape, fewer concepts to learn).
- Adding a new collection is just adding a new repo — interface stays untouched.
- Cleaner separation: "domain logic" lives in tool handlers, "storage" lives in repos.

**Cons:**
- Filter-object semantics differ between Mongo (rich BSON) and SQLite (SQL `WHERE`) — either we limit filters to a tiny common subset (loses Mongo power) or we leak query-language details (loses abstraction).
- Text-search ranking differs (Mongo `$meta textScore` vs SQLite `bm25()`) — abstraction can't fully hide it; `textSearch` becomes "best-effort equivalent".
- Forward-compat for vector adds a new method (`vectorSearch`) on `MemoriesRepo` — the "uniform repo" promise weakens.
- More indirection per tool handler — harder to read end-to-end flow.

**Effort:** medium-high (filter abstraction is the hard part)

---

## Approach C — Operation-bus / typed-op union

**Summary:**
A single `storage.execute(op)` method where `op` is a TypeScript discriminated union (`{ kind: 'remember', args: {...} } | { kind: 'recall', args: {...} } | ...`). Each adapter implements one big `switch (op.kind)`. Tool handlers build an op descriptor and dispatch.

**Pros:**
- Smallest possible interface (1 method).
- Easy to add cross-cutting concerns (logging, retry, metrics, replay) — every op flows through one chokepoint.
- A future RPC/IPC transport would be a natural fit (the op union serializes cleanly).

**Cons:**
- Functionally identical to Approach A but with worse ergonomics: navigating from a tool handler into the adapter requires hopping through `execute` → `switch`.
- Type narrowing in the discriminated `switch` is fiddly; easy to silently miss a case.
- Builds machinery (the bus, the op envelope) that nothing in v1 needs — pattern-matching CLAUDE.md's "avoid abstractions beyond what the task requires" warning.

**Effort:** medium (interface is small, but the switch + return-type plumbing eats the savings)

---

## Selected Approach

**Choice:** Approach A — Domain-method facade
**Rationale:** 1-to-1 mapping with the 12 MCP tools keeps the code easy to navigate; each adapter can choose its own internal query strategy without leaking filter/ranking semantics; vector forward-compat (AC-9) attaches locally to `recall` rather than introducing a parallel method; no premature abstraction.

## Confirmation

**Confirmed by user:** yes
**Notes:**

## Cancellation

*(Fill only if status: cancelled)*
**Cancelled at phase:** propose
**Reason:**
