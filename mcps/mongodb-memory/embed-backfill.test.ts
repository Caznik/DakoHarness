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
