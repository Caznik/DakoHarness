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
/** Env key that selects the embedding model id. */
const MODEL_ENV_KEY = "DAKO_EMBEDDING_MODEL";
const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
/** Env key that switches `embedTexts` to its deterministic test stub. */
export const EMBED_STUB_KEY = "DAKO_EMBED_STUB";
/** Stub vector dimension (32 floats). Real model dim is whatever the model emits (384 for MiniLM-L6). */
const STUB_DIM = 32;
// ── Public surface ────────────────────────────────────────────────────────
export function getModelId() {
    const v = process.env[MODEL_ENV_KEY];
    if (v && v.trim().length > 0)
        return v.trim();
    return DEFAULT_MODEL;
}
/**
 * Embed an array of texts. Returns one Float32Array per input, in order.
 * On real-model path the vectors are unit-norm and `dim`-long (model-dependent).
 * On stub path the vectors are unit-norm and `STUB_DIM`-long.
 *
 * Throws if the model load itself errors (callers can catch to degrade gracefully).
 */
export async function embedTexts(texts) {
    if (process.env[EMBED_STUB_KEY]) {
        return texts.map(stubEmbed);
    }
    const pipe = await loadPipeline();
    const out = [];
    for (const t of texts) {
        // Transformers.js pipeline returns a Tensor with a Float32Array `.data` property
        // when called with { pooling: "mean", normalize: true }. We copy into a plain
        // Float32Array so the consumer doesn't hold a reference into the tensor's pool.
        const tensor = await pipe(t, { pooling: "mean", normalize: true });
        out.push(new Float32Array(tensor.data));
    }
    return out;
}
export function floatsToBytes(v) {
    // The underlying ArrayBuffer holds 4 bytes per float in native (little-endian on x64) order.
    // We slice to the exact view length in case the Float32Array doesn't cover the whole buffer.
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}
export function bytesToFloats(b) {
    // Buffer is a Uint8Array view onto a (possibly shared) ArrayBuffer. We re-view
    // the slice belonging to this Buffer as Float32Array. byteOffset alignment must
    // be a multiple of 4; if it isn't, copy into a fresh ArrayBuffer first.
    if (b.byteOffset % 4 === 0) {
        return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    }
    const copy = Buffer.alloc(b.byteLength);
    b.copy(copy);
    return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}
/**
 * Cosine similarity of two unit vectors. Equal to dot product because both
 * sides are unit-norm by construction. If lengths differ, we score 0 — this
 * is the model-mismatch defensive case (caller should already have filtered).
 */
export function cosine(a, b) {
    if (a.length !== b.length)
        return 0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += a[i] * b[i];
    }
    return sum;
}
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
export function rrfMerge(ftsRanked, vectorRanked, limit, k = 60) {
    if (ftsRanked.length === 0 && vectorRanked.length === 0)
        return [];
    if (ftsRanked.length === 0)
        return vectorRanked.slice(0, limit);
    if (vectorRanked.length === 0)
        return ftsRanked.slice(0, limit);
    const scores = new Map();
    ftsRanked.forEach((id, idx) => {
        const rank = idx + 1;
        scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    });
    vectorRanked.forEach((id, idx) => {
        const rank = idx + 1;
        scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    });
    const merged = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
    return merged.slice(0, limit).map(([id]) => id);
}
// ── Internals ─────────────────────────────────────────────────────────────
let _pipelinePromise = null;
async function loadPipeline() {
    if (!_pipelinePromise) {
        const modelId = getModelId();
        process.stderr.write(`[embed] loading ${modelId}…\n`);
        _pipelinePromise = (async () => {
            // Dynamic import so tests with DAKO_EMBED_STUB=1 don't require the package.
            const mod = await import("@xenova/transformers");
            // The package exports { pipeline } at top level. Some bundler edge cases route
            // through .default — handle both.
            const transformers = mod;
            const pipelineFn = (transformers.pipeline ?? transformers.default?.pipeline);
            if (!pipelineFn) {
                throw new Error("@xenova/transformers did not export a 'pipeline' function");
            }
            return pipelineFn("feature-extraction", modelId);
        })();
    }
    return _pipelinePromise;
}
/**
 * Deterministic stub used in tests (env: DAKO_EMBED_STUB).
 *
 * Folds the input text byte-by-byte through FNV-1a into STUB_DIM float
 * positions. The result is unit-normalized so cosine(a, b) is in [-1, 1].
 * Same input → same vector. Different inputs almost always → different
 * vectors with discriminable cosines, which is enough for AC tests.
 */
export function stubEmbed(text) {
    const v = new Float32Array(STUB_DIM);
    // Seed each lane with a distinct FNV-1a hash by mixing a per-lane salt.
    const bytes = Buffer.from(text, "utf8");
    for (let lane = 0; lane < STUB_DIM; lane++) {
        let h = 2166136261 ^ lane; // FNV offset basis, salted by lane
        for (let i = 0; i < bytes.length; i++) {
            h ^= bytes[i];
            // FNV prime = 16777619. Use Math.imul to keep 32-bit arithmetic.
            h = Math.imul(h, 16777619);
        }
        // Map uint32 hash → [-1, 1) float
        v[lane] = ((h >>> 0) / 0xffffffff) * 2 - 1;
    }
    // Unit-normalize
    let norm = 0;
    for (let i = 0; i < STUB_DIM; i++)
        norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < STUB_DIM; i++)
            v[i] = v[i] / norm;
    }
    return v;
}
/** Convenience for the MCP tool boundary — returns the JSON-shaped ToolResult content. */
export async function embedQueryResult(text) {
    const [vec] = await embedTexts([text]);
    if (!vec)
        throw new Error("embedTexts returned an empty result");
    return {
        embedding: floatsToBytes(vec).toString("base64"),
        model: getModelId(),
    };
}
//# sourceMappingURL=embed.js.map