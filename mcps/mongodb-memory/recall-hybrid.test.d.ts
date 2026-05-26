/**
 * recall-hybrid.test.ts — Tests for SqliteStorage and MongoStorage tri-mode
 * recall (keyword, vector, hybrid) and inline embed.
 *
 * All tests use DAKO_EMBED_STUB=1 so embedTexts is the deterministic FNV-1a
 * fake. Mongo-dependent tests gate on a reachability probe and process.exit(0)
 * cleanly if Mongo isn't available.
 *
 * AC coverage:
 *   - inline embed happy path                              → AC-3
 *   - graceful insert on embed failure                     → AC-3 failure mode
 *   - auto-detect mode selection                           → AC-4 (default)
 *   - explicit modes (keyword / vector / hybrid)           → AC-4
 *   - mode=vector with no embeddings throws helpful error  → AC-4 error
 *   - vector half excludes mismatched embedding_model      → AC-8
 *   - single-side fallback (FTS empty, vec hits)           → AC-6
 *   - hybrid RRF math via synthetic vectors                → AC-5
 *   - SQLite vs Mongo behavioral parity                    → AC-7
 */
export {};
//# sourceMappingURL=recall-hybrid.test.d.ts.map