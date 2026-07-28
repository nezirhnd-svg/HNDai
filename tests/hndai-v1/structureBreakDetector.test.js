"use strict";

const assert = require("assert");
const path = require("path");
const detectorPath = path.resolve(__dirname, "../../js/hndai-v1/structureBreakDetector.js");
const sequencePath = path.resolve(__dirname, "../../js/hndai-v1/swingSequence.js");
const normalizerPath = path.resolve(__dirname, "../../js/hndai-v1/candleNormalizer.js");
const detector = require(detectorPath);
const tests = [];

function test(name, fn) { tests.push({ name, fn }); }
function candle(index, close, high, low, closeTime) {
    return {
        openTime: index * 1000,
        closeTime: closeTime === undefined ? index * 1000 + 999 : closeTime,
        open: close,
        high: high === undefined ? close + 1 : high,
        low: low === undefined ? close - 1 : low,
        close: close,
        volume: 10
    };
}
function run(candles, options) {
    return detector.detectBreaks(
        candles,
        Object.assign({ nowMs: 999999, leftBars: 1, rightBars: 1 }, options)
    );
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function withSequenceResult(sequenceResult, rawCandles) {
    const originalSequence = require.cache[sequencePath];
    const originalDetector = require.cache[detectorPath];
    delete require.cache[detectorPath];
    require.cache[sequencePath] = {
        id: sequencePath,
        filename: sequencePath,
        loaded: true,
        exports: { classifySwings: function () { return clone(sequenceResult); } }
    };
    try {
        return require(detectorPath).detectBreaks(rawCandles, {
            nowMs: 999999,
            leftBars: 1,
            rightBars: 1
        });
    } finally {
        delete require.cache[detectorPath];
        if (originalDetector) { require.cache[detectorPath] = originalDetector; }
        if (originalSequence) { require.cache[sequencePath] = originalSequence; }
        else { delete require.cache[sequencePath]; }
    }
}
function alignedSequence(candles, events) {
    return {
        valid: true,
        ready: true,
        config: { leftBars: 1, rightBars: 1 },
        sourceCandleCount: candles.length,
        closedCandleCount: candles.length,
        excludedOpenCandleCount: 0,
        duplicateOpenTimeCount: 0,
        openTimes: candles.map(function (item) { return item.openTime; }),
        events: events
    };
}
function swing(candles, type, candidateIndex, confirmedAtIndex, classification, previous) {
    return {
        type: type,
        classification: classification,
        candidateIndex: candidateIndex,
        openTime: candles[candidateIndex].openTime,
        closeTime: candles[candidateIndex].closeTime,
        price: type === "SWING_HIGH"
            ? candles[candidateIndex].high : candles[candidateIndex].low,
        confirmedAtIndex: confirmedAtIndex,
        confirmedAtOpenTime: candles[confirmedAtIndex].openTime,
        confirmedAtCloseTime: candles[confirmedAtIndex].closeTime,
        previousSameTypeCandidateIndex: previous ? previous.candidateIndex : null,
        previousSameTypePrice: previous ? previous.price : null
    };
}

const high = [
    candle(0, 5, 6, 4),
    candle(1, 10, 12, 3),
    candle(2, 6, 7, 4),
    candle(3, 13, 14, 12)
];
const low = [
    candle(0, 10, 11, 9),
    candle(1, 5, 12, 3),
    candle(2, 9, 10, 8),
    candle(3, 2, 3, 1)
];

test("public vocabulary and API are stable", function () {
    assert.deepStrictEqual(Object.keys(detector).sort(), ["detectBreaks", "getVocabulary"]);
    assert.deepStrictEqual(detector.getVocabulary(), {
        breakTypes: ["BREAK_ABOVE_SWING_HIGH", "BREAK_BELOW_SWING_LOW"],
        directions: ["BULLISH", "BEARISH"],
        levelTypes: ["SWING_HIGH", "SWING_LOW"]
    });
    assert.notStrictEqual(detector.getVocabulary(), detector.getVocabulary());
});
test("invalid sequence dependency result fails closed", function () {
    assert.strictEqual(run(null).error, "SWING_SEQUENCE_FAILED");
});
test("empty closed history is valid and has no latest event", function () {
    const result = run([]);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.breaks, []);
    assert.strictEqual(result.latestBullishBreak, null);
    assert.strictEqual(result.latestBearishBreak, null);
});
test("bullish close above confirmed swing high emits exact aligned event", function () {
    const result = run(high);
    assert.strictEqual(result.bullishBreaks.length, 1);
    assert.deepStrictEqual(result.bullishBreaks[0], {
        type: "BREAK_ABOVE_SWING_HIGH",
        direction: "BULLISH",
        breakAtIndex: 3,
        breakOpenTime: 3000,
        breakCloseTime: 3999,
        breakClosePrice: 13,
        levelType: "SWING_HIGH",
        levelClassification: "INITIAL_HIGH",
        levelCandidateIndex: 1,
        levelOpenTime: 1000,
        levelCloseTime: 1999,
        levelPrice: 12,
        levelConfirmedAtIndex: 2,
        levelConfirmedAtOpenTime: 2000,
        levelConfirmedAtCloseTime: 2999
    });
});
test("bearish close below confirmed swing low emits exact aligned event", function () {
    const result = run(low);
    assert.strictEqual(result.bearishBreaks.length, 1);
    assert.strictEqual(result.bearishBreaks[0].breakAtIndex, 3);
    assert.strictEqual(result.bearishBreaks[0].levelCandidateIndex, 1);
    assert.strictEqual(result.bearishBreaks[0].levelConfirmedAtIndex, 2);
    assert.strictEqual(result.bearishBreaks[0].breakClosePrice, 2);
});
test("classification history carries higher and lower high labels into breaks", function () {
    const series = [
        candle(0, 5, 6, 4), candle(1, 9, 10, 3), candle(2, 6, 7, 4),
        candle(3, 8, 9, 5), candle(4, 6, 7, 4), candle(5, 10, 11, 8),
        candle(6, 7, 8, 5), candle(7, 12, 13, 11)
    ];
    const result = run(series);
    assert.deepStrictEqual(
        result.bullishBreaks.map(function (item) { return item.levelClassification; }),
        ["LOWER_HIGH", "HIGHER_HIGH"]
    );
});
test("classification history carries lower and higher low labels into breaks", function () {
    const series = [
        candle(0, 10, 11, 9), candle(1, 6, 12, 5), candle(2, 9, 10, 8),
        candle(3, 7, 9, 6), candle(4, 10, 11, 9), candle(5, 5, 6, 4)
    ];
    const result = run(series);
    assert.deepStrictEqual(
        result.bearishBreaks.map(function (item) { return item.levelClassification; }),
        ["HIGHER_LOW"]
    );
});
test("confirmation candle cannot break the level it confirms", function () {
    assert.strictEqual(run(high.slice(0, 3)).breaks.length, 0);
    assert.strictEqual(run(low.slice(0, 3)).breaks.length, 0);
});
test("candidate time and confirmation time remain distinct and causal", function () {
    const event = run(high).bullishBreaks[0];
    assert.ok(event.levelCandidateIndex < event.levelConfirmedAtIndex);
    assert.ok(event.levelConfirmedAtIndex < event.breakAtIndex);
    assert.ok(event.levelOpenTime < event.levelConfirmedAtOpenTime);
    assert.ok(event.levelConfirmedAtOpenTime < event.breakOpenTime);
});
test("equal bullish close is not a break", function () {
    assert.strictEqual(
        run(high.slice(0, 3).concat([candle(3, 12, 13, 11)])).bullishBreaks.length,
        0
    );
});
test("equal bearish close is not a break", function () {
    assert.strictEqual(
        run(low.slice(0, 3).concat([candle(3, 3, 4, 2)])).bearishBreaks.length,
        0
    );
});
test("wick above without close above is forbidden", function () {
    assert.strictEqual(
        run(high.slice(0, 3).concat([candle(3, 11, 20, 10)])).bullishBreaks.length,
        0
    );
});
test("wick below without close below is forbidden", function () {
    assert.strictEqual(
        run(low.slice(0, 3).concat([candle(3, 4, 5, 0)])).bearishBreaks.length,
        0
    );
});
test("a high level is one-shot after its first close break", function () {
    const result = run(high.concat([candle(4, 14, 15, 13), candle(5, 15, 16, 14)]));
    assert.strictEqual(result.bullishBreaks.length, 1);
    assert.strictEqual(result.bullishBreaks[0].breakAtIndex, 3);
});
test("a low level is one-shot after its first close break", function () {
    const result = run(low.concat([candle(4, 1, 2, 0), candle(5, 0, 1, -1)]));
    assert.strictEqual(result.bearishBreaks.length, 1);
    assert.strictEqual(result.bearishBreaks[0].breakAtIndex, 3);
});
test("breaks are globally ordered by candle index", function () {
    const series = high.concat([
        candle(4, 10, 11, 8), candle(5, 6, 12, 5),
        candle(6, 9, 10, 8), candle(7, 4, 5, 3)
    ]);
    const result = run(series);
    assert.ok(result.breaks.length >= 2);
    result.breaks.forEach(function (item, index) {
        if (index) { assert.ok(result.breaks[index - 1].breakAtIndex <= item.breakAtIndex); }
    });
});
test("bullish and bearish projections preserve global event identity", function () {
    const bullish = run(high);
    const bearish = run(low);
    assert.deepStrictEqual(bullish.breaks[0], bullish.bullishBreaks[0]);
    assert.deepStrictEqual(bearish.breaks[0], bearish.bearishBreaks[0]);
    assert.notStrictEqual(bullish.breaks[0], bullish.bullishBreaks[0]);
    assert.notStrictEqual(bearish.breaks[0], bearish.bearishBreaks[0]);
});
test("latest events equal the last directional event but are isolated clones", function () {
    const bullish = run(high);
    const bearish = run(low);
    assert.deepStrictEqual(bullish.latestBullishBreak, bullish.bullishBreaks.at(-1));
    assert.deepStrictEqual(bearish.latestBearishBreak, bearish.bearishBreaks.at(-1));
    assert.notStrictEqual(bullish.latestBullishBreak, bullish.bullishBreaks.at(-1));
    assert.notStrictEqual(bearish.latestBearishBreak, bearish.bearishBreaks.at(-1));
});
test("future open candle is excluded and cannot create a break", function () {
    const openBreak = candle(3, 13, 14, 12, 1000000);
    const result = run(high.slice(0, 3).concat([openBreak]));
    assert.strictEqual(result.excludedOpenCandleCount, 1);
    assert.strictEqual(result.closedCandleCount, 3);
    assert.deepStrictEqual(result.breaks, []);
});
test("raw isClosed cannot force a future candle closed", function () {
    const openBreak = Object.assign(candle(3, 13, 14, 12, 1000000), { isClosed: true });
    assert.deepStrictEqual(run(high.slice(0, 3).concat([openBreak])).breaks, []);
});
test("duplicate open time uses the final candle and reports the duplicate", function () {
    const duplicate = high.slice(0, 3).concat([
        candle(3, 11, 20, 10),
        candle(3, 13, 14, 12)
    ]);
    const result = run(duplicate);
    assert.strictEqual(result.duplicateOpenTimeCount, 1);
    assert.strictEqual(result.sourceCandleCount, 4);
    assert.strictEqual(result.bullishBreaks.length, 1);
    assert.strictEqual(result.bullishBreaks[0].breakClosePrice, 13);
});
test("unsorted raw input normalizes to identical chronological output", function () {
    assert.deepStrictEqual(run([high[3], high[1], high[0], high[2]]), run(high));
});
test("input candles and options are never mutated", function () {
    const candles = clone(high);
    const options = { nowMs: 999999, leftBars: 1, rightBars: 1 };
    const beforeCandles = clone(candles);
    const beforeOptions = clone(options);
    detector.detectBreaks(candles, options);
    assert.deepStrictEqual(candles, beforeCandles);
    assert.deepStrictEqual(options, beforeOptions);
});
test("output mutation cannot affect later calls", function () {
    const first = run(high);
    first.openTimes[0] = -1;
    first.breaks[0].breakClosePrice = -1;
    first.bullishBreaks.length = 0;
    assert.deepStrictEqual(run(high), run(high));
    assert.strictEqual(run(high).breaks[0].breakClosePrice, 13);
});
test("same input is deeply deterministic", function () {
    const expected = JSON.stringify(run(high));
    for (let index = 0; index < 25; index += 1) {
        assert.strictEqual(JSON.stringify(run(high)), expected);
    }
});
test("prefix causality preserves every already emitted break", function () {
    const wave = Array.from({ length: 150 }, function (_, index) {
        return candle(
            index,
            100 + Math.sin(index / 4) * 10,
            112 + Math.sin(index / 4) * 10,
            88 + Math.sin(index / 4) * 10
        );
    });
    for (let size = 20; size < wave.length; size += 7) {
        const prefix = run(wave.slice(0, size)).breaks;
        const extended = run(wave.slice(0, size + 1)).breaks;
        assert.deepStrictEqual(extended.slice(0, prefix.length), prefix);
    }
});
test("appending an open future candle preserves the complete closed result", function () {
    const future = candle(4, 1, 20, 0, 1000000);
    const extended = run(high.concat([future]));
    assert.deepStrictEqual(extended.breaks, run(high).breaks);
    assert.deepStrictEqual(extended.openTimes, run(high).openTimes);
});
test("break event schema remains exact", function () {
    assert.deepStrictEqual(Object.keys(run(high).breaks[0]), [
        "type", "direction", "breakAtIndex", "breakOpenTime", "breakCloseTime",
        "breakClosePrice", "levelType", "levelClassification", "levelCandidateIndex",
        "levelOpenTime", "levelCloseTime", "levelPrice", "levelConfirmedAtIndex",
        "levelConfirmedAtOpenTime", "levelConfirmedAtCloseTime"
    ]);
});
test("misaligned sequence open times fail closed", function () {
    const event = swing(high, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    const source = alignedSequence(high, [event]);
    source.openTimes[1] = 12345;
    assert.strictEqual(withSequenceResult(source, high).error, "INTERNAL_ALIGNMENT_ERROR");
});
test("misaligned candidate close time fails closed", function () {
    const event = swing(high, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    event.closeTime += 1;
    assert.strictEqual(
        withSequenceResult(alignedSequence(high, [event]), high).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("misaligned confirmation close time fails closed", function () {
    const event = swing(high, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    event.confirmedAtCloseTime += 1;
    assert.strictEqual(
        withSequenceResult(alignedSequence(high, [event]), high).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("candidate after confirmation fails closed", function () {
    const event = swing(high, "SWING_HIGH", 2, 1, "INITIAL_HIGH", null);
    assert.strictEqual(
        withSequenceResult(alignedSequence(high, [event]), high).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("confirmation index equal to candidate index fails closed", function () {
    const event = swing(high, "SWING_HIGH", 1, 1, "INITIAL_HIGH", null);
    assert.strictEqual(
        withSequenceResult(alignedSequence(high, [event]), high).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("swing high price unequal to candidate high fails closed", function () {
    const event = swing(high, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    event.price = high[1].high - 1;
    assert.strictEqual(
        withSequenceResult(alignedSequence(high, [event]), high).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("swing low price unequal to candidate low fails closed", function () {
    const event = swing(low, "SWING_LOW", 1, 2, "INITIAL_LOW", null);
    event.price = low[1].low + 1;
    assert.strictEqual(
        withSequenceResult(alignedSequence(low, [event]), low).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("wrong initial classification fails closed", function () {
    const event = swing(high, "SWING_HIGH", 1, 2, "HIGHER_HIGH", null);
    assert.strictEqual(
        withSequenceResult(alignedSequence(high, [event]), high).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("wrong classification history fails closed", function () {
    const candles = [
        candle(0, 5, 6, 4), candle(1, 9, 10, 3), candle(2, 6, 7, 4),
        candle(3, 8, 9, 5), candle(4, 6, 7, 4)
    ];
    const first = swing(candles, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    const second = swing(candles, "SWING_HIGH", 3, 4, "HIGHER_HIGH", first);
    assert.strictEqual(
        withSequenceResult(alignedSequence(candles, [first, second]), candles).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("wrong previous same-type candidate fails closed", function () {
    const candles = [
        candle(0, 5, 6, 4), candle(1, 9, 10, 3), candle(2, 6, 7, 4),
        candle(3, 8, 9, 5), candle(4, 6, 7, 4)
    ];
    const first = swing(candles, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    const second = swing(candles, "SWING_HIGH", 3, 4, "LOWER_HIGH", first);
    second.previousSameTypeCandidateIndex = 0;
    assert.strictEqual(
        withSequenceResult(alignedSequence(candles, [first, second]), candles).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("wrong previous same-type price fails closed", function () {
    const candles = [
        candle(0, 5, 6, 4), candle(1, 9, 10, 3), candle(2, 6, 7, 4),
        candle(3, 8, 9, 5), candle(4, 6, 7, 4)
    ];
    const first = swing(candles, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    const second = swing(candles, "SWING_HIGH", 3, 4, "LOWER_HIGH", first);
    second.previousSameTypePrice = 999;
    assert.strictEqual(
        withSequenceResult(alignedSequence(candles, [first, second]), candles).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("descending confirmation event order fails closed", function () {
    const first = swing(high, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    const second = swing(high, "SWING_LOW", 0, 1, "INITIAL_LOW", null);
    assert.strictEqual(
        withSequenceResult(alignedSequence(high, [first, second]), high).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("same-candidate low-before-high order fails closed", function () {
    const same = [
        candle(0, 5, 6, 4), candle(1, 5, 10, 1), candle(2, 5, 6, 4),
        candle(3, 11, 12, 10)
    ];
    const lowEvent = swing(same, "SWING_LOW", 1, 2, "INITIAL_LOW", null);
    const highEvent = swing(same, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    assert.strictEqual(
        withSequenceResult(alignedSequence(same, [lowEvent, highEvent]), same).error,
        "INTERNAL_ALIGNMENT_ERROR"
    );
});
test("same-candidate high-before-low order is accepted and deterministic", function () {
    const same = [
        candle(0, 5, 6, 4), candle(1, 5, 10, 1), candle(2, 5, 6, 4),
        candle(3, 11, 12, 10)
    ];
    const highEvent = swing(same, "SWING_HIGH", 1, 2, "INITIAL_HIGH", null);
    const lowEvent = swing(same, "SWING_LOW", 1, 2, "INITIAL_LOW", null);
    const source = alignedSequence(same, [highEvent, lowEvent]);
    const first = withSequenceResult(source, same);
    const second = withSequenceResult(source, same);
    assert.strictEqual(first.valid, true);
    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(first.breaks.map(function (item) { return item.direction; }), ["BULLISH"]);
});

let passed = 0;
for (const item of tests) {
    try {
        item.fn();
        passed += 1;
        console.log("PASS:" + item.name);
    } catch (error) {
        console.error("HND_STRUCTURE_BREAK_DETECTOR_TEST_FAILED:" + item.name);
        console.error(error.stack || error);
        process.exitCode = 1;
        break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_BREAK_DETECTOR_TESTS_PASS:" + tests.length);
}
