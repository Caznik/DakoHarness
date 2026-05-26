/**
 * embed.test.ts — Tests for the shared embed module.
 *
 * Runs via `node --test`. All tests use the deterministic stub
 * (DAKO_EMBED_STUB=1) so CI never downloads the real ~30MB model.
 *
 * AC coverage:
 *   - cosine math, floats↔bytes round-trip      → AC-7
 *   - getModelId env reading                     → AC-1
 *   - stub determinism                           → AC-14 (test isolation)
 *   - rrfMerge math (incl. single-side fallback) → AC-5, AC-6
 */
export {};
//# sourceMappingURL=embed.test.d.ts.map