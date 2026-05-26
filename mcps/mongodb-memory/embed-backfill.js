/**
 * embed-backfill.ts — One-shot script that walks every `memories` row in the
 * configured storage backend and writes an `embedding` + `embedding_model`
 * value when it's missing or stale.
 *
 * USAGE
 * -----
 *   npm run embed-backfill              — idempotent backfill (skip rows already
 *                                          embedded with the current model)
 *   npm run embed-backfill -- --dry-run — read-only, print plan, no writes
 *   npm run embed-backfill -- --force   — re-embed every row regardless of state
 *
 * DESIGN
 * ------
 * Mirrors migrate.ts: loads .env from the same directory as the compiled .js,
 * validates DAKO_STORAGE_BACKEND, opens the matching backend directly via the
 * raw driver (bypasses the Storage facade — we need raw row access and bulk
 * read/write that the facade doesn't expose).
 *
 * Per-chunk error isolation: a thrown embed call for one chunk logs the error,
 * increments a counter, and continues. Backfill is repeatable, so partial
 * progress is fine — different from the migrator's all-or-nothing semantics.
 *
 * Returns 0 on success (errors == 0), 1 otherwise (errors > 0, or fatal pre-flight).
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { MongoClient, Binary, ObjectId } from "mongodb";
import { embedTexts, getModelId, floatsToBytes } from "./embed.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, ".env");
const BATCH = 32;
// ── Entry point ────────────────────────────────────────────────────────────
export async function main(argv) {
    // ── Flag parsing ────────────────────────────────────────────────────────
    const opts = { dryRun: false, force: false };
    for (const a of argv) {
        if (a === "--dry-run")
            opts.dryRun = true;
        else if (a === "--force")
            opts.force = true;
        else {
            process.stderr.write(`Unknown flag: ${a}\nUsage: embed-backfill [--dry-run] [--force]\n`);
            return 1;
        }
    }
    // ── Env load ────────────────────────────────────────────────────────────
    if (!fs.existsSync(ENV_PATH)) {
        process.stderr.write(`Error: .env file not found at expected path: ${ENV_PATH}\n`);
        return 1;
    }
    dotenv.config({ path: ENV_PATH, override: true });
    const backend = (process.env["DAKO_STORAGE_BACKEND"] ?? "mongodb").trim();
    const modelId = getModelId();
    if (backend !== "sqlite" && backend !== "mongodb" && backend !== "") {
        process.stderr.write(`Error: DAKO_STORAGE_BACKEND='${backend}' is not 'sqlite' or 'mongodb'.\n`);
        return 1;
    }
    const startedAt = Date.now();
    let summary;
    try {
        if (backend === "sqlite") {
            summary = await backfillSqlite(opts, modelId);
        }
        else {
            summary = await backfillMongo(opts, modelId);
        }
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Backfill failed: ${reason}\n`);
        return 1;
    }
    summary.durationMs = Date.now() - startedAt;
    printSummary(summary, opts);
    return summary.errors === 0 ? 0 : 1;
}
// ── SQLite path ────────────────────────────────────────────────────────────
async function backfillSqlite(opts, modelId) {
    const sqlitePath = process.env["DAKO_SQLITE_PATH"];
    if (!sqlitePath)
        throw new Error("DAKO_SQLITE_PATH not set in .env");
    if (!fs.existsSync(sqlitePath))
        throw new Error(`SQLite file not found at ${sqlitePath}`);
    const db = new Database(sqlitePath);
    const s = { rowsRead: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };
    try {
        // Ensure columns exist (mirrors SqliteStorage.create). Idempotent.
        const addCol = (sql) => {
            try {
                db.exec(sql);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!/duplicate column name/i.test(msg))
                    throw err;
            }
        };
        addCol(`ALTER TABLE memories ADD COLUMN embedding BLOB`);
        addCol(`ALTER TABLE memories ADD COLUMN embedding_model TEXT`);
        const allRows = db.prepare(`SELECT id, title, content, embedding_model FROM memories ORDER BY id`)
            .all();
        s.rowsRead = allRows.length;
        const totalChunks = Math.max(1, Math.ceil(allRows.length / BATCH));
        const updateStmt = db.prepare(`UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?`);
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const chunk = allRows.slice(chunkIdx * BATCH, (chunkIdx + 1) * BATCH);
            if (chunk.length === 0)
                break;
            // Filter to rows we'd actually embed.
            const toEmbed = chunk.filter((r) => opts.force || r.embedding_model !== modelId);
            const chunkSkipped = chunk.length - toEmbed.length;
            s.skipped += chunkSkipped;
            if (opts.dryRun) {
                process.stdout.write(`[batch ${chunkIdx + 1}/${totalChunks}] would-embed ${toEmbed.length}, would-skip ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
                continue;
            }
            if (toEmbed.length === 0) {
                process.stdout.write(`[batch ${chunkIdx + 1}/${totalChunks}] embedded 0, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
                continue;
            }
            let vectors;
            try {
                vectors = await embedTexts(toEmbed.map((r) => `${r.title}\n${r.content}`));
            }
            catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[batch ${chunkIdx + 1}/${totalChunks}] embed call failed: ${reason}\n`);
                s.errors += toEmbed.length;
                continue;
            }
            const txn = db.transaction(() => {
                for (let i = 0; i < toEmbed.length; i++) {
                    const row = toEmbed[i];
                    const vec = vectors[i];
                    if (!vec) {
                        s.errors++;
                        continue;
                    }
                    updateStmt.run(floatsToBytes(vec), modelId, row.id);
                    s.embedded++;
                }
            });
            txn();
            process.stdout.write(`[batch ${chunkIdx + 1}/${totalChunks}] embedded ${toEmbed.length}, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        }
    }
    finally {
        db.close();
    }
    return s;
}
// ── Mongo path ─────────────────────────────────────────────────────────────
async function backfillMongo(opts, modelId) {
    const mongoUri = process.env["MONGO_URI"];
    const mongoDb = process.env["MONGO_DB"];
    if (!mongoUri || !mongoDb)
        throw new Error("MONGO_URI and MONGO_DB must be set in .env");
    const client = new MongoClient(mongoUri);
    await client.connect();
    const db = client.db(mongoDb);
    const memories = db.collection("memories");
    const s = { rowsRead: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };
    try {
        const total = await memories.countDocuments();
        s.rowsRead = total;
        const totalChunks = Math.max(1, Math.ceil(total / BATCH));
        const cursor = memories.find({}, { projection: { _id: 1, title: 1, content: 1, embedding_model: 1 } });
        let chunkIdx = 0;
        let buffer = [];
        const flush = async () => {
            if (buffer.length === 0)
                return;
            chunkIdx++;
            const chunk = buffer;
            buffer = [];
            const toEmbed = chunk.filter((r) => opts.force || r.embedding_model !== modelId);
            const chunkSkipped = chunk.length - toEmbed.length;
            s.skipped += chunkSkipped;
            if (opts.dryRun) {
                process.stdout.write(`[batch ${chunkIdx}/${totalChunks}] would-embed ${toEmbed.length}, would-skip ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
                return;
            }
            if (toEmbed.length === 0) {
                process.stdout.write(`[batch ${chunkIdx}/${totalChunks}] embedded 0, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
                return;
            }
            let vectors;
            try {
                vectors = await embedTexts(toEmbed.map((r) => `${r.title}\n${r.content}`));
            }
            catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[batch ${chunkIdx}/${totalChunks}] embed call failed: ${reason}\n`);
                s.errors += toEmbed.length;
                return;
            }
            const ops = [];
            for (let i = 0; i < toEmbed.length; i++) {
                const row = toEmbed[i];
                const vec = vectors[i];
                if (!vec) {
                    s.errors++;
                    continue;
                }
                ops.push({
                    updateOne: {
                        filter: { _id: row._id },
                        update: { $set: { embedding: new Binary(floatsToBytes(vec), 0), embedding_model: modelId } },
                    },
                });
            }
            if (ops.length > 0) {
                try {
                    await memories.bulkWrite(ops, { ordered: false });
                    s.embedded += ops.length;
                }
                catch (err) {
                    const reason = err instanceof Error ? err.message : String(err);
                    process.stderr.write(`[batch ${chunkIdx}/${totalChunks}] bulkWrite failed: ${reason}\n`);
                    s.errors += ops.length;
                }
            }
            process.stdout.write(`[batch ${chunkIdx}/${totalChunks}] embedded ${ops.length}, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        };
        for await (const doc of cursor) {
            buffer.push(doc);
            if (buffer.length >= BATCH)
                await flush();
        }
        await flush();
    }
    finally {
        await client.close();
    }
    return s;
}
// ── Summary ────────────────────────────────────────────────────────────────
function printSummary(s, opts) {
    process.stdout.write("\nSummary\n");
    process.stdout.write("rows-read | embedded | skipped | errors | duration_ms\n");
    process.stdout.write("----------+----------+---------+--------+------------\n");
    process.stdout.write(`${String(s.rowsRead).padStart(9)} | ${String(s.embedded).padStart(8)} | ${String(s.skipped).padStart(7)} | ${String(s.errors).padStart(6)} | ${String(s.durationMs).padStart(10)}\n`);
    if (opts.dryRun)
        process.stdout.write("\n(no writes performed — --dry-run)\n");
}
// ── CLI bootstrap ──────────────────────────────────────────────────────────
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
//# sourceMappingURL=embed-backfill.js.map