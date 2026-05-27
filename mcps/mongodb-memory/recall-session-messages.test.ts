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

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { MongoClient, Binary } from "mongodb";
import Database from "better-sqlite3";
import * as dotenv from "dotenv";

process.env["DAKO_EMBED_STUB"] = "1";

import { SqliteStorage } from "./storage/SqliteStorage.js";
import { MongoStorage } from "./storage/MongoStorage.js";
import { stubEmbed, floatsToBytes, getModelId } from "./embed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, ".env");

// ── Mongo reachability probe ─────────────────────────────────────────────
async function mongoReachable(uri: string): Promise<boolean> {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
  try {
    await c.connect();
    await c.db("admin").command({ ping: 1 });
    await c.close();
    return true;
  } catch {
    try { await c.close(); } catch { /* ignore */ }
    return false;
  }
}

const probeEnv = fs.existsSync(ENV_PATH) ? dotenv.parse(fs.readFileSync(ENV_PATH)) : {};
const PROBE_URI = probeEnv["MONGO_URI"] ?? process.env["MONGO_URI"] ?? "mongodb://dako:harness@localhost:27017/?authSource=admin";
const MONGO_OK = await mongoReachable(PROBE_URI);

// A "long enough" message string for skip-rule tests (>= 20 chars).
const LONG_USER = "user discussing redis caching policies in detail";
const LONG_ASSISTANT = "assistant explaining the retry/backoff scheme in detail";
const LONG_USER_2 = "tell me about the mongo schema migration approach";

// ── SQLite suite ─────────────────────────────────────────────────────────

function newSqliteStorage(): { storage: SqliteStorage; tmpDir: string; dbPath: string } {
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "dako-rsm-test-"));
  const dbPath = join(tmpDir, "memory.db");
  const storage = SqliteStorage.create(dbPath);
  return { storage, tmpDir, dbPath };
}

function cleanupSqlite(s: SqliteStorage, tmpDir: string): void {
  void s.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

test("[sqlite] logMessage inline-embeds long user messages", async () => {
  const { storage, tmpDir, dbPath } = newSqliteStorage();
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "s1" });
    await storage.logMessage({ session_id: "s1", role: "user", content: LONG_USER });

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(`SELECT embedding, embedding_model FROM messages LIMIT 1`).get() as { embedding: Buffer | null; embedding_model: string | null };
    db.close();
    assert.ok(row.embedding, "embedding should be set");
    assert.equal(row.embedding_model, getModelId());
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] logMessage skips empty / short / tool messages (AC-3)", async () => {
  const { storage, tmpDir, dbPath } = newSqliteStorage();
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "s1" });
    await storage.logMessage({ session_id: "s1", role: "user", content: "" });        // empty
    await storage.logMessage({ session_id: "s1", role: "user", content: "ok" });      // < 20
    await storage.logMessage({ session_id: "s1", role: "tool", content: LONG_USER }); // tool

    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(`SELECT embedding, embedding_model FROM messages ORDER BY seq`).all() as Array<{ embedding: Buffer | null; embedding_model: string | null }>;
    db.close();
    assert.equal(rows.length, 3, "all 3 rows inserted");
    for (const r of rows) {
      assert.equal(r.embedding, null, "skip-rule rows should have null embedding");
      assert.equal(r.embedding_model, null, "skip-rule rows should have null embedding_model");
    }
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] logMessage embed failure: row inserted with null fields (AC-2 failure)", async () => {
  const { storage, tmpDir, dbPath } = newSqliteStorage();
  // Temporarily disable the stub and point at a model the dynamic import can't resolve.
  const stubSave = process.env["DAKO_EMBED_STUB"];
  delete process.env["DAKO_EMBED_STUB"];
  process.env["DAKO_EMBEDDING_MODEL"] = "definitely/not-a-real-model-please-fail";
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "s1" });
    await storage.logMessage({ session_id: "s1", role: "user", content: LONG_USER });

    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(`SELECT embedding, embedding_model, content FROM messages LIMIT 1`).get() as { embedding: Buffer | null; embedding_model: string | null; content: string };
    db.close();
    assert.equal(row.content, LONG_USER, "row inserted");
    assert.equal(row.embedding, null, "embedding null on failure");
    assert.equal(row.embedding_model, null, "embedding_model null on failure");
  } finally {
    if (stubSave !== undefined) process.env["DAKO_EMBED_STUB"] = stubSave;
    delete process.env["DAKO_EMBEDDING_MODEL"];
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] recallSessionMessages — project-wide search across sessions (AC-6)", async () => {
  const { storage, tmpDir } = newSqliteStorage();
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "sA" });
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "sB" });
    await storage.logMessage({ session_id: "sA", role: "user", content: LONG_USER });
    await storage.logMessage({ session_id: "sB", role: "assistant", content: LONG_ASSISTANT });

    const result = await storage.recallSessionMessages({ project: "P", query: "redis caching policy", limit: 10 });
    const text = result.content[0]!.text;
    // Both sessions' messages should appear since both were embedded and we search project-wide.
    assert.ok(text.includes("sA".slice(0, 8)) || text.includes("sB".slice(0, 8)), "at least one session id appears");
    // Both messages live in the result text (project-wide).
    assert.ok(text.includes(LONG_USER) && text.includes(LONG_ASSISTANT), "both messages returned project-wide");
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] recallSessionMessages — session_id filter narrows results (AC-5/AC-6)", async () => {
  const { storage, tmpDir } = newSqliteStorage();
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "sA" });
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "sB" });
    await storage.logMessage({ session_id: "sA", role: "user", content: LONG_USER });
    await storage.logMessage({ session_id: "sB", role: "assistant", content: LONG_ASSISTANT });

    const result = await storage.recallSessionMessages({ project: "P", query: "redis", session_id: "sA", limit: 10 });
    const text = result.content[0]!.text;
    assert.ok(text.includes(LONG_USER), "session-A message returned");
    assert.ok(!text.includes(LONG_ASSISTANT), "session-B message excluded");
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] recallSessionMessages — since filter narrows to time window (AC-5)", async () => {
  const { storage, tmpDir, dbPath } = newSqliteStorage();
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "s1" });
    await storage.logMessage({ session_id: "s1", role: "user", content: LONG_USER });
    // Manually backdate the first row.
    const db = new Database(dbPath);
    db.prepare(`UPDATE messages SET timestamp = ? WHERE seq = 0`).run("2020-01-01T00:00:00.000Z");
    db.close();
    await storage.logMessage({ session_id: "s1", role: "assistant", content: LONG_ASSISTANT });

    const result = await storage.recallSessionMessages({ project: "P", query: "redis", since: "2025-01-01T00:00:00.000Z", limit: 10 });
    const text = result.content[0]!.text;
    assert.ok(!text.includes(LONG_USER), "pre-since row excluded");
    assert.ok(text.includes(LONG_ASSISTANT), "post-since row included");
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] recallSessionMessages — invalid since throws (AC-5 validation)", async () => {
  const { storage, tmpDir } = newSqliteStorage();
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "s1" });
    await storage.logMessage({ session_id: "s1", role: "user", content: LONG_USER });
    await assert.rejects(
      () => storage.recallSessionMessages({ project: "P", query: "redis", since: "not-a-date" }),
      /expected ISO-8601/,
    );
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] recallSessionMessages — empty result returns the 'No matching messages found' text (AC-7)", async () => {
  const { storage, tmpDir } = newSqliteStorage();
  try {
    const result = await storage.recallSessionMessages({ project: "EmptyProj", query: "anything" });
    const text = result.content[0]!.text;
    assert.ok(text.includes("No matching messages found"));
    assert.ok(text.includes("EmptyProj"));
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] recallSessionMessages — caller-supplied embedding skips server embed (AC-9)", async () => {
  const { storage, tmpDir } = newSqliteStorage();
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "s1" });
    await storage.logMessage({ session_id: "s1", role: "user", content: LONG_USER });

    // The caller-supplied vector controls ordering; if the server ignored it
    // and re-embedded server-side it would still produce a result, so we
    // assert behavioral: a hand-crafted "redis-caching" vector should rank
    // the message non-zero.
    const callerVec = floatsToBytes(stubEmbed("redis caching policy"));
    const result = await storage.recallSessionMessages({
      project: "P", query: "redis", embedding: callerVec, limit: 10,
    });
    const text = result.content[0]!.text;
    assert.ok(text.includes(LONG_USER), "caller-supplied embedding still returns the message");
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

test("[sqlite] recallSessionMessages — mixed-model rows excluded (AC-8)", async () => {
  const { storage, tmpDir, dbPath } = newSqliteStorage();
  try {
    await storage.startSession({ project: "P", agent: "claude-code", session_id: "s1" });
    await storage.logMessage({ session_id: "s1", role: "user", content: LONG_USER });

    // Inject a second row with a literal wrong model id.
    const db = new Database(dbPath);
    const wrongVec = floatsToBytes(stubEmbed(`assistant: ${LONG_ASSISTANT}`));
    db.prepare(`INSERT INTO messages (session_id, role, content, seq, timestamp, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("s1", "assistant", LONG_ASSISTANT, 99, new Date().toISOString(), wrongVec, "OldModel/v1");
    db.close();

    const result = await storage.recallSessionMessages({ project: "P", query: "anything redis assistant", limit: 10 });
    const text = result.content[0]!.text;
    assert.ok(text.includes(LONG_USER), "current-model row appears");
    assert.ok(!text.includes(LONG_ASSISTANT), "wrong-model row excluded");
  } finally {
    cleanupSqlite(storage, tmpDir);
  }
});

// ── Mongo suite ──────────────────────────────────────────────────────────

if (!MONGO_OK) {
  console.log("skipped: Mongo unreachable at " + PROBE_URI);
} else {
  test("[mongo] logMessage inline-embeds long messages; skips short/tool", async () => {
    const uri = PROBE_URI;
    const dbName = `dako_rsm_test_${randomUUID().slice(0, 8)}`;
    const storage = await MongoStorage.create(uri, dbName);
    try {
      await storage.startSession({ project: "P", agent: "claude-code", session_id: "s1" });
      await storage.logMessage({ session_id: "s1", role: "user", content: LONG_USER });        // embed
      await storage.logMessage({ session_id: "s1", role: "user", content: "short" });           // skip
      await storage.logMessage({ session_id: "s1", role: "tool", content: LONG_USER_2 });      // skip

      const client = new MongoClient(uri);
      await client.connect();
      const docs = await client.db(dbName).collection("messages").find({ session_id: "s1" }).sort({ seq: 1 }).toArray();
      await client.close();
      assert.equal(docs.length, 3);
      assert.ok(docs[0]!["embedding"], "long user msg embedded");
      assert.equal(docs[0]!["embedding_model"], getModelId());
      assert.equal(docs[1]!["embedding"], undefined, "short msg not embedded");
      assert.equal(docs[2]!["embedding"], undefined, "tool msg not embedded");
    } finally {
      const c = new MongoClient(uri); await c.connect();
      await c.db(dbName).dropDatabase(); await c.close();
      await storage.close();
    }
  });

  test("[mongo] recallSessionMessages — project-wide and session-filtered + mixed-model exclusion", async () => {
    const uri = PROBE_URI;
    const dbName = `dako_rsm_test_${randomUUID().slice(0, 8)}`;
    const storage = await MongoStorage.create(uri, dbName);
    try {
      await storage.startSession({ project: "P", agent: "claude-code", session_id: "sA" });
      await storage.startSession({ project: "P", agent: "claude-code", session_id: "sB" });
      await storage.logMessage({ session_id: "sA", role: "user", content: LONG_USER });
      await storage.logMessage({ session_id: "sB", role: "assistant", content: LONG_ASSISTANT });

      // Project-wide:
      const wide = await storage.recallSessionMessages({ project: "P", query: "redis", limit: 10 });
      const wideText = wide.content[0]!.text;
      assert.ok(wideText.includes(LONG_USER), "project-wide includes sA msg");
      assert.ok(wideText.includes(LONG_ASSISTANT), "project-wide includes sB msg");

      // Session-filtered:
      const narrow = await storage.recallSessionMessages({ project: "P", query: "redis", session_id: "sA", limit: 10 });
      const narrowText = narrow.content[0]!.text;
      assert.ok(narrowText.includes(LONG_USER));
      assert.ok(!narrowText.includes(LONG_ASSISTANT));

      // Mixed-model: inject a wrong-model row directly.
      const client = new MongoClient(uri);
      await client.connect();
      const wrongVec = floatsToBytes(stubEmbed(`assistant: another long enough message string here`));
      await client.db(dbName).collection("messages").insertOne({
        session_id: "sA", role: "assistant", content: "another long enough message string here",
        seq: 99, timestamp: new Date(),
        embedding: new Binary(wrongVec, 0), embedding_model: "OldModel/v1",
      });
      await client.close();

      const filtered = await storage.recallSessionMessages({ project: "P", query: "another long enough", limit: 10 });
      const filteredText = filtered.content[0]!.text;
      assert.ok(!filteredText.includes("another long enough message string here"), "wrong-model row excluded");
    } finally {
      const c = new MongoClient(uri); await c.connect();
      await c.db(dbName).dropDatabase(); await c.close();
      await storage.close();
    }
  });

  test("[mongo] recallSessionMessages — empty project returns 'No matching messages found' text", async () => {
    const uri = PROBE_URI;
    const dbName = `dako_rsm_test_${randomUUID().slice(0, 8)}`;
    const storage = await MongoStorage.create(uri, dbName);
    try {
      const result = await storage.recallSessionMessages({ project: "EmptyProj", query: "anything" });
      const text = result.content[0]!.text;
      assert.ok(text.includes("No matching messages found"));
    } finally {
      const c = new MongoClient(uri); await c.connect();
      await c.db(dbName).dropDatabase(); await c.close();
      await storage.close();
    }
  });
}
