/**
 * recall-session-messages.test.ts — Tests for `logMessage` inline embed +
 * `recallSessionMessages` adapter method on both SQLite and Mongo backends.
 *
 * All tests use DAKO_EMBED_STUB=1 so embedTexts returns the deterministic
 * FNV-1a fake. Mongo-dependent tests gate on a reachability probe and
 * skip cleanly if Mongo isn't available.
 *
 * AC coverage:
 *   - inline embed happy path (long messages get embedded)         → AC-2
 *   - skip rules (empty / <20 chars / role=tool)                   → AC-3
 *   - embed failure leaves row inserted with null fields           → AC-2 failure mode
 *   - project-wide search across multiple sessions                 → AC-6
 *   - session_id filter narrows to one session                     → AC-5/AC-6
 *   - since filter narrows to a time window                        → AC-5
 *   - no matches → "No matching messages found …" text             → AC-7
 *   - caller-supplied embedding skips server-side embed            → AC-9
 *   - mixed-model rows excluded                                    → AC-8
 *   - SQLite vs Mongo parity                                       → AC-13
 */
export {};
//# sourceMappingURL=recall-session-messages.test.d.ts.map