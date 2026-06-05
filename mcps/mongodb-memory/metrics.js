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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
// ── Markdown helpers (shared) ──────────────────────────────────────────────
/**
 * Read the leading `---`-fenced YAML block as flat key→value pairs.
 * Tolerates a missing or garbled block by returning {} (AC-11). Only simple
 * `key: value` lines are parsed — nested YAML is out of scope for these artifacts.
 */
export function parseFrontmatter(md) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
    if (!m)
        return {};
    const out = {};
    for (const line of m[1].split(/\r?\n/)) {
        const idx = line.indexOf(":");
        if (idx <= 0)
            continue; // no key, or garbled line → skip
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim();
        if (key)
            out[key] = val;
    }
    return out;
}
/**
 * Locate a `## <heading>` section (matched by headingRegex against the heading
 * text) and return its markdown table's data rows — header row and the
 * `|---|` separator excluded. Returns [] when the section or its table is absent.
 */
export function tableDataRows(md, headingRegex) {
    const body = sectionText(md, headingRegex);
    if (!body)
        return [];
    const rows = body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("|"));
    // First |-row is the header; second is the |---| separator. Data starts after.
    const dataRows = [];
    let seenHeader = false;
    let seenSeparator = false;
    for (const row of rows) {
        if (!seenHeader) {
            seenHeader = true;
            continue;
        }
        if (!seenSeparator) {
            // The separator row is all dashes/colons/pipes/spaces.
            if (/^\|[\s:\-|]+\|?$/.test(row)) {
                seenSeparator = true;
                continue;
            }
            // No separator present — treat remaining rows as data (best effort).
            seenSeparator = true;
        }
        if (row.length > 1)
            dataRows.push(row);
    }
    return dataRows;
}
/**
 * Raw text of a `## <heading>` section body — everything between this heading
 * and the next `## ` heading (or EOF). Returns "" when no matching heading.
 */
export function sectionText(md, headingRegex) {
    const lines = md.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        const h = /^##\s+(.*)$/.exec(lines[i]);
        if (h && headingRegex.test(h[1])) {
            start = i + 1;
            break;
        }
    }
    if (start === -1)
        return "";
    const collected = [];
    for (let i = start; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i]))
            break;
        collected.push(lines[i]);
    }
    return collected.join("\n");
}
/**
 * Split a markdown table row "| a | b | c |" into trimmed cells. Pipes inside
 * inline `code` spans (e.g. `memories|messages|all`) and backslash-escaped
 * pipes (`\|`) are NOT column delimiters — real artifacts contain both, so a
 * naive split("|") shifts columns and misreads the Satisfied cell.
 */
function tableCells(row) {
    const s = row.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
    const cells = [];
    let cur = "";
    let inCode = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "\\" && s[i + 1] === "|") {
            cur += "|";
            i++;
            continue;
        }
        if (ch === "`") {
            inCode = !inCode;
            cur += ch;
            continue;
        }
        if (ch === "|" && !inCode) {
            cells.push(cur.trim());
            cur = "";
            continue;
        }
        cur += ch;
    }
    cells.push(cur.trim());
    return cells;
}
// ── Extractors (pure) ──────────────────────────────────────────────────────
/**
 * AC pass rate from review.md. Counts `## AC Verification` data rows. The
 * "Satisfied" column is located by header name (not position) so column
 * reordering does not break parsing. Missing Satisfied column → null metrics
 * + warning (AC-11). verdict comes from frontmatter.
 */
export function parseAcMetrics(reviewMd, warnings) {
    const fm = parseFrontmatter(reviewMd);
    const verdict = fm["verdict"] ?? null;
    const headingRe = /AC Verification/;
    const body = sectionText(reviewMd, headingRe);
    const headerLine = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("|"));
    const rows = tableDataRows(reviewMd, headingRe);
    const ac_total = rows.length;
    if (ac_total === 0) {
        return { ac_total: 0, ac_satisfied: null, ac_pass_rate: null, verdict };
    }
    let satisfiedIdx = -1;
    if (headerLine) {
        const headers = tableCells(headerLine).map((h) => h.toLowerCase());
        satisfiedIdx = headers.findIndex((h) => h.includes("satisfied"));
    }
    if (satisfiedIdx === -1) {
        warnings.push("AC Verification table has no 'Satisfied' column — ac_satisfied/ac_pass_rate set null");
        return { ac_total, ac_satisfied: null, ac_pass_rate: null, verdict };
    }
    let ac_satisfied = 0;
    for (const row of rows) {
        const cell = (tableCells(row)[satisfiedIdx] ?? "").toLowerCase();
        if (cell === "yes" || cell === "y")
            ac_satisfied++;
    }
    const ac_pass_rate = ac_total ? ac_satisfied / ac_total : null;
    return { ac_total, ac_satisfied, ac_pass_rate, verdict };
}
/** QA iterations = data rows in implementation.md `## QA Log`. No table → 0. */
export function parseQaIterations(implMd) {
    return tableDataRows(implMd, /QA Log/).length;
}
/**
 * Replan/deviation counts. deviation_count = `## Plan Deviations` rows in
 * implementation.md. dispatch_count = distinct `dispatch #<n>` numbers in
 * source_of_truth.md (distinct numbers, not max N — AC-4 / Open Question 4).
 */
export function parseReplans(implMd, sotMd) {
    const deviation_count = tableDataRows(implMd, /Plan Deviations/).length;
    const seen = new Set();
    const re = /dispatch\s+#(\d+)/gi;
    let m;
    while ((m = re.exec(sotMd)) !== null) {
        seen.add(m[1]);
    }
    return { deviation_count, dispatch_count: seen.size };
}
/**
 * Gaps from review.md. gaps_open = false iff `## Gaps` body trimmed is empty
 * or starts with "none" (case-insensitive). accepted_gaps = text after
 * "Accepted gaps:" (anywhere in the doc); a literal "none" → "".
 */
export function parseGaps(reviewMd) {
    const gapsBody = sectionText(reviewMd, /Gaps/).trim();
    const gaps_open = !(gapsBody.length === 0 || /^none\b/i.test(gapsBody));
    let accepted_gaps = "";
    const m = /Accepted gaps:\s*(.*)/i.exec(reviewMd);
    if (m) {
        const val = m[1].trim();
        accepted_gaps = /^none$/i.test(val) ? "" : val;
    }
    return { gaps_open, accepted_gaps };
}
/**
 * Calendar-day phase spans. For each present phase, whole-day delta from the
 * previous *present* phase's date (first present phase = 0). total_days =
 * whole-day delta created → latest present date. UTC-midnight flooring avoids
 * TZ/DST drift on bare YYYY-MM-DD dates.
 */
export function parsePhaseDays(phaseDates, createdDate) {
    const phase_days = {};
    let prevTs = null;
    let latestTs = null;
    for (const { phase, date } of phaseDates) {
        if (!date)
            continue;
        const ts = utcMidnight(date);
        if (ts === null)
            continue;
        phase_days[phase] = prevTs === null ? 0 : wholeDays(prevTs, ts);
        prevTs = ts;
        if (latestTs === null || ts > latestTs)
            latestTs = ts;
    }
    const createdTs = createdDate ? utcMidnight(createdDate) : null;
    let total_days = 0;
    if (createdTs !== null && latestTs !== null) {
        total_days = wholeDays(createdTs, latestTs);
    }
    return { phase_days, total_days };
}
/** Parse a YYYY-MM-DD date to UTC-midnight epoch ms, or null if unparseable. */
function utcMidnight(date) {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!m)
        return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
/** Whole-day count between two UTC-midnight timestamps. */
function wholeDays(fromTs, toTs) {
    return Math.round((toTs - fromTs) / 86400000);
}
// ── Tree walk (fs) ─────────────────────────────────────────────────────────
/** Ordered phase → artifact-filename map. propose's artifact is approaches.md. */
const PHASE_FILES = [
    { phase: "intake", file: "intake.md" },
    { phase: "analyze", file: "analyze.md" },
    { phase: "propose", file: "approaches.md" },
    { phase: "plan", file: "plan.md" },
    { phase: "implementation", file: "implementation.md" },
    { phase: "review", file: "review.md" },
    { phase: "documentation", file: "documentation.md" },
];
function readIfExists(path) {
    try {
        return readFileSync(path, "utf8");
    }
    catch {
        return null;
    }
}
function isDir(path) {
    try {
        return statSync(path).isDirectory();
    }
    catch {
        return false;
    }
}
/**
 * Walk the WI dirs under workitemRoot (each `WI-...` containing
 * `<YYYYMMDD>-<sub>` folders), reading each sub-feature's phase
 * artifacts and the WI-level source_of_truth.md, building one record per
 * sub-feature. Non-`WI-*` entries are skipped (AC-1). A non-existent root
 * returns zero records + a top-level warning (never throws). Each sub-feature
 * is isolated in try/catch so one bad folder yields a record with warnings and
 * the walk continues (AC-11). `project` comes from the arg, not from files.
 */
export function harvestTree(workitemRoot, project) {
    const topWarnings = [];
    const records = [];
    let wiDirs;
    try {
        wiDirs = readdirSync(workitemRoot);
    }
    catch {
        return { records, warnings: [`workitem_root not readable: ${workitemRoot}`] };
    }
    for (const wi of wiDirs) {
        if (!wi.startsWith("WI-"))
            continue; // AC-1: skip non-WI entries
        const wiPath = join(workitemRoot, wi);
        if (!isDir(wiPath))
            continue;
        const sotMd = readIfExists(join(wiPath, "source_of_truth.md")) ?? "";
        let subDirs;
        try {
            subDirs = readdirSync(wiPath);
        }
        catch {
            topWarnings.push(`WI dir not readable: ${wi}`);
            continue;
        }
        for (const sub of subDirs) {
            const subPath = join(wiPath, sub);
            if (!/^\d{8}-/.test(sub))
                continue; // only <YYYYMMDD>-<sub-feature> folders
            if (!isDir(subPath))
                continue;
            try {
                records.push(buildRecord(wi, sub, project, subPath, sotMd));
            }
            catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                records.push(emptyRecord(wi, sub, project, [`sub-feature harvest failed: ${reason}`]));
            }
        }
    }
    return { records, warnings: topWarnings };
}
function buildRecord(wi, sub, project, subPath, sotMd) {
    const warnings = [];
    const files = {};
    for (const { file } of PHASE_FILES) {
        files[file] = readIfExists(join(subPath, file));
    }
    const reviewMd = files["review.md"] ?? "";
    const implMd = files["implementation.md"] ?? "";
    const ac = parseAcMetrics(reviewMd, warnings);
    const qa_iterations = parseQaIterations(implMd);
    const replans = parseReplans(implMd, sotMd);
    const gaps = parseGaps(reviewMd);
    // created date = first present phase date (intake by ordering), or the
    // sub-folder's YYYYMMDD prefix as a fallback when no frontmatter dates exist.
    const phaseDates = PHASE_FILES.map(({ phase, file }) => {
        const content = files[file];
        const date = content ? (parseFrontmatter(content)["date"] ?? null) : null;
        return { phase, date };
    });
    const firstPresent = phaseDates.find((p) => p.date)?.date ?? subPrefixDate(sub);
    const days = parsePhaseDays(phaseDates, firstPresent);
    return {
        wi, sub_feature: sub, project,
        ac_total: ac.ac_total,
        ac_satisfied: ac.ac_satisfied,
        ac_pass_rate: ac.ac_pass_rate,
        verdict: ac.verdict,
        qa_iterations,
        deviation_count: replans.deviation_count,
        dispatch_count: replans.dispatch_count,
        gaps_open: gaps.gaps_open,
        accepted_gaps: gaps.accepted_gaps,
        total_days: days.total_days,
        phase_days: days.phase_days,
        warnings,
        harvested_at: new Date().toISOString(),
    };
}
/** Convert a `YYYYMMDD-...` folder prefix to a `YYYY-MM-DD` string, or null. */
function subPrefixDate(sub) {
    const m = /^(\d{4})(\d{2})(\d{2})-/.exec(sub);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function emptyRecord(wi, sub, project, warnings) {
    return {
        wi, sub_feature: sub, project,
        ac_total: 0, ac_satisfied: null, ac_pass_rate: null, verdict: null,
        qa_iterations: 0, deviation_count: 0, dispatch_count: 0,
        gaps_open: false, accepted_gaps: "", total_days: 0, phase_days: {},
        warnings, harvested_at: new Date().toISOString(),
    };
}
// ── Rollup ─────────────────────────────────────────────────────────────────
/**
 * Aggregate records into a project rollup. Averages exclude records missing
 * that metric (nulls filtered before dividing — NOT counted as 0, per AC-7).
 * total_replans = Σ(deviation_count + dispatch_count). wi_count_by_status
 * buckets verdict; null verdict → "unknown".
 */
export function computeRollup(records) {
    const avgOf = (vals) => {
        const present = vals.filter((v) => v !== null);
        if (present.length === 0)
            return null;
        return present.reduce((a, b) => a + b, 0) / present.length;
    };
    const total_replans = records.reduce((a, r) => a + r.deviation_count + r.dispatch_count, 0);
    const wi_count_by_status = {};
    for (const r of records) {
        const key = r.verdict ?? "unknown";
        wi_count_by_status[key] = (wi_count_by_status[key] ?? 0) + 1;
    }
    return {
        wi_count: records.length,
        avg_ac_pass_rate: avgOf(records.map((r) => r.ac_pass_rate)),
        avg_qa_iterations: avgOf(records.map((r) => r.qa_iterations)),
        total_replans,
        avg_replans: records.length ? total_replans / records.length : null,
        total_gaps_open: records.filter((r) => r.gaps_open).length,
        avg_total_days: avgOf(records.map((r) => r.total_days)),
        wi_count_by_status,
    };
}
//# sourceMappingURL=metrics.js.map