/**
 * embed-backfill.test.ts — Tests for the embed-backfill one-shot script.
 *
 * Runs via `node --test`. Uses DAKO_EMBED_STUB=1 to skip the real model.
 * Only the SQLite path is exercised here — Mongo path is structurally
 * identical but requires a reachable Mongo (covered separately by
 * recall-hybrid.test.ts's Mongo branch).
 *
 * AC coverage:
 *   - default run embeds missing rows                  → AC-9
 *   - idempotent re-run skips fully-embedded rows      → AC-11
 *   - --force re-embeds every row                      → AC-10
 *   - --dry-run performs no writes                     → AC-10
 *   - unknown flag exits non-zero                      → AC-10
 */
export {};
//# sourceMappingURL=embed-backfill.test.d.ts.map