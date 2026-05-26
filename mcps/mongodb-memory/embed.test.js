/**
 * embed.test.ts — Tests for the shared embed module.
 *
 * Runs via `node --test`. All tests use the deterministic stub
 * (DAKO_EMBED_STUB=1) so CI never downloads the real ~30MB model.
 *
 * AC coverage:
 *   - cosine math, floats↔bytes round-trip      → AC-7
 *   - getModelId env reading                     → AC-1
 *   - stub determinism                           → AC-14 (test isolation)
 *   - rrfMerge math (incl. single-side fallback) → AC-5, AC-6
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
// Force stub before importing the module (env read happens lazily inside).
process.env["DAKO_EMBED_STUB"] = "1";
import { embedTexts, getModelId, floatsToBytes, bytesToFloats, cosine, rrfMerge, stubEmbed, } from "./embed.js";
// ── floats ↔ bytes round-trip ────────────────────────────────────────────
test("floatsToBytes / bytesToFloats round-trips arbitrary Float32 vectors", () => {
    const original = new Float32Array([0.5, -0.25, 1e-6, -1.5, 0, 3.14159]);
    const buf = floatsToBytes(original);
    assert.equal(buf.length, original.length * 4);
    const restored = bytesToFloats(buf);
    assert.equal(restored.length, original.length);
    for (let i = 0; i < original.length; i++) {
        assert.equal(restored[i], original[i], `lane ${i}`);
    }
});
// ── cosine math on known unit vectors ────────────────────────────────────
test("cosine of identical unit vectors is 1, orthogonal is 0, opposite is -1", () => {
    const v1 = new Float32Array([1, 0, 0]);
    const v2 = new Float32Array([1, 0, 0]);
    const v3 = new Float32Array([0, 1, 0]);
    const v4 = new Float32Array([-1, 0, 0]);
    assert.equal(cosine(v1, v2), 1);
    assert.equal(cosine(v1, v3), 0);
    assert.equal(cosine(v1, v4), -1);
});
test("cosine returns 0 on length mismatch (defensive)", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    assert.equal(cosine(a, b), 0);
});
// ── stub determinism ────────────────────────────────────────────────────
test("stubEmbed is deterministic and unit-normalized", () => {
    const v1 = stubEmbed("hello world");
    const v2 = stubEmbed("hello world");
    assert.deepEqual(Array.from(v1), Array.from(v2));
    let norm = 0;
    for (const x of v1)
        norm += x * x;
    assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-5, `norm should be ~1, got ${Math.sqrt(norm)}`);
});
test("stubEmbed produces different vectors for different inputs", () => {
    const v1 = stubEmbed("alpha");
    const v2 = stubEmbed("beta");
    assert.notDeepEqual(Array.from(v1), Array.from(v2));
    // And cosine should not equal 1.
    assert.ok(cosine(v1, v2) < 0.999, "different inputs should produce non-identical vectors");
});
test("embedTexts uses stub when DAKO_EMBED_STUB is set; matches stubEmbed", async () => {
    const [vec] = await embedTexts(["sample text"]);
    const direct = stubEmbed("sample text");
    assert.ok(vec);
    assert.deepEqual(Array.from(vec), Array.from(direct));
});
// ── getModelId env handling ─────────────────────────────────────────────
test("getModelId returns default when DAKO_EMBEDDING_MODEL is unset", () => {
    const prev = process.env["DAKO_EMBEDDING_MODEL"];
    delete process.env["DAKO_EMBEDDING_MODEL"];
    try {
        assert.equal(getModelId(), "Xenova/all-MiniLM-L6-v2");
    }
    finally {
        if (prev !== undefined)
            process.env["DAKO_EMBEDDING_MODEL"] = prev;
    }
});
test("getModelId returns env value when set", () => {
    const prev = process.env["DAKO_EMBEDDING_MODEL"];
    process.env["DAKO_EMBEDDING_MODEL"] = "custom-model";
    try {
        assert.equal(getModelId(), "custom-model");
    }
    finally {
        if (prev === undefined)
            delete process.env["DAKO_EMBEDDING_MODEL"];
        else
            process.env["DAKO_EMBEDDING_MODEL"] = prev;
    }
});
// ── rrfMerge math ───────────────────────────────────────────────────────
test("rrfMerge produces expected order on synthetic ranked inputs", () => {
    // FTS ranks: a=1, b=2, c=3 → scores 1/61, 1/62, 1/63
    // Vec ranks: c=1, b=2, d=3 → scores 1/61, 1/62, 1/63
    // Combined: c = 1/63 + 1/61, b = 1/62 + 1/62, a = 1/61, d = 1/63
    // Numerically: c ≈ 0.0327, b ≈ 0.0323, a ≈ 0.0164, d ≈ 0.0159
    const merged = rrfMerge(["a", "b", "c"], ["c", "b", "d"], 10);
    assert.deepEqual(merged, ["c", "b", "a", "d"]);
});
test("rrfMerge single-side fallback: empty FTS returns vector order", () => {
    const merged = rrfMerge([], ["x", "y", "z"], 2);
    assert.deepEqual(merged, ["x", "y"]);
});
test("rrfMerge single-side fallback: empty vector returns FTS order", () => {
    const merged = rrfMerge(["p", "q", "r"], [], 2);
    assert.deepEqual(merged, ["p", "q"]);
});
test("rrfMerge both-empty returns empty", () => {
    const merged = rrfMerge([], [], 5);
    assert.deepEqual(merged, []);
});
test("rrfMerge respects limit cap", () => {
    const merged = rrfMerge(["a", "b", "c", "d"], ["e", "f", "g", "h"], 3);
    assert.equal(merged.length, 3);
});
//# sourceMappingURL=embed.test.js.map