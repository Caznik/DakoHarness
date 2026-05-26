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
import * as dotenv from "dotenv";
import * as fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { MongoClient, ObjectId } from "mongodb";
// ── Paths & types ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, ".env");
const COLLECTIONS = ["memories", "workitems", "sessions", "messages"];
// ── Entry point ────────────────────────────────────────────────────────────
export async function main(argv) {
    const dryRun = argv.includes("--dry-run");
    // Step 1: env load + validation
    if (!fs.existsSync(ENV_PATH)) {
        console.error(`Error: .env file not found at expected path: ${ENV_PATH}`);
        return 1;
    }
    // override: true so that calling main() multiple times in the same process
    // (notably in tests) actually picks up the latest .env on disk rather than
    // returning the cached value from a previous load.
    dotenv.config({ path: ENV_PATH, override: true });
    const backend = (process.env["DAKO_STORAGE_BACKEND"] ?? "").trim();
    // Step 1: AC-10 pre-flight — already on mongodb (empty/unset/mongodb all mean "no-op")
    if (backend === "" || backend === "mongodb") {
        console.log("Backend is already mongodb — nothing to migrate.");
        return 0;
    }
    if (backend !== "sqlite") {
        console.error(`Error: DAKO_STORAGE_BACKEND='${backend}' is not 'sqlite'; cannot migrate. Allowed values: sqlite, mongodb.`);
        return 1;
    }
    const sqlitePath = process.env["DAKO_SQLITE_PATH"];
    const mongoUri = process.env["MONGO_URI"];
    const mongoDb = process.env["MONGO_DB"];
    const missing = [];
    if (!sqlitePath)
        missing.push("DAKO_SQLITE_PATH");
    if (!mongoUri)
        missing.push("MONGO_URI");
    if (!mongoDb)
        missing.push("MONGO_DB");
    if (missing.length > 0) {
        console.error(`Error: required env var(s) missing from ${ENV_PATH}: ${missing.join(", ")}`);
        return 1;
    }
    if (!fs.existsSync(sqlitePath)) {
        console.error(`Error: SQLite file not found at DAKO_SQLITE_PATH=${sqlitePath}`);
        return 1;
    }
    // ── Open both backends ───────────────────────────────────────────────────
    const startedAt = Date.now();
    let sqlite = null;
    let mongoClient = null;
    const inserted = { memories: [], workitems: [], sessions: [], messages: [] };
    let envRewritten = false;
    let envOriginal = null;
    try {
        sqlite = new Database(sqlitePath, { readonly: true });
        mongoClient = new MongoClient(mongoUri);
        await mongoClient.connect();
        const db = mongoClient.db(mongoDb);
        // Step 2 + 3: per-collection plan (read SQLite, dedup against Mongo)
        const plans = {
            memories: buildMemoriesPlan(sqlite),
            workitems: buildWorkitemsPlan(sqlite),
            sessions: buildSessionsPlan(sqlite),
            messages: buildMessagesPlan(sqlite),
        };
        await dedupAgainstMongo(db, plans);
        // Step 4: dry-run path — print plan, exit 0, no writes
        if (dryRun) {
            for (const col of COLLECTIONS) {
                const p = plans[col];
                const total = p.toInsert.length + p.skipCount;
                process.stdout.write(`[${col}] would-insert ${p.toInsert.length}, would-skip ${p.skipCount} (${p.toInsert.length}+${p.skipCount}/${total}) …dry-run\n`);
            }
            process.stdout.write("\nno writes performed (--dry-run)\n");
            return 0;
        }
        // Step 5: insert with rollback tracking + Step 6: verify + Step 7: progress
        const results = {
            memories: emptyResult(plans.memories),
            workitems: emptyResult(plans.workitems),
            sessions: emptyResult(plans.sessions),
            messages: emptyResult(plans.messages),
        };
        for (const col of COLLECTIONS) {
            const plan = plans[col];
            const t0 = Date.now();
            const collection = db.collection(col);
            const beforeCount = await collection.countDocuments();
            if (plan.toInsert.length > 0) {
                try {
                    const result = await collection.insertMany(plan.toInsert, { ordered: true });
                    const ids = Object.values(result.insertedIds);
                    inserted[col].push(...ids);
                }
                catch (insertErr) {
                    // BulkWriteError carries the ids that DID succeed before the failure.
                    // Across driver versions, partial-success info has been on different paths:
                    //   v5: err.result.insertedIds (object keyed by index)
                    //   v6+: err.result.insertedIds  OR  err.insertedIds  OR  err.insertedDocs
                    // We probe defensively and capture every ObjectId we can find for rollback.
                    const e = insertErr;
                    const partialMap = e?.result?.insertedIds ?? e?.insertedIds;
                    if (partialMap) {
                        inserted[col].push(...Object.values(partialMap));
                    }
                    else if (Array.isArray(e?.insertedDocs)) {
                        for (const d of e.insertedDocs) {
                            if (d && d._id)
                                inserted[col].push(d._id);
                        }
                    }
                    throw insertErr;
                }
            }
            // Step 6: per-collection verification — read == inserted + skipped, AND delta is sane
            const afterCount = await collection.countDocuments();
            const delta = afterCount - beforeCount;
            if (delta !== inserted[col].length) {
                throw new Error(`Verification failed for [${col}]: Mongo delta ${delta} != inserted ${inserted[col].length}`);
            }
            if (plan.readCount !== inserted[col].length + plan.skipCount) {
                throw new Error(`Verification failed for [${col}]: read ${plan.readCount} != inserted ${inserted[col].length} + skipped ${plan.skipCount}`);
            }
            const elapsed = Date.now() - t0;
            results[col] = { read: plan.readCount, inserted: inserted[col].length, skipped: plan.skipCount, durationMs: elapsed };
            // Step 7: progress line
            const total = inserted[col].length + plan.skipCount;
            process.stdout.write(`[${col}] inserted ${inserted[col].length}, skipped ${plan.skipCount} (${inserted[col].length}+${plan.skipCount}/${total}) ✓\n`);
        }
        // Step 8: .env rewrite (atomic .tmp + renameSync)
        envOriginal = { bytes: fs.readFileSync(ENV_PATH), existed: true };
        rewriteEnvBackend(ENV_PATH, "mongodb");
        envRewritten = true;
        // Step 9: close SQLite handle BEFORE rename (Windows file lock) and rename to .bak-<unix>
        sqlite.close();
        sqlite = null;
        const bakPath = `${sqlitePath}.bak-${Math.floor(Date.now() / 1000)}`;
        try {
            fs.renameSync(sqlitePath, bakPath);
        }
        catch (renameErr) {
            // Revert .env (Step 9 ordering rule), then rollback Mongo
            try {
                fs.writeFileSync(ENV_PATH, envOriginal.bytes);
                envRewritten = false;
            }
            catch {
                // Best-effort revert; carry on to surface the original error.
            }
            throw renameErr;
        }
        // Step 10: final summary
        const totalMs = Date.now() - startedAt;
        printSummary(results, bakPath, totalMs);
        return 0;
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Migration failed: ${reason}\n`);
        // Rollback Mongo inserts (manual delete, no transactions assumed)
        if (mongoClient) {
            try {
                const db = mongoClient.db(mongoDb);
                await rollback(db, inserted);
            }
            catch (rbErr) {
                const rbReason = rbErr instanceof Error ? rbErr.message : String(rbErr);
                process.stderr.write(`Warning: rollback encountered an error: ${rbReason}\n`);
            }
        }
        // Revert .env if it was already rewritten before the failure
        if (envRewritten && envOriginal) {
            try {
                fs.writeFileSync(ENV_PATH, envOriginal.bytes);
            }
            catch (e) {
                process.stderr.write(`Warning: failed to revert .env: ${e.message}\n`);
            }
        }
        return 1;
    }
    finally {
        if (sqlite) {
            try {
                sqlite.close();
            }
            catch { /* best effort */ }
        }
        if (mongoClient) {
            try {
                await mongoClient.close();
            }
            catch { /* best effort */ }
        }
    }
}
// ── SQLite readers + field translation (Step 2) ──────────────────────────
function buildMemoriesPlan(sqlite) {
    const rows = sqlite.prepare(`SELECT * FROM memories`).all();
    const docs = rows.map((r) => {
        // Drop integer id; parse tags JSON; ISO string -> Date
        let tags = [];
        try {
            tags = JSON.parse(r["tags"] ?? "[]");
        }
        catch {
            tags = [];
        }
        const doc = {
            project: r["project"],
            agent: r["agent"],
            type: r["type"],
            title: r["title"],
            content: r["content"],
            tags,
            scope: r["scope"] ?? "project",
            timestamp: new Date(r["timestamp"]),
        };
        if (r["session_id"] !== null && r["session_id"] !== undefined) {
            doc["session_id"] = r["session_id"];
        }
        return doc;
    });
    return { readCount: rows.length, toInsert: docs, skipCount: 0 };
}
function buildWorkitemsPlan(sqlite) {
    const rows = sqlite.prepare(`SELECT * FROM workitems`).all();
    const docs = rows.map((r) => {
        const doc = {
            wi_path: r["wi_path"],
            project: r["project"],
            documentation: r["documentation"],
            archived_at: new Date(r["archived_at"]),
        };
        if (r["username"] !== null && r["username"] !== undefined)
            doc["username"] = r["username"];
        if (r["git_commit"] !== null && r["git_commit"] !== undefined)
            doc["git_commit"] = r["git_commit"];
        return doc;
    });
    return { readCount: rows.length, toInsert: docs, skipCount: 0 };
}
function buildSessionsPlan(sqlite) {
    const rows = sqlite.prepare(`SELECT * FROM sessions`).all();
    const docs = rows.map((r) => ({
        session_id: r["session_id"],
        project: r["project"],
        agent: r["agent"],
        cwd: r["cwd"] ?? "",
        started_at: new Date(r["started_at"]),
    }));
    return { readCount: rows.length, toInsert: docs, skipCount: 0 };
}
function buildMessagesPlan(sqlite) {
    const rows = sqlite.prepare(`SELECT * FROM messages`).all();
    const docs = rows.map((r) => ({
        session_id: r["session_id"],
        role: r["role"],
        content: r["content"],
        seq: r["seq"],
        timestamp: new Date(r["timestamp"]),
    }));
    return { readCount: rows.length, toInsert: docs, skipCount: 0 };
}
// ── Mongo dedup (Step 3) ──────────────────────────────────────────────────
async function dedupAgainstMongo(db, plans) {
    // memories: natural key = (project, agent, type, title)
    {
        const existing = await db.collection("memories")
            .find({}, { projection: { project: 1, agent: 1, type: 1, title: 1, _id: 0 } })
            .toArray();
        const set = new Set(existing.map((d) => JSON.stringify([d["project"], d["agent"], d["type"], d["title"]])));
        const kept = [];
        for (const doc of plans.memories.toInsert) {
            const key = JSON.stringify([doc["project"], doc["agent"], doc["type"], doc["title"]]);
            if (set.has(key))
                plans.memories.skipCount++;
            else {
                kept.push(doc);
                set.add(key); /* also dedup within batch */
            }
        }
        plans.memories.toInsert = kept;
    }
    // workitems: natural key = wi_path
    {
        const existing = await db.collection("workitems")
            .find({}, { projection: { wi_path: 1, _id: 0 } })
            .toArray();
        const set = new Set(existing.map((d) => JSON.stringify([d["wi_path"]])));
        const kept = [];
        for (const doc of plans.workitems.toInsert) {
            const key = JSON.stringify([doc["wi_path"]]);
            if (set.has(key))
                plans.workitems.skipCount++;
            else {
                kept.push(doc);
                set.add(key);
            }
        }
        plans.workitems.toInsert = kept;
    }
    // sessions: natural key = session_id
    {
        const existing = await db.collection("sessions")
            .find({}, { projection: { session_id: 1, _id: 0 } })
            .toArray();
        const set = new Set(existing.map((d) => JSON.stringify([d["session_id"]])));
        const kept = [];
        for (const doc of plans.sessions.toInsert) {
            const key = JSON.stringify([doc["session_id"]]);
            if (set.has(key))
                plans.sessions.skipCount++;
            else {
                kept.push(doc);
                set.add(key);
            }
        }
        plans.sessions.toInsert = kept;
    }
    // messages: natural key = (session_id, seq)
    {
        const existing = await db.collection("messages")
            .find({}, { projection: { session_id: 1, seq: 1, _id: 0 } })
            .toArray();
        const set = new Set(existing.map((d) => JSON.stringify([d["session_id"], d["seq"]])));
        const kept = [];
        for (const doc of plans.messages.toInsert) {
            const key = JSON.stringify([doc["session_id"], doc["seq"]]);
            if (set.has(key))
                plans.messages.skipCount++;
            else {
                kept.push(doc);
                set.add(key);
            }
        }
        plans.messages.toInsert = kept;
    }
}
// ── Rollback (Step 5/6/8/9 failure paths) ────────────────────────────────
async function rollback(db, inserted) {
    for (const col of COLLECTIONS) {
        const ids = inserted[col];
        if (ids.length === 0)
            continue;
        await db.collection(col).deleteMany({ _id: { $in: ids } });
        inserted[col] = [];
    }
}
// ── .env rewrite (Step 8) ────────────────────────────────────────────────
export function rewriteEnvBackend(envPath, newValue) {
    const raw = fs.readFileSync(envPath);
    const text = raw.toString("utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const endsWithNewline = text.endsWith("\n") || text.endsWith("\r\n");
    // Split preserving the original line content (we'll rejoin with detected EOL)
    const lines = text.split(/\r\n|\n/);
    // If file ends with a newline, split produces an empty trailing element; drop and re-add later.
    if (endsWithNewline && lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    const KEY = "DAKO_STORAGE_BACKEND";
    let found = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripped = line.replace(/^\s+/, "");
        if (!stripped.startsWith(`${KEY}=`))
            continue;
        // Preserve any surrounding quotes the user had on the original value.
        const eqIdx = line.indexOf("=");
        const lhs = line.slice(0, eqIdx + 1);
        const rhsRaw = line.slice(eqIdx + 1);
        // Detect quote style on RHS (allow leading whitespace before the quote)
        const m = rhsRaw.match(/^(\s*)(["'])(.*)\2(\s*(#.*)?)?$/);
        if (m) {
            const leadingWs = m[1] ?? "";
            const quote = m[2] ?? "";
            const trailing = m[4] ?? "";
            lines[i] = `${lhs}${leadingWs}${quote}${newValue}${quote}${trailing}`;
        }
        else {
            // Bare value (possibly with trailing comment); preserve trailing comment if any.
            const commentMatch = rhsRaw.match(/^([^#]*)(#.*)?$/);
            const trailingComment = (commentMatch && commentMatch[2]) ? ` ${commentMatch[2]}` : "";
            // Preserve leading whitespace on the value portion if present.
            const leadingWsMatch = (commentMatch?.[1] ?? "").match(/^(\s*)/);
            const leadingWs = leadingWsMatch ? leadingWsMatch[1] : "";
            lines[i] = `${lhs}${leadingWs}${newValue}${trailingComment}`;
        }
        found = true;
        break;
    }
    if (!found) {
        lines.push(`${KEY}=${newValue}`);
    }
    let out = lines.join(eol);
    if (endsWithNewline)
        out += eol;
    // Atomic write: .env.tmp -> renameSync
    const tmpPath = `${envPath}.tmp`;
    try {
        fs.writeFileSync(tmpPath, out);
        fs.renameSync(tmpPath, envPath);
    }
    catch (err) {
        // Best-effort tmp cleanup
        try {
            if (fs.existsSync(tmpPath))
                fs.unlinkSync(tmpPath);
        }
        catch { /* ignore */ }
        throw err;
    }
}
// ── Summary helpers (Step 10) ────────────────────────────────────────────
function emptyResult(plan) {
    return { read: plan.readCount, inserted: 0, skipped: plan.skipCount, durationMs: 0 };
}
function printSummary(results, bakPath, totalMs) {
    process.stdout.write("\nSummary\n");
    process.stdout.write("collection  | read | inserted | skipped | duration_ms\n");
    process.stdout.write("------------+------+----------+---------+------------\n");
    for (const col of COLLECTIONS) {
        const r = results[col];
        process.stdout.write(`${col.padEnd(11)} | ${String(r.read).padStart(4)} | ${String(r.inserted).padStart(8)} | ${String(r.skipped).padStart(7)} | ${String(r.durationMs).padStart(10)}\n`);
    }
    process.stdout.write(`\n.env updated: DAKO_STORAGE_BACKEND=mongodb\n`);
    process.stdout.write(`SQLite renamed: ${bakPath}\n`);
    process.stdout.write(`Total: ${totalMs} ms\n`);
}
// ── CLI bootstrap ────────────────────────────────────────────────────────
// Run when invoked as the entry point. Compare resolved file URLs because
// `process.argv[1]` is a path while `import.meta.url` is a file:// URL.
const invokedDirectly = (() => {
    try {
        const arg1 = process.argv[1];
        if (!arg1)
            return false;
        const argUrl = new URL(`file://${arg1.replace(/\\/g, "/")}`).href;
        return import.meta.url === argUrl || import.meta.url.endsWith(arg1.replace(/\\/g, "/"));
    }
    catch {
        return false;
    }
})();
if (invokedDirectly) {
    main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
        process.stderr.write(`Unhandled error: ${err instanceof Error ? err.stack : String(err)}\n`);
        process.exit(1);
    });
}
//# sourceMappingURL=migrate.js.map