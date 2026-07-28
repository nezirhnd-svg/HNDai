"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const resolver = require("../../js/hndai-v1/bosChochResolver.js");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sourceEvent(direction, index, overrides) {
    const bullish = direction === "BULLISH";
    const open = index * 1000;
    const level = bullish ? 10 : 10;
    return Object.assign({
        id: [
            "HND_STRUCTURE_EVENT_V1", "BTCUSDT", "15m", direction, index
        ].join("|"),
        schemaVersion: "HND_STRUCTURE_EVENT_V1",
        kind: "STRUCTURE_BREAK",
        status: "CONFIRMED",
        symbol: "BTCUSDT",
        interval: "15m",
        direction,
        breakType: bullish
            ? "BREAK_ABOVE_SWING_HIGH" : "BREAK_BELOW_SWING_LOW",
        breakAtIndex: index,
        breakOpenTime: open,
        breakCloseTime: open + 999,
        breakClosePrice: bullish ? level + 1 : level - 1,
        levelType: bullish ? "SWING_HIGH" : "SWING_LOW",
        levelClassification: bullish ? "HIGHER_HIGH" : "LOWER_LOW",
        levelCandidateIndex: index - 2,
        levelOpenTime: open - 2000,
        levelCloseTime: open - 1501,
        levelPrice: level,
        levelConfirmedAtIndex: index - 1,
        levelConfirmedAtOpenTime: open - 1000,
        levelConfirmedAtCloseTime: open - 1
    }, overrides);
}
function contractResult(items, ready) {
    const events = (items || []).map(clone);
    const bullishEvents = events.filter(x => x.direction === "BULLISH").map(clone);
    const bearishEvents = events.filter(x => x.direction === "BEARISH").map(clone);
    return {
        valid: true,
        error: null,
        ready: ready === undefined ? true : ready,
        schemaVersion: "HND_STRUCTURE_EVENT_V1",
        market: { symbol: "BTCUSDT", interval: "15m" },
        sourceBreakCount: events.length,
        eventCount: events.length,
        events,
        bullishEvents,
        bearishEvents,
        latestBullishEvent: bullishEvents.length ? clone(bullishEvents.at(-1)) : null,
        latestBearishEvent: bearishEvents.length ? clone(bearishEvents.at(-1)) : null
    };
}
function resolve(items, ready) {
    return resolver.resolveStructure(contractResult(items, ready));
}
function rebuildProjections(result) {
    result.bullishEvents = result.events
        .filter(x => x.direction === "BULLISH").map(clone);
    result.bearishEvents = result.events
        .filter(x => x.direction === "BEARISH").map(clone);
    result.latestBullishEvent = result.bullishEvents.length
        ? clone(result.bullishEvents.at(-1)) : null;
    result.latestBearishEvent = result.bearishEvents.length
        ? clone(result.bearishEvents.at(-1)) : null;
}
function failed(error, source) {
    const output = resolver.resolveStructure(source);
    assert.strictEqual(output.valid, false);
    assert.strictEqual(output.error, error);
    assert.strictEqual(output.ready, false);
    assert.strictEqual(output.currentRegime, "UNDETERMINED");
    for (const key of [
        "events", "initialBreaks", "bosEvents", "chochEvents",
        "bullishEvents", "bearishEvents"
    ]) {
        assert.deepStrictEqual(output[key], []);
    }
    assert.strictEqual(output.latestEvent, null);
    assert.strictEqual(output.latestBos, null);
    assert.strictEqual(output.latestChoch, null);
    return output;
}

test("public API is minimal", () => {
    assert.deepStrictEqual(Object.keys(resolver).sort(),
        ["getVocabulary", "resolveStructure"]);
});
test("vocabulary is exact", () => {
    assert.deepStrictEqual(resolver.getVocabulary(), {
        eventTypes: ["INITIAL_BREAK", "BOS", "CHOCH"],
        regimes: ["UNDETERMINED", "BULLISH", "BEARISH"],
        directions: ["BULLISH", "BEARISH"]
    });
});
test("vocabulary calls are clone isolated", () => {
    const first = resolver.getVocabulary();
    first.eventTypes.push("X");
    assert.strictEqual(resolver.getVocabulary().eventTypes.includes("X"), false);
});
test("browser UMD exposes expected global", () => {
    const code = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/bosChochResolver.js"), "utf8");
    const window = {};
    vm.runInNewContext(code, { window });
    assert.deepStrictEqual(Object.keys(window.HNDBosChochResolver).sort(),
        ["getVocabulary", "resolveStructure"]);
});
test("valid empty result keeps undetermined regime", () => {
    const output = resolve([]);
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.ready, true);
    assert.strictEqual(output.sourceEventCount, 0);
    assert.strictEqual(output.resolvedEventCount, 0);
    assert.strictEqual(output.initialRegime, "UNDETERMINED");
    assert.strictEqual(output.currentRegime, "UNDETERMINED");
    assert.deepStrictEqual(output.events, []);
    assert.strictEqual(output.latestEvent, null);
});
test("ready false propagates on valid empty result", () => {
    const output = resolve([], false);
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.ready, false);
});
test("first bullish break is initial bullish regime", () => {
    const output = resolve([sourceEvent("BULLISH", 3)]);
    assert.deepStrictEqual(
        [output.events[0].type, output.events[0].regimeBefore,
            output.events[0].regimeAfter],
        ["INITIAL_BREAK", "UNDETERMINED", "BULLISH"]);
    assert.strictEqual(output.currentRegime, "BULLISH");
});
test("first bearish break is initial bearish regime", () => {
    const output = resolve([sourceEvent("BEARISH", 3)]);
    assert.deepStrictEqual(
        [output.events[0].type, output.events[0].regimeBefore,
            output.events[0].regimeAfter],
        ["INITIAL_BREAK", "UNDETERMINED", "BEARISH"]);
    assert.strictEqual(output.currentRegime, "BEARISH");
});
test("bullish continuation is BOS", () => {
    const output = resolve([
        sourceEvent("BULLISH", 3), sourceEvent("BULLISH", 5)
    ]);
    assert.deepStrictEqual(output.events.map(x => x.type), ["INITIAL_BREAK", "BOS"]);
    assert.strictEqual(output.events[1].regimeBefore, "BULLISH");
    assert.strictEqual(output.events[1].regimeAfter, "BULLISH");
});
test("bearish continuation is BOS", () => {
    const output = resolve([
        sourceEvent("BEARISH", 3), sourceEvent("BEARISH", 5)
    ]);
    assert.deepStrictEqual(output.events.map(x => x.type), ["INITIAL_BREAK", "BOS"]);
    assert.strictEqual(output.events[1].regimeAfter, "BEARISH");
});
test("bullish to bearish transition is CHOCH", () => {
    const output = resolve([
        sourceEvent("BULLISH", 3), sourceEvent("BEARISH", 5)
    ]);
    assert.strictEqual(output.events[1].type, "CHOCH");
    assert.strictEqual(output.events[1].regimeBefore, "BULLISH");
    assert.strictEqual(output.events[1].regimeAfter, "BEARISH");
});
test("bearish to bullish transition is CHOCH", () => {
    const output = resolve([
        sourceEvent("BEARISH", 3), sourceEvent("BULLISH", 5)
    ]);
    assert.strictEqual(output.events[1].type, "CHOCH");
    assert.strictEqual(output.events[1].regimeBefore, "BEARISH");
    assert.strictEqual(output.events[1].regimeAfter, "BULLISH");
});
test("multiple BOS and CHOCH transitions are deterministic", () => {
    const directions = ["BULLISH", "BULLISH", "BEARISH", "BEARISH", "BULLISH"];
    const output = resolve(directions.map((direction, i) =>
        sourceEvent(direction, 3 + i * 2)));
    assert.deepStrictEqual(output.events.map(x => x.type),
        ["INITIAL_BREAK", "BOS", "CHOCH", "BOS", "CHOCH"]);
    assert.deepStrictEqual(output.events.map(x => x.regimeAfter), directions);
    assert.strictEqual(output.currentRegime, "BULLISH");
});
test("all projections match the canonical resolved list", () => {
    const output = resolve([
        sourceEvent("BULLISH", 3), sourceEvent("BULLISH", 5),
        sourceEvent("BEARISH", 7), sourceEvent("BEARISH", 9)
    ]);
    assert.deepStrictEqual(output.initialBreaks,
        output.events.filter(x => x.type === "INITIAL_BREAK"));
    assert.deepStrictEqual(output.bosEvents,
        output.events.filter(x => x.type === "BOS"));
    assert.deepStrictEqual(output.chochEvents,
        output.events.filter(x => x.type === "CHOCH"));
    assert.deepStrictEqual(output.bullishEvents,
        output.events.filter(x => x.direction === "BULLISH"));
    assert.deepStrictEqual(output.bearishEvents,
        output.events.filter(x => x.direction === "BEARISH"));
});
test("latest projections identify final matching events", () => {
    const output = resolve([
        sourceEvent("BULLISH", 3), sourceEvent("BULLISH", 5),
        sourceEvent("BEARISH", 7), sourceEvent("BULLISH", 9)
    ]);
    assert.deepStrictEqual(output.latestEvent, output.events.at(-1));
    assert.deepStrictEqual(output.latestBos, output.bosEvents.at(-1));
    assert.deepStrictEqual(output.latestChoch, output.chochEvents.at(-1));
});
test("latest BOS and CHOCH are null when absent", () => {
    const output = resolve([sourceEvent("BULLISH", 3)]);
    assert.strictEqual(output.latestBos, null);
    assert.strictEqual(output.latestChoch, null);
});
test("resolved event preserves source identity and causality fields", () => {
    const source = sourceEvent("BULLISH", 3);
    const event = resolve([source]).events[0];
    assert.strictEqual(event.sourceEventId, source.id);
    for (const field of [
        "direction", "breakAtIndex", "breakOpenTime", "breakCloseTime",
        "breakClosePrice", "levelType", "levelPrice", "levelCandidateIndex",
        "levelConfirmedAtIndex"
    ]) {
        assert.strictEqual(event[field], source[field], field);
    }
});
test("resolver IDs are stable and market namespaced", () => {
    const first = resolve([sourceEvent("BULLISH", 3)]).events[0].id;
    const second = resolve([sourceEvent("BULLISH", 3)]).events[0].id;
    assert.strictEqual(first, second);
    assert.strictEqual(first.includes("BTCUSDT"), true);
    assert.strictEqual(first.includes("15m"), true);
});
test("different market changes resolver ID", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    const first = resolver.resolveStructure(source).events[0].id;
    source.market = { symbol: "ETHUSDT", interval: "15m" };
    source.events[0].symbol = "ETHUSDT";
    source.bullishEvents[0].symbol = "ETHUSDT";
    source.latestBullishEvent.symbol = "ETHUSDT";
    const second = resolver.resolveStructure(source).events[0].id;
    assert.notStrictEqual(first, second);
});
test("input result is not mutated", () => {
    const source = contractResult([
        sourceEvent("BULLISH", 3), sourceEvent("BEARISH", 5)
    ]);
    const before = clone(source);
    resolver.resolveStructure(source);
    assert.deepStrictEqual(source, before);
});
test("output projections have isolated event clones", () => {
    const output = resolve([
        sourceEvent("BULLISH", 3), sourceEvent("BULLISH", 5)
    ]);
    assert.notStrictEqual(output.events[0], output.initialBreaks[0]);
    assert.notStrictEqual(output.events[1], output.bosEvents[0]);
    assert.notStrictEqual(output.events[0], output.bullishEvents[0]);
    output.events[0].levelPrice = 0;
    assert.strictEqual(output.initialBreaks[0].levelPrice, 10);
    assert.strictEqual(output.bullishEvents[0].levelPrice, 10);
});
test("output mutation does not affect later calls", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    const first = resolver.resolveStructure(source);
    first.events[0].type = "CHOCH";
    first.market.symbol = "X";
    const second = resolver.resolveStructure(source);
    assert.strictEqual(second.events[0].type, "INITIAL_BREAK");
    assert.strictEqual(second.market.symbol, "BTCUSDT");
});
test("repeated calls have deep determinism", () => {
    const source = contractResult([
        sourceEvent("BULLISH", 3), sourceEvent("BEARISH", 5),
        sourceEvent("BEARISH", 7)
    ]);
    assert.deepStrictEqual(
        resolver.resolveStructure(source),
        resolver.resolveStructure(source));
});
test("prefix causality preserves resolved history exactly", () => {
    const first = sourceEvent("BULLISH", 3);
    const second = sourceEvent("BULLISH", 5);
    const prefix = resolve([first]);
    const extended = resolve([first, second]);
    assert.deepStrictEqual(extended.events.slice(0, prefix.events.length), prefix.events);
});
test("duplicate source ID rejects entire result", () => {
    const first = sourceEvent("BULLISH", 3);
    const second = sourceEvent("BULLISH", 5, { id: first.id });
    failed("DUPLICATE_EVENT_ID", contractResult([first, second]));
});
test("descending break index is rejected", () => {
    failed("CHRONOLOGY_VIOLATION", contractResult([
        sourceEvent("BULLISH", 5), sourceEvent("BEARISH", 3)
    ]));
});
test("increasing index with descending time is rejected", () => {
    const second = sourceEvent("BEARISH", 5, {
        breakOpenTime: 2500, breakCloseTime: 2999,
        levelOpenTime: 0, levelCloseTime: 499,
        levelConfirmedAtOpenTime: 500, levelConfirmedAtCloseTime: 1999
    });
    failed("CHRONOLOGY_VIOLATION", contractResult([
        sourceEvent("BULLISH", 3), second
    ]));
});
test("same candle accepts only bullish then bearish", () => {
    const bull = sourceEvent("BULLISH", 3, {
        breakClosePrice: 10, levelPrice: 9
    });
    const bear = sourceEvent("BEARISH", 3, {
        breakClosePrice: 10, levelPrice: 11
    });
    assert.strictEqual(resolve([bull, bear]).valid, true);
    failed("CHRONOLOGY_VIOLATION", contractResult([bear, bull]));
});
test("same index with different candle time is rejected", () => {
    const bull = sourceEvent("BULLISH", 3, {
        breakClosePrice: 10, levelPrice: 9
    });
    const bear = sourceEvent("BEARISH", 3, {
        breakOpenTime: 3001, breakCloseTime: 3999,
        breakClosePrice: 10, levelPrice: 11
    });
    failed("CHRONOLOGY_VIOLATION", contractResult([bull, bear]));
});
test("null array and malformed result are invalid", () => {
    for (const source of [null, [], {}, { valid: true }]) {
        failed("INVALID_INPUT_RESULT", source);
    }
    const source = contractResult([]);
    source.events = null;
    failed("INVALID_INPUT_RESULT", source);
});
test("upstream invalid status is rejected", () => {
    const source = contractResult([]);
    source.valid = false;
    failed("INVALID_INPUT_RESULT", source);
});
test("non-boolean ready is rejected", () => {
    const source = contractResult([]);
    source.ready = 1;
    failed("INVALID_INPUT_RESULT", source);
});
test("source schema mismatch is rejected", () => {
    const source = contractResult([]);
    source.schemaVersion = "HND_STRUCTURE_EVENT_V2";
    failed("SCHEMA_VERSION_MISMATCH", source);
});
test("missing market is rejected", () => {
    const source = contractResult([]);
    source.market = null;
    failed("MARKET_MISSING", source);
});
test("unclean market is rejected instead of normalized", () => {
    const source = contractResult([]);
    source.market.symbol = " btcusdt ";
    failed("MARKET_MISSING", source);
});
test("event count mismatch is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.eventCount = 0;
    failed("EVENT_ARRAY_PROJECTION_MISMATCH", source);
});
test("source break count mismatch is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.sourceBreakCount = 2;
    failed("EVENT_ARRAY_PROJECTION_MISMATCH", source);
});
test("bullish projection tampering is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.bullishEvents = [];
    failed("EVENT_ARRAY_PROJECTION_MISMATCH", source);
});
test("bearish projection tampering is rejected", () => {
    const source = contractResult([sourceEvent("BEARISH", 3)]);
    source.bearishEvents[0].levelPrice = 99;
    failed("EVENT_ARRAY_PROJECTION_MISMATCH", source);
});
test("latest bullish projection tampering is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.latestBullishEvent = null;
    failed("LATEST_EVENT_PROJECTION_MISMATCH", source);
});
test("latest bearish projection tampering is rejected", () => {
    const source = contractResult([]);
    source.latestBearishEvent = sourceEvent("BEARISH", 3);
    failed("LATEST_EVENT_PROJECTION_MISMATCH", source);
});
test("unconfirmed event is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].status = "PENDING";
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("wrong event kind is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].kind = "SWING";
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("event schema mismatch is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].schemaVersion = "HND_STRUCTURE_EVENT_V2";
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("event market mismatch is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].symbol = "ETHUSDT";
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("invalid direction is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].direction = "SIDEWAYS";
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("bullish break type contradiction is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].breakType = "BREAK_BELOW_SWING_LOW";
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("bearish level type contradiction is rejected", () => {
    const source = contractResult([sourceEvent("BEARISH", 3)]);
    source.events[0].levelType = "SWING_HIGH";
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("classification contradiction is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].levelClassification = "LOWER_LOW";
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("candidate confirmation break causality is enforced", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].levelConfirmedAtIndex = 3;
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("timestamp causality is enforced", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].levelConfirmedAtCloseTime = 3000;
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("non-finite price is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].levelPrice = Infinity;
    source.bullishEvents[0].levelPrice = Infinity;
    source.latestBullishEvent.levelPrice = Infinity;
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("bullish close must exceed level", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].breakClosePrice = 10;
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("bearish close must be below level", () => {
    const source = contractResult([sourceEvent("BEARISH", 3)]);
    source.events[0].breakClosePrice = 10;
    rebuildProjections(source);
    failed("EVENT_CONTRACT_CONFLICT", source);
});
test("missing top-level field is rejected", () => {
    const source = contractResult([]);
    delete source.eventCount;
    failed("INVALID_INPUT_RESULT", source);
});
test("extra top-level field is rejected", () => {
    const source = contractResult([]);
    source.extra = true;
    failed("INVALID_INPUT_RESULT", source);
});
test("missing event field is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    delete source.events[0].levelPrice;
    rebuildProjections(source);
    failed("EVENT_ARRAY_PROJECTION_MISMATCH", source);
});
test("extra event field is rejected", () => {
    const source = contractResult([sourceEvent("BULLISH", 3)]);
    source.events[0].openCandle = true;
    rebuildProjections(source);
    failed("EVENT_ARRAY_PROJECTION_MISMATCH", source);
});
test("all failures share one stable fail-closed schema", () => {
    const expectedKeys = [
        "valid", "error", "ready", "schemaVersion", "market",
        "sourceEventCount", "resolvedEventCount", "initialRegime",
        "currentRegime", "events", "initialBreaks", "bosEvents",
        "chochEvents", "bullishEvents", "bearishEvents", "latestEvent",
        "latestBos", "latestChoch"
    ].sort();
    const failures = [
        resolver.resolveStructure(null),
        resolver.resolveStructure(Object.assign(contractResult([]), {
            schemaVersion: "X"
        })),
        resolver.resolveStructure(Object.assign(contractResult([]), {
            market: null
        }))
    ];
    failures.forEach(output => {
        assert.deepStrictEqual(Object.keys(output).sort(), expectedKeys);
        assert.strictEqual(output.schemaVersion, "HND_BOS_CHOCH_RESOLVER_V1");
        assert.strictEqual(output.sourceEventCount, 0);
        assert.strictEqual(output.resolvedEventCount, 0);
    });
});
test("failure after a valid prefix exposes no partial classification", () => {
    const source = contractResult([
        sourceEvent("BULLISH", 3), sourceEvent("BEARISH", 5)
    ]);
    source.events[1].breakType = "BREAK_ABOVE_SWING_HIGH";
    rebuildProjections(source);
    const output = failed("EVENT_CONTRACT_CONFLICT", source);
    assert.deepStrictEqual(output.events, []);
});
test("production module has no raw candle or live integration capabilities", () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/bosChochResolver.js"), "utf8");
    for (const token of [
        "structureBreakDetector", "detectBreaks(", "buildStructureEvents(",
        "normalizeCandles(", "rawCandles", "isClosed", "require(",
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
        console.error("HND_BOS_CHOCH_RESOLVER_TEST_FAILED:" + item.name);
        console.error(error.stack || error);
        process.exitCode = 1;
        break;
    }
}
if (passed === tests.length) {
    console.log("HND_BOS_CHOCH_RESOLVER_TESTS_PASS:" + tests.length);
}
