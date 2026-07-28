"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const contract = require("../../js/hndai-v1/structureEventContract.js");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function bullish(overrides) {
    return Object.assign({
        type: "BREAK_ABOVE_SWING_HIGH", direction: "BULLISH",
        breakAtIndex: 3, breakOpenTime: 3000, breakCloseTime: 3999,
        breakClosePrice: 13, levelType: "SWING_HIGH",
        levelClassification: "INITIAL_HIGH", levelCandidateIndex: 1,
        levelOpenTime: 1000, levelCloseTime: 1999, levelPrice: 12,
        levelConfirmedAtIndex: 2, levelConfirmedAtOpenTime: 2000,
        levelConfirmedAtCloseTime: 2999
    }, overrides);
}
function bearish(overrides) {
    return Object.assign({
        type: "BREAK_BELOW_SWING_LOW", direction: "BEARISH",
        breakAtIndex: 7, breakOpenTime: 7000, breakCloseTime: 7999,
        breakClosePrice: 2, levelType: "SWING_LOW",
        levelClassification: "LOWER_LOW", levelCandidateIndex: 5,
        levelOpenTime: 5000, levelCloseTime: 5999, levelPrice: 3,
        levelConfirmedAtIndex: 6, levelConfirmedAtOpenTime: 6000,
        levelConfirmedAtCloseTime: 6999
    }, overrides);
}
function result(items, ready) {
    const breaks = items || [];
    const bulls = breaks.filter(x => x.direction === "BULLISH").map(clone);
    const bears = breaks.filter(x => x.direction === "BEARISH").map(clone);
    return {
        valid: true, ready: ready === undefined ? true : ready,
        breaks: breaks.map(clone), bullishBreaks: bulls, bearishBreaks: bears,
        latestBullishBreak: bulls.length ? clone(bulls.at(-1)) : null,
        latestBearishBreak: bears.length ? clone(bears.at(-1)) : null
    };
}
function build(source, market) {
    return contract.buildStructureEvents(
        source,
        market || { symbol: " btcusdt ", interval: " 15m " }
    );
}
function expectAlignment(mutator, seed) {
    const source = result([seed ? seed() : bullish()]);
    mutator(source.breaks[0]);
    source.bullishBreaks = source.breaks.filter(x => x.direction === "BULLISH").map(clone);
    source.bearishBreaks = source.breaks.filter(x => x.direction === "BEARISH").map(clone);
    source.latestBullishBreak = source.bullishBreaks.length
        ? clone(source.bullishBreaks.at(-1)) : null;
    source.latestBearishBreak = source.bearishBreaks.length
        ? clone(source.bearishBreaks.at(-1)) : null;
    const output = build(source);
    assert.strictEqual(output.valid, false);
    assert.strictEqual(output.error, "STRUCTURE_BREAK_ALIGNMENT_ERROR");
    assert.deepStrictEqual(output.events, []);
}

test("public API and exact schema version", () => {
    assert.deepStrictEqual(Object.keys(contract).sort(),
        ["buildStructureEvents", "getSchemaVersion", "getVocabulary"]);
    assert.strictEqual(contract.getSchemaVersion(), "HND_STRUCTURE_EVENT_V1");
});
test("vocabulary is exact and independently cloned", () => {
    const expected = {
        schemaVersions: ["HND_STRUCTURE_EVENT_V1"], kinds: ["STRUCTURE_BREAK"],
        statuses: ["CONFIRMED"], directions: ["BULLISH", "BEARISH"],
        breakTypes: ["BREAK_ABOVE_SWING_HIGH", "BREAK_BELOW_SWING_LOW"],
        levelTypes: ["SWING_HIGH", "SWING_LOW"]
    };
    assert.deepStrictEqual(contract.getVocabulary(), expected);
    const first = contract.getVocabulary();
    first.directions.push("X");
    assert.deepStrictEqual(contract.getVocabulary(), expected);
});
test("valid empty result remains ready and empty", () => {
    const output = build(result([]));
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.ready, true);
    assert.strictEqual(output.sourceBreakCount, 0);
    assert.strictEqual(output.eventCount, 0);
    assert.deepStrictEqual(output.events, []);
    assert.strictEqual(output.latestBullishEvent, null);
});
test("bullish conversion transfers every contract field", () => {
    const source = bullish();
    const event = build(result([source])).events[0];
    assert.deepStrictEqual(event, {
        id: event.id, schemaVersion: "HND_STRUCTURE_EVENT_V1",
        kind: "STRUCTURE_BREAK", status: "CONFIRMED",
        symbol: "BTCUSDT", interval: "15m", direction: source.direction,
        breakType: source.type, breakAtIndex: source.breakAtIndex,
        breakOpenTime: source.breakOpenTime, breakCloseTime: source.breakCloseTime,
        breakClosePrice: source.breakClosePrice, levelType: source.levelType,
        levelClassification: source.levelClassification,
        levelCandidateIndex: source.levelCandidateIndex,
        levelOpenTime: source.levelOpenTime, levelCloseTime: source.levelCloseTime,
        levelPrice: source.levelPrice,
        levelConfirmedAtIndex: source.levelConfirmedAtIndex,
        levelConfirmedAtOpenTime: source.levelConfirmedAtOpenTime,
        levelConfirmedAtCloseTime: source.levelConfirmedAtCloseTime
    });
});
test("bearish conversion and directional projections", () => {
    const output = build(result([bullish(), bearish()]));
    assert.strictEqual(output.eventCount, 2);
    assert.deepStrictEqual(output.bullishEvents, [output.events[0]]);
    assert.deepStrictEqual(output.bearishEvents, [output.events[1]]);
    assert.deepStrictEqual(output.latestBullishEvent, output.events[0]);
    assert.deepStrictEqual(output.latestBearishEvent, output.events[1]);
});
test("symbol uppercase trim and interval trim", () => {
    const output = build(result([]), { symbol: " ethusdt ", interval: " 1h " });
    assert.deepStrictEqual(output.market, { symbol: "ETHUSDT", interval: "1h" });
});
test("missing market context fails closed", () => {
    assert.strictEqual(contract.buildStructureEvents(result([])).error,
        "INVALID_MARKET_CONTEXT");
});
test("empty symbol and non-string interval fail closed", () => {
    assert.strictEqual(build(result([]), { symbol: " ", interval: "1m" }).error,
        "INVALID_MARKET_CONTEXT");
    assert.strictEqual(build(result([]), { symbol: "BTC", interval: 15 }).error,
        "INVALID_MARKET_CONTEXT");
});
test("invalid upstream object fails closed", () => {
    for (const value of [null, [], {}, { valid: false }]) {
        assert.strictEqual(build(value).error, "STRUCTURE_BREAK_RESULT_INVALID");
    }
});
test("upstream valid ready and array contracts are required", () => {
    const source = result([]);
    delete source.ready;
    assert.strictEqual(build(source).error, "STRUCTURE_BREAK_RESULT_INVALID");
    assert.strictEqual(build(Object.assign(result([]), { breaks: null })).error,
        "STRUCTURE_BREAK_RESULT_INVALID");
});
test("bullish filtered array must match canonical breaks", () => {
    const source = result([bullish()]);
    source.bullishBreaks = [];
    assert.strictEqual(build(source).error, "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("bearish filtered array must match canonical breaks", () => {
    const source = result([bearish()]);
    source.bearishBreaks[0].levelPrice = 99;
    assert.strictEqual(build(source).error, "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("latest fields must match last directional breaks", () => {
    const source = result([bullish(), bearish()]);
    source.latestBullishBreak = null;
    assert.strictEqual(build(source).error, "STRUCTURE_BREAK_ALIGNMENT_ERROR");
    const source2 = result([]);
    source2.latestBearishBreak = bearish();
    assert.strictEqual(build(source2).error, "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("bullish direction type contradiction is rejected", () =>
    expectAlignment(x => { x.type = "BREAK_BELOW_SWING_LOW"; }));
test("bearish direction level contradiction is rejected", () =>
    expectAlignment(x => { x.levelType = "SWING_HIGH"; }, bearish));
test("high level with low classification is rejected", () =>
    expectAlignment(x => { x.levelClassification = "LOWER_LOW"; }));
test("low level with high classification is rejected", () =>
    expectAlignment(x => { x.levelClassification = "HIGHER_HIGH"; }, bearish));
test("whitespace classification is rejected", () =>
    expectAlignment(x => { x.levelClassification = "   "; }));
test("candidate must precede confirmation", () =>
    expectAlignment(x => { x.levelConfirmedAtIndex = x.levelCandidateIndex; }));
test("confirmation must precede break", () =>
    expectAlignment(x => { x.breakAtIndex = x.levelConfirmedAtIndex; }));
test("negative and unsafe indices are rejected", () => {
    expectAlignment(x => { x.levelCandidateIndex = -1; });
    expectAlignment(x => { x.breakAtIndex = Number.MAX_SAFE_INTEGER + 1; });
});
test("candidate time chain must move forward", () =>
    expectAlignment(x => { x.levelCloseTime = x.levelConfirmedAtOpenTime; }));
test("confirmation time chain must move forward", () =>
    expectAlignment(x => { x.levelConfirmedAtCloseTime = x.breakOpenTime; }));
test("each open time must not follow its own close", () =>
    expectAlignment(x => { x.breakCloseTime = x.breakOpenTime - 1; }));
test("non-finite times are rejected", () =>
    expectAlignment(x => { x.breakOpenTime = Infinity; }));
test("fractional timestamp is rejected", () =>
    expectAlignment(x => { x.levelConfirmedAtOpenTime = 2000.5; }));
test("negative timestamp is rejected", () =>
    expectAlignment(x => { x.levelOpenTime = -1; }));
test("open time equal to close time is rejected", () =>
    expectAlignment(x => { x.breakCloseTime = x.breakOpenTime; }));
test("non-finite prices are rejected", () =>
    expectAlignment(x => { x.levelPrice = NaN; }));
test("bullish close must be strictly above level", () => {
    expectAlignment(x => { x.breakClosePrice = x.levelPrice; });
    expectAlignment(x => { x.breakClosePrice = x.levelPrice - 1; });
});
test("bearish close must be strictly below level", () => {
    expectAlignment(x => { x.breakClosePrice = x.levelPrice; }, bearish);
    expectAlignment(x => { x.breakClosePrice = x.levelPrice + 1; }, bearish);
});
test("wick fields cannot rescue an equal close", () => {
    const source = bullish({ breakClosePrice: 12, high: 20 });
    expectAlignment(x => { x.breakClosePrice = 12; }, () => source);
});
test("canonical event order rejects descending break indices", () => {
    const source = result([bearish(), bullish()]);
    assert.strictEqual(build(source).error, "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("increasing index with decreasing break time is rejected", () => {
    const second = bearish({
        breakAtIndex: 7, breakOpenTime: 2500, breakCloseTime: 2999,
        levelCandidateIndex: 0, levelOpenTime: 0, levelCloseTime: 499,
        levelConfirmedAtIndex: 1, levelConfirmedAtOpenTime: 500,
        levelConfirmedAtCloseTime: 1999
    });
    assert.strictEqual(build(result([bullish(), second])).error,
        "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("increasing index with equal break time is rejected", () => {
    const second = bearish({
        breakAtIndex: 7, breakOpenTime: 3000, breakCloseTime: 3999,
        levelCandidateIndex: 1, levelOpenTime: 1000, levelCloseTime: 1999,
        levelConfirmedAtIndex: 2, levelConfirmedAtOpenTime: 2000,
        levelConfirmedAtCloseTime: 2999
    });
    assert.strictEqual(build(result([bullish(), second])).error,
        "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("same-index canonical order is bullish before bearish", () => {
    const bear = bearish({
        breakAtIndex: 3, breakOpenTime: 3000, breakCloseTime: 3999,
        breakClosePrice: 13, levelPrice: 14,
        levelCandidateIndex: 1, levelOpenTime: 1000, levelCloseTime: 1999,
        levelConfirmedAtIndex: 2, levelConfirmedAtOpenTime: 2000,
        levelConfirmedAtCloseTime: 2999
    });
    assert.strictEqual(build(result([bear, bullish()])).error,
        "STRUCTURE_BREAK_ALIGNMENT_ERROR");
    assert.strictEqual(build(result([bullish(), bear])).valid, true);
});
test("same index with different open time is rejected", () => {
    const bear = bearish({
        breakAtIndex: 3, breakOpenTime: 3001, breakCloseTime: 3999,
        levelCandidateIndex: 1, levelOpenTime: 1000, levelCloseTime: 1999,
        levelConfirmedAtIndex: 2, levelConfirmedAtOpenTime: 2000,
        levelConfirmedAtCloseTime: 2999
    });
    assert.strictEqual(build(result([bullish(), bear])).error,
        "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("same index with different close time is rejected", () => {
    const bear = bearish({
        breakAtIndex: 3, breakOpenTime: 3000, breakCloseTime: 4000,
        levelCandidateIndex: 1, levelOpenTime: 1000, levelCloseTime: 1999,
        levelConfirmedAtIndex: 2, levelConfirmedAtOpenTime: 2000,
        levelConfirmedAtCloseTime: 2999
    });
    assert.strictEqual(build(result([bullish(), bear])).error,
        "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("same index with different close price is rejected", () => {
    const bear = bearish({
        breakAtIndex: 3, breakOpenTime: 3000, breakCloseTime: 3999,
        breakClosePrice: 2, levelPrice: 3,
        levelCandidateIndex: 1, levelOpenTime: 1000, levelCloseTime: 1999,
        levelConfirmedAtIndex: 2, levelConfirmedAtOpenTime: 2000,
        levelConfirmedAtCloseTime: 2999
    });
    assert.strictEqual(build(result([bullish(), bear])).error,
        "STRUCTURE_BREAK_ALIGNMENT_ERROR");
});
test("same index same candle and canonical direction remains valid", () => {
    const bull = bullish({ breakClosePrice: 5, levelPrice: 4 });
    const bear = bearish({
        breakAtIndex: 3, breakOpenTime: 3000, breakCloseTime: 3999,
        breakClosePrice: 5, levelPrice: 6,
        levelCandidateIndex: 1, levelOpenTime: 1000, levelCloseTime: 1999,
        levelConfirmedAtIndex: 2, levelConfirmedAtOpenTime: 2000,
        levelConfirmedAtCloseTime: 2999
    });
    const output = build(result([bull, bear]));
    assert.strictEqual(output.valid, true);
    assert.deepStrictEqual(output.events.map(x => x.direction),
        ["BULLISH", "BEARISH"]);
});
test("duplicate deterministic IDs reject the whole result", () => {
    const second = bullish({ breakAtIndex: 4, breakCloseTime: 4999 });
    const output = build(result([bullish(), second]));
    assert.strictEqual(output.error, "DUPLICATE_STRUCTURE_EVENT");
    assert.strictEqual(output.eventCount, 0);
    assert.deepStrictEqual(output.events, []);
});
test("stable ID is deterministic", () => {
    assert.strictEqual(build(result([bullish()])).events[0].id,
        build(result([bullish()])).events[0].id);
});
test("symbol interval and event changes alter ID", () => {
    const base = build(result([bullish()])).events[0].id;
    assert.notStrictEqual(base,
        build(result([bullish()]), { symbol: "ETHUSDT", interval: "15m" }).events[0].id);
    assert.notStrictEqual(base,
        build(result([bullish()]), { symbol: "BTCUSDT", interval: "1h" }).events[0].id);
    assert.notStrictEqual(base,
        build(result([bullish({ breakOpenTime: 4000, breakCloseTime: 4999 })])).events[0].id);
});
test("input result and market context are not mutated", () => {
    const source = result([bullish()]);
    const market = { symbol: " btcusdt ", interval: " 15m " };
    const beforeSource = clone(source);
    const beforeMarket = clone(market);
    build(source, market);
    assert.deepStrictEqual(source, beforeSource);
    assert.deepStrictEqual(market, beforeMarket);
});
test("output references are isolated from upstream and sibling projections", () => {
    const source = result([bullish()]);
    const output = build(source);
    assert.notStrictEqual(output.events[0], source.breaks[0]);
    assert.notStrictEqual(output.events[0], output.bullishEvents[0]);
    output.events[0].levelPrice = 0;
    assert.strictEqual(output.bullishEvents[0].levelPrice, 12);
    assert.strictEqual(source.breaks[0].levelPrice, 12);
});
test("repeated calls are deeply equal", () => {
    const source = result([bullish(), bearish()]);
    assert.deepStrictEqual(build(source), build(source));
});
test("prefix causality preserves prior events and IDs", () => {
    const prefix = build(result([bullish()]));
    const extended = build(result([bullish(), bearish()]));
    assert.deepStrictEqual(extended.events.slice(0, prefix.events.length), prefix.events);
});
test("failure never exposes partial events", () => {
    const source = result([bullish(), bearish({ breakClosePrice: 3 })]);
    const output = build(source);
    assert.strictEqual(output.valid, false);
    assert.strictEqual(output.eventCount, 0);
    assert.deepStrictEqual(output.bullishEvents, []);
    assert.deepStrictEqual(output.bearishEvents, []);
    assert.strictEqual(output.latestBullishEvent, null);
});
test("production module does not call detector or forbidden capabilities", () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, "../../js/hndai-v1/structureEventContract.js"), "utf8");
    for (const token of [
        "structureBreakDetector", "detectBreaks(", "require(",
        "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage",
        "Date.now", "new Date", "Math.random", "setTimeout", "setInterval", "console."
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
        console.error("HND_STRUCTURE_EVENT_CONTRACT_TEST_FAILED:" + item.name);
        console.error(error.stack || error);
        process.exitCode = 1;
        break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_EVENT_CONTRACT_TESTS_PASS:" + tests.length);
}
