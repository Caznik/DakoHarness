/**
 * metrics.ts — Retroactive workitem-metrics harvester.
 *
 * RESPONSIBILITIES
 * ----------------
 * - Extract per-sub-feature workflow metrics (AC pass rate, QA iterations,
 *   replan/deviation counts, gaps, calendar-day phase spans) from the markdown
 *   *content* of workitem phase artifacts. Every extractor is a pure
 *   string-in → record-out function with NO filesystem access, so each is
 *   unit-testable on string fixtures (same seam discipline as embed.ts).
 * - Walk the `workitem/` tree (`harvestTree`) — the ONLY fs-touching function
 *   here. It reads artifacts and feeds them to the pure extractors.
 * - Aggregate per-sub-feature records into a project rollup (`computeRollup`).
 *
 * No new runtime dependencies — pure Node string parsing + node:fs.
 *
 * Robustness contract (AC-11): extractors never throw on malformed input. They
 * push a human-readable note onto the caller-supplied `warnings: string[]` and
 * return null/0 for the affected metric. `harvestTree` isolates each
 * sub-feature in its own try/catch so one bad folder never aborts the walk.
 */
/** One harvested metric record per (wi, sub_feature). */
export interface WorkitemMetricsRecord {
    wi: string;
    sub_feature: string;
    project: string;
    ac_total: number;
    ac_satisfied: number | null;
    ac_pass_rate: number | null;
    verdict: string | null;
    qa_iterations: number;
    deviation_count: number;
    dispatch_count: number;
    gaps_open: boolean;
    accepted_gaps: string;
    total_days: number;
    phase_days: Record<string, number>;
    warnings: string[];
    harvested_at: string;
}
/** Ordered phase-date input to parsePhaseDays. */
export interface PhaseDate {
    phase: string;
    date: string | null;
}
/** Project-level aggregation produced by computeRollup. */
export interface WorkitemMetricsRollup {
    wi_count: number;
    avg_ac_pass_rate: number | null;
    avg_qa_iterations: number | null;
    total_replans: number;
    avg_replans: number | null;
    total_gaps_open: number;
    avg_total_days: number | null;
    wi_count_by_status: Record<string, number>;
}
/**
 * Read the leading `---`-fenced YAML block as flat key→value pairs.
 * Tolerates a missing or garbled block by returning {} (AC-11). Only simple
 * `key: value` lines are parsed — nested YAML is out of scope for these artifacts.
 */
export declare function parseFrontmatter(md: string): Record<string, string>;
/**
 * Locate a `## <heading>` section (matched by headingRegex against the heading
 * text) and return its markdown table's data rows — header row and the
 * `|---|` separator excluded. Returns [] when the section or its table is absent.
 */
export declare function tableDataRows(md: string, headingRegex: RegExp): string[];
/**
 * Raw text of a `## <heading>` section body — everything between this heading
 * and the next `## ` heading (or EOF). Returns "" when no matching heading.
 */
export declare function sectionText(md: string, headingRegex: RegExp): string;
/**
 * AC pass rate from review.md. Counts `## AC Verification` data rows. The
 * "Satisfied" column is located by header name (not position) so column
 * reordering does not break parsing. Missing Satisfied column → null metrics
 * + warning (AC-11). verdict comes from frontmatter.
 */
export declare function parseAcMetrics(reviewMd: string, warnings: string[]): {
    ac_total: number;
    ac_satisfied: number | null;
    ac_pass_rate: number | null;
    verdict: string | null;
};
/** QA iterations = data rows in implementation.md `## QA Log`. No table → 0. */
export declare function parseQaIterations(implMd: string): number;
/**
 * Replan/deviation counts. deviation_count = `## Plan Deviations` rows in
 * implementation.md. dispatch_count = distinct `dispatch #<n>` numbers in
 * source_of_truth.md (distinct numbers, not max N — AC-4 / Open Question 4).
 */
export declare function parseReplans(implMd: string, sotMd: string): {
    deviation_count: number;
    dispatch_count: number;
};
/**
 * Gaps from review.md. gaps_open = false iff `## Gaps` body trimmed is empty
 * or starts with "none" (case-insensitive). accepted_gaps = text after
 * "Accepted gaps:" (anywhere in the doc); a literal "none" → "".
 */
export declare function parseGaps(reviewMd: string): {
    gaps_open: boolean;
    accepted_gaps: string;
};
/**
 * Calendar-day phase spans. For each present phase, whole-day delta from the
 * previous *present* phase's date (first present phase = 0). total_days =
 * whole-day delta created → latest present date. UTC-midnight flooring avoids
 * TZ/DST drift on bare YYYY-MM-DD dates.
 */
export declare function parsePhaseDays(phaseDates: PhaseDate[], createdDate: string | null): {
    phase_days: Record<string, number>;
    total_days: number;
};
/**
 * Walk the WI dirs under workitemRoot (each `WI-...` containing
 * `<YYYYMMDD>-<sub>` folders), reading each sub-feature's phase
 * artifacts and the WI-level source_of_truth.md, building one record per
 * sub-feature. Non-`WI-*` entries are skipped (AC-1). A non-existent root
 * returns zero records + a top-level warning (never throws). Each sub-feature
 * is isolated in try/catch so one bad folder yields a record with warnings and
 * the walk continues (AC-11). `project` comes from the arg, not from files.
 */
export declare function harvestTree(workitemRoot: string, project: string): {
    records: WorkitemMetricsRecord[];
    warnings: string[];
};
/**
 * Aggregate records into a project rollup. Averages exclude records missing
 * that metric (nulls filtered before dividing — NOT counted as 0, per AC-7).
 * total_replans = Σ(deviation_count + dispatch_count). wi_count_by_status
 * buckets verdict; null verdict → "unknown".
 */
export declare function computeRollup(records: WorkitemMetricsRecord[]): WorkitemMetricsRollup;
//# sourceMappingURL=metrics.d.ts.map