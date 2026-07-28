"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
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
        breakType: bullish
            ? "BREAK_ABOVE_SWING_HIGH" : "BREAK_BELOW_SWING_LOW",
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
    const list = (events || []).map(clone);
    const initialBreaks = list.filter(x => x.type === "INITIAL_BREAK").map(clone);
    const bosEvents = list.filter(x => x.type === "BOS").map(clone);
    const chochEvents = list.filter(x => x.type === "CHOCH").map(clone);
    const bullishEvents = list.filter(x => x.direction === "BULLISH").map(clone);
    const bearishEvents = list.filter(x => x.direction === "BEARISH").map(clone);
    return {
        valid: true,
        error: null,
        ready: ready === undefined ? true : ready,
        schemaVersion: "HND_BOS_CHOCH_RESOLVER_V1",
        market: { symbol: "BTCUSDT", interval: "15m" },
        sourceEventCount: list.length,
        resolvedEventCount: list.length,
        initialRegime: "UNDETERMINED",
        currentRegime: list.length ? list.at(-1).regimeAfter : "UNDETERMINED",
        events: list,
        initialBreaks,
        bosEvents,
        chochEvents,
        bullishEvents,
        bearishEvents,
        latestEvent: list.length ? clone(list.at(-1)) : null,
        latestBos: bosEvents.length ? clone(bosEvents.at(-1)) : null,
        latestChoch: chochEvents.length ? clone(chochEvents.at(-1)) : null
    };
}
function rebuild(result) {
    const list = result.events;
    result.sourceEventCount = list.length;
    result.resolvedEventCount = list.length;
    result.initialBreaks = list.filter(x => x.type === "INITIAL_BREAK").map(clone);
    result.bosEvents = list.filter(x => x.type === "BOS").map(clone);
    result.chochEvents = list.filter(x => x.type === "CHOCH").map(clone);
    result.bullishEvents = list.filter(x => x.direction === "BULLISH").map(clone);
    result.bearishEvents = list.filter(x => x.direction === "BEARISH").map(clone);
    result.latestEvent = list.length ? clone(list.at(-1)) : null;
    result.latestBos = result.bosEvents.length ? clone(result.bosEvents.at(-1)) : null;
    result.latestChoch = result.chochEvents.length ? clone(result.chochEvents.at(-1)) : null;
    result.currentRegime = list.length ? list.at(-1).regimeAfter : "UNDETERMINED";
}
function build(events, ready) {
    return snapshotModule.buildStructureStateSnapshot(resolverResult(events, ready));
}
function failed(error, source) {
    const output = snapshotModule.buildStructureStateSnapshot(source);
    assert.strictEqual(output.valid, false);
    assert.strictEqual(output.error, error);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.sourceEventCount, 0);
    assert.strictEqual(output.snapshotCount, 0);
    assert.deepStrictEqual(output.snapshotOpenTimes, []);
    for (const field of [
        "snapshots", "bullishSnapshots", "bearishSnapshots",
        "establishmentSnapshots", "continuationSnapshots", "reversalSnapshots"
    ]) {
        assert.deepStrictEqual(output[field], []);
    }
    for (const field of [
        "latest", "latestBullish", "latestBearish", "latestEstablishment",
        "latestContinuation", "latestReversal"
    ]) {
        assert.strictEqual(output[field], null);
    }
    return output;
}

test("public API has exactly three functions", () => {
    assert.deepStrictEqual(Object.keys(snapshotModule).sort(), [
        "buildStructureStateSnapshot", "getSchemaVersion", "getVocabulary"
    ]);
});
test("schema version is exact", () => {
    assert.strictEqual(snapshotModule.getSchemaVersion(),
        "HND_STRUCTURE_STATE_SNAPSHOT_V1");
});
test("vocabulary is exact", () => {
    assert.deepStrictEqual(snapshotModule.getVocabulary(), {
        sourceSchemas: ["HND_BOS_CHOCH_RESOLVER_V1"],
        eventTypes: ["INITIAL_BREAK", "BOS", "CHOCH"],
        regimes: ["UNDETERMINED", "BULLISH", "BEARISH"],
        structurePhases: ["ESTABLISHMENT", "CONTINUATION", "REVERSAL"],
        directions: ["BULLISH", "BEARISH"]
    });
});
test("vocabulary results are isolated", () => {
    const first = snapshotModule.getVocabulary();
    first.eventTypes.push("X");
    assert.strictEqual(snapshotModule.getVocabulary().eventTypes.includes("X"), false);
});
test("CommonJS module exposes expected API", () => {
    assert.strictEqual(typeof snapshotModule.buildStructureStateSnapshot, "function");
});
test("browser UMD exposes expected global", () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureStateSnapshot.js"), "utf8");
    const window = {};
    vm.runInNewContext(source, { window, encodeURIComponent });
    assert.deepStrictEqual(Object.keys(window.HNDStructureStateSnapshot).sort(), [
        "buildStructureStateSnapshot", "getSchemaVersion", "getVocabulary"
    ]);
});
test("valid empty result is not ready and has no prediction", () => {
    const output = build([]);
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.sourceEventCount, 0);
    assert.strictEqual(output.snapshotCount, 0);
    assert.deepStrictEqual(output.snapshots, []);
    assert.strictEqual(output.latest, null);
});
test("upstream ready false propagates to result and snapshots", () => {
    const output = build(sequence(["BULLISH"]), false);
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.snapshots[0].isReady, false);
});
test("upstream ready true marks nonempty snapshots ready", () => {
    const output = build(sequence(["BULLISH"]), true);
    assert.strictEqual(output.ready, true);
    assert.strictEqual(output.snapshots[0].isReady, true);
});
test("bullish initial break becomes establishment", () => {
    const item = build(sequence(["BULLISH"])).snapshots[0];
    assert.strictEqual(item.eventType, "INITIAL_BREAK");
    assert.strictEqual(item.structurePhase, "ESTABLISHMENT");
    assert.strictEqual(item.currentRegime, "BULLISH");
});
test("bearish initial break becomes establishment", () => {
    const item = build(sequence(["BEARISH"])).snapshots[0];
    assert.strictEqual(item.structurePhase, "ESTABLISHMENT");
    assert.strictEqual(item.currentRegime, "BEARISH");
});
test("bullish BOS becomes continuation", () => {
    const item = build(sequence(["BULLISH", "BULLISH"])).snapshots[1];
    assert.strictEqual(item.eventType, "BOS");
    assert.strictEqual(item.structurePhase, "CONTINUATION");
    assert.strictEqual(item.currentRegime, "BULLISH");
});
test("bearish BOS becomes continuation", () => {
    const item = build(sequence(["BEARISH", "BEARISH"])).snapshots[1];
    assert.strictEqual(item.structurePhase, "CONTINUATION");
    assert.strictEqual(item.currentRegime, "BEARISH");
});
test("bullish CHOCH becomes reversal", () => {
    const item = build(sequence(["BEARISH", "BULLISH"])).snapshots[1];
    assert.strictEqual(item.eventType, "CHOCH");
    assert.strictEqual(item.structurePhase, "REVERSAL");
    assert.strictEqual(item.currentRegime, "BULLISH");
});
test("bearish CHOCH becomes reversal", () => {
    const item = build(sequence(["BULLISH", "BEARISH"])).snapshots[1];
    assert.strictEqual(item.structurePhase, "REVERSAL");
    assert.strictEqual(item.currentRegime, "BEARISH");
});
test("multiple transitions preserve exact phase mapping", () => {
    const output = build(sequence([
        "BULLISH", "BULLISH", "BEARISH", "BEARISH", "BULLISH"
    ]));
    assert.deepStrictEqual(output.snapshots.map(x => x.structurePhase), [
        "ESTABLISHMENT", "CONTINUATION", "REVERSAL",
        "CONTINUATION", "REVERSAL"
    ]);
    assert.deepStrictEqual(output.snapshots.map(x => x.currentRegime), [
        "BULLISH", "BULLISH", "BEARISH", "BEARISH", "BULLISH"
    ]);
});
test("snapshot fields preserve resolver event causality", () => {
    const source = sequence(["BULLISH"])[0];
    const item = build([source]).snapshots[0];
    for (const field of [
        "direction", "regimeBefore", "breakAtIndex", "breakOpenTime",
        "breakCloseTime", "breakClosePrice", "levelType",
        "levelClassification", "levelCandidateIndex", "levelOpenTime",
        "levelCloseTime", "levelPrice", "levelConfirmedAtIndex",
        "levelConfirmedAtOpenTime", "levelConfirmedAtCloseTime"
    ]) {
        assert.strictEqual(item[field], source[field], field);
    }
    assert.strictEqual(item.sourceEventId, source.id);
});
test("sequence index follows source order", () => {
    const output = build(sequence(["BULLISH", "BULLISH", "BEARISH"]));
    assert.deepStrictEqual(output.snapshots.map(x => x.sequenceIndex), [0, 1, 2]);
});
test("snapshot open times follow source order", () => {
    const output = build(sequence(["BULLISH", "BULLISH", "BEARISH"]));
    assert.deepStrictEqual(output.snapshotOpenTimes,
        output.snapshots.map(x => x.breakOpenTime));
});
test("snapshot IDs are deeply deterministic", () => {
    const source = resolverResult(sequence(["BULLISH", "BEARISH"]));
    assert.deepStrictEqual(
        snapshotModule.buildStructureStateSnapshot(source),
        snapshotModule.buildStructureStateSnapshot(source));
});
test("snapshot ID includes market and sequence namespace", () => {
    const id = build(sequence(["BULLISH"])).snapshots[0].id;
    assert.strictEqual(id.includes("BTCUSDT"), true);
    assert.strictEqual(id.includes("15m"), true);
    assert.strictEqual(id.endsWith("|0"), true);
});
test("different market changes snapshot ID", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    const first = snapshotModule.buildStructureStateSnapshot(source).snapshots[0].id;
    source.market.symbol = "ETHUSDT";
    for (const key of ["events", "initialBreaks", "bullishEvents"]) {
        source[key][0].symbol = "ETHUSDT";
    }
    source.latestEvent.symbol = "ETHUSDT";
    const second = snapshotModule.buildStructureStateSnapshot(source).snapshots[0].id;
    assert.notStrictEqual(first, second);
});
test("all projection lists match canonical snapshots", () => {
    const output = build(sequence([
        "BULLISH", "BULLISH", "BEARISH", "BEARISH"
    ]));
    assert.deepStrictEqual(output.bullishSnapshots,
        output.snapshots.filter(x => x.direction === "BULLISH"));
    assert.deepStrictEqual(output.bearishSnapshots,
        output.snapshots.filter(x => x.direction === "BEARISH"));
    assert.deepStrictEqual(output.establishmentSnapshots,
        output.snapshots.filter(x => x.structurePhase === "ESTABLISHMENT"));
    assert.deepStrictEqual(output.continuationSnapshots,
        output.snapshots.filter(x => x.structurePhase === "CONTINUATION"));
    assert.deepStrictEqual(output.reversalSnapshots,
        output.snapshots.filter(x => x.structurePhase === "REVERSAL"));
});
test("all latest fields match projection tails", () => {
    const output = build(sequence([
        "BULLISH", "BULLISH", "BEARISH", "BEARISH", "BULLISH"
    ]));
    assert.deepStrictEqual(output.latest, output.snapshots.at(-1));
    assert.deepStrictEqual(output.latestBullish, output.bullishSnapshots.at(-1));
    assert.deepStrictEqual(output.latestBearish, output.bearishSnapshots.at(-1));
    assert.deepStrictEqual(output.latestEstablishment,
        output.establishmentSnapshots.at(-1));
    assert.deepStrictEqual(output.latestContinuation,
        output.continuationSnapshots.at(-1));
    assert.deepStrictEqual(output.latestReversal, output.reversalSnapshots.at(-1));
});
test("latest fields are reference isolated", () => {
    const output = build(sequence(["BULLISH", "BULLISH"]));
    assert.notStrictEqual(output.latest, output.snapshots.at(-1));
    assert.notStrictEqual(output.latestBullish, output.bullishSnapshots.at(-1));
    assert.notStrictEqual(output.latestContinuation,
        output.continuationSnapshots.at(-1));
});
test("projection entries are reference isolated", () => {
    const output = build(sequence(["BULLISH", "BULLISH"]));
    assert.notStrictEqual(output.snapshots[0], output.bullishSnapshots[0]);
    assert.notStrictEqual(output.snapshots[0], output.establishmentSnapshots[0]);
    output.snapshots[0].levelPrice = 0;
    assert.strictEqual(output.bullishSnapshots[0].levelPrice, 10);
});
test("input is not mutated", () => {
    const source = resolverResult(sequence(["BULLISH", "BEARISH"]));
    const before = clone(source);
    snapshotModule.buildStructureStateSnapshot(source);
    assert.deepStrictEqual(source, before);
});
test("output mutation does not affect later call", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    const first = snapshotModule.buildStructureStateSnapshot(source);
    first.snapshots[0].currentRegime = "BEARISH";
    first.market.symbol = "X";
    const second = snapshotModule.buildStructureStateSnapshot(source);
    assert.strictEqual(second.snapshots[0].currentRegime, "BULLISH");
    assert.strictEqual(second.market.symbol, "BTCUSDT");
});
test("prefix causality preserves prior snapshots and IDs", () => {
    const events = sequence(["BULLISH", "BULLISH"]);
    const prefix = build(events.slice(0, 1));
    const extended = build(events);
    assert.deepStrictEqual(
        extended.snapshots.slice(0, prefix.snapshots.length),
        prefix.snapshots);
});
test("duplicate source event ID is rejected", () => {
    const events = sequence(["BULLISH", "BULLISH"]);
    events[1].id = events[0].id;
    const source = resolverResult(events);
    failed("DUPLICATE_EVENT_ID", source);
});
test("duplicate snapshot ID is rejected", () => {
    const sourceCode = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureStateSnapshot.js"), "utf8");
    const window = {};
    vm.runInNewContext(sourceCode, {
        window,
        encodeURIComponent: () => "same"
    });
    const output = window.HNDStructureStateSnapshot
        .buildStructureStateSnapshot(resolverResult(sequence(["BULLISH", "BULLISH"])));
    assert.strictEqual(output.error, "DUPLICATE_EVENT_ID");
    assert.strictEqual(output.snapshotCount, 0);
});
test("null and malformed results are rejected", () => {
    for (const value of [null, [], {}, { valid: true }]) {
        failed("INVALID_RESOLVER_RESULT", value);
    }
});
test("invalid upstream valid error ready fields are rejected", () => {
    const first = resolverResult([]);
    first.valid = false;
    failed("INVALID_RESOLVER_RESULT", first);
    const second = resolverResult([]);
    second.error = "X";
    failed("INVALID_RESOLVER_RESULT", second);
    const third = resolverResult([]);
    third.ready = 1;
    failed("INVALID_RESOLVER_RESULT", third);
});
test("source schema mismatch is rejected", () => {
    const source = resolverResult([]);
    source.schemaVersion = "HND_BOS_CHOCH_RESOLVER_V2";
    failed("SOURCE_SCHEMA_MISMATCH", source);
});
test("missing market is rejected", () => {
    const source = resolverResult([]);
    source.market = null;
    failed("MARKET_INVALID", source);
});
test("unclean market is rejected without normalization", () => {
    const source = resolverResult([]);
    source.market.symbol = " btcusdt ";
    failed("MARKET_INVALID", source);
});
test("missing top-level field is rejected", () => {
    const source = resolverResult([]);
    delete source.currentRegime;
    failed("INVALID_RESOLVER_RESULT", source);
});
test("extra top-level field is rejected", () => {
    const source = resolverResult([]);
    source.extra = true;
    failed("INVALID_RESOLVER_RESULT", source);
});
test("event count mismatch is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.resolvedEventCount = 0;
    failed("EVENT_PROJECTION_MISMATCH", source);
});
test("source event count mismatch is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.sourceEventCount = 2;
    failed("EVENT_PROJECTION_MISMATCH", source);
});
test("missing event field is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    delete source.events[0].levelPrice;
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("extra event field is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.events[0].rawCandle = {};
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("event schema mismatch is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.events[0].schemaVersion = "X";
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("event market mismatch is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.events[0].symbol = "ETHUSDT";
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("invalid direction is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.events[0].direction = "SIDEWAYS";
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("break type and direction contradiction is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.events[0].breakType = "BREAK_BELOW_SWING_LOW";
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("level type and direction contradiction is rejected", () => {
    const source = resolverResult(sequence(["BEARISH"]));
    source.events[0].levelType = "SWING_HIGH";
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("causal index chain is enforced", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.events[0].levelConfirmedAtIndex = 3;
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("causal time chain is enforced", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.events[0].levelConfirmedAtCloseTime = 3000;
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("initial regime must be undetermined", () => {
    const source = resolverResult([]);
    source.initialRegime = "BULLISH";
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("first event cannot be BOS", () => {
    const source = resolverResult([
        event("BOS", "BULLISH", 3, "UNDETERMINED")
    ]);
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("first event cannot be CHOCH", () => {
    const source = resolverResult([
        event("CHOCH", "BULLISH", 3, "UNDETERMINED")
    ]);
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("second event cannot be INITIAL_BREAK", () => {
    const events = sequence(["BULLISH", "BULLISH"]);
    events[1].type = "INITIAL_BREAK";
    const source = resolverResult(events);
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("BOS direction must equal previous regime", () => {
    const events = sequence(["BULLISH", "BEARISH"]);
    events[1].type = "BOS";
    const source = resolverResult(events);
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("CHOCH direction must oppose previous regime", () => {
    const events = sequence(["BULLISH", "BULLISH"]);
    events[1].type = "CHOCH";
    const source = resolverResult(events);
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("regimeBefore contradiction is rejected", () => {
    const events = sequence(["BULLISH", "BULLISH"]);
    events[1].regimeBefore = "BEARISH";
    const source = resolverResult(events);
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("regimeAfter must equal event direction", () => {
    const events = sequence(["BULLISH"]);
    events[0].regimeAfter = "BEARISH";
    const source = resolverResult(events);
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("resolver current regime must match final event", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.currentRegime = "BEARISH";
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("empty result current regime must be undetermined", () => {
    const source = resolverResult([]);
    source.currentRegime = "BULLISH";
    failed("REGIME_TRANSITION_CONFLICT", source);
});
test("event projection manipulation is rejected", () => {
    const source = resolverResult(sequence(["BULLISH", "BULLISH"]));
    source.bosEvents = [];
    failed("EVENT_PROJECTION_MISMATCH", source);
});
test("directional projection manipulation is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.bullishEvents[0].levelPrice = 99;
    failed("EVENT_PROJECTION_MISMATCH", source);
});
test("latest event manipulation is rejected", () => {
    const source = resolverResult(sequence(["BULLISH"]));
    source.latestEvent = null;
    failed("LATEST_PROJECTION_MISMATCH", source);
});
test("latest BOS manipulation is rejected", () => {
    const source = resolverResult(sequence(["BULLISH", "BULLISH"]));
    source.latestBos = null;
    failed("LATEST_PROJECTION_MISMATCH", source);
});
test("latest CHOCH manipulation is rejected", () => {
    const source = resolverResult(sequence(["BULLISH", "BEARISH"]));
    source.latestChoch.levelPrice = 99;
    failed("LATEST_PROJECTION_MISMATCH", source);
});
test("descending break index is rejected", () => {
    const events = sequence(["BULLISH", "BEARISH"]);
    events[1].breakAtIndex = 2;
    const source = resolverResult(events);
    failed("EVENT_SCHEMA_CONFLICT", source);
});
test("increasing index with descending event time is rejected", () => {
    const events = sequence(["BULLISH", "BEARISH"]);
    events[1] = event("CHOCH", "BEARISH", 5, "BULLISH", {
        breakOpenTime: 2500,
        breakCloseTime: 2999,
        levelOpenTime: 0,
        levelCloseTime: 499,
        levelConfirmedAtOpenTime: 500,
        levelConfirmedAtCloseTime: 1999
    });
    const source = resolverResult(events);
    failed("CHRONOLOGY_VIOLATION", source);
});
test("all failure paths share stable schema", () => {
    const expected = [
        "valid", "error", "ready", "schemaVersion", "sourceSchemaVersion",
        "market", "sourceEventCount", "snapshotCount", "snapshotOpenTimes",
        "snapshots", "bullishSnapshots", "bearishSnapshots",
        "establishmentSnapshots", "continuationSnapshots", "reversalSnapshots",
        "latest", "latestBullish", "latestBearish", "latestEstablishment",
        "latestContinuation", "latestReversal"
    ].sort();
    const failures = [
        snapshotModule.buildStructureStateSnapshot(null),
        snapshotModule.buildStructureStateSnapshot(Object.assign(
            resolverResult([]), { schemaVersion: "X" })),
        snapshotModule.buildStructureStateSnapshot(Object.assign(
            resolverResult([]), { market: null }))
    ];
    failures.forEach(output => {
        assert.deepStrictEqual(Object.keys(output).sort(), expected);
        assert.strictEqual(output.schemaVersion,
            "HND_STRUCTURE_STATE_SNAPSHOT_V1");
        assert.strictEqual(output.sourceSchemaVersion,
            "HND_BOS_CHOCH_RESOLVER_V1");
    });
});
test("invalid event after valid prefix leaks no snapshot", () => {
    const source = resolverResult(sequence(["BULLISH", "BULLISH"]));
    source.events[1].regimeBefore = "BEARISH";
    rebuild(source);
    const output = failed("REGIME_TRANSITION_CONFLICT", source);
    assert.deepStrictEqual(output.snapshots, []);
});
test("production module has no raw data or live integration capabilities", () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureStateSnapshot.js"), "utf8");
    for (const token of [
        "rawCandles", "isClosed", "structureBreakDetector", "detectBreaks(",
        "structureEventContract", "buildStructureEvents(", "resolveStructure(",
        "setupEngine", "entry", "stopLoss", "takeProfit", "require(",
        "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage",
        "Date.now", "new Date", "Math.random", "setTimeout", "setInterval",
        "console."
    ]) {
        assert.strictEqual(source.includes(token), false, token);
    }
});

let passed = 0;
for (const item of tests) {
    try {
        item.fn();
        passed += 1;
        console.log("PASS:" + item.name);
    } catch (error) {
        console.error("HND_STRUCTURE_STATE_SNAPSHOT_TEST_FAILED:" + item.name);
        console.error(error.stack || error);
        process.exitCode = 1;
        break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_STATE_SNAPSHOT_TESTS_PASS:" + tests.length);
}
