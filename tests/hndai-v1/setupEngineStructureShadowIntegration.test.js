"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const commonJsShadow = require("../../js/hndai-v1/structureShadowMode.js");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function loadEngine(structureShadowMode) {
    const code = fs.readFileSync(path.resolve(__dirname, "../../js/setupEngine.js"), "utf8");
    const window = {};
    if (structureShadowMode !== undefined) {
        window.HNDStructureShadowMode = structureShadowMode;
    }
    vm.runInNewContext(code, { window, console });
    return window.HNDSetupEngine;
}

function shadowResult(legacyDecision, gateDecision) {
    return {
        valid: true, error: null, ready: true,
        schemaVersion: "HND_STRUCTURE_SHADOW_MODE_V1",
        mode: "SHADOW", status: "COMPLETED", enabled: true,
        legacyDecision, legacyReason: "LEGACY_REASON",
        gateDecision, gateReason: gateDecision === "ALLOW" ? "STRUCTURE_MATCH" : "DIRECTION_MISMATCH",
        effectiveDecision: legacyDecision, effectiveReason: "LEGACY_REASON",
        comparison: legacyDecision === gateDecision ? "MATCH_ALLOW" :
            legacyDecision === "ALLOW" ? "LEGACY_ALLOW_GATE_BLOCK" : "LEGACY_BLOCK_GATE_ALLOW",
        wouldChangeDecision: legacyDecision !== gateDecision,
        candidateKey: null, pipelineEvaluation: { nested: { value: 1 } },
        diagnostics: { evaluated: true }
    };
}

function dependency(handler) {
    const calls = [];
    return {
        calls,
        api: { runShadow: function () {
            calls.push(Array.from(arguments));
            return handler ? handler.apply(null, arguments) : shadowResult(arguments[2].decision, "ALLOW");
        } }
    };
}

function candles() {
    return [
        { time: 1000, closeTime: 1999, open: 110, high: 112, low: 108, close: 110, volume: 10 },
        { time: 2000, closeTime: 2999, open: 105, high: 107, low: 103, close: 105, volume: 10 }
    ];
}

function qualifiedZone() {
    return {
        id: "OB-1", kind: "ORDER_BLOCK", type: "BULLISH", status: "ACTIVE",
        structureQualified: true, structureSignificant: true,
        structureEventId: "EVENT-1", structureEventType: "BOS",
        structureConfirmationIndex: 1, structureConfirmationTime: 1900,
        startTime: 1000, confirmationTime: 1900, high: 102, low: 100,
        structureSignificanceScore: 100, structureATR: 10, zoneHeightATR: 1,
        dominantQualifiedZone: true, touches: 0, qualificationVersion: "1"
    };
}

function context() {
    return {
        rawCandles: [{ openTime: 0, closeTime: 999, open: 1, high: 2, low: 0, close: 1 }],
        analysisContext: { symbol: "BTCUSDT", interval: "15m", nowMs: 9999, leftBars: 1, rightBars: 1 },
        evaluationContext: { symbol: "BTCUSDT", interval: "15m", evaluationAtIndex: 1,
            evaluationOpenTime: 1000, evaluationCloseTime: 1999 }
    };
}

function allowInput(enabled) {
    const input = {
        symbol: "BTCUSDT", interval: "15m", price: 105,
        candles: candles(), analysis: { signal: "LONG", marketBias: "BULLISH" },
        qualifiedPriceZones: { orderBlocks: [qualifiedZone()], fvgs: [] },
        structureShadowContext: context()
    };
    if (enabled !== undefined) input.featureFlags = { structureShadowEnabled: enabled };
    return input;
}

function blockInput(enabled) {
    const input = {
        symbol: "BTCUSDT", interval: "15m", price: 105,
        candles: candles(), analysis: { signal: "WAIT", marketBias: "NEUTRAL" },
        qualifiedPriceZones: { orderBlocks: [], fvgs: [] },
        structureShadowContext: context()
    };
    if (enabled !== undefined) input.featureFlags = { structureShadowEnabled: enabled };
    return input;
}

test("public API preserves existing functions and adds getter", () => {
    const api = loadEngine(commonJsShadow);
    for (const name of ["evaluate", "reset", "getState", "getCurrentSetup", "getHistory",
        "buildCandidates", "updateExistingSetup", "getLastDebug", "explainLastEvaluation",
        "buildCandidatesDetailed", "getLastStructureShadow"]) {
        assert.strictEqual(typeof api[name], "function", name);
    }
});

test("missing flag disables shadow and does not call dependency", () => {
    const mock = dependency(); const api = loadEngine(mock.api);
    const state = api.evaluate(blockInput());
    assert.strictEqual(mock.calls.length, 0); assert.strictEqual(state.status, "NO_SETUP");
    assert.deepStrictEqual(clone(api.getLastStructureShadow()), {
        enabled: false, status: "DISABLED", reason: "FEATURE_DISABLED",
        legacyResult: null, shadowResult: null
    });
});

test("false flag disables shadow and does not call dependency", () => {
    const mock = dependency(); const api = loadEngine(mock.api);
    api.evaluate(allowInput(false));
    assert.strictEqual(mock.calls.length, 0); assert.ok(api.getCurrentSetup());
});

test("true flag calls runShadow once with exact legacy ALLOW arguments", () => {
    const mock = dependency((raw, analysis, legacy) => shadowResult(legacy.decision, "ALLOW"));
    const api = loadEngine(mock.api); const input = allowInput(true);
    api.evaluate(input);
    assert.strictEqual(mock.calls.length, 1);
    const call = mock.calls[0];
    assert.deepStrictEqual(clone(call[0]), input.structureShadowContext.rawCandles);
    assert.deepStrictEqual(clone(call[1]), input.structureShadowContext.analysisContext);
    assert.deepStrictEqual(clone(call[3]), input.structureShadowContext.evaluationContext);
    assert.deepStrictEqual(clone(call[4]), { structureShadowEnabled: true });
    assert.deepStrictEqual(Object.keys(call[2]).sort(), ["candidate", "decision", "reason"]);
    assert.strictEqual(call[2].decision, "ALLOW"); assert.strictEqual(call[2].reason, "SETUP_CREATED");
    assert.ok(call[2].candidate); assert.ok(api.getCurrentSetup());
});

test("legacy ALLOW remains created when shadow says BLOCK", () => {
    const mock = dependency((raw, analysis, legacy) => shadowResult(legacy.decision, "BLOCK"));
    const api = loadEngine(mock.api); const state = api.evaluate(allowInput(true));
    assert.notStrictEqual(state.status, "NO_SETUP"); assert.ok(state.currentSetup);
    assert.strictEqual(api.getLastStructureShadow().shadowResult.gateDecision, "BLOCK");
});

test("legacy BLOCK remains NO_SETUP when shadow says ALLOW", () => {
    const mock = dependency((raw, analysis, legacy) => shadowResult(legacy.decision, "ALLOW"));
    const api = loadEngine(mock.api); const state = api.evaluate(blockInput(true));
    assert.strictEqual(state.status, "NO_SETUP"); assert.strictEqual(state.currentSetup, null);
    assert.strictEqual(mock.calls[0][2].decision, "BLOCK"); assert.strictEqual(mock.calls[0][2].candidate, null);
    assert.strictEqual(api.getLastStructureShadow().shadowResult.gateDecision, "ALLOW");
});

test("missing dependency is isolated from legacy ALLOW", () => {
    const api = loadEngine(); const state = api.evaluate(allowInput(true));
    assert.ok(state.currentSetup); assert.strictEqual(api.getLastStructureShadow().reason,
        "SHADOW_DEPENDENCY_UNAVAILABLE");
});

test("dependency exception is isolated from legacy ALLOW", () => {
    const mock = dependency(() => { throw new Error("boom"); }); const api = loadEngine(mock.api);
    const state = api.evaluate(allowInput(true));
    assert.ok(state.currentSetup); assert.strictEqual(api.getLastStructureShadow().reason,
        "SHADOW_EVALUATION_EXCEPTION");
});

test("invalid or missing context is not applicable and legacy continues", () => {
    for (const bad of [undefined, {}, { rawCandles: [], analysisContext: {}, evaluationContext: {}, extra: true }]) {
        const mock = dependency(); const api = loadEngine(mock.api); const input = allowInput(true);
        if (bad === undefined) delete input.structureShadowContext;
        else input.structureShadowContext = bad;
        const state = api.evaluate(input);
        assert.ok(state.currentSetup); assert.strictEqual(mock.calls.length, 0);
        assert.strictEqual(api.getLastStructureShadow().reason, "INVALID_STRUCTURE_SHADOW_CONTEXT");
    }
});

test("existing setup locked path is unchanged and not applicable", () => {
    const mock = dependency(); const api = loadEngine(mock.api);
    const first = api.evaluate(allowInput(false)); const key = first.currentSetup.key;
    const second = api.evaluate(allowInput(true));
    assert.strictEqual(second.currentSetup.key, key); assert.strictEqual(second.status, "PENDING");
    assert.strictEqual(api.getLastDebug().primaryReason, "EXISTING_SETUP_UPDATED");
    assert.strictEqual(mock.calls.length, 0);
    assert.strictEqual(api.getLastStructureShadow().status, "NOT_APPLICABLE");
    assert.strictEqual(api.getLastStructureShadow().reason, "EXISTING_SETUP_EVALUATION");
});

test("getter returns a deep clone", () => {
    const mock = dependency(); const api = loadEngine(mock.api); api.evaluate(blockInput(true));
    const first = api.getLastStructureShadow(); first.shadowResult.pipelineEvaluation.nested.value = 99;
    first.legacyResult.decision = "ALLOW";
    const second = api.getLastStructureShadow();
    assert.strictEqual(second.shadowResult.pipelineEvaluation.nested.value, 1);
    assert.strictEqual(second.legacyResult.decision, "BLOCK");
});

test("reset clears last shadow diagnostic", () => {
    const api = loadEngine(dependency().api); api.evaluate(blockInput(true));
    assert.ok(api.getLastStructureShadow()); api.reset();
    assert.strictEqual(api.getLastStructureShadow(), null);
});

test("all inputs are isolated from dependency mutation", () => {
    const mock = dependency((raw, analysis, legacy, evaluation, flags) => {
        raw.push({ changed: true }); analysis.changed = true; legacy.decision = "BLOCK";
        evaluation.changed = true; flags.structureShadowEnabled = false;
        return shadowResult("ALLOW", "BLOCK");
    });
    const api = loadEngine(mock.api); const input = allowInput(true); const before = clone(input);
    api.evaluate(input); assert.deepStrictEqual(input, before); assert.ok(api.getCurrentSetup());
});

test("same input produces deterministic diagnostics independent of legacy timestamps", () => {
    const mock = dependency((raw, analysis, legacy) => shadowResult(legacy.decision, "BLOCK"));
    const api = loadEngine(mock.api); const input = allowInput(true);
    api.evaluate(input); const first = api.getLastStructureShadow();
    api.reset(); api.evaluate(clone(input)); const second = api.getLastStructureShadow();
    assert.deepStrictEqual(first, second);
});

test("CommonJS shadow API can be injected into browser VM", () => {
    const api = loadEngine(commonJsShadow); const state = api.evaluate(blockInput(true));
    assert.strictEqual(state.status, "NO_SETUP");
    assert.strictEqual(api.getLastStructureShadow().shadowResult.comparison, "NOT_COMPARABLE");
});

let passed = 0;
for (const item of tests) {
    try { item.fn(); passed += 1; console.log("PASS:" + item.name); }
    catch (error) {
        console.error("HND_SETUP_ENGINE_STRUCTURE_SHADOW_INTEGRATION_TEST_FAILED:" + item.name);
        console.error(error.stack || error); process.exitCode = 1; break;
    }
}
if (passed === tests.length) {
    console.log("HND_SETUP_ENGINE_STRUCTURE_SHADOW_INTEGRATION_TESTS_PASS:" + tests.length);
}
