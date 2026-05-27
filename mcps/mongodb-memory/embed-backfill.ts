/**
 * embed-backfill.ts — One-shot script that walks every embeddable row in the
 * configured storage backend and writes an `embedding` + `embedding_model`
 * value when it's missing or stale.
 *
 * USAGE
 * -----
 *   npm run embed-backfill                                — backfill `memories` (default)
 *   npm run embed-backfill -- --collection messages       — backfill `messages` only
 *   npm run embed-backfill -- --collection all            — both, in order
 *   npm run embed-backfill -- --dry-run                   — read-only plan, no writes
 *   npm run embed-backfill -- --force                     — re-embed every row regardless of state
 *
 * Flags compose: `--collection messages --dry-run`, etc.
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
 * For `messages`, the shared `shouldEmbedMessage` skip-rule from `embed.ts`
 * is applied so insert-time and backfill-time decisions are identical: rows
 * skipped at insert (empty / <20 chars / role=tool) stay skipped on backfill,
 * counted in `skipped` rather than `embedded`.
 *
 * Returns 0 on success (errors == 0), 1 otherwise (errors > 0, or fatal pre-flight).
 */

import * as dotenv from "dotenv";
import * as fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { MongoClient, Binary, ObjectId } from "mongodb";
import { embedTexts, getModelId, floatsToBytes, shouldEmbedMessage } from "./embed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = join(__dirname, ".env");
const BATCH = 32;

type Collection = "memories" | "messages" | "all";

interface Summary {
  collection: "memories" | "messages";
  rowsRead: number;
  embedded: number;
  skipped:  number;
  errors:   number;
  durationMs: number;
}

interface Options {
  dryRun: boolean;
  force:  boolean;
  collection: Collection;
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  // ── Flag parsing ────────────────────────────────────────────────────────
  const opts: Options = { dryRun: false, force: false, collection: "memories" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") { opts.dryRun = true; continue; }
    if (a === "--force")   { opts.force = true; continue; }
    if (a === "--collection" || a.startsWith("--collection=")) {
      let value: string | undefined;
      if (a === "--collection") {
        value = argv[i + 1];
        i++;
      } else {
        value = a.slice("--collection=".length);
      }
      if (!value || value.startsWith("--")) {
        process.stderr.write(`Error: --collection requires a value (memories|messages|all)\nUsage: embed-backfill [--collection memories|messages|all] [--dry-run] [--force]\n`);
        return 1;
      }
      if (value !== "memories" && value !== "messages" && value !== "all") {
        process.stderr.write(`Error: invalid --collection value '${value}'. Expected memories|messages|all.\nUsage: embed-backfill [--collection memories|messages|all] [--dry-run] [--force]\n`);
        return 1;
      }
      opts.collection = value as Collection;
      continue;
    }
    process.stderr.write(`Unknown flag: ${a}\nUsage: embed-backfill [--collection memories|messages|all] [--dry-run] [--force]\n`);
    return 1;
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

  const targets: Array<"memories" | "messages"> =
    opts.collection === "all" ? ["memories", "messages"] : [opts.collection];

  const summaries: Summary[] = [];
  for (const target of targets) {
    const startedAt = Date.now();
    let summary: Summary;
    try {
      if (backend === "sqlite") {
        summary = target === "memories"
          ? await backfillMemoriesSqlite(opts, modelId)
          : await backfillMessagesSqlite(opts, modelId);
      } else {
        summary = target === "memories"
          ? await backfillMemoriesMongo(opts, modelId)
          : await backfillMessagesMongo(opts, modelId);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Backfill (${target}) failed: ${reason}\n`);
      return 1;
    }
    summary.durationMs = Date.now() - startedAt;
    summaries.push(summary);
  }

  printSummary(summaries, opts);
  return summaries.every((s) => s.errors === 0) ? 0 : 1;
}

// ── SQLite — memories ──────────────────────────────────────────────────────

async function backfillMemoriesSqlite(opts: Options, modelId: string): Promise<Summary> {
  const sqlitePath = process.env["DAKO_SQLITE_PATH"];
  if (!sqlitePath) throw new Error("DAKO_SQLITE_PATH not set in .env");
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite file not found at ${sqlitePath}`);

  const db = new Database(sqlitePath);
  const s: Summary = { collection: "memories", rowsRead: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };

  try {
    const addCol = (sql: string): void => {
      try { db.exec(sql); } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/duplicate column name/i.test(msg)) throw err;
      }
    };
    addCol(`ALTER TABLE memories ADD COLUMN embedding BLOB`);
    addCol(`ALTER TABLE memories ADD COLUMN embedding_model TEXT`);

    const allRows = db.prepare(`SELECT id, title, content, embedding_model FROM memories ORDER BY id`)
      .all() as Array<{ id: number; title: string; content: string; embedding_model: string | null }>;
    s.rowsRead = allRows.length;

    const totalChunks = Math.max(1, Math.ceil(allRows.length / BATCH));
    const updateStmt = db.prepare(`UPDATE memories SET embedding = ?, embedding_model = ? WHERE id = ?`);

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const chunk = allRows.slice(chunkIdx * BATCH, (chunkIdx + 1) * BATCH);
      if (chunk.length === 0) break;

      const toEmbed = chunk.filter((r) => opts.force || r.embedding_model !== modelId);
      const chunkSkipped = chunk.length - toEmbed.length;
      s.skipped += chunkSkipped;

      if (opts.dryRun) {
        process.stdout.write(`[memories ${chunkIdx + 1}/${totalChunks}] would-embed ${toEmbed.length}, would-skip ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        continue;
      }

      if (toEmbed.length === 0) {
        process.stdout.write(`[memories ${chunkIdx + 1}/${totalChunks}] embedded 0, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        continue;
      }

      let vectors: Float32Array[];
      try {
        vectors = await embedTexts(toEmbed.map((r) => `${r.title}\n${r.content}`));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[memories ${chunkIdx + 1}/${totalChunks}] embed call failed: ${reason}\n`);
        s.errors += toEmbed.length;
        continue;
      }

      const txn = db.transaction(() => {
        for (let i = 0; i < toEmbed.length; i++) {
          const row = toEmbed[i]!;
          const vec = vectors[i];
          if (!vec) { s.errors++; continue; }
          updateStmt.run(floatsToBytes(vec), modelId, row.id);
          s.embedded++;
        }
      });
      txn();

      process.stdout.write(`[memories ${chunkIdx + 1}/${totalChunks}] embedded ${toEmbed.length}, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
    }
  } finally {
    db.close();
  }
  return s;
}

// ── SQLite — messages ──────────────────────────────────────────────────────

async function backfillMessagesSqlite(opts: Options, modelId: string): Promise<Summary> {
  const sqlitePath = process.env["DAKO_SQLITE_PATH"];
  if (!sqlitePath) throw new Error("DAKO_SQLITE_PATH not set in .env");
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite file not found at ${sqlitePath}`);

  const db = new Database(sqlitePath);
  const s: Summary = { collection: "messages", rowsRead: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };

  try {
    const addCol = (sql: string): void => {
      try { db.exec(sql); } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/duplicate column name/i.test(msg)) throw err;
      }
    };
    addCol(`ALTER TABLE messages ADD COLUMN embedding BLOB`);
    addCol(`ALTER TABLE messages ADD COLUMN embedding_model TEXT`);

    const allRows = db.prepare(`SELECT id, role, content, embedding_model FROM messages ORDER BY id`)
      .all() as Array<{ id: number; role: string; content: string; embedding_model: string | null }>;
    s.rowsRead = allRows.length;

    const totalChunks = Math.max(1, Math.ceil(allRows.length / BATCH));
    const updateStmt = db.prepare(`UPDATE messages SET embedding = ?, embedding_model = ? WHERE id = ?`);

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const chunk = allRows.slice(chunkIdx * BATCH, (chunkIdx + 1) * BATCH);
      if (chunk.length === 0) break;

      // Two skip reasons: (a) model match (already embedded with current model
      // unless --force); (b) shouldEmbedMessage rejected. Both count as skipped.
      const toEmbed = chunk.filter((r) =>
        (opts.force || r.embedding_model !== modelId) && shouldEmbedMessage(r.role, r.content)
      );
      const chunkSkipped = chunk.length - toEmbed.length;
      s.skipped += chunkSkipped;

      if (opts.dryRun) {
        process.stdout.write(`[messages ${chunkIdx + 1}/${totalChunks}] would-embed ${toEmbed.length}, would-skip ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        continue;
      }

      if (toEmbed.length === 0) {
        process.stdout.write(`[messages ${chunkIdx + 1}/${totalChunks}] embedded 0, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        continue;
      }

      let vectors: Float32Array[];
      try {
        vectors = await embedTexts(toEmbed.map((r) => `${r.role}: ${r.content}`));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[messages ${chunkIdx + 1}/${totalChunks}] embed call failed: ${reason}\n`);
        s.errors += toEmbed.length;
        continue;
      }

      const txn = db.transaction(() => {
        for (let i = 0; i < toEmbed.length; i++) {
          const row = toEmbed[i]!;
          const vec = vectors[i];
          if (!vec) { s.errors++; continue; }
          updateStmt.run(floatsToBytes(vec), modelId, row.id);
          s.embedded++;
        }
      });
      txn();

      process.stdout.write(`[messages ${chunkIdx + 1}/${totalChunks}] embedded ${toEmbed.length}, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
    }
  } finally {
    db.close();
  }
  return s;
}

// ── Mongo — memories ──────────────────────────────────────────────────────

async function backfillMemoriesMongo(opts: Options, modelId: string): Promise<Summary> {
  const mongoUri = process.env["MONGO_URI"];
  const mongoDb  = process.env["MONGO_DB"];
  if (!mongoUri || !mongoDb) throw new Error("MONGO_URI and MONGO_DB must be set in .env");

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(mongoDb);
  const memories = db.collection("memories");
  const s: Summary = { collection: "memories", rowsRead: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };

  try {
    const total = await memories.countDocuments();
    s.rowsRead = total;
    const totalChunks = Math.max(1, Math.ceil(total / BATCH));

    const cursor = memories.find({}, { projection: { _id: 1, title: 1, content: 1, embedding_model: 1 } });
    let chunkIdx = 0;
    let buffer: Array<{ _id: ObjectId; title: string; content: string; embedding_model?: string | null }> = [];

    const flush = async (): Promise<void> => {
      if (buffer.length === 0) return;
      chunkIdx++;
      const chunk = buffer;
      buffer = [];

      const toEmbed = chunk.filter((r) => opts.force || r.embedding_model !== modelId);
      const chunkSkipped = chunk.length - toEmbed.length;
      s.skipped += chunkSkipped;

      if (opts.dryRun) {
        process.stdout.write(`[memories ${chunkIdx}/${totalChunks}] would-embed ${toEmbed.length}, would-skip ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        return;
      }
      if (toEmbed.length === 0) {
        process.stdout.write(`[memories ${chunkIdx}/${totalChunks}] embedded 0, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        return;
      }

      let vectors: Float32Array[];
      try {
        vectors = await embedTexts(toEmbed.map((r) => `${r.title}\n${r.content}`));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[memories ${chunkIdx}/${totalChunks}] embed call failed: ${reason}\n`);
        s.errors += toEmbed.length;
        return;
      }

      const ops = [];
      for (let i = 0; i < toEmbed.length; i++) {
        const row = toEmbed[i]!;
        const vec = vectors[i];
        if (!vec) { s.errors++; continue; }
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
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[memories ${chunkIdx}/${totalChunks}] bulkWrite failed: ${reason}\n`);
          s.errors += ops.length;
        }
      }

      process.stdout.write(`[memories ${chunkIdx}/${totalChunks}] embedded ${ops.length}, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
    };

    for await (const doc of cursor) {
      buffer.push(doc as unknown as { _id: ObjectId; title: string; content: string; embedding_model?: string | null });
      if (buffer.length >= BATCH) await flush();
    }
    await flush();
  } finally {
    await client.close();
  }
  return s;
}

// ── Mongo — messages ──────────────────────────────────────────────────────

async function backfillMessagesMongo(opts: Options, modelId: string): Promise<Summary> {
  const mongoUri = process.env["MONGO_URI"];
  const mongoDb  = process.env["MONGO_DB"];
  if (!mongoUri || !mongoDb) throw new Error("MONGO_URI and MONGO_DB must be set in .env");

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(mongoDb);
  const messages = db.collection("messages");
  const s: Summary = { collection: "messages", rowsRead: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };

  try {
    const total = await messages.countDocuments();
    s.rowsRead = total;
    const totalChunks = Math.max(1, Math.ceil(total / BATCH));

    const cursor = messages.find({}, { projection: { _id: 1, role: 1, content: 1, embedding_model: 1 } });
    let chunkIdx = 0;
    let buffer: Array<{ _id: ObjectId; role: string; content: string; embedding_model?: string | null }> = [];

    const flush = async (): Promise<void> => {
      if (buffer.length === 0) return;
      chunkIdx++;
      const chunk = buffer;
      buffer = [];

      const toEmbed = chunk.filter((r) =>
        (opts.force || r.embedding_model !== modelId) && shouldEmbedMessage(r.role, r.content)
      );
      const chunkSkipped = chunk.length - toEmbed.length;
      s.skipped += chunkSkipped;

      if (opts.dryRun) {
        process.stdout.write(`[messages ${chunkIdx}/${totalChunks}] would-embed ${toEmbed.length}, would-skip ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        return;
      }
      if (toEmbed.length === 0) {
        process.stdout.write(`[messages ${chunkIdx}/${totalChunks}] embedded 0, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
        return;
      }

      let vectors: Float32Array[];
      try {
        vectors = await embedTexts(toEmbed.map((r) => `${r.role}: ${r.content}`));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[messages ${chunkIdx}/${totalChunks}] embed call failed: ${reason}\n`);
        s.errors += toEmbed.length;
        return;
      }

      const ops = [];
      for (let i = 0; i < toEmbed.length; i++) {
        const row = toEmbed[i]!;
        const vec = vectors[i];
        if (!vec) { s.errors++; continue; }
        ops.push({
          updateOne: {
            filter: { _id: row._id },
            update: { $set: { embedding: new Binary(floatsToBytes(vec), 0), embedding_model: modelId } },
          },
        });
      }
      if (ops.length > 0) {
        try {
          await messages.bulkWrite(ops, { ordered: false });
          s.embedded += ops.length;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          process.stderr.write(`[messages ${chunkIdx}/${totalChunks}] bulkWrite failed: ${reason}\n`);
          s.errors += ops.length;
        }
      }

      process.stdout.write(`[messages ${chunkIdx}/${totalChunks}] embedded ${ops.length}, skipped ${chunkSkipped} (running: embedded=${s.embedded}, skipped=${s.skipped}, errors=${s.errors})\n`);
    };

    for await (const doc of cursor) {
      buffer.push(doc as unknown as { _id: ObjectId; role: string; content: string; embedding_model?: string | null });
      if (buffer.length >= BATCH) await flush();
    }
    await flush();
  } finally {
    await client.close();
  }
  return s;
}

// ── Summary ────────────────────────────────────────────────────────────────

function printSummary(summaries: Summary[], opts: Options): void {
  process.stdout.write("\nSummary\n");
  for (const s of summaries) {
    process.stdout.write(`\n[${s.collection}]\n`);
    process.stdout.write("rows-read | embedded | skipped | errors | duration_ms\n");
    process.stdout.write("----------+----------+---------+--------+------------\n");
    process.stdout.write(`${String(s.rowsRead).padStart(9)} | ${String(s.embedded).padStart(8)} | ${String(s.skipped).padStart(7)} | ${String(s.errors).padStart(6)} | ${String(s.durationMs).padStart(10)}\n`);
  }
  if (opts.dryRun) process.stdout.write("\n(no writes performed — --dry-run)\n");
}

// ── CLI bootstrap ──────────────────────────────────────────────────────────

const invokedDirectly = (() => {
  try {
    const arg1 = process.argv[1];
    if (!arg1) return false;
    const argUrl = new URL(`file://${arg1.replace(/\\/g, "/")}`).href;
    return import.meta.url === argUrl || import.meta.url.endsWith(arg1.replace(/\\/g, "/"));
  } catch { return false; }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`Unhandled error: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
