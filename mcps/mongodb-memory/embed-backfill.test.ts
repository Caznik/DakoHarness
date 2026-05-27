/**
 * embed-backfill.test.ts — Tests for the embed-backfill one-shot script.
 *
 * Runs via `node --test`. Uses DAKO_EMBED_STUB=1 to skip the real model.
 * Only the SQLite path is exercised here — Mongo path is structurally
 * identical but requires a reachable Mongo (covered separately by
 * recall-hybrid.test.ts's Mongo branch).
 *
 * AC coverage:
 *   - default run embeds missing rows                  → AC-9
 *   - idempotent re-run skips fully-embedded rows      → AC-11
 *   - --force re-embeds every row                      → AC-10
 *   - --dry-run performs no writes                     → AC-10
 *   - unknown flag exits non-zero                      → AC-10
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

process.env["DAKO_EMBED_STUB"] = "1";

import { main as backfillMain } from "./embed-backfill.js";
import { getModelId, floatsToBytes, stubEmbed } from "./embed.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, ".env");

function snapshotEnv(): Buffer | null {
  return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH) : null;
}
function restoreEnv(snapshot: Buffer | null): void {
  if (snapshot === null) {
    if (fs.existsSync(ENV_PATH)) fs.unlinkSync(ENV_PATH);
  } else {
    fs.writeFileSync(ENV_PATH, snapshot);
  }
}

interface TestEnv {
  envSnapshot: Buffer | null;
  tmpDir: string;
  sqlitePath: string;
}

function seedDb(sqlitePath: string, preEmbeddedCount: number): void {
  fs.mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL, agent TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'project', session_id TEXT, timestamp TEXT NOT NULL,
      embedding BLOB, embedding_model TEXT
    );
  `);
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT INTO memories (project, agent, type, title, content, tags, scope, session_id, timestamp, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const currentModel = getModelId();
  for (let i = 0; i < 5; i++) {
    const isPreEmbedded = i < preEmbeddedCount;
    const vec = isPreEmbedded ? floatsToBytes(stubEmbed(`title-${i}\ncontent-${i}`)) : null;
    const model = isPreEmbedded ? currentModel : null;
    ins.run("P", "claude-code", "decision", `title-${i}`, `content-${i}`, "[]", "project", null, now, vec, model);
  }
  db.close();
}

function setupTestEnv(preEmbeddedCount: number): TestEnv {
  const envSnapshot = snapshotEnv();
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "dako-backfill-test-"));
  const sqlitePath = join(tmpDir, "memory.db");

  // Write a test .env that points at our SQLite fixture.
  const body = [
    `DAKO_STORAGE_BACKEND=sqlite`,
    `DAKO_SQLITE_PATH=${sqlitePath}`,
    `MONGO_URI=mongodb://invalid/`,
    `MONGO_DB=unused`,
    ``,
  ].join("\n");
  fs.writeFileSync(ENV_PATH, body);

  delete process.env["DAKO_STORAGE_BACKEND"];
  delete process.env["DAKO_SQLITE_PATH"];

  seedDb(sqlitePath, preEmbeddedCount);
  return { envSnapshot, tmpDir, sqlitePath };
}

function teardown(env: TestEnv): void {
  restoreEnv(env.envSnapshot);
  try { fs.rmSync(env.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  delete process.env["DAKO_STORAGE_BACKEND"];
  delete process.env["DAKO_SQLITE_PATH"];
}

function countEmbedded(sqlitePath: string): { withVec: number; total: number } {
  const db = new Database(sqlitePath, { readonly: true });
  const total = (db.prepare(`SELECT COUNT(*) as c FROM memories`).get() as { c: number }).c;
  const withVec = (db.prepare(`SELECT COUNT(*) as c FROM memories WHERE embedding IS NOT NULL AND embedding_model = ?`).get(getModelId()) as { c: number }).c;
  db.close();
  return { withVec, total };
}

// ── Tests ────────────────────────────────────────────────────────────────

test("default run embeds missing rows; skips already-embedded ones", async () => {
  const env = setupTestEnv(2);
  try {
    let { withVec } = countEmbedded(env.sqlitePath);
    assert.equal(withVec, 2, "pre-state: 2 embedded");

    const code = await backfillMain([]);
    assert.equal(code, 0);

    ({ withVec } = countEmbedded(env.sqlitePath));
    assert.equal(withVec, 5, "post-state: all 5 embedded");
  } finally {
    teardown(env);
  }
});

test("re-run on fully-embedded DB is idempotent (AC-11)", async () => {
  const env = setupTestEnv(5);
  try {
    const code = await backfillMain([]);
    assert.equal(code, 0);
    const { withVec } = countEmbedded(env.sqlitePath);
    assert.equal(withVec, 5);
  } finally {
    teardown(env);
  }
});

test("--force re-embeds every row regardless of model match", async () => {
  const env = setupTestEnv(5);
  try {
    // Modify one row's stored embedding to a known sentinel so we can detect rewrite.
    const db = new Database(env.sqlitePath);
    const sentinel = Buffer.alloc(128, 0xAB);
    db.prepare(`UPDATE memories SET embedding = ? WHERE id = 1`).run(sentinel);
    db.close();

    const code = await backfillMain(["--force"]);
    assert.equal(code, 0);

    const db2 = new Database(env.sqlitePath, { readonly: true });
    const row = db2.prepare(`SELECT embedding FROM memories WHERE id = 1`).get() as { embedding: Buffer };
    db2.close();
    assert.notDeepEqual(Array.from(row.embedding), Array.from(sentinel), "force should overwrite the sentinel");
  } finally {
    teardown(env);
  }
});

test("--dry-run performs no writes", async () => {
  const env = setupTestEnv(0);
  try {
    const before = countEmbedded(env.sqlitePath);
    assert.equal(before.withVec, 0);

    const code = await backfillMain(["--dry-run"]);
    assert.equal(code, 0);

    const after = countEmbedded(env.sqlitePath);
    assert.equal(after.withVec, 0, "no rows should be embedded after dry-run");
  } finally {
    teardown(env);
  }
});

test("unknown flag exits non-zero", async () => {
  const env = setupTestEnv(0);
  try {
    const code = await backfillMain(["--bogus"]);
    assert.equal(code, 1);
  } finally {
    teardown(env);
  }
});

// ── --collection tests (WI-rag-long-sessions) ────────────────────────────

/**
 * Seed a `messages` table alongside `memories` for --collection messages tests.
 * 5 rows total: 2 long-eligible (pre-embedded count controls how many of them
 * have a vector already), 1 empty (skip-rule), 1 short (skip-rule), 1 tool-role
 * (skip-rule).
 */
function seedMessagesDb(sqlitePath: string, preEmbeddedCount: number): void {
  fs.mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL, agent TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'project', session_id TEXT, timestamp TEXT NOT NULL,
      embedding BLOB, embedding_model TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      seq INTEGER NOT NULL, timestamp TEXT NOT NULL,
      embedding BLOB, embedding_model TEXT
    );
  `);
  const now = new Date().toISOString();
  const longA = "a long enough user message describing redis caching policies in detail";
  const longB = "a long enough assistant message explaining backoff schemes thoroughly";
  const currentModel = getModelId();
  const ins = db.prepare(`INSERT INTO messages (session_id, role, content, seq, timestamp, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  ins.run("s1", "user", longA, 0, now,
    preEmbeddedCount >= 1 ? floatsToBytes(stubEmbed(`user: ${longA}`)) : null,
    preEmbeddedCount >= 1 ? currentModel : null);
  ins.run("s1", "assistant", longB, 1, now,
    preEmbeddedCount >= 2 ? floatsToBytes(stubEmbed(`assistant: ${longB}`)) : null,
    preEmbeddedCount >= 2 ? currentModel : null);
  ins.run("s1", "user", "", 2, now, null, null);                                             // empty
  ins.run("s1", "user", "ok", 3, now, null, null);                                           // < 20 chars
  ins.run("s1", "tool", "tool output content long enough to clear MIN_LEN", 4, now, null, null); // tool role
  db.close();
}

function countMessagesEmbedded(sqlitePath: string): { withVec: number; total: number } {
  const db = new Database(sqlitePath, { readonly: true });
  const total = (db.prepare(`SELECT COUNT(*) as c FROM messages`).get() as { c: number }).c;
  const withVec = (db.prepare(`SELECT COUNT(*) as c FROM messages WHERE embedding IS NOT NULL AND embedding_model = ?`).get(getModelId()) as { c: number }).c;
  db.close();
  return { withVec, total };
}

function setupMessagesTestEnv(preEmbeddedMessages: number): TestEnv {
  const envSnapshot = snapshotEnv();
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "dako-backfill-msgs-test-"));
  const sqlitePath = join(tmpDir, "memory.db");
  const body = [
    `DAKO_STORAGE_BACKEND=sqlite`,
    `DAKO_SQLITE_PATH=${sqlitePath}`,
    `MONGO_URI=mongodb://invalid/`,
    `MONGO_DB=unused`,
    ``,
  ].join("\n");
  fs.writeFileSync(ENV_PATH, body);
  delete process.env["DAKO_STORAGE_BACKEND"];
  delete process.env["DAKO_SQLITE_PATH"];
  seedMessagesDb(sqlitePath, preEmbeddedMessages);
  return { envSnapshot, tmpDir, sqlitePath };
}

test("--collection messages: idempotent — embeds eligible, skips already-embedded + skip-rule rows (AC-13 i)", async () => {
  const env = setupMessagesTestEnv(1); // 1 of 2 long-eligible pre-embedded
  try {
    const before = countMessagesEmbedded(env.sqlitePath);
    assert.equal(before.withVec, 1, "pre: 1 pre-embedded long-eligible");
    assert.equal(before.total, 5);

    const code = await backfillMain(["--collection", "messages"]);
    assert.equal(code, 0);

    const after = countMessagesEmbedded(env.sqlitePath);
    assert.equal(after.withVec, 2, "post: both long-eligible embedded; skip-rule rows stay null");

    // Re-run: idempotent — count stays at 2.
    const code2 = await backfillMain(["--collection", "messages"]);
    assert.equal(code2, 0);
    const after2 = countMessagesEmbedded(env.sqlitePath);
    assert.equal(after2.withVec, 2, "idempotent re-run leaves 2 embedded");
  } finally {
    teardown(env);
  }
});

test("--collection messages --force: re-embeds all eligible; skip-rule rows still skipped (AC-13 j)", async () => {
  const env = setupMessagesTestEnv(2);
  try {
    // Inject a sentinel into row id=1 so we can detect a rewrite.
    const db = new Database(env.sqlitePath);
    const sentinel = Buffer.alloc(128, 0xCD);
    db.prepare(`UPDATE messages SET embedding = ? WHERE id = 1`).run(sentinel);
    db.close();

    const code = await backfillMain(["--collection", "messages", "--force"]);
    assert.equal(code, 0);

    const db2 = new Database(env.sqlitePath, { readonly: true });
    const row = db2.prepare(`SELECT embedding FROM messages WHERE id = 1`).get() as { embedding: Buffer };
    db2.close();
    assert.notDeepEqual(Array.from(row.embedding), Array.from(sentinel), "force should overwrite the sentinel");

    const final = countMessagesEmbedded(env.sqlitePath);
    assert.equal(final.withVec, 2, "skip-rule rows remain unembedded even with --force");
  } finally {
    teardown(env);
  }
});

test("--collection messages --dry-run: zero writes", async () => {
  const env = setupMessagesTestEnv(0);
  try {
    const before = countMessagesEmbedded(env.sqlitePath);
    assert.equal(before.withVec, 0);

    const code = await backfillMain(["--collection", "messages", "--dry-run"]);
    assert.equal(code, 0);

    const after = countMessagesEmbedded(env.sqlitePath);
    assert.equal(after.withVec, 0, "no writes performed");
  } finally {
    teardown(env);
  }
});

test("--collection all: runs memories then messages (AC-13 k)", async () => {
  const envSnapshot = snapshotEnv();
  const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "dako-backfill-all-test-"));
  const sqlitePath = join(tmpDir, "memory.db");
  const body = [
    `DAKO_STORAGE_BACKEND=sqlite`,
    `DAKO_SQLITE_PATH=${sqlitePath}`,
    `MONGO_URI=mongodb://invalid/`,
    `MONGO_DB=unused`,
    ``,
  ].join("\n");
  fs.writeFileSync(ENV_PATH, body);
  delete process.env["DAKO_STORAGE_BACKEND"];
  delete process.env["DAKO_SQLITE_PATH"];

  fs.mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL, agent TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
      scope TEXT NOT NULL DEFAULT 'project', session_id TEXT, timestamp TEXT NOT NULL,
      embedding BLOB, embedding_model TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
      seq INTEGER NOT NULL, timestamp TEXT NOT NULL,
      embedding BLOB, embedding_model TEXT
    );
  `);
  const now = new Date().toISOString();
  const mIns = db.prepare(`INSERT INTO memories (project, agent, type, title, content, tags, scope, session_id, timestamp, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let i = 0; i < 3; i++) mIns.run("P", "claude-code", "decision", `t-${i}`, `c-${i}`, "[]", "project", null, now, null, null);
  const msgIns = db.prepare(`INSERT INTO messages (session_id, role, content, seq, timestamp, embedding, embedding_model) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  msgIns.run("s1", "user", "a long enough user msg about redis caching strategies", 0, now, null, null);
  msgIns.run("s1", "assistant", "a long enough assistant reply about retry/backoff schemes", 1, now, null, null);
  msgIns.run("s1", "tool", "skipped tool payload even if longer than min len", 2, now, null, null);
  db.close();

  try {
    const code = await backfillMain(["--collection", "all"]);
    assert.equal(code, 0);
    const memCount = countEmbedded(sqlitePath);
    const msgCount = countMessagesEmbedded(sqlitePath);
    assert.equal(memCount.withVec, 3, "all 3 memories embedded");
    assert.equal(msgCount.withVec, 2, "2 long-eligible messages embedded; tool row skipped");
  } finally {
    restoreEnv(envSnapshot);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    delete process.env["DAKO_STORAGE_BACKEND"];
    delete process.env["DAKO_SQLITE_PATH"];
  }
});

test("--collection invalid exits 1 with usage (AC-11)", async () => {
  const env = setupMessagesTestEnv(0);
  try {
    const code = await backfillMain(["--collection", "bogusvalue"]);
    assert.equal(code, 1);
  } finally {
    teardown(env);
  }
});

test("--collection requires a value (no orphan flag)", async () => {
  const env = setupMessagesTestEnv(0);
  try {
    const code = await backfillMain(["--collection"]);
    assert.equal(code, 1);
  } finally {
    teardown(env);
  }
});

test("--collection=<val> single-token form is accepted", async () => {
  const env = setupMessagesTestEnv(0);
  try {
    const code = await backfillMain(["--collection=messages"]);
    assert.equal(code, 0);
    const after = countMessagesEmbedded(env.sqlitePath);
    assert.equal(after.withVec, 2, "single-token form embeds the 2 long-eligible messages");
  } finally {
    teardown(env);
  }
});
