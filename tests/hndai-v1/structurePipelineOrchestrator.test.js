"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const orchestrator = require("../../js/hndai-v1/structurePipelineOrchestrator.js");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function candle(index, close, high, low, closeTime) {
    return {
        openTime: index * 1000,
        closeTime: closeTime === undefined ? index * 1000 + 999 : closeTime,
        open: close, high: high === undefined ? close + 1 : high,
        low: low === undefined ? close - 1 : low, close, volume: 10
    };
}
function context(overrides) {
    return Object.assign({
        symbol: "BTCUSDT", interval: "15m", nowMs: 999999,
        leftBars: 1, rightBars: 1
    }, overrides);
}
const high = [candle(0, 5, 6, 4), candle(1, 10, 12, 3),
    candle(2, 6, 7, 4), candle(3, 13, 14, 12)];
const low = [candle(0, 10, 11, 9), candle(1, 5, 12, 3),
    candle(2, 9, 10, 8), candle(3, 2, 3, 1)];
const transitions = [
    candle(0, 5, 6, 4), candle(1, 10, 12, 3),
    candle(2, 6, 7, 4), candle(3, 13, 14, 12),
    candle(4, 14, 16, 13), candle(5, 12, 13, 11),
    candle(6, 17, 18, 16), candle(7, 10, 11, 9)
];
function setupFor(snapshot, direction) {
    return {
        key: "SETUP-" + snapshot.sequenceIndex,
        direction: direction || (snapshot.direction === "BULLISH" ? "LONG" : "SHORT"),
        structureEventId: snapshot.sourceEventId,
        structureConfirmationIndex: snapshot.levelConfirmedAtIndex
    };
}
function evaluationFor(snapshot) {
    return {
        symbol: "BTCUSDT", interval: "15m",
        evaluationAtIndex: snapshot.breakAtIndex,
        evaluationOpenTime: snapshot.breakOpenTime,
        evaluationCloseTime: snapshot.breakCloseTime
    };
}
function mockResult(ready, extra) {
    return Object.assign({ valid: true, error: null, ready: ready !== false }, extra);
}
function loadWith(deps) {
    const code = fs.readFileSync(path.resolve(
        __dirname, "../../js/hndai-v1/structurePipelineOrchestrator.js"), "utf8");
    const window = Object.assign({}, deps);
    vm.runInNewContext(code, { window, JSON, Number, Object, Array, Error });
    return window.HNDStructurePipelineOrchestrator;
}
function mockPipeline(overrides) {
    const calls = [];
    const deps = {
        HNDStructureBreakDetector: { detectBreaks: () => {
            calls.push("STRUCTURE_BREAK"); return mockResult(true, { stage: "break" });
        } },
        HNDStructureEventContract: { buildStructureEvents: () => {
            calls.push("STRUCTURE_EVENT"); return mockResult(true, { stage: "event" });
        } },
        HNDBosChochResolver: { resolveStructure: () => {
            calls.push("BOS_CHOCH"); return mockResult(true, { stage: "resolver" });
        } },
        HNDStructureStateSnapshot: { buildStructureStateSnapshot: () => {
            calls.push("STRUCTURE_SNAPSHOT");
            return mockResult(true, { latest: { id: "latest" }, stage: "snapshot" });
        } },
        HNDStructureSetupAdapter: { evaluateCandidate: () => {
            calls.push("SETUP_ADAPTER");
            return mockResult(true, {
                gateResult: { decision: "ALLOW", reason: "STRUCTURE_MATCH" }
            });
        } }
    };
    Object.assign(deps, overrides || {});
    return { api: loadWith(deps), calls, deps };
}

test("public API is exact", () => {
    assert.deepStrictEqual(Object.keys(orchestrator).sort(), [
        "analyzeStructure", "evaluateSetupCandidate", "getSchemaVersion", "getVocabulary"
    ]);
});
test("schema is exact", () => {
    assert.strictEqual(orchestrator.getSchemaVersion(), "HND_STRUCTURE_PIPELINE_V1");
});
test("vocabulary is exact", () => {
    assert.deepStrictEqual(orchestrator.getVocabulary(), {
        stages: ["STRUCTURE_BREAK", "STRUCTURE_EVENT", "BOS_CHOCH",
            "STRUCTURE_SNAPSHOT", "SETUP_ADAPTER"],
        operations: ["ANALYZE_STRUCTURE", "EVALUATE_SETUP"],
        statuses: ["SUCCESS", "FAILED"],
        directions: ["BULLISH", "BEARISH", "UNDETERMINED"]
    });
});
test("CommonJS real dependencies load", () => {
    assert.strictEqual(orchestrator.analyzeStructure([], context()).valid, true);
});
test("browser UMD dependencies load", () => {
    assert.strictEqual(mockPipeline().api.analyzeStructure([], context()).valid, true);
});
test("missing browser dependency throws exact error", () => {
    assert.throws(() => loadWith({}), /HND_STRUCTURE_PIPELINE_DEPENDENCY_MISSING/);
});
test("analysis context missing field is invalid", () => {
    const value = context(); delete value.nowMs;
    assert.strictEqual(orchestrator.analyzeStructure([], value).error,
        "INVALID_ANALYSIS_INPUT");
});
test("analysis context extra field is invalid", () => {
    assert.strictEqual(orchestrator.analyzeStructure([], Object.assign(
        context(), { extra: true })).error, "INVALID_ANALYSIS_INPUT");
});
test("analysis context canonical rules are strict", () => {
    for (const value of [
        context({ symbol: "btcusdt" }), context({ interval: " 15m" }),
        context({ nowMs: -1 }), context({ nowMs: Infinity }),
        context({ leftBars: 0 }), context({ rightBars: 1.5 })
    ]) {
        assert.strictEqual(orchestrator.analyzeStructure([], value).error,
            "INVALID_ANALYSIS_INPUT");
    }
});
test("non-array raw candles are invalid", () => {
    assert.strictEqual(orchestrator.analyzeStructure(null, context()).error,
        "INVALID_RAW_CANDLES");
});
test("real empty series is valid not ready", () => {
    const output = orchestrator.analyzeStructure([], context());
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.latestStructure, null);
});
test("real bullish break pipeline", () => {
    const output = orchestrator.analyzeStructure(high, context());
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.latestStructure.direction, "BULLISH");
    assert.strictEqual(output.latestStructure.structurePhase, "ESTABLISHMENT");
});
test("real bearish break pipeline", () => {
    const output = orchestrator.analyzeStructure(low, context());
    assert.strictEqual(output.latestStructure.direction, "BEARISH");
});
test("real BOS continuation pipeline", () => {
    const output = orchestrator.analyzeStructure(transitions, context());
    assert.strictEqual(output.snapshotResult.snapshots[1].eventType, "BOS");
    assert.strictEqual(output.snapshotResult.snapshots[1].structurePhase,
        "CONTINUATION");
});
test("real CHOCH reversal pipeline", () => {
    const output = orchestrator.analyzeStructure(transitions, context());
    assert.strictEqual(output.snapshotResult.snapshots[2].eventType, "CHOCH");
    assert.strictEqual(output.latestStructure.structurePhase, "REVERSAL");
});
test("real LONG setup is allowed", () => {
    const analysis = orchestrator.analyzeStructure(high, context());
    const item = analysis.latestStructure;
    const output = orchestrator.evaluateSetupCandidate(
        high, context(), setupFor(item), evaluationFor(item));
    assert.strictEqual(output.gateDecision, "ALLOW");
});
test("real SHORT setup is allowed", () => {
    const analysis = orchestrator.analyzeStructure(low, context());
    const item = analysis.latestStructure;
    const output = orchestrator.evaluateSetupCandidate(
        low, context(), setupFor(item), evaluationFor(item));
    assert.strictEqual(output.gateDecision, "ALLOW");
});
test("real direction mismatch is blocked", () => {
    const analysis = orchestrator.analyzeStructure(high, context());
    const item = analysis.latestStructure;
    const output = orchestrator.evaluateSetupCandidate(
        high, context(), setupFor(item, "SHORT"), evaluationFor(item));
    assert.strictEqual(output.gateDecision, "BLOCK");
    assert.strictEqual(output.gateReason, "DIRECTION_MISMATCH");
});
test("real stale event is blocked", () => {
    const analysis = orchestrator.analyzeStructure(transitions, context());
    const first = analysis.snapshotResult.snapshots[0];
    const latest = analysis.latestStructure;
    const output = orchestrator.evaluateSetupCandidate(
        transitions, context(), setupFor(first), evaluationFor(latest));
    assert.strictEqual(output.gateDecision, "BLOCK");
    assert.strictEqual(output.gateReason, "STALE_STRUCTURE_REFERENCE");
});
test("real not-ready source decision is preserved", () => {
    const output = orchestrator.evaluateSetupCandidate([], context(), {
        key: "S", direction: "LONG", structureEventId: "missing",
        structureConfirmationIndex: 0
    }, {
        symbol: "BTCUSDT", interval: "15m", evaluationAtIndex: 0,
        evaluationOpenTime: 0, evaluationCloseTime: 1
    });
    assert.strictEqual(output.gateDecision, "BLOCK");
    assert.strictEqual(output.gateReason, "SOURCE_NOT_READY");
});
test("latestStructure matches snapshot latest but is isolated", () => {
    const output = orchestrator.analyzeStructure(high, context());
    assert.deepStrictEqual(output.latestStructure, output.snapshotResult.latest);
    assert.notStrictEqual(output.latestStructure, output.snapshotResult.latest);
});
test("ready propagates from final snapshot", () => {
    const fixture = mockPipeline({
        HNDStructureStateSnapshot: { buildStructureStateSnapshot: () =>
            mockResult(false, { latest: null }) }
    });
    assert.strictEqual(fixture.api.analyzeStructure([], context()).ready, false);
});
test("dependencies are called once in exact order", () => {
    const fixture = mockPipeline();
    fixture.api.analyzeStructure([], context());
    assert.deepStrictEqual(fixture.calls, [
        "STRUCTURE_BREAK", "STRUCTURE_EVENT", "BOS_CHOCH", "STRUCTURE_SNAPSHOT"
    ]);
});
test("break failure stops later stages", () => {
    const fixture = mockPipeline({
        HNDStructureBreakDetector: { detectBreaks: () => {
            fixture.calls.push("STRUCTURE_BREAK");
            return mockResult(false, { valid: false, error: "BREAK_FAIL" });
        } }
    });
    const output = fixture.api.analyzeStructure([], context());
    assert.deepStrictEqual(fixture.calls, ["STRUCTURE_BREAK"]);
    assert.strictEqual(output.failedStage, "STRUCTURE_BREAK");
    assert.strictEqual(output.stageError, "BREAK_FAIL");
});
test("event failure stops resolver", () => {
    const fixture = mockPipeline();
    fixture.deps.HNDStructureEventContract.buildStructureEvents = () => {
        fixture.calls.push("STRUCTURE_EVENT");
        return { valid: false, error: "EVENT_FAIL", ready: false };
    };
    const output = fixture.api.analyzeStructure([], context());
    assert.deepStrictEqual(fixture.calls, ["STRUCTURE_BREAK", "STRUCTURE_EVENT"]);
    assert.strictEqual(output.failedStage, "STRUCTURE_EVENT");
});
test("resolver failure stops snapshot", () => {
    const fixture = mockPipeline();
    fixture.deps.HNDBosChochResolver.resolveStructure = () => {
        fixture.calls.push("BOS_CHOCH");
        return { valid: false, error: "RESOLVE_FAIL", ready: false };
    };
    const output = fixture.api.analyzeStructure([], context());
    assert.strictEqual(output.failedStage, "BOS_CHOCH");
    assert.strictEqual(fixture.calls.includes("STRUCTURE_SNAPSHOT"), false);
});
test("snapshot failure is reported", () => {
    const fixture = mockPipeline();
    fixture.deps.HNDStructureStateSnapshot.buildStructureStateSnapshot = () => {
        fixture.calls.push("STRUCTURE_SNAPSHOT");
        return { valid: false, error: "SNAP_FAIL", ready: false };
    };
    assert.strictEqual(fixture.api.analyzeStructure([], context()).failedStage,
        "STRUCTURE_SNAPSHOT");
});
test("malformed dependency result is rejected", () => {
    const fixture = mockPipeline({
        HNDStructureBreakDetector: { detectBreaks: () => null }
    });
    assert.strictEqual(fixture.api.analyzeStructure([], context()).error,
        "DEPENDENCY_RESULT_INVALID");
});
test("stage failure leaks no partial results", () => {
    const fixture = mockPipeline({
        HNDStructureEventContract: { buildStructureEvents: () =>
            ({ valid: false, error: "X", ready: false }) }
    });
    const output = fixture.api.analyzeStructure([], context());
    for (const field of ["breakResult", "structureEventResult", "resolverResult",
        "snapshotResult", "latestStructure"]) {
        assert.strictEqual(output[field], null);
    }
});
test("analysis output schema is exact", () => {
    assert.deepStrictEqual(Object.keys(
        orchestrator.analyzeStructure([], context())).sort(), [
        "valid", "error", "ready", "schemaVersion", "operation", "status",
        "failedStage", "stageError", "market", "config", "breakResult",
        "structureEventResult", "resolverResult", "snapshotResult",
        "latestStructure"
    ].sort());
});
test("adapter is not called when pipeline invalid", () => {
    const fixture = mockPipeline({
        HNDStructureBreakDetector: { detectBreaks: () =>
            ({ valid: false, error: "X", ready: false }) }
    });
    const output = fixture.api.evaluateSetupCandidate([], context(), {}, {});
    assert.strictEqual(fixture.calls.includes("SETUP_ADAPTER"), false);
    assert.strictEqual(output.adapterResult, null);
});
test("adapter invalid result fails setup", () => {
    const fixture = mockPipeline({
        HNDStructureSetupAdapter: { evaluateCandidate: () =>
            ({ valid: false, error: "ADAPT_FAIL", ready: false }) }
    });
    const output = fixture.api.evaluateSetupCandidate([], context(), {}, {});
    assert.strictEqual(output.failedStage, "SETUP_ADAPTER");
    assert.strictEqual(output.stageError, "ADAPT_FAIL");
});
test("adapter exception fails closed", () => {
    const fixture = mockPipeline({
        HNDStructureSetupAdapter: { evaluateCandidate: () => { throw new Error("boom"); } }
    });
    assert.strictEqual(fixture.api.evaluateSetupCandidate(
        [], context(), {}, {}).error, "SETUP_EVALUATION_FAILED");
});
test("gate ALLOW decision and reason are preserved", () => {
    const fixture = mockPipeline();
    const output = fixture.api.evaluateSetupCandidate([], context(), {}, {});
    assert.strictEqual(output.gateDecision, "ALLOW");
    assert.strictEqual(output.gateReason, "STRUCTURE_MATCH");
    assert.strictEqual(output.ready, true);
});
test("gate BLOCK decision and reason are preserved", () => {
    const fixture = mockPipeline({
        HNDStructureSetupAdapter: { evaluateCandidate: () => mockResult(true, {
            gateResult: { decision: "BLOCK", reason: "SOURCE_NOT_READY" }
        }) }
    });
    const output = fixture.api.evaluateSetupCandidate([], context(), {}, {});
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.gateDecision, "BLOCK");
    assert.strictEqual(output.gateReason, "SOURCE_NOT_READY");
});
test("setup output schema is exact", () => {
    const fixture = mockPipeline();
    assert.deepStrictEqual(Object.keys(fixture.api.evaluateSetupCandidate(
        [], context(), {}, {})).sort(), [
        "valid", "error", "ready", "schemaVersion", "operation", "status",
        "failedStage", "stageError", "pipelineResult", "adapterResult",
        "gateDecision", "gateReason"
    ].sort());
});
test("raw candles and context are not mutated", () => {
    const candles = clone(high); const ctx = context();
    const beforeCandles = clone(candles); const beforeContext = clone(ctx);
    orchestrator.analyzeStructure(candles, ctx);
    assert.deepStrictEqual(candles, beforeCandles);
    assert.deepStrictEqual(ctx, beforeContext);
});
test("candidate and evaluation context are not mutated", () => {
    const fixture = mockPipeline();
    const candidate = { key: "x" }; const evaluation = { value: 1 };
    fixture.api.evaluateSetupCandidate([], context(), candidate, evaluation);
    assert.deepStrictEqual(candidate, { key: "x" });
    assert.deepStrictEqual(evaluation, { value: 1 });
});
test("output mutation does not affect later call", () => {
    const first = orchestrator.analyzeStructure(high, context());
    first.latestStructure.direction = "BEARISH";
    const second = orchestrator.analyzeStructure(high, context());
    assert.strictEqual(second.latestStructure.direction, "BULLISH");
});
test("deep determinism", () => {
    assert.deepStrictEqual(orchestrator.analyzeStructure(high, context()),
        orchestrator.analyzeStructure(high, context()));
});
test("open future candle does not change closed result", () => {
    const base = orchestrator.analyzeStructure(high, context());
    const extended = orchestrator.analyzeStructure(high.concat([
        candle(4, 100, 101, 99, 1000000)
    ]), context());
    assert.deepStrictEqual(extended.latestStructure, base.latestStructure);
});
test("production module has no reimplemented algorithms or live integration", () => {
    const code = fs.readFileSync(path.resolve(
        __dirname, "../../js/hndai-v1/structurePipelineOrchestrator.js"), "utf8");
    for (const token of [
        "SWING_HIGH", "SWING_LOW", "INITIAL_BREAK", "CONTINUATION",
        "STRUCTURE_MATCH", "STALE_STRUCTURE_REFERENCE", "setupEngine",
        "entryLow", "entryHigh", "stopLoss", "takeProfit", "Date.now", "new Date",
        "Math.random", "setTimeout", "setInterval", "fetch(", "document.",
        "localStorage", "sessionStorage"
    ]) {
        assert.strictEqual(code.includes(token), false, token);
    }
});

let passed = 0;
for (const item of tests) {
    try {
        item.fn();
        passed += 1;
        console.log("PASS:" + item.name);
    } catch (error) {
        console.error("HND_STRUCTURE_PIPELINE_ORCHESTRATOR_TEST_FAILED:" + item.name);
        console.error(error.stack || error);
        process.exitCode = 1;
        break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_PIPELINE_ORCHESTRATOR_TESTS_PASS:" + tests.length);
}
