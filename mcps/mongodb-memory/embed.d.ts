/**
 * embed.ts — Shared embedding wrapper used by both Storage adapters and the
 * embed-backfill script.
 *
 * RESPONSIBILITIES
 * ----------------
 * - Lazily load a sentence-transformers (Xenova) model behind a module-level
 *   singleton promise. First call writes one `[embed] loading <model>…` line
 *   to stderr so the cold-start latency is visible.
 * - Convert between Float32Array and raw bytes (4 × dim) — the on-disk layout
 *   used by SQLite BLOB and MongoDB Binary subtype 0.
 * - Cosine similarity helper. Vectors are unit-normalized by construction
 *   (`pipeline(..., { normalize: true })`), so cosine = dot product.
 * - Reciprocal Rank Fusion helper shared by both adapters' hybrid recall paths
 *   so the merge math is identical across backends.
 *
 * TEST SEAM
 * ---------
 * If `process.env[EMBED_STUB_KEY]` is set, `embedTexts` returns a deterministic
 * fake vector (FNV-1a folded into 32 float positions, unit-normalized). This
 * keeps CI from downloading the ~30MB real model and lets tests precompute
 * expected cosines by hand.
 *
 * The dynamic `await import("@xenova/transformers")` means the dependency is
 * NOT a hard load when the stub path is active — tests run without it
 * installed.
 */
/** Env key that switches `embedTexts` to its deterministic test stub. */
export declare const EMBED_STUB_KEY = "DAKO_EMBED_STUB";
/**
 * Minimum content length (after trim) for a message to be eligible for embedding.
 * Shorter messages are conversational noise (acks, single words) and embed
 * poorly — they crowd out signal in recall. See WI-rag-long-sessions Req-3.
 */
export declare const MESSAGE_MIN_LEN = 20;
/**
 * Skip-rule predicate shared by `logMessage` (inline embed) and
 * `embed-backfill --collection messages` (batch backfill).
 *
 * Returns true when the message is worth embedding:
 *   - role is not "tool" (tool-call payloads are structured and embed poorly)
 *   - trimmed content is non-empty
 *   - trimmed content length >= MESSAGE_MIN_LEN
 *
 * Centralizing here keeps insert-time and backfill-time decisions identical —
 * a row skipped at insert stays skipped at backfill.
 */
export declare function shouldEmbedMessage(role: string, content: string): boolean;
export declare function getModelId(): string;
/**
 * Embed an array of texts. Returns one Float32Array per input, in order.
 * On real-model path the vectors are unit-norm and `dim`-long (model-dependent).
 * On stub path the vectors are unit-norm and `STUB_DIM`-long.
 *
 * Throws if the model load itself errors (callers can catch to degrade gracefully).
 */
export declare function embedTexts(texts: string[]): Promise<Float32Array[]>;
export declare function floatsToBytes(v: Float32Array): Buffer;
export declare function bytesToFloats(b: Buffer): Float32Array;
/**
 * Cosine similarity of two unit vectors. Equal to dot product because both
 * sides are unit-norm by construction. If lengths differ, we score 0 — this
 * is the model-mismatch defensive case (caller should already have filtered).
 */
export declare function cosine(a: Float32Array, b: Float32Array): number;
/**
 * Reciprocal Rank Fusion merge.
 *
 * Takes two ranked arrays of opaque ids (rank 1 = top). Returns the merged
 * top-`limit` list ordered by RRF score = sum over sides of 1/(k + rank).
 *
 * Single-side fallback: if one input is empty, the other side's order is
 * returned as-is (capped at `limit`). If both are empty, [] is returned.
 *
 * The id type T is whatever the caller uses to identify a row (string,
 * number, Mongo _id stringified, SQLite rowid, etc.) — the merger doesn't
 * care, it just dedups by `===`.
 */
export declare function rrfMerge<T>(ftsRanked: T[], vectorRanked: T[], limit: number, k?: number): T[];
/**
 * Deterministic stub used in tests (env: DAKO_EMBED_STUB).
 *
 * Folds the input text byte-by-byte through FNV-1a into STUB_DIM float
 * positions. The result is unit-normalized so cosine(a, b) is in [-1, 1].
 * Same input → same vector. Different inputs almost always → different
 * vectors with discriminable cosines, which is enough for AC tests.
 */
export declare function stubEmbed(text: string): Float32Array;
/** Convenience for the MCP tool boundary — returns the JSON-shaped ToolResult content. */
export declare function embedQueryResult(text: string): Promise<{
    embedding: string;
    model: string;
}>;
//# sourceMappingURL=embed.d.ts.map