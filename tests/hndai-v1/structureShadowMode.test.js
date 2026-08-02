"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");
const shadowPath = path.resolve(__dirname, "../../js/hndai-v1/structureShadowMode.js");
const orchestrator = require("../../js/hndai-v1/structurePipelineOrchestrator.js");
const shadow = require(shadowPath);
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function flags(enabled) { return { structureShadowEnabled: enabled }; }
function legacy(decision, candidate, reason) {
    return { decision, reason: reason === undefined ? "LEGACY_REASON" : reason, candidate };
}
function candidate(overrides) {
    return Object.assign({
        key: "CANDIDATE-1", direction: "LONG", structureEventId: "EVENT-1",
        structureConfirmationIndex: 1, extra: { preserved: true }
    }, overrides);
}
function pipeline(decision, overrides) {
    return Object.assign({
        valid: true, error: null, ready: true, failedStage: null, stageError: null,
        gateDecision: decision, gateReason: decision === "ALLOW" ? "STRUCTURE_MATCH" : "DIRECTION_MISMATCH",
        nested: { value: 1 }
    }, overrides);
}
function loadBrowser(dependency) {
    const code = fs.readFileSync(shadowPath, "utf8");
    const window = dependency === undefined ? {} : {
        HNDStructurePipelineOrchestrator: dependency
    };
    vm.runInNewContext(code, { window, JSON, Object, Array, String });
    return window.HNDStructureShadowMode;
}
function loadCommonJsWith(dependency) {
    const originalLoad = Module._load;
    const cached = require.cache[shadowPath];
    delete require.cache[shadowPath];
    Module._load = function (request, parent, isMain) {
        if (parent && parent.filename === shadowPath &&
            request === "./structurePipelineOrchestrator.js") {
            return dependency;
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require(shadowPath);
    } finally {
        Module._load = originalLoad;
        delete require.cache[shadowPath];
        if (cached) { require.cache[shadowPath] = cached; }
    }
}
function fixture(result) {
    const calls = [];
    return {
        calls,
        api: loadCommonJsWith({ evaluateSetupCandidate: function () {
            calls.push(Array.from(arguments));
            if (result instanceof Error) { throw result; }
            return clone(result);
        } })
    };
}
function candle(index, close, high, low) {
    return { openTime: index * 1000, closeTime: index * 1000 + 999,
        open: close, high, low, close, volume: 10 };
}
const high = [candle(0, 5, 6, 4), candle(1, 10, 12, 3),
    candle(2, 6, 7, 4), candle(3, 13, 14, 12)];
const transitions = [
    candle(0, 5, 6, 4), candle(1, 10, 12, 3), candle(2, 6, 7, 4),
    candle(3, 13, 14, 12), candle(4, 14, 16, 13), candle(5, 12, 13, 11),
    candle(6, 17, 18, 16), candle(7, 10, 11, 9)
];
const analysisContext = { symbol: "BTCUSDT", interval: "15m", nowMs: 999999,
    leftBars: 1, rightBars: 1 };
function realInputs(candles, snapshot, direction) {
    return {
        candidate: { key: "REAL-" + snapshot.sequenceIndex,
            direction: direction || (snapshot.direction === "BULLISH" ? "LONG" : "SHORT"),
            structureEventId: snapshot.sourceEventId,
            structureConfirmationIndex: snapshot.levelConfirmedAtIndex },
        evaluation: { symbol: "BTCUSDT", interval: "15m",
            evaluationAtIndex: candles.length - 1,
            evaluationOpenTime: (candles.length - 1) * 1000,
            evaluationCloseTime: (candles.length - 1) * 1000 + 999 }
    };
}

test("public API is exact", () => assert.deepStrictEqual(Object.keys(shadow).sort(),
    ["getSchemaVersion", "getVocabulary", "runShadow"].sort()));
test("schema and vocabulary are exact", () => {
    assert.strictEqual(shadow.getSchemaVersion(), "HND_STRUCTURE_SHADOW_MODE_V1");
    assert.deepStrictEqual(shadow.getVocabulary(), {
        modes: ["OFF", "SHADOW"], decisions: ["ALLOW", "BLOCK"],
        comparisons: ["NOT_EVALUATED", "NOT_COMPARABLE", "MATCH_ALLOW", "MATCH_BLOCK",
            "LEGACY_ALLOW_GATE_BLOCK", "LEGACY_BLOCK_GATE_ALLOW", "PIPELINE_FAILED"],
        statuses: ["DISABLED", "COMPLETED", "FAILED"]
    });
});
test("CommonJS dependency is used", () => {
    const value = fixture(pipeline("ALLOW"));
    assert.strictEqual(value.api.runShadow([], {}, legacy("ALLOW", candidate()), {}, flags(true)).gateDecision, "ALLOW");
    assert.strictEqual(value.calls.length, 1);
});
test("browser UMD global and dependency work", () => {
    const api = loadBrowser({ evaluateSetupCandidate: () => pipeline("BLOCK") });
    assert.strictEqual(api.runShadow([], {}, legacy("ALLOW", candidate()), {}, flags(true)).gateDecision, "BLOCK");
});
test("missing dependency has exact error", () => assert.strictEqual(
    loadBrowser().runShadow([], {}, legacy("ALLOW", candidate()), {}, flags(true)).error,
    "ORCHESTRATOR_DEPENDENCY_INVALID"));
test("feature flags require exact schema and boolean", () => {
    for (const value of [{}, { structureShadowEnabled: "true" },
        { structureShadowEnabled: true, extra: false }, null]) {
        assert.strictEqual(shadow.runShadow([], {}, legacy("BLOCK", null), {}, value).error,
            "INVALID_FEATURE_FLAGS");
    }
});
test("disabled never calls orchestrator and preserves ALLOW", () => {
    const value = fixture(new Error("must not run"));
    const output = value.api.runShadow([], {}, legacy("ALLOW", candidate(), "YES"), {}, flags(false));
    assert.strictEqual(value.calls.length, 0); assert.strictEqual(output.status, "DISABLED");
    assert.strictEqual(output.mode, "OFF"); assert.strictEqual(output.comparison, "NOT_EVALUATED");
    assert.strictEqual(output.effectiveDecision, "ALLOW"); assert.strictEqual(output.effectiveReason, "YES");
});
test("disabled preserves BLOCK", () => assert.strictEqual(
    shadow.runShadow([], {}, legacy("BLOCK", null), {}, flags(false)).effectiveDecision, "BLOCK"));
test("enabled calls orchestrator exactly once with original inputs", () => {
    const value = fixture(pipeline("ALLOW")); const raw = [{ x: 1 }]; const ac = { a: 1 };
    const lc = candidate(); const ec = { e: 1 };
    value.api.runShadow(raw, ac, legacy("ALLOW", lc), ec, flags(true));
    assert.strictEqual(value.calls.length, 1);
    assert.deepStrictEqual(value.calls[0], [raw, ac, lc, ec]);
    assert.notStrictEqual(value.calls[0][0], raw); assert.notStrictEqual(value.calls[0][1], ac);
    assert.notStrictEqual(value.calls[0][2], lc); assert.notStrictEqual(value.calls[0][3], ec);
});
for (const row of [
    ["ALLOW", "ALLOW", "MATCH_ALLOW", false], ["BLOCK", "BLOCK", "MATCH_BLOCK", false],
    ["ALLOW", "BLOCK", "LEGACY_ALLOW_GATE_BLOCK", true],
    ["BLOCK", "ALLOW", "LEGACY_BLOCK_GATE_ALLOW", true]
]) {
    test(row[0] + " versus " + row[1], () => {
        const output = fixture(pipeline(row[1])).api.runShadow([], {}, legacy(row[0], candidate()), {}, flags(true));
        assert.strictEqual(output.comparison, row[2]); assert.strictEqual(output.wouldChangeDecision, row[3]);
        assert.strictEqual(output.effectiveDecision, row[0]); assert.strictEqual(output.diagnostics.mismatch, row[3]);
    });
}
test("BLOCK with null candidate is not comparable", () => {
    const output = shadow.runShadow([], {}, legacy("BLOCK", null), {}, flags(true));
    assert.strictEqual(output.comparison, "NOT_COMPARABLE"); assert.strictEqual(output.status, "COMPLETED");
});
test("ALLOW with null candidate is invalid", () => assert.strictEqual(
    shadow.runShadow([], {}, legacy("ALLOW", null), {}, flags(true)).error, "LEGACY_CANDIDATE_REQUIRED"));
test("legacy exact schema and fields are validated", () => {
    assert.strictEqual(shadow.runShadow([], {}, { decision: "BLOCK", reason: null, candidate: null, x: 1 }, {}, flags(false)).error, "INVALID_LEGACY_RESULT");
    assert.strictEqual(shadow.runShadow([], {}, legacy("WAIT", null), {}, flags(false)).error, "INVALID_LEGACY_DECISION");
    assert.strictEqual(shadow.runShadow([], {}, legacy("BLOCK", null, ""), {}, flags(false)).error, "INVALID_LEGACY_REASON");
    assert.strictEqual(shadow.runShadow([], {}, legacy("BLOCK", []), {}, flags(false)).error, "INVALID_LEGACY_CANDIDATE");
});
test("pipeline invalid is a completed comparison failure", () => {
    const output = fixture(pipeline(null, { valid: false, ready: false, error: "BAD",
        failedStage: "SETUP_ADAPTER", stageError: "INVALID_CANDIDATE_KEY",
        gateDecision: null, gateReason: null })).api.runShadow([], {}, legacy("ALLOW", candidate({ key: "" })), {}, flags(true));
    assert.strictEqual(output.valid, true); assert.strictEqual(output.status, "COMPLETED");
    assert.strictEqual(output.comparison, "PIPELINE_FAILED"); assert.strictEqual(output.gateDecision, null);
    assert.deepStrictEqual(Object.assign({}, output.diagnostics), {
        evaluated: true, comparable: true, pipelineValid: false, pipelineReady: false,
        pipelineError: "BAD", failedStage: "SETUP_ADAPTER", stageError: "INVALID_CANDIDATE_KEY",
        gateValid: false, gateReady: false, mismatch: false
    });
    assert.strictEqual(output.candidateKey, null);
});
test("pipeline exception fails closed to legacy", () => {
    const output = fixture(new Error("boom")).api.runShadow([], {}, legacy("ALLOW", candidate(), "SAFE"), {}, flags(true));
    assert.strictEqual(output.error, "SHADOW_EVALUATION_FAILED"); assert.strictEqual(output.status, "FAILED");
    assert.strictEqual(output.gateDecision, null); assert.strictEqual(output.effectiveDecision, "ALLOW");
    assert.strictEqual(output.effectiveReason, "SAFE");
});
test("gate decision reason diagnostics and candidate key are retained", () => {
    const output = fixture(pipeline("BLOCK")).api.runShadow([], {}, legacy("ALLOW", candidate()), {}, flags(true));
    assert.strictEqual(output.gateReason, "DIRECTION_MISMATCH"); assert.strictEqual(output.candidateKey, "CANDIDATE-1");
    assert.strictEqual(output.diagnostics.gateValid, true); assert.strictEqual(output.diagnostics.gateReady, true);
});
test("output schema is exact on success disabled and failure", () => {
    const expected = ["valid", "error", "ready", "schemaVersion", "mode", "status", "enabled",
        "legacyDecision", "legacyReason", "gateDecision", "gateReason", "effectiveDecision",
        "effectiveReason", "comparison", "wouldChangeDecision", "candidateKey",
        "pipelineEvaluation", "diagnostics"].sort();
    const outputs = [fixture(pipeline("ALLOW")).api.runShadow([], {}, legacy("ALLOW", candidate()), {}, flags(true)),
        shadow.runShadow([], {}, legacy("BLOCK", null), {}, flags(false)),
        shadow.runShadow([], {}, legacy("WAIT", null), {}, flags(false))];
    outputs.forEach(value => assert.deepStrictEqual(Object.keys(value).sort(), expected));
});
test("inputs and extra candidate fields are preserved without output leakage", () => {
    const raw = [{ nested: { n: 1 } }], ac = { nested: { n: 2 } }, lc = candidate(), ec = { nested: { n: 3 } }, ff = flags(true);
    const before = clone([raw, ac, lc, ec, ff]);
    const output = fixture(pipeline("ALLOW")).api.runShadow(raw, ac, legacy("ALLOW", lc), ec, ff);
    assert.deepStrictEqual([raw, ac, lc, ec, ff], before);
    assert.strictEqual(JSON.stringify(output).includes("preserved"), false);
});
test("pipeline output clone is isolated and calls are deterministic", () => {
    const value = fixture(pipeline("ALLOW"));
    const first = value.api.runShadow([], {}, legacy("ALLOW", candidate()), {}, flags(true));
    first.pipelineEvaluation.nested.value = 99; first.diagnostics.mismatch = true;
    const second = value.api.runShadow([], {}, legacy("ALLOW", candidate()), {}, flags(true));
    assert.strictEqual(second.pipelineEvaluation.nested.value, 1); assert.strictEqual(second.diagnostics.mismatch, false);
    assert.deepStrictEqual(second, value.api.runShadow([], {}, legacy("ALLOW", candidate()), {}, flags(true)));
});
test("real orchestrator produces MATCH_ALLOW", () => {
    const analyzed = orchestrator.analyzeStructure(high, analysisContext); const input = realInputs(high, analyzed.latestStructure);
    const output = shadow.runShadow(high, analysisContext, legacy("ALLOW", input.candidate), input.evaluation, flags(true));
    assert.strictEqual(output.comparison, "MATCH_ALLOW");
});
test("real orchestrator produces LEGACY_ALLOW_GATE_BLOCK", () => {
    const analyzed = orchestrator.analyzeStructure(high, analysisContext); const input = realInputs(high, analyzed.latestStructure, "SHORT");
    const output = shadow.runShadow(high, analysisContext, legacy("ALLOW", input.candidate), input.evaluation, flags(true));
    assert.strictEqual(output.comparison, "LEGACY_ALLOW_GATE_BLOCK");
});
test("real orchestrator reports stale-event comparison", () => {
    const analyzed = orchestrator.analyzeStructure(transitions, analysisContext);
    assert.ok(analyzed.snapshotResult.snapshots.length > 1);
    const input = realInputs(transitions, analyzed.snapshotResult.snapshots[0]);
    const output = shadow.runShadow(transitions, analysisContext, legacy("ALLOW", input.candidate), input.evaluation, flags(true));
    assert.strictEqual(output.comparison, "LEGACY_ALLOW_GATE_BLOCK");
    assert.strictEqual(output.gateReason, "STALE_STRUCTURE_REFERENCE");
});
test("production module has no live integration or side effects", () => {
    const code = fs.readFileSync(shadowPath, "utf8");
    for (const token of ["setupEngine", "entryLow", "entryHigh", "stopLoss", "takeProfit",
        "Date.now", "new Date", "Math.random", "setTimeout", "setInterval", "fetch(",
        "document.", "localStorage", "sessionStorage", "console."]) {
        assert.strictEqual(code.includes(token), false, token);
    }
});

let passed = 0;
for (const item of tests) {
    try { item.fn(); passed += 1; console.log("PASS:" + item.name); }
    catch (error) {
        console.error("HND_STRUCTURE_SHADOW_MODE_TEST_FAILED:" + item.name);
        console.error(error.stack || error); process.exitCode = 1; break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_SHADOW_MODE_TESTS_PASS:" + tests.length);
}
