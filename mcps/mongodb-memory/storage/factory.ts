/**
 * factory.ts — Backend selection and singleton management.
 *
 * Reads DAKO_STORAGE_BACKEND from the environment:
 *   unset / "mongodb" → MongoStorage
 *   "sqlite"          → SqliteStorage
 *   any other value   → Error (server exits non-zero with a clear message)
 *
 * Singletons are cached per-process. Call closeStorage() to clean up
 * (meaningful for MongoDB; SqliteStorage.close() is a no-op-safe call).
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Storage } from "./Storage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _instance: Storage | null = null;

/**
 * Returns the singleton Storage instance, creating it on first call.
 * Uses MONGO_URI / MONGO_DB env vars for MongoDB, DAKO_SQLITE_PATH for SQLite.
 */
export async function getStorage(): Promise<Storage> {
  if (_instance) return _instance;

  const backend = process.env["DAKO_STORAGE_BACKEND"] ?? "mongodb";

  if (backend === "mongodb") {
    const { MongoStorage } = await import("./MongoStorage.js");
    const uri = process.env["MONGO_URI"] ?? "mongodb://dako:harness@localhost:27017/agent_memory?authSource=admin";
    const dbName = process.env["MONGO_DB"] ?? "agent_memory";
    _instance = await MongoStorage.create(uri, dbName);
    return _instance;
  }

  if (backend === "sqlite") {
    const { SqliteStorage } = await import("./SqliteStorage.js");
    // Default path: .dako/memory.db relative to the LTM MCP root
    // (same .dako/ directory owned by the STM MCP for patterns.db — no collision, R6)
    const dbPath = process.env["DAKO_SQLITE_PATH"] ?? join(__dirname, "..", "..", "..", ".dako", "memory.db");
    _instance = SqliteStorage.create(dbPath);
    return _instance;
  }

  throw new Error(
    `Invalid DAKO_STORAGE_BACKEND='${backend}'. Allowed values: mongodb, sqlite`
  );
}

/**
 * Closes the current storage instance and clears the singleton cache.
 * Safe to call if no instance has been created yet.
 */
export async function closeStorage(): Promise<void> {
  if (_instance) {
    await _instance.close();
    _instance = null;
  }
}
