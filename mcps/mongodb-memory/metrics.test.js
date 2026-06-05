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
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import Database from "better-sqlite3";
import * as dotenv from "dotenv";
import { SqliteStorage } from "./storage/SqliteStorage.js";
import { MongoStorage } from "./storage/MongoStorage.js";
import { parseFrontmatter, tableDataRows, sectionText, parseAcMetrics, parseQaIterations, parseReplans, parseGaps, parsePhaseDays, harvestTree, computeRollup, } from "./metrics.js";
import { handleHarvestWorkitemMetrics } from "./server.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, ".env");
// ── Mongo reachability probe ─────────────────────────────────────────────
async function mongoReachable(uri) {
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
    try {
        await c.connect();
        await c.db("admin").command({ ping: 1 });
        await c.close();
        return true;
    }
    catch {
        try {
            await c.close();
        }
        catch { /* ignore */ }
        return false;
    }
}
const probeEnv = fs.existsSync(ENV_PATH) ? dotenv.parse(fs.readFileSync(ENV_PATH)) : {};
const PROBE_URI = probeEnv["MONGO_URI"] ?? process.env["MONGO_URI"] ?? "mongodb://dako:harness@localhost:27017/?authSource=admin";
const MONGO_OK = await mongoReachable(PROBE_URI);
// ── parseFrontmatter (AC-11 tolerance) ────────────────────────────────────
test("parseFrontmatter reads leading --- block", () => {
    const md = `---\nwi: WI-x/2026-y\nphase: review\nverdict: pass\n---\n\n## Body`;
    const fm = parseFrontmatter(md);
    assert.equal(fm["phase"], "review");
    assert.equal(fm["verdict"], "pass");
});
test("parseFrontmatter returns {} on missing / garbled block (AC-11)", () => {
    assert.deepEqual(parseFrontmatter("no frontmatter here"), {});
    assert.deepEqual(parseFrontmatter("---\ngarbled no colon line\n---\nbody"), {});
});
// ── tableDataRows / sectionText ────────────────────────────────────────────
test("tableDataRows excludes header + separator, returns data rows", () => {
    const md = `## AC Verification\n| AC | Satisfied | Notes |\n|---|---|---|\n| AC-1 | yes | ok |\n| AC-2 | no | gap |\n\n## Next`;
    const rows = tableDataRows(md, /AC Verification/);
    assert.equal(rows.length, 2);
    assert.ok(rows[0].includes("AC-1"));
});
test("tableDataRows returns [] when section or table absent", () => {
    assert.deepEqual(tableDataRows("## Other\ntext", /AC Verification/), []);
    assert.deepEqual(tableDataRows("## AC Verification\nno table here", /AC Verification/), []);
});
test("sectionText returns the body of a heading section", () => {
    const md = `## Gaps\nNone.\n\n## Verdict\npass`;
    assert.equal(sectionText(md, /Gaps/).trim(), "None.");
});
// ── parseAcMetrics (AC-2, AC-11) ───────────────────────────────────────────
test("parseAcMetrics all-yes → rate 1.0 + verdict from frontmatter (AC-2)", () => {
    const rows = Array.from({ length: 14 }, (_, i) => `| AC-${i + 1} | yes | ok |`).join("\n");
    const md = `---\nverdict: pass\n---\n## AC Verification\n| AC | Satisfied | Notes |\n|---|---|---|\n${rows}\n`;
    const m = parseAcMetrics(md, []);
    assert.equal(m.ac_total, 14);
    assert.equal(m.ac_satisfied, 14);
    assert.equal(m.ac_pass_rate, 1.0);
    assert.equal(m.verdict, "pass");
});
test("parseAcMetrics mixed yes/no → fractional rate (AC-2)", () => {
    const md = `---\nverdict: fail\n---\n## AC Verification\n| AC | Satisfied | Notes |\n|---|---|---|\n| AC-1 | yes | ok |\n| AC-2 | no | gap |\n| AC-3 | yes | ok |\n| AC-4 | no | gap |\n`;
    const m = parseAcMetrics(md, []);
    assert.equal(m.ac_total, 4);
    assert.equal(m.ac_satisfied, 2);
    assert.equal(m.ac_pass_rate, 0.5);
    assert.equal(m.verdict, "fail");
});
test("parseAcMetrics ignores pipes inside code spans + escapes (AC-2)", () => {
    // The AC-2 row's evidence cell contains a literal pipe inside a code span
    // (`a|b|c`) and an escaped pipe (\|) — neither is a column delimiter.
    const md = `---\nverdict: pass\n---\n## AC Verification\n| AC | Satisfied | Notes |\n|---|---|---|\n| AC-1 | yes | plain row |\n| AC-2 | yes | \`--collection memories|messages|all\` and a\\|b |\n`;
    const m = parseAcMetrics(md, []);
    assert.equal(m.ac_total, 2);
    assert.equal(m.ac_satisfied, 2, "code-span pipe must not shift the Satisfied column");
    assert.equal(m.ac_pass_rate, 1.0);
});
test("parseAcMetrics no table → ac_total 0, pass_rate null", () => {
    const m = parseAcMetrics("---\nverdict: pass\n---\nno table", []);
    assert.equal(m.ac_total, 0);
    assert.equal(m.ac_pass_rate, null);
});
test("parseAcMetrics missing Satisfied column → null + warning (AC-11)", () => {
    const warnings = [];
    const md = `## AC Verification\n| AC | Notes |\n|---|---|\n| AC-1 | ok |\n`;
    const m = parseAcMetrics(md, warnings);
    assert.equal(m.ac_satisfied, null);
    assert.equal(m.ac_pass_rate, null);
    assert.ok(warnings.length > 0, "warning pushed for missing column");
});
// ── parseQaIterations (AC-3) ───────────────────────────────────────────────
test("parseQaIterations counts QA Log data rows (AC-3)", () => {
    const md = `## QA Log\n| Iteration | AC | Result | Action |\n|---|---|---|---|\n| 1 | AC-1 | pass | added test |\n| 2 | AC-2 | pass | fixed bug |\n| 3 | AC-3 | pass | none |\n`;
    assert.equal(parseQaIterations(md), 3);
});
test("parseQaIterations no table → 0 (AC-3)", () => {
    assert.equal(parseQaIterations("## QA Log\n(empty)"), 0);
    assert.equal(parseQaIterations("no qa log section"), 0);
});
// ── parseReplans (AC-4) ────────────────────────────────────────────────────
test("parseReplans counts deviations + distinct dispatches (AC-4)", () => {
    const impl = `## Plan Deviations\n| Step | Original | Actual | Reason |\n|---|---|---|---|\n| 1 | a | b | c |\n| 2 | d | e | f |\n`;
    const sot = `dispatched implementer dispatch #1\nfeedback came back\ndispatch #2 re-dispatched\ndispatch #2 mention again\n`;
    const m = parseReplans(impl, sot);
    assert.equal(m.deviation_count, 2);
    assert.equal(m.dispatch_count, 2, "distinct dispatch numbers, not max N");
});
test("parseReplans absent → 0/0 (AC-4)", () => {
    const m = parseReplans("no deviations table", "no dispatch lines");
    assert.equal(m.deviation_count, 0);
    assert.equal(m.dispatch_count, 0);
});
// ── parseGaps (AC-5) ───────────────────────────────────────────────────────
test("parseGaps None. → gaps_open false (AC-5)", () => {
    const md = `## Gaps\nNone.\n\n## Verdict\nAccepted gaps: none`;
    const m = parseGaps(md);
    assert.equal(m.gaps_open, false);
    assert.equal(m.accepted_gaps, "");
});
test("parseGaps non-empty → gaps_open true + accepted text (AC-5)", () => {
    const md = `## Gaps\nAC-7 rollup edge case not covered.\n\n## Verdict\nAccepted gaps: AC-7 deferred to follow-up`;
    const m = parseGaps(md);
    assert.equal(m.gaps_open, true);
    assert.equal(m.accepted_gaps, "AC-7 deferred to follow-up");
});
// ── parsePhaseDays (AC-6) ──────────────────────────────────────────────────
test("parsePhaseDays whole-day deltas from previous present phase (AC-6)", () => {
    const phases = [
        { phase: "intake", date: "2026-06-01" },
        { phase: "analyze", date: null },
        { phase: "propose", date: null },
        { phase: "plan", date: "2026-06-03" },
        { phase: "implementation", date: null },
        { phase: "review", date: "2026-06-03" },
        { phase: "documentation", date: null },
    ];
    const m = parsePhaseDays(phases, "2026-06-01");
    assert.equal(m.phase_days["intake"], 0, "first present phase = 0");
    assert.equal(m.phase_days["plan"], 2, "plan = 2 days after intake");
    assert.equal(m.phase_days["review"], 0, "review same day as plan");
    assert.equal(m.total_days, 2, "created → latest = 2 whole days");
});
test("parsePhaseDays same-day → all zero (AC-6)", () => {
    const phases = [
        { phase: "intake", date: "2026-06-05" },
        { phase: "plan", date: "2026-06-05" },
        { phase: "review", date: "2026-06-05" },
    ];
    const m = parsePhaseDays(phases, "2026-06-05");
    assert.equal(m.phase_days["intake"], 0);
    assert.equal(m.phase_days["plan"], 0);
    assert.equal(m.phase_days["review"], 0);
    assert.equal(m.total_days, 0);
});
// ── computeRollup (AC-7) ───────────────────────────────────────────────────
function rec(partial) {
    return {
        wi: "WI-x", sub_feature: "20260101-a", project: "P",
        ac_total: 0, ac_satisfied: 0, ac_pass_rate: null, verdict: null,
        qa_iterations: 0, deviation_count: 0, dispatch_count: 0,
        gaps_open: false, accepted_gaps: "", total_days: 0, phase_days: {},
        warnings: [], harvested_at: "2026-06-05T00:00:00.000Z",
        ...partial,
    };
}
test("computeRollup aggregates; null-metric excluded from its average (AC-7)", () => {
    const records = [
        rec({ ac_pass_rate: 1.0, qa_iterations: 2, deviation_count: 1, dispatch_count: 1, gaps_open: true, total_days: 4, verdict: "pass" }),
        rec({ ac_pass_rate: 0.5, qa_iterations: 4, deviation_count: 0, dispatch_count: 0, gaps_open: false, total_days: 2, verdict: "fail" }),
        rec({ ac_pass_rate: null, qa_iterations: 0, deviation_count: 1, dispatch_count: 0, gaps_open: false, total_days: 0, verdict: null }),
    ];
    const r = computeRollup(records);
    // avg over the two non-null pass rates only: (1.0 + 0.5)/2 = 0.75 (NOT /3)
    assert.equal(r.avg_ac_pass_rate, 0.75);
    assert.equal(r.avg_qa_iterations, (2 + 4 + 0) / 3);
    assert.equal(r.total_replans, 1 + 1 + 0 + 0 + 1 + 0); // Σ(dev+dispatch) = 3
    assert.equal(r.avg_replans, 3 / 3);
    assert.equal(r.total_gaps_open, 1);
    assert.equal(r.avg_total_days, (4 + 2 + 0) / 3);
    assert.deepEqual(r.wi_count_by_status, { pass: 1, fail: 1, unknown: 1 });
});
test("computeRollup avg_ac_pass_rate null when all rates null (AC-7)", () => {
    const r = computeRollup([rec({}), rec({})]);
    assert.equal(r.avg_ac_pass_rate, null);
});
// ── harvestTree fixture-tree walk (AC-1, AC-11) ────────────────────────────
function writeFile(p, content) {
    fs.mkdirSync(dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
}
function buildFixtureTree() {
    const root = fs.mkdtempSync(join(os.tmpdir(), "dako-metrics-"));
    // WI-alpha / two sub-features
    writeFile(join(root, "WI-alpha", "source_of_truth.md"), "dispatch #1\ndispatch #1\n");
    writeFile(join(root, "WI-alpha", "20260601-one", "intake.md"), "---\nphase: intake\ndate: 2026-06-01\n---\n");
    writeFile(join(root, "WI-alpha", "20260601-one", "plan.md"), "---\nphase: plan\ndate: 2026-06-02\n---\n");
    writeFile(join(root, "WI-alpha", "20260601-one", "implementation.md"), "## QA Log\n| It | AC | Res | Act |\n|---|---|---|---|\n| 1 | AC-1 | pass | x |\n\n## Plan Deviations\n| S | O | A | R |\n|---|---|---|---|\n| 1 | a | b | c |\n");
    writeFile(join(root, "WI-alpha", "20260601-one", "review.md"), "---\nverdict: pass\n---\n## AC Verification\n| AC | Satisfied | Notes |\n|---|---|---|\n| AC-1 | yes | ok |\n| AC-2 | yes | ok |\n\n## Gaps\nNone.\n\n## Verdict\nAccepted gaps: none\n");
    writeFile(join(root, "WI-alpha", "20260603-two", "review.md"), "---\nverdict: fail\n---\n## AC Verification\n| AC | Satisfied | Notes |\n|---|---|---|\n| AC-1 | yes | ok |\n| AC-2 | no | gap |\n\n## Gaps\nAC-2 not handled.\n");
    // WI-beta / one malformed sub-feature (garbled frontmatter + missing Satisfied col)
    writeFile(join(root, "WI-beta", "20260604-bad", "review.md"), "---\ngarbled no colon\n---\n## AC Verification\n| AC | Notes |\n|---|---|\n| AC-1 | ? |\n");
    // Non-WI dir that must be skipped
    writeFile(join(root, "notes", "scratch.md"), "ignore me");
    writeFile(join(root, "README.md"), "ignore me too");
    return root;
}
test("harvestTree one record per sub-feature; non-WI skipped (AC-1)", () => {
    const root = buildFixtureTree();
    try {
        const { records } = harvestTree(root, "P");
        // 3 sub-features total: alpha/one, alpha/two, beta/bad
        assert.equal(records.length, 3, "one record per sub-feature folder, non-WI skipped");
        const subs = records.map((r) => r.sub_feature).sort();
        assert.deepEqual(subs, ["20260601-one", "20260603-two", "20260604-bad"]);
        const alphaOne = records.find((r) => r.sub_feature === "20260601-one");
        assert.equal(alphaOne.wi, "WI-alpha");
        assert.equal(alphaOne.project, "P");
        assert.equal(alphaOne.ac_total, 2);
        assert.equal(alphaOne.ac_satisfied, 2);
        assert.equal(alphaOne.ac_pass_rate, 1.0);
        assert.equal(alphaOne.verdict, "pass");
        assert.equal(alphaOne.qa_iterations, 1);
        assert.equal(alphaOne.deviation_count, 1);
        assert.equal(alphaOne.dispatch_count, 1, "distinct dispatch #1");
        assert.equal(alphaOne.gaps_open, false);
        assert.equal(alphaOne.phase_days["plan"], 1);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
test("harvestTree malformed sub-feature → warnings, walk completes (AC-11)", () => {
    const root = buildFixtureTree();
    try {
        const { records } = harvestTree(root, "P");
        assert.equal(records.length, 3, "all records returned despite one malformed");
        const bad = records.find((r) => r.sub_feature === "20260604-bad");
        assert.equal(bad.ac_satisfied, null, "missing Satisfied col → null");
        assert.ok(bad.warnings.length > 0, "warnings populated for malformed sub-feature");
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
test("harvestTree non-existent root → zero records + top-level warning (AC-11)", () => {
    const { records, warnings } = harvestTree(join(os.tmpdir(), "dako-does-not-exist-" + randomUUID()), "P");
    assert.equal(records.length, 0);
    assert.ok(warnings && warnings.length > 0, "top-level warning, no throw");
});
// ── SQLite persistence idempotency (AC-8) ──────────────────────────────────
function newSqliteStorage() {
    const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "dako-metrics-sqlite-"));
    const dbPath = join(tmpDir, "memory.db");
    const storage = SqliteStorage.create(dbPath);
    return { storage, tmpDir, dbPath };
}
test("[sqlite] saveWorkitemMetrics upsert keeps one row per (wi, sub_feature) (AC-8)", async () => {
    const { storage, tmpDir, dbPath } = newSqliteStorage();
    try {
        const r = rec({ wi: "WI-x", sub_feature: "20260101-a", ac_pass_rate: 1.0, qa_iterations: 2 });
        await storage.saveWorkitemMetrics([r]);
        await storage.saveWorkitemMetrics([{ ...r, qa_iterations: 5 }]); // re-harvest, updated value
        const db = new Database(dbPath, { readonly: true });
        const count = db.prepare(`SELECT COUNT(*) c FROM workitem_metrics`).get().c;
        const row = db.prepare(`SELECT qa_iterations FROM workitem_metrics WHERE wi=? AND sub_feature=?`).get("WI-x", "20260101-a");
        db.close();
        assert.equal(count, 1, "double-write stays one row");
        assert.equal(row.qa_iterations, 5, "upsert overwrote with newer value");
        const back = await storage.getWorkitemMetrics("P");
        assert.equal(back.length, 1);
        assert.equal(back[0].ac_pass_rate, 1.0);
    }
    finally {
        void storage.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
// ── harvest_workitem_metrics handler (AC-9) ────────────────────────────────
test("[sqlite] handler write:false writes nothing; write:true upserts (AC-9)", async () => {
    const root = buildFixtureTree();
    const { storage, tmpDir } = newSqliteStorage();
    try {
        // write:false → store stays empty
        const ro = await handleHarvestWorkitemMetrics(storage, { project: "P", workitem_root: root, write: false });
        assert.ok(ro.content[0].text.includes("rollup") || ro.content[0].text.includes("avg_"), "returns metrics+rollup text");
        assert.equal((await storage.getWorkitemMetrics("P")).length, 0, "write:false persisted nothing");
        // write:true → upserts all 3 records
        await handleHarvestWorkitemMetrics(storage, { project: "P", workitem_root: root, write: true });
        assert.equal((await storage.getWorkitemMetrics("P")).length, 3, "write:true upserted records");
    }
    finally {
        void storage.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        fs.rmSync(root, { recursive: true, force: true });
    }
});
// ── Mongo equivalents (gated) ──────────────────────────────────────────────
if (!MONGO_OK) {
    console.log("skipped: Mongo unreachable at " + PROBE_URI);
}
else {
    test("[mongo] saveWorkitemMetrics upsert keeps one doc per (wi, sub_feature) (AC-8)", async () => {
        const uri = PROBE_URI;
        const dbName = `dako_metrics_test_${randomUUID().slice(0, 8)}`;
        const storage = await MongoStorage.create(uri, dbName);
        try {
            const r = rec({ wi: "WI-x", sub_feature: "20260101-a", ac_pass_rate: 1.0, qa_iterations: 2 });
            await storage.saveWorkitemMetrics([r]);
            await storage.saveWorkitemMetrics([{ ...r, qa_iterations: 5 }]);
            const client = new MongoClient(uri);
            await client.connect();
            const docs = await client.db(dbName).collection("workitem_metrics").find({ wi: "WI-x", sub_feature: "20260101-a" }).toArray();
            await client.close();
            assert.equal(docs.length, 1, "double-write stays one doc");
            assert.equal(docs[0]["qa_iterations"], 5);
            const back = await storage.getWorkitemMetrics("P");
            assert.equal(back.length, 1);
        }
        finally {
            const c = new MongoClient(uri);
            await c.connect();
            await c.db(dbName).dropDatabase();
            await c.close();
            await storage.close();
        }
    });
}
//# sourceMappingURL=metrics.test.js.map