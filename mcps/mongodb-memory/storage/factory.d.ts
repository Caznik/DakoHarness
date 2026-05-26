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
import type { Storage } from "./Storage.js";
/**
 * Returns the singleton Storage instance, creating it on first call.
 * Uses MONGO_URI / MONGO_DB env vars for MongoDB, DAKO_SQLITE_PATH for SQLite.
 */
export declare function getStorage(): Promise<Storage>;
/**
 * Closes the current storage instance and clears the singleton cache.
 * Safe to call if no instance has been created yet.
 */
export declare function closeStorage(): Promise<void>;
//# sourceMappingURL=factory.d.ts.map