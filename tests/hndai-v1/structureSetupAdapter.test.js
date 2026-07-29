"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const adapter = require("../../js/hndai-v1/structureSetupAdapter.js");
const snapshotModule = require("../../js/hndai-v1/structureStateSnapshot.js");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function candidate(overrides) {
    return Object.assign({
        key: "BTCUSDT|15m|LONG|event-1|ob-1",
        direction: "LONG",
        structureEventId: "event-1",
        structureConfirmationIndex: 2,
        sourceType: "ORDER_BLOCK",
        quality: 84,
        distanceATR: 0.4,
        zoneIds: ["ob-1"],
        entryLow: 100,
        entryHigh: 101
    }, overrides);
}
function context(overrides) {
    return Object.assign({
        symbol: "BTCUSDT",
        interval: "15m",
        evaluationAtIndex: 3,
        evaluationOpenTime: 3000,
        evaluationCloseTime: 3999
    }, overrides);
}
function adaptFail(error, source, evaluation) {
    const output = adapter.adaptCandidate(source, evaluation);
    assert.strictEqual(output.valid, false);
    assert.strictEqual(output.error, error);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.gateCandidate, null);
    return output;
}
function resolverEvent(type, direction, index, regimeBefore) {
    const bullish = direction === "BULLISH";
    const open = index * 1000;
    return {
        id: ["HND_BOS_CHOCH_RESOLVER_V1", "BTCUSDT", "15m", type, index].join("|"),
        sourceEventId: ["HND_STRUCTURE_EVENT_V1", direction, index].join("|"),
        schemaVersion: "HND_BOS_CHOCH_RESOLVER_V1",
        sourceSchemaVersion: "HND_STRUCTURE_EVENT_V1",
        type, direction, regimeBefore, regimeAfter: direction,
        symbol: "BTCUSDT", interval: "15m",
        breakType: bullish ? "BREAK_ABOVE_SWING_HIGH" : "BREAK_BELOW_SWING_LOW",
        breakAtIndex: index, breakOpenTime: open, breakCloseTime: open + 999,
        breakClosePrice: bullish ? 11 : 9,
        levelType: bullish ? "SWING_HIGH" : "SWING_LOW",
        levelClassification: bullish ? "HIGHER_HIGH" : "LOWER_LOW",
        levelCandidateIndex: index - 2,
        levelOpenTime: open - 2000, levelCloseTime: open - 1501,
        levelPrice: 10, levelConfirmedAtIndex: index - 1,
        levelConfirmedAtOpenTime: open - 1000,
        levelConfirmedAtCloseTime: open - 1
    };
}
function sequence(directions) {
    let regime = "UNDETERMINED";
    return directions.map((direction, position) => {
        const type = position === 0 ? "INITIAL_BREAK"
            : direction === regime ? "BOS" : "CHOCH";
        const item = resolverEvent(type, direction, 3 + position * 2, regime);
        regime = direction;
        return item;
    });
}
function snapshotSource(directions) {
    const list = sequence(directions);
    const select = predicate => list.filter(predicate).map(clone);
    const resolver = {
        valid: true, error: null, ready: true,
        schemaVersion: "HND_BOS_CHOCH_RESOLVER_V1",
        market: { symbol: "BTCUSDT", interval: "15m" },
        sourceEventCount: list.length, resolvedEventCount: list.length,
        initialRegime: "UNDETERMINED",
        currentRegime: list.at(-1).regimeAfter,
        events: list.map(clone),
        initialBreaks: select(x => x.type === "INITIAL_BREAK"),
        bosEvents: select(x => x.type === "BOS"),
        chochEvents: select(x => x.type === "CHOCH"),
        bullishEvents: select(x => x.direction === "BULLISH"),
        bearishEvents: select(x => x.direction === "BEARISH"),
        latestEvent: clone(list.at(-1)),
        latestBos: list.some(x => x.type === "BOS")
            ? clone(list.filter(x => x.type === "BOS").at(-1)) : null,
        latestChoch: list.some(x => x.type === "CHOCH")
            ? clone(list.filter(x => x.type === "CHOCH").at(-1)) : null
    };
    return snapshotModule.buildStructureStateSnapshot(resolver);
}
function integrationCandidate(snapshot, overrides) {
    return candidate(Object.assign({
        key: "SETUP-" + snapshot.sequenceIndex,
        direction: snapshot.direction === "BULLISH" ? "LONG" : "SHORT",
        structureEventId: snapshot.sourceEventId,
        structureConfirmationIndex: snapshot.levelConfirmedAtIndex
    }, overrides));
}
function integrationContext(snapshot, overrides) {
    return context(Object.assign({
        evaluationAtIndex: snapshot.breakAtIndex,
        evaluationOpenTime: snapshot.breakOpenTime,
        evaluationCloseTime: snapshot.breakCloseTime
    }, overrides));
}
function loadWithGate(gate) {
    const code = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureSetupAdapter.js"), "utf8");
    const window = { HNDStructureSetupGate: gate };
    vm.runInNewContext(code, { window, JSON, Number, Object, Array });
    return window.HNDStructureSetupAdapter;
}

test("public API is exactly four functions", () => {
    assert.deepStrictEqual(Object.keys(adapter).sort(), [
        "adaptCandidate", "evaluateCandidate", "getSchemaVersion", "getVocabulary"
    ]);
});
test("schema version is exact", () => {
    assert.strictEqual(adapter.getSchemaVersion(), "HND_STRUCTURE_SETUP_ADAPTER_V1");
});
test("vocabulary is exact", () => {
    assert.deepStrictEqual(adapter.getVocabulary(), {
        targetSchemas: ["HND_STRUCTURE_SETUP_GATE_V1"],
        directions: ["LONG", "SHORT"],
        sourceCandidateFields: ["key", "direction", "structureEventId",
            "structureConfirmationIndex"],
        evaluationContextFields: ["symbol", "interval", "evaluationAtIndex",
            "evaluationOpenTime", "evaluationCloseTime"],
        gateCandidateFields: ["id", "symbol", "interval", "direction",
            "structureEventId", "evaluationAtIndex", "evaluationOpenTime",
            "evaluationCloseTime"]
    });
});
test("vocabulary outputs are isolated", () => {
    const first = adapter.getVocabulary();
    first.directions.push("X");
    assert.deepStrictEqual(adapter.getVocabulary().directions, ["LONG", "SHORT"]);
});
test("CommonJS dependency is real gate module", () => {
    const source = snapshotSource(["BULLISH"]);
    const item = source.snapshots[0];
    const output = adapter.evaluateCandidate(
        source, integrationCandidate(item), integrationContext(item));
    assert.strictEqual(output.gateResult.decision, "ALLOW");
});
test("browser UMD uses gate global", () => {
    let calls = 0;
    const browserAdapter = loadWithGate({
        getSchemaVersion: () => "HND_STRUCTURE_SETUP_GATE_V1",
        evaluateSetup: () => {
            calls += 1;
            return { valid: true, error: null, ready: true, decision: "ALLOW" };
        }
    });
    browserAdapter.evaluateCandidate({}, candidate(), context());
    assert.strictEqual(calls, 1);
});
test("real setupEngine-shaped LONG candidate adapts", () => {
    const output = adapter.adaptCandidate(candidate(), context());
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.gateCandidate.direction, "LONG");
});
test("SHORT candidate adapts", () => {
    const output = adapter.adaptCandidate(
        candidate({ direction: "SHORT" }), context());
    assert.strictEqual(output.gateCandidate.direction, "SHORT");
});
test("gate candidate has exact eight fields", () => {
    const output = adapter.adaptCandidate(candidate(), context());
    assert.deepStrictEqual(Object.keys(output.gateCandidate).sort(), [
        "id", "symbol", "interval", "direction", "structureEventId",
        "evaluationAtIndex", "evaluationOpenTime", "evaluationCloseTime"
    ].sort());
});
test("extra candidate fields never leak", () => {
    const output = adapter.adaptCandidate(candidate({
        quality: 99, entryLow: 1, entryHigh: 2, secret: true
    }), context());
    assert.strictEqual("quality" in output.gateCandidate, false);
    assert.strictEqual("secret" in output.gateCandidate, false);
});
test("candidate key maps to gate id", () => {
    const output = adapter.adaptCandidate(candidate({ key: "exact-key" }), context());
    assert.strictEqual(output.gateCandidate.id, "exact-key");
});
test("market and evaluation fields come from context", () => {
    const evaluation = context({
        symbol: "ETHUSDT", interval: "1h", evaluationAtIndex: 8,
        evaluationOpenTime: 8000, evaluationCloseTime: 8999
    });
    const output = adapter.adaptCandidate(candidate(), evaluation);
    for (const field of Object.keys(evaluation)) {
        assert.strictEqual(output.gateCandidate[field], evaluation[field]);
    }
});
test("adapt result schema is exact", () => {
    assert.deepStrictEqual(Object.keys(
        adapter.adaptCandidate(candidate(), context())).sort(), [
        "valid", "error", "ready", "schemaVersion", "targetSchemaVersion",
        "sourceCandidateKey", "sourceDirection", "sourceStructureEventId",
        "sourceStructureConfirmationIndex", "evaluationContext", "gateCandidate"
    ].sort());
});
test("null candidate is invalid", () => {
    adaptFail("INVALID_SOURCE_CANDIDATE", null, context());
});
test("array candidate is invalid", () => {
    adaptFail("INVALID_SOURCE_CANDIDATE", [], context());
});
test("missing key is invalid", () => {
    const value = candidate(); delete value.key;
    adaptFail("INVALID_CANDIDATE_KEY", value, context());
});
test("empty key is invalid", () => {
    adaptFail("INVALID_CANDIDATE_KEY", candidate({ key: "" }), context());
});
test("empty structure event id is invalid", () => {
    adaptFail("INVALID_STRUCTURE_EVENT_ID",
        candidate({ structureEventId: "" }), context());
});
test("invalid direction is rejected without normalization", () => {
    for (const direction of ["long", "BULLISH", "", null]) {
        adaptFail("INVALID_CANDIDATE_DIRECTION",
            candidate({ direction }), context());
    }
});
test("invalid confirmation index is rejected", () => {
    for (const index of [-1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
        adaptFail("INVALID_STRUCTURE_CONFIRMATION_INDEX",
            candidate({ structureConfirmationIndex: index }), context());
    }
});
test("missing evaluation context field is rejected", () => {
    const value = context(); delete value.interval;
    adaptFail("INVALID_EVALUATION_CONTEXT", candidate(), value);
});
test("extra evaluation context field is rejected", () => {
    adaptFail("INVALID_EVALUATION_CONTEXT", candidate(),
        Object.assign(context(), { extra: true }));
});
test("canonical symbol is required", () => {
    for (const symbol of ["btcusdt", " BTCUSDT", "BTCUSDT ", ""]) {
        adaptFail("INVALID_EVALUATION_CONTEXT", candidate(), context({ symbol }));
    }
});
test("trimmed interval is required", () => {
    for (const interval of [" 15m", "15m ", ""]) {
        adaptFail("INVALID_EVALUATION_CONTEXT", candidate(), context({ interval }));
    }
});
test("negative fractional and unsafe evaluation index are rejected", () => {
    for (const index of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        adaptFail("INVALID_EVALUATION_INDEX", candidate(),
            context({ evaluationAtIndex: index }));
    }
});
test("invalid evaluation times are rejected", () => {
    for (const override of [
        { evaluationOpenTime: -1 },
        { evaluationCloseTime: 1.5 },
        { evaluationOpenTime: 4000, evaluationCloseTime: 4000 },
        { evaluationOpenTime: 5000, evaluationCloseTime: 4000 }
    ]) {
        adaptFail("INVALID_EVALUATION_TIME", candidate(), context(override));
    }
});
test("future structure confirmation is rejected", () => {
    const output = adaptFail("FUTURE_STRUCTURE_CONFIRMATION",
        candidate({ structureConfirmationIndex: 4 }), context());
    assert.deepStrictEqual(output.evaluationContext, context());
});
test("candidate input is not mutated", () => {
    const source = candidate(); const before = clone(source);
    adapter.adaptCandidate(source, context());
    assert.deepStrictEqual(source, before);
});
test("context input is not mutated", () => {
    const evaluation = context(); const before = clone(evaluation);
    adapter.adaptCandidate(candidate(), evaluation);
    assert.deepStrictEqual(evaluation, before);
});
test("output nested values are clone isolated", () => {
    const output = adapter.adaptCandidate(candidate(), context());
    assert.notStrictEqual(output.evaluationContext, output.gateCandidate);
    output.evaluationContext.symbol = "X";
    assert.strictEqual(output.gateCandidate.symbol, "BTCUSDT");
});
test("output mutation does not affect later adaptation", () => {
    const source = candidate(); const evaluation = context();
    const first = adapter.adaptCandidate(source, evaluation);
    first.gateCandidate.id = "X";
    const second = adapter.adaptCandidate(source, evaluation);
    assert.strictEqual(second.gateCandidate.id, source.key);
});
test("adaptation is deeply deterministic", () => {
    assert.deepStrictEqual(adapter.adaptCandidate(candidate(), context()),
        adapter.adaptCandidate(candidate(), context()));
});
test("invalid adaptation does not call gate", () => {
    let calls = 0;
    const isolated = loadWithGate({
        getSchemaVersion: () => "HND_STRUCTURE_SETUP_GATE_V1",
        evaluateSetup: () => { calls += 1; return {}; }
    });
    const output = isolated.evaluateCandidate({}, null, context());
    assert.strictEqual(calls, 0);
    assert.strictEqual(output.gateResult, null);
});
test("successful adaptation passes exact candidate to gate", () => {
    let received = null;
    const isolated = loadWithGate({
        getSchemaVersion: () => "HND_STRUCTURE_SETUP_GATE_V1",
        evaluateSetup: (source, setup) => {
            received = setup;
            return { valid: true, error: null, ready: true, decision: "ALLOW" };
        }
    });
    isolated.evaluateCandidate({}, candidate(), context());
    assert.deepStrictEqual(Object.keys(received).sort(), [
        "id", "symbol", "interval", "direction", "structureEventId",
        "evaluationAtIndex", "evaluationOpenTime", "evaluationCloseTime"
    ].sort());
});
test("gate ALLOW result is preserved", () => {
    const source = snapshotSource(["BULLISH"]);
    const item = source.snapshots[0];
    const output = adapter.evaluateCandidate(
        source, integrationCandidate(item), integrationContext(item));
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.ready, true);
    assert.strictEqual(output.gateResult.decision, "ALLOW");
    assert.strictEqual(output.gateResult.reason, "STRUCTURE_MATCH");
});
test("gate direction mismatch BLOCK is preserved", () => {
    const source = snapshotSource(["BULLISH"]);
    const item = source.snapshots[0];
    const output = adapter.evaluateCandidate(source,
        integrationCandidate(item, { direction: "SHORT" }),
        integrationContext(item));
    assert.strictEqual(output.gateResult.decision, "BLOCK");
    assert.strictEqual(output.gateResult.reason, "DIRECTION_MISMATCH");
});
test("gate stale event BLOCK is preserved", () => {
    const source = snapshotSource(["BULLISH", "BEARISH"]);
    const old = source.snapshots[0]; const latest = source.snapshots[1];
    const output = adapter.evaluateCandidate(source,
        integrationCandidate(old),
        integrationContext(latest));
    assert.strictEqual(output.gateResult.decision, "BLOCK");
    assert.strictEqual(output.gateResult.reason, "STALE_STRUCTURE_REFERENCE");
});
test("gate invalid result is preserved", () => {
    const source = snapshotSource(["BULLISH"]);
    const item = source.snapshots[0];
    source.latest = null;
    const output = adapter.evaluateCandidate(
        source, integrationCandidate(item), integrationContext(item));
    assert.strictEqual(output.valid, false);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.error, "LATEST_PROJECTION_MISMATCH");
    assert.strictEqual(output.gateResult.error, "LATEST_PROJECTION_MISMATCH");
});
test("invalid gate dependency fails closed", () => {
    const isolated = loadWithGate(null);
    const output = isolated.evaluateCandidate({}, candidate(), context());
    assert.strictEqual(output.error, "GATE_DEPENDENCY_INVALID");
    assert.strictEqual(output.gateResult, null);
});
test("wrong gate schema fails closed", () => {
    const isolated = loadWithGate({
        getSchemaVersion: () => "X", evaluateSetup: () => ({})
    });
    assert.strictEqual(isolated.evaluateCandidate(
        {}, candidate(), context()).error, "GATE_DEPENDENCY_INVALID");
});
test("gate schema exception fails closed", () => {
    const isolated = loadWithGate({
        getSchemaVersion: () => { throw new Error("schema"); },
        evaluateSetup: () => ({})
    });
    assert.strictEqual(isolated.evaluateCandidate(
        {}, candidate(), context()).error, "GATE_DEPENDENCY_INVALID");
});
test("gate exception fails closed", () => {
    const isolated = loadWithGate({
        getSchemaVersion: () => "HND_STRUCTURE_SETUP_GATE_V1",
        evaluateSetup: () => { throw new Error("boom"); }
    });
    const output = isolated.evaluateCandidate({}, candidate(), context());
    assert.strictEqual(output.error, "GATE_EVALUATION_FAILED");
    assert.strictEqual(output.gateResult, null);
});
test("malformed gate result fails closed", () => {
    const isolated = loadWithGate({
        getSchemaVersion: () => "HND_STRUCTURE_SETUP_GATE_V1",
        evaluateSetup: () => null
    });
    assert.strictEqual(isolated.evaluateCandidate(
        {}, candidate(), context()).error, "GATE_EVALUATION_FAILED");
});
test("uncloneable gate result fails closed", () => {
    const result = { valid: true, error: null, ready: true };
    result.self = result;
    const isolated = loadWithGate({
        getSchemaVersion: () => "HND_STRUCTURE_SETUP_GATE_V1",
        evaluateSetup: () => result
    });
    assert.strictEqual(isolated.evaluateCandidate(
        {}, candidate(), context()).error, "GATE_EVALUATION_FAILED");
});
test("evaluate envelope schema is exact", () => {
    const source = snapshotSource(["BULLISH"]);
    const item = source.snapshots[0];
    const output = adapter.evaluateCandidate(
        source, integrationCandidate(item), integrationContext(item));
    assert.deepStrictEqual(Object.keys(output).sort(),
        ["valid", "error", "ready", "schemaVersion", "adaptation", "gateResult"]
            .sort());
});
test("evaluate output is clone isolated", () => {
    const source = snapshotSource(["BULLISH"]);
    const item = source.snapshots[0];
    const sourceCandidate = integrationCandidate(item);
    const output = adapter.evaluateCandidate(
        source, sourceCandidate, integrationContext(item));
    output.adaptation.gateCandidate.id = "X";
    assert.strictEqual(output.gateResult.setupId, sourceCandidate.key);
});
test("prefix and causality fields are preserved", () => {
    const source = snapshotSource(["BULLISH"]);
    const item = source.snapshots[0];
    const output = adapter.adaptCandidate(integrationCandidate(item),
        integrationContext(item));
    assert.strictEqual(output.sourceStructureConfirmationIndex,
        item.levelConfirmedAtIndex);
    assert.strictEqual(output.gateCandidate.evaluationAtIndex, item.breakAtIndex);
    assert.strictEqual(output.gateCandidate.evaluationCloseTime, item.breakCloseTime);
});
test("adapter does not reimplement gate decisions", () => {
    const code = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureSetupAdapter.js"), "utf8");
    for (const token of [
        "STALE_STRUCTURE_REFERENCE", "FUTURE_STRUCTURE_EVENT",
        "DIRECTION_MISMATCH", "STRUCTURE_MATCH", "latestCausalSnapshot",
        "breakCloseTime <="
    ]) {
        assert.strictEqual(code.includes(token), false, token);
    }
});
test("production module has no live integration capabilities", () => {
    const code = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureSetupAdapter.js"), "utf8");
    for (const token of [
        "HNDSetupEngine", "setupEngine.", "buildCandidates(", "createSetup(",
        "entryLow", "entryHigh", "stopLoss", "takeProfit", "rawCandles",
        "document.", "querySelector", "addEventListener", "fetch(",
        "XMLHttpRequest", "localStorage", "sessionStorage", "Date.now",
        "new Date", "Math.random", "setTimeout", "setInterval", "console."
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
        console.error("HND_STRUCTURE_SETUP_ADAPTER_TEST_FAILED:" + item.name);
        console.error(error.stack || error);
        process.exitCode = 1;
        break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_SETUP_ADAPTER_TESTS_PASS:" + tests.length);
}
