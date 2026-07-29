"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const gate = require("../../js/hndai-v1/structureSetupGate.js");
const snapshotModule = require("../../js/hndai-v1/structureStateSnapshot.js");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function event(type, direction, index, regimeBefore, overrides) {
    const bullish = direction === "BULLISH";
    const open = index * 1000;
    return Object.assign({
        id: ["HND_BOS_CHOCH_RESOLVER_V1", "BTCUSDT", "15m", type, index].join("|"),
        sourceEventId: ["HND_STRUCTURE_EVENT_V1", direction, index].join("|"),
        schemaVersion: "HND_BOS_CHOCH_RESOLVER_V1",
        sourceSchemaVersion: "HND_STRUCTURE_EVENT_V1",
        type,
        direction,
        regimeBefore,
        regimeAfter: direction,
        symbol: "BTCUSDT",
        interval: "15m",
        breakType: bullish ? "BREAK_ABOVE_SWING_HIGH" : "BREAK_BELOW_SWING_LOW",
        breakAtIndex: index,
        breakOpenTime: open,
        breakCloseTime: open + 999,
        breakClosePrice: bullish ? 11 : 9,
        levelType: bullish ? "SWING_HIGH" : "SWING_LOW",
        levelClassification: bullish ? "HIGHER_HIGH" : "LOWER_LOW",
        levelCandidateIndex: index - 2,
        levelOpenTime: open - 2000,
        levelCloseTime: open - 1501,
        levelPrice: 10,
        levelConfirmedAtIndex: index - 1,
        levelConfirmedAtOpenTime: open - 1000,
        levelConfirmedAtCloseTime: open - 1
    }, overrides);
}
function sequence(directions) {
    let regime = "UNDETERMINED";
    return directions.map((direction, position) => {
        const type = position === 0
            ? "INITIAL_BREAK" : direction === regime ? "BOS" : "CHOCH";
        const item = event(type, direction, 3 + position * 2, regime);
        regime = direction;
        return item;
    });
}
function resolverResult(events, ready) {
    const list = events.map(clone);
    const filter = predicate => list.filter(predicate).map(clone);
    return {
        valid: true, error: null, ready: ready === undefined ? true : ready,
        schemaVersion: "HND_BOS_CHOCH_RESOLVER_V1",
        market: { symbol: "BTCUSDT", interval: "15m" },
        sourceEventCount: list.length, resolvedEventCount: list.length,
        initialRegime: "UNDETERMINED",
        currentRegime: list.length ? list.at(-1).regimeAfter : "UNDETERMINED",
        events: list,
        initialBreaks: filter(x => x.type === "INITIAL_BREAK"),
        bosEvents: filter(x => x.type === "BOS"),
        chochEvents: filter(x => x.type === "CHOCH"),
        bullishEvents: filter(x => x.direction === "BULLISH"),
        bearishEvents: filter(x => x.direction === "BEARISH"),
        latestEvent: list.length ? clone(list.at(-1)) : null,
        latestBos: list.some(x => x.type === "BOS")
            ? clone(list.filter(x => x.type === "BOS").at(-1)) : null,
        latestChoch: list.some(x => x.type === "CHOCH")
            ? clone(list.filter(x => x.type === "CHOCH").at(-1)) : null
    };
}
function source(directions, ready) {
    return snapshotModule.buildStructureStateSnapshot(
        resolverResult(sequence(directions), ready));
}
function candidate(snapshot, overrides) {
    return Object.assign({
        id: "SETUP-1",
        symbol: "BTCUSDT",
        interval: "15m",
        direction: snapshot.direction === "BULLISH" ? "LONG" : "SHORT",
        structureEventId: snapshot.sourceEventId,
        evaluationAtIndex: snapshot.breakAtIndex,
        evaluationOpenTime: snapshot.breakOpenTime,
        evaluationCloseTime: snapshot.breakCloseTime
    }, overrides);
}
function rebuild(value) {
    const snapshots = value.snapshots;
    value.sourceEventCount = snapshots.length;
    value.snapshotCount = snapshots.length;
    value.snapshotOpenTimes = snapshots.map(x => x.breakOpenTime);
    const projection = (field, predicate) => {
        value[field] = snapshots.filter(predicate).map(clone);
    };
    projection("bullishSnapshots", x => x.direction === "BULLISH");
    projection("bearishSnapshots", x => x.direction === "BEARISH");
    projection("establishmentSnapshots", x => x.structurePhase === "ESTABLISHMENT");
    projection("continuationSnapshots", x => x.structurePhase === "CONTINUATION");
    projection("reversalSnapshots", x => x.structurePhase === "REVERSAL");
    const latest = field => value[field].length ? clone(value[field].at(-1)) : null;
    value.latest = snapshots.length ? clone(snapshots.at(-1)) : null;
    value.latestBullish = latest("bullishSnapshots");
    value.latestBearish = latest("bearishSnapshots");
    value.latestEstablishment = latest("establishmentSnapshots");
    value.latestContinuation = latest("continuationSnapshots");
    value.latestReversal = latest("reversalSnapshots");
}
function fail(error, sourceValue, setupValue) {
    const output = gate.evaluateSetup(sourceValue, setupValue);
    assert.strictEqual(output.valid, false);
    assert.strictEqual(output.error, error);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.decision, "BLOCK");
    assert.strictEqual(output.reason, null);
    assert.strictEqual(output.referencedSnapshot, null);
    assert.strictEqual(output.latestCausalSnapshot, null);
    assert.deepStrictEqual(output.evidence, {
        setupStructureEventId: null, referencedSnapshotId: null,
        latestCausalSnapshotId: null, structureDirection: null,
        currentRegime: null, structurePhase: null, eventType: null,
        breakAtIndex: null, breakCloseTime: null
    });
    return output;
}

test("public API is exact", () => {
    assert.deepStrictEqual(Object.keys(gate).sort(),
        ["evaluateSetup", "getSchemaVersion", "getVocabulary"]);
});
test("schema version is exact", () => {
    assert.strictEqual(gate.getSchemaVersion(), "HND_STRUCTURE_SETUP_GATE_V1");
});
test("vocabulary is exact", () => {
    assert.deepStrictEqual(gate.getVocabulary(), {
        decisions: ["ALLOW", "BLOCK"],
        setupDirections: ["LONG", "SHORT"],
        structureDirections: ["BULLISH", "BEARISH"],
        structurePhases: ["ESTABLISHMENT", "CONTINUATION", "REVERSAL"],
        allowReasons: ["STRUCTURE_MATCH"],
        blockReasons: ["SOURCE_NOT_READY", "NO_CAUSAL_STRUCTURE",
            "STRUCTURE_EVENT_NOT_FOUND", "FUTURE_STRUCTURE_EVENT",
            "STALE_STRUCTURE_REFERENCE", "DIRECTION_MISMATCH"]
    });
});
test("vocabulary outputs are isolated", () => {
    const value = gate.getVocabulary();
    value.decisions.push("X");
    assert.deepStrictEqual(gate.getVocabulary().decisions, ["ALLOW", "BLOCK"]);
});
test("CommonJS exposes evaluateSetup", () => {
    assert.strictEqual(typeof gate.evaluateSetup, "function");
});
test("browser UMD exposes expected global", () => {
    const code = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureSetupGate.js"), "utf8");
    const window = {};
    vm.runInNewContext(code, { window, Set, Number, Object, Array });
    assert.deepStrictEqual(Object.keys(window.HNDStructureSetupGate).sort(),
        ["evaluateSetup", "getSchemaVersion", "getVocabulary"]);
});
test("valid LONG establishment is allowed", () => {
    const value = source(["BULLISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[0]));
    assert.strictEqual(output.decision, "ALLOW");
    assert.strictEqual(output.reason, "STRUCTURE_MATCH");
    assert.strictEqual(output.expectedStructureDirection, "BULLISH");
});
test("valid SHORT establishment is allowed", () => {
    const value = source(["BEARISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[0]));
    assert.strictEqual(output.decision, "ALLOW");
    assert.strictEqual(output.expectedStructureDirection, "BEARISH");
});
test("bullish BOS continuation is allowed", () => {
    const value = source(["BULLISH", "BULLISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[1]));
    assert.strictEqual(output.decision, "ALLOW");
    assert.strictEqual(output.evidence.structurePhase, "CONTINUATION");
    assert.strictEqual(output.evidence.eventType, "BOS");
});
test("bearish BOS continuation is allowed", () => {
    const value = source(["BEARISH", "BEARISH"]);
    assert.strictEqual(gate.evaluateSetup(
        value, candidate(value.snapshots[1])).decision, "ALLOW");
});
test("bullish CHOCH reversal is allowed", () => {
    const value = source(["BEARISH", "BULLISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[1]));
    assert.strictEqual(output.decision, "ALLOW");
    assert.strictEqual(output.evidence.structurePhase, "REVERSAL");
});
test("bearish CHOCH reversal is allowed", () => {
    const value = source(["BULLISH", "BEARISH"]);
    assert.strictEqual(gate.evaluateSetup(
        value, candidate(value.snapshots[1])).decision, "ALLOW");
});
test("source ready false blocks", () => {
    const value = source(["BULLISH"], false);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[0]));
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.reason, "SOURCE_NOT_READY");
});
test("empty snapshot history blocks", () => {
    const value = source([]);
    const setup = {
        id: "S", symbol: "BTCUSDT", interval: "15m", direction: "LONG",
        structureEventId: "missing", evaluationAtIndex: 1,
        evaluationOpenTime: 1000, evaluationCloseTime: 1999
    };
    const output = gate.evaluateSetup(value, setup);
    assert.strictEqual(output.reason, "SOURCE_NOT_READY");
    assert.strictEqual(output.sourceSnapshotCount, 0);
});
test("missing event reference blocks", () => {
    const value = source(["BULLISH"]);
    const output = gate.evaluateSetup(value,
        candidate(value.snapshots[0], { structureEventId: "missing" }));
    assert.strictEqual(output.reason, "STRUCTURE_EVENT_NOT_FOUND");
});
test("future referenced event blocks", () => {
    const value = source(["BULLISH", "BULLISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[1], {
        evaluationAtIndex: value.snapshots[0].breakAtIndex,
        evaluationOpenTime: value.snapshots[0].breakOpenTime,
        evaluationCloseTime: value.snapshots[0].breakCloseTime
    }));
    assert.strictEqual(output.reason, "FUTURE_STRUCTURE_EVENT");
    assert.deepStrictEqual(output.latestCausalSnapshot, value.snapshots[0]);
});
test("stale event reference blocks", () => {
    const value = source(["BULLISH", "BULLISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[0], {
        evaluationAtIndex: value.snapshots[1].breakAtIndex,
        evaluationOpenTime: value.snapshots[1].breakOpenTime,
        evaluationCloseTime: value.snapshots[1].breakCloseTime
    }));
    assert.strictEqual(output.reason, "STALE_STRUCTURE_REFERENCE");
});
test("old bullish setup is blocked after bearish CHOCH", () => {
    const value = source(["BULLISH", "BEARISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[0], {
        evaluationAtIndex: value.snapshots[1].breakAtIndex,
        evaluationOpenTime: value.snapshots[1].breakOpenTime,
        evaluationCloseTime: value.snapshots[1].breakCloseTime
    }));
    assert.strictEqual(output.reason, "STALE_STRUCTURE_REFERENCE");
    assert.strictEqual(output.latestCausalSnapshot.direction, "BEARISH");
});
test("direction mismatch blocks LONG against bearish", () => {
    const value = source(["BEARISH"]);
    const output = gate.evaluateSetup(value,
        candidate(value.snapshots[0], { direction: "LONG" }));
    assert.strictEqual(output.reason, "DIRECTION_MISMATCH");
});
test("direction mismatch blocks SHORT against bullish", () => {
    const value = source(["BULLISH"]);
    const output = gate.evaluateSetup(value,
        candidate(value.snapshots[0], { direction: "SHORT" }));
    assert.strictEqual(output.reason, "DIRECTION_MISMATCH");
});
test("same candle close is causal", () => {
    const value = source(["BULLISH"]);
    const setup = candidate(value.snapshots[0]);
    assert.strictEqual(gate.evaluateSetup(value, setup).decision, "ALLOW");
});
test("evaluation selects latest prior event", () => {
    const value = source(["BULLISH", "BULLISH", "BEARISH"]);
    const setup = candidate(value.snapshots[1]);
    const output = gate.evaluateSetup(value, setup);
    assert.strictEqual(output.decision, "ALLOW");
    assert.strictEqual(output.latestCausalSnapshot.id, value.snapshots[1].id);
    assert.strictEqual(output.causalSnapshotCount, 2);
});
test("snapshot after evaluation is ignored", () => {
    const value = source(["BULLISH", "BULLISH", "BEARISH"]);
    const setup = candidate(value.snapshots[1]);
    const output = gate.evaluateSetup(value, setup);
    assert.notStrictEqual(output.latestCausalSnapshot.id, value.snapshots[2].id);
});
test("evidence is exact and causal", () => {
    const value = source(["BULLISH", "BULLISH"]);
    const item = value.snapshots[1];
    const output = gate.evaluateSetup(value, candidate(item));
    assert.deepStrictEqual(output.evidence, {
        setupStructureEventId: item.sourceEventId,
        referencedSnapshotId: item.id,
        latestCausalSnapshotId: item.id,
        structureDirection: item.direction,
        currentRegime: item.currentRegime,
        structurePhase: item.structurePhase,
        eventType: item.eventType,
        breakAtIndex: item.breakAtIndex,
        breakCloseTime: item.breakCloseTime
    });
});
test("output top-level schema is exact", () => {
    const value = source(["BULLISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[0]));
    assert.deepStrictEqual(Object.keys(output).sort(), [
        "valid", "error", "ready", "schemaVersion", "sourceSchemaVersion",
        "market", "decision", "reason", "setupId", "setupDirection",
        "expectedStructureDirection", "evaluationAtIndex", "evaluationOpenTime",
        "evaluationCloseTime", "sourceSnapshotCount", "causalSnapshotCount",
        "referencedSnapshot", "latestCausalSnapshot", "evidence"
    ].sort());
});
test("missing setup field is invalid", () => {
    const value = source(["BULLISH"]);
    const setup = candidate(value.snapshots[0]);
    delete setup.id;
    fail("INVALID_SETUP_CANDIDATE", value, setup);
});
test("extra setup field is invalid", () => {
    const value = source(["BULLISH"]);
    fail("INVALID_SETUP_CANDIDATE", value,
        Object.assign(candidate(value.snapshots[0]), { extra: true }));
});
test("empty setup ids are invalid", () => {
    const value = source(["BULLISH"]);
    fail("INVALID_SETUP_CANDIDATE", value,
        candidate(value.snapshots[0], { id: "" }));
    fail("INVALID_SETUP_CANDIDATE", value,
        candidate(value.snapshots[0], { structureEventId: "" }));
});
test("setup market must be canonical exact match", () => {
    const value = source(["BULLISH"]);
    for (const override of [
        { symbol: "btcusdt" }, { symbol: " BTCUSDT" }, { interval: "15M" }
    ]) {
        fail("INVALID_SETUP_CANDIDATE", value,
            candidate(value.snapshots[0], override));
    }
});
test("setup direction is exact", () => {
    const value = source(["BULLISH"]);
    fail("INVALID_SETUP_CANDIDATE", value,
        candidate(value.snapshots[0], { direction: "long" }));
});
test("evaluation index must be nonnegative safe integer", () => {
    const value = source(["BULLISH"]);
    for (const invalid of [-1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1]) {
        fail("INVALID_SETUP_CANDIDATE", value,
            candidate(value.snapshots[0], { evaluationAtIndex: invalid }));
    }
});
test("evaluation times must be ordered safe integers", () => {
    const value = source(["BULLISH"]);
    for (const override of [
        { evaluationOpenTime: -1 },
        { evaluationCloseTime: 1.5 },
        { evaluationOpenTime: 4000, evaluationCloseTime: 4000 },
        { evaluationOpenTime: 5000, evaluationCloseTime: 4000 }
    ]) {
        fail("INVALID_SETUP_CANDIDATE", value,
            candidate(value.snapshots[0], override));
    }
});
test("null and malformed source are invalid", () => {
    for (const value of [null, [], {}, { valid: true }]) {
        fail("INVALID_SNAPSHOT_RESULT", value, null);
    }
});
test("source schema mismatch is invalid", () => {
    const value = source(["BULLISH"]);
    value.schemaVersion = "X";
    fail("SOURCE_SCHEMA_MISMATCH", value, candidate(value.snapshots[0]));
});
test("source source-schema mismatch is invalid", () => {
    const value = source(["BULLISH"]);
    value.sourceSchemaVersion = "X";
    fail("SOURCE_SCHEMA_MISMATCH", value, candidate(value.snapshots[0]));
});
test("invalid source market is rejected", () => {
    const value = source(["BULLISH"]);
    value.market.symbol = "btcusdt";
    fail("INVALID_MARKET", value, candidate(value.snapshots[0]));
});
test("extra market field is rejected", () => {
    const value = source(["BULLISH"]);
    value.market.extra = true;
    fail("INVALID_MARKET", value, candidate(value.snapshots[0]));
});
test("missing source top-level field is rejected", () => {
    const value = source(["BULLISH"]);
    delete value.latest;
    fail("INVALID_SNAPSHOT_RESULT", value, candidate(value.snapshots[0]));
});
test("extra source top-level field is rejected", () => {
    const value = source(["BULLISH"]);
    value.extra = true;
    fail("INVALID_SNAPSHOT_RESULT", value, candidate(value.snapshots[0]));
});
test("missing snapshot field is rejected", () => {
    const value = source(["BULLISH"]);
    delete value.snapshots[0].levelPrice;
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.latest));
});
test("extra snapshot field is rejected", () => {
    const value = source(["BULLISH"]);
    value.snapshots[0].raw = {};
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.latest));
});
test("snapshot market conflict is rejected", () => {
    const value = source(["BULLISH"]);
    value.snapshots[0].symbol = "ETHUSDT";
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.latest));
});
test("snapshot event phase conflict is rejected", () => {
    const value = source(["BULLISH"]);
    value.snapshots[0].structurePhase = "REVERSAL";
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.latest));
});
test("snapshot direction regime conflict is rejected", () => {
    const value = source(["BULLISH"]);
    value.snapshots[0].currentRegime = "BEARISH";
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.latest));
});
test("first snapshot must be establishment", () => {
    const value = source(["BULLISH"]);
    value.snapshots[0].eventType = "BOS";
    value.snapshots[0].structurePhase = "CONTINUATION";
    value.snapshots[0].regimeBefore = "BULLISH";
    rebuild(value);
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.snapshots[0]));
});
test("later snapshot cannot be establishment", () => {
    const value = source(["BULLISH", "BULLISH"]);
    value.snapshots[1].eventType = "INITIAL_BREAK";
    value.snapshots[1].structurePhase = "ESTABLISHMENT";
    value.snapshots[1].regimeBefore = "UNDETERMINED";
    rebuild(value);
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.snapshots[1]));
});
test("regime transition chain is enforced", () => {
    const value = source(["BULLISH", "BEARISH", "BEARISH"]);
    value.snapshots[2].regimeBefore = "BULLISH";
    value.snapshots[2].direction = "BULLISH";
    value.snapshots[2].currentRegime = "BULLISH";
    value.snapshots[2].levelType = "SWING_HIGH";
    value.snapshots[2].levelClassification = "HIGHER_HIGH";
    rebuild(value);
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.snapshots[2]));
});
test("snapshot count manipulation is rejected", () => {
    const value = source(["BULLISH"]);
    value.snapshotCount = 2;
    fail("SNAPSHOT_PROJECTION_MISMATCH", value, candidate(value.latest));
});
test("snapshot open-time manipulation is rejected", () => {
    const value = source(["BULLISH"]);
    value.snapshotOpenTimes[0] += 1;
    fail("SNAPSHOT_PROJECTION_MISMATCH", value, candidate(value.latest));
});
test("direction projection manipulation is rejected", () => {
    const value = source(["BULLISH"]);
    value.bullishSnapshots[0].levelPrice += 1;
    fail("SNAPSHOT_PROJECTION_MISMATCH", value, candidate(value.latest));
});
test("phase projection manipulation is rejected", () => {
    const value = source(["BULLISH", "BULLISH"]);
    value.continuationSnapshots = [];
    fail("SNAPSHOT_PROJECTION_MISMATCH", value, candidate(value.latest));
});
test("latest projection manipulation is rejected", () => {
    const value = source(["BULLISH"]);
    value.latest = null;
    fail("LATEST_PROJECTION_MISMATCH", value, candidate(value.snapshots[0]));
});
test("latest directional manipulation is rejected", () => {
    const value = source(["BULLISH"]);
    value.latestBullish.levelPrice += 1;
    fail("LATEST_PROJECTION_MISMATCH", value, candidate(value.snapshots[0]));
});
test("latest phase manipulation is rejected", () => {
    const value = source(["BULLISH"]);
    value.latestEstablishment = null;
    fail("LATEST_PROJECTION_MISMATCH", value, candidate(value.snapshots[0]));
});
test("duplicate snapshot id is rejected", () => {
    const value = source(["BULLISH", "BULLISH"]);
    value.snapshots[1].id = value.snapshots[0].id;
    rebuild(value);
    fail("DUPLICATE_SNAPSHOT_ID", value, candidate(value.snapshots[1]));
});
test("duplicate source event id is rejected", () => {
    const value = source(["BULLISH", "BULLISH"]);
    value.snapshots[1].sourceEventId = value.snapshots[0].sourceEventId;
    rebuild(value);
    fail("DUPLICATE_SOURCE_EVENT_ID", value, candidate(value.snapshots[1]));
});
test("sequence index conflict is rejected", () => {
    const value = source(["BULLISH", "BULLISH"]);
    value.snapshots[1].sequenceIndex = 2;
    rebuild(value);
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.snapshots[1]));
});
test("descending chronology is rejected", () => {
    const value = source(["BULLISH", "BULLISH"]);
    value.snapshots[1].levelCandidateIndex = 0;
    value.snapshots[1].levelConfirmedAtIndex = 1;
    value.snapshots[1].breakAtIndex = 2;
    rebuild(value);
    fail("CHRONOLOGY_VIOLATION", value, candidate(value.snapshots[1]));
});
test("descending time chronology is rejected", () => {
    const value = source(["BULLISH", "BULLISH"]);
    const second = value.snapshots[1];
    second.breakOpenTime = 2500;
    second.breakCloseTime = 2999;
    second.levelOpenTime = 0;
    second.levelCloseTime = 499;
    second.levelConfirmedAtOpenTime = 500;
    second.levelConfirmedAtCloseTime = 1999;
    rebuild(value);
    fail("CHRONOLOGY_VIOLATION", value, candidate(second));
});
test("ready consistency is enforced", () => {
    const value = source(["BULLISH"]);
    value.ready = false;
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.snapshots[0]));
});
test("snapshot isReady consistency is enforced", () => {
    const value = source(["BULLISH"]);
    value.snapshots[0].isReady = false;
    rebuild(value);
    fail("SNAPSHOT_SCHEMA_CONFLICT", value, candidate(value.snapshots[0]));
});
test("input objects are not mutated", () => {
    const value = source(["BULLISH"]);
    const setup = candidate(value.snapshots[0]);
    const beforeSource = clone(value);
    const beforeSetup = clone(setup);
    gate.evaluateSetup(value, setup);
    assert.deepStrictEqual(value, beforeSource);
    assert.deepStrictEqual(setup, beforeSetup);
});
test("output references are isolated", () => {
    const value = source(["BULLISH"]);
    const output = gate.evaluateSetup(value, candidate(value.snapshots[0]));
    assert.notStrictEqual(output.market, value.market);
    assert.notStrictEqual(output.referencedSnapshot, value.snapshots[0]);
    assert.notStrictEqual(output.latestCausalSnapshot, value.snapshots[0]);
    output.referencedSnapshot.levelPrice = 0;
    assert.strictEqual(output.latestCausalSnapshot.levelPrice, 10);
});
test("output mutation does not affect later call", () => {
    const value = source(["BULLISH"]);
    const setup = candidate(value.snapshots[0]);
    const first = gate.evaluateSetup(value, setup);
    first.market.symbol = "X";
    first.evidence.structureDirection = "BEARISH";
    const second = gate.evaluateSetup(value, setup);
    assert.strictEqual(second.market.symbol, "BTCUSDT");
    assert.strictEqual(second.evidence.structureDirection, "BULLISH");
});
test("deep determinism", () => {
    const value = source(["BULLISH", "BULLISH"]);
    const setup = candidate(value.snapshots[1]);
    assert.deepStrictEqual(gate.evaluateSetup(value, setup),
        gate.evaluateSetup(value, setup));
});
test("prefix causality preserves prior decision", () => {
    const prefix = source(["BULLISH", "BULLISH"]);
    const extended = source(["BULLISH", "BULLISH", "BEARISH"]);
    const setup = candidate(prefix.snapshots[1]);
    const first = gate.evaluateSetup(prefix, setup);
    const second = gate.evaluateSetup(extended, setup);
    for (const field of [
        "valid", "ready", "decision", "reason", "causalSnapshotCount",
        "referencedSnapshot", "latestCausalSnapshot", "evidence"
    ]) {
        assert.deepStrictEqual(second[field], first[field], field);
    }
});
test("all invalid paths share stable fail-closed schema", () => {
    const value = source(["BULLISH"]);
    const setup = candidate(value.snapshots[0]);
    const outputs = [
        gate.evaluateSetup(null, setup),
        gate.evaluateSetup(Object.assign(clone(value), { schemaVersion: "X" }), setup),
        gate.evaluateSetup(value, null)
    ];
    const fields = Object.keys(outputs[0]).sort();
    outputs.forEach(output => {
        assert.deepStrictEqual(Object.keys(output).sort(), fields);
        assert.strictEqual(output.valid, false);
        assert.strictEqual(output.ready, false);
        assert.strictEqual(output.decision, "BLOCK");
    });
});
test("invalid snapshot after valid prefix leaks no decision", () => {
    const value = source(["BULLISH", "BULLISH"]);
    value.snapshots[1].currentRegime = "BEARISH";
    rebuild(value);
    const output = fail("SNAPSHOT_SCHEMA_CONFLICT", value,
        candidate(value.snapshots[0]));
    assert.strictEqual(output.setupId, null);
    assert.strictEqual(output.sourceSnapshotCount, 0);
});
test("production module has no live integration capabilities", () => {
    const code = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureSetupGate.js"), "utf8");
    for (const token of [
        "setupEngine", "HNDSetupEngine", "entry", "stopLoss", "takeProfit",
        "trade", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage",
        "Date.now", "new Date", "Math.random", "setTimeout", "setInterval",
        "document.", "querySelector", "addEventListener", "require(", "console."
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
        console.error("HND_STRUCTURE_SETUP_GATE_TEST_FAILED:" + item.name);
        console.error(error.stack || error);
        process.exitCode = 1;
        break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_SETUP_GATE_TESTS_PASS:" + tests.length);
}
