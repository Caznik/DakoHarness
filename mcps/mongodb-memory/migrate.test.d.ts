/**
 * migrate.test.ts — Tests for the SQLite -> Mongo migrator.
 *
 * Runs via `node --test`. Tests use a per-run Mongo database name so parallel
 * runs don't collide; the database is dropped on teardown. If Mongo is
 * unreachable, the suite prints a skip note and exits 0 — so CI can run this
 * file without a Mongo instance available.
 *
 * Test coverage map (one test per AC group):
 *   - happy path                — AC-1, AC-3, AC-4, AC-8, AC-9, AC-11
 *   - pre-flight no-op          — AC-10, AC-12
 *   - dry-run                   — AC-7, AC-12
 *   - re-runnability            — AC-13
 *   - insert-failure rollback   — AC-5 (insert path)
 *   - verification rollback     — AC-5 (verification path), AC-6
 *   - missing env keys          — AC-2, AC-12
 *
 * NOTE on `.env` handling: the migrator reads `.env` from the same directory
 * as the compiled `migrate.js`. The test temporarily swaps that file with a
 * test fixture and restores the original in a finally block.
 */
export {};
//# sourceMappingURL=migrate.test.d.ts.map