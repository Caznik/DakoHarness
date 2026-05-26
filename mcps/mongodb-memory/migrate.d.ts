/**
 * migrate.ts — One-shot SQLite → MongoDB migrator for the DakoHarness LTM MCP.
 *
 * USAGE
 * -----
 *   npm run migrate              — full migration
 *   npm run migrate -- --dry-run — plan-only, no writes
 *
 * BEHAVIOR
 * --------
 * Reads connection settings from `mcps/mongodb-memory/.env` only. Migrates the four
 * collections (memories, workitems, sessions, messages) from a SQLite backend to
 * MongoDB. Merges by natural key (skips rows whose key already exists in Mongo).
 *
 * Atomicity: on any failure (driver error, verification mismatch, .env rewrite
 * failure, SQLite rename failure), every document inserted by this run is deleted
 * from Mongo, .env is left untouched (or reverted if it was rewritten), and the
 * source SQLite file is not renamed.
 *
 * Pre-flight: if DAKO_STORAGE_BACKEND is already `mongodb` (or empty/unset, which
 * is the running MCP default), the migrator is an idempotent no-op and exits 0.
 *
 * Bypasses Storage facade by design — needs raw row access and bulk insert with
 * `insertedIds` tracking that the facade doesn't (and shouldn't) expose.
 */
export declare function main(argv: string[]): Promise<number>;
export declare function rewriteEnvBackend(envPath: string, newValue: string): void;
//# sourceMappingURL=migrate.d.ts.map