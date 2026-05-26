/**
 * embed-backfill.ts — One-shot script that walks every `memories` row in the
 * configured storage backend and writes an `embedding` + `embedding_model`
 * value when it's missing or stale.
 *
 * USAGE
 * -----
 *   npm run embed-backfill              — idempotent backfill (skip rows already
 *                                          embedded with the current model)
 *   npm run embed-backfill -- --dry-run — read-only, print plan, no writes
 *   npm run embed-backfill -- --force   — re-embed every row regardless of state
 *
 * DESIGN
 * ------
 * Mirrors migrate.ts: loads .env from the same directory as the compiled .js,
 * validates DAKO_STORAGE_BACKEND, opens the matching backend directly via the
 * raw driver (bypasses the Storage facade — we need raw row access and bulk
 * read/write that the facade doesn't expose).
 *
 * Per-chunk error isolation: a thrown embed call for one chunk logs the error,
 * increments a counter, and continues. Backfill is repeatable, so partial
 * progress is fine — different from the migrator's all-or-nothing semantics.
 *
 * Returns 0 on success (errors == 0), 1 otherwise (errors > 0, or fatal pre-flight).
 */
export declare function main(argv: string[]): Promise<number>;
//# sourceMappingURL=embed-backfill.d.ts.map