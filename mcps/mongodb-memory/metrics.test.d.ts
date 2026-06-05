/**
 * metrics.test.ts — Tests for the retroactive workitem-metrics harvester.
 *
 * Structure mirrors recall-session-messages.test.ts: pure string-fixture tests
 * for the extractors (no fs), a mkdtemp fixture-tree test for the fs walk, a
 * SQLite double-write idempotency test, a Mongo equivalent gated on reachability,
 * and a handler test that drives harvestTree → computeRollup → optional persist.
 *
 * AC coverage:
 *   - non-WI dirs skipped, one record per sub-feature folder      → AC-1
 *   - AC Verification table (all-yes / mixed) + verdict           → AC-2
 *   - QA Log row count / no-table → 0                             → AC-3
 *   - Plan Deviations rows + distinct dispatch count              → AC-4
 *   - Gaps None/non-empty + Accepted gaps parse                   → AC-5
 *   - phase-days multi-date deltas + same-day all-zero            → AC-6
 *   - computeRollup aggregates incl. null-metric exclusion        → AC-7
 *   - SQLite/Mongo upsert idempotency (count stays 1)             → AC-8
 *   - handler write:false writes nothing / write:true upserts     → AC-9
 *   - malformed artifacts → null/0 + warnings, walk completes     → AC-11
 */
export {};
//# sourceMappingURL=metrics.test.d.ts.map