"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const atr = require("../../js/hndai-v1/atrIndicator.js");

const EPSILON = 1e-12;
const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) <= EPSILON, `${actual} != ${expected}`);
}

function candle(openTime, overrides) {
    return Object.assign({
        openTime,
        closeTime: openTime + 999,
        open: 10,
        high: 12,
        low: 8,
        close: 11,
        volume: 5
    }, overrides);
}

function series(count, overridesForIndex) {
    const output = [];
    for (let index = 0; index < count; index += 1) {
        output.push(candle(index * 1000, overridesForIndex ? overridesForIndex(index) : {}));
    }
    return output;
}

function independentAtr(candles, period) {
    const ranges = candles.map((current, index) => {
        const direct = current.high - current.low;
        if (index === 0) return direct;
        return Math.max(
            direct,
            Math.abs(current.high - candles[index - 1].close),
            Math.abs(current.low - candles[index - 1].close)
        );
    });
    const values = ranges.map(() => null);
    if (ranges.length >= period) {
        let previous = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
        values[period - 1] = previous;
        for (let index = period; index < ranges.length; index += 1) {
            previous = ((previous * (period - 1)) + ranges[index]) / period;
            values[index] = previous;
        }
    }
    return { ranges, values };
}

test("period 1 kabul edilir", () => {
    assert.strictEqual(atr.normalizePeriod(1), 1);
});
test("period 14 kabul edilir", () => {
    assert.strictEqual(atr.normalizePeriod(14), 14);
});
test("period 0 reddedilir", () => {
    assert.strictEqual(atr.normalizePeriod(0), null);
});
test("negatif period reddedilir", () => {
    assert.strictEqual(atr.normalizePeriod(-1), null);
});
test("ondalikli period reddedilir", () => {
    assert.strictEqual(atr.normalizePeriod(2.5), null);
});
test("period string reddedilir", () => {
    assert.strictEqual(atr.normalizePeriod("14"), null);
});
test("safe integer disi period reddedilir", () => {
    assert.strictEqual(atr.normalizePeriod(Number.MAX_SAFE_INTEGER + 1), null);
});
test("non-array candle serisi reddedilir", () => {
    assert.strictEqual(atr.calculateATR(null, 14).error, "INVALID_CANDLE_SERIES");
});
test("bos seri valid fakat ready false", () => {
    const result = atr.calculateATR([], 14);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ready, false);
    assert.deepStrictEqual(result.openTimes, []);
});
test("canonical object candle kabul edilir", () => {
    assert.strictEqual(atr.calculateATR([candle(0)], 1).valid, true);
});
test("Binance kline kabul edilir", () => {
    assert.strictEqual(atr.calculateATR([[0, 10, 12, 8, 11, 5, 999]], 1).valid, true);
});
test("invalid candle butun hesabi reddeder", () => {
    const result = atr.calculateATR([candle(0), candle(1000, { volume: -1 })], 1);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, "INVALID_CANDLE_SERIES");
    assert.deepStrictEqual(result.trueRanges, []);
});
test("rejected reason normalizerdan aktarilir", () => {
    assert.strictEqual(
        atr.calculateATR([candle(0, { volume: -1 })], 1).rejected[0].reason,
        "INVALID_VOLUME"
    );
});
test("rejected inputIndex korunur", () => {
    const result = atr.calculateATR([candle(0), null], 1);
    assert.strictEqual(result.rejected[0].inputIndex, 1);
});
test("duplicate openTime son gecerli kaydi kullanir", () => {
    const result = atr.calculateATR([
        candle(0, { high: 12, low: 8 }),
        candle(0, { high: 15, low: 5 })
    ], 1);
    assert.strictEqual(result.trueRanges[0], 10);
});
test("duplicateOpenTimeCount aktarilir", () => {
    assert.strictEqual(atr.calculateATR([candle(0), candle(0)], 1).duplicateOpenTimeCount, 1);
});
test("raw sirasi openTimes sonucunu degistirmez", () => {
    const result = atr.calculateATR([candle(2000), candle(0), candle(1000)], 1);
    assert.deepStrictEqual(result.openTimes, [0, 1000, 2000]);
});
test("ilk True Range high eksi low", () => {
    assert.strictEqual(atr.calculateATR([candle(0)], 1).trueRanges[0], 4);
});
test("normal candle True Range dogru", () => {
    const result = atr.calculateATR([candle(0), candle(1000)], 1);
    assert.strictEqual(result.trueRanges[1], 4);
});
test("yukari gap True Range dogru", () => {
    const result = atr.calculateATR([
        candle(0, { close: 10 }),
        candle(1000, { open: 15, high: 17, low: 14, close: 16 })
    ], 1);
    assert.strictEqual(result.trueRanges[1], 7);
});
test("asagi gap True Range dogru", () => {
    const result = atr.calculateATR([
        candle(0, { close: 10 }),
        candle(1000, { open: 5, high: 6, low: 3, close: 4 })
    ], 1);
    assert.strictEqual(result.trueRanges[1], 7);
});
test("previous close dogru candledan alinir", () => {
    const result = atr.calculateATR([
        candle(0, { close: 10 }),
        candle(1000, { open: 20, high: 21, low: 19, close: 20 }),
        candle(2000, { open: 22, high: 23, low: 21, close: 22 })
    ], 1);
    assert.strictEqual(result.trueRanges[2], 3);
});
test("trueRanges uzunlugu candle sayisina esit", () => {
    assert.strictEqual(atr.calculateATR(series(4), 2).trueRanges.length, 4);
});
test("seri perioddan kisaysa ATR values null", () => {
    assert.deepStrictEqual(atr.calculateATR(series(2), 3).values, [null, null]);
});
test("seedIndex period eksi birdir", () => {
    assert.strictEqual(atr.calculateATR(series(3), 3).seedIndex, 2);
});
test("seed oncesi values null", () => {
    assert.deepStrictEqual(atr.calculateATR(series(3), 3).values.slice(0, 2), [null, null]);
});
test("ATR seed arithmetic mean", () => {
    const input = [
        candle(0, { high: 12, low: 8 }),
        candle(1000, { high: 14, low: 9, close: 12 }),
        candle(2000, { open: 12, high: 15, low: 11, close: 13 })
    ];
    closeTo(atr.calculateATR(input, 3).values[2], (4 + 5 + 4) / 3);
});
test("ilk Wilder ATR dogru", () => {
    const input = series(4, (index) => ({ high: 10 + index + 2, low: 10 - index }));
    const expected = independentAtr(input, 3);
    closeTo(atr.calculateATR(input, 3).values[3], expected.values[3]);
});
test("coklu Wilder ATR zinciri dogru", () => {
    const input = series(7, (index) => ({
        open: 10 + index, high: 13 + index, low: 8 + index, close: 11 + index
    }));
    const expected = independentAtr(input, 3);
    const actual = atr.calculateATR(input, 3).values;
    actual.forEach((value, index) => {
        if (value !== null) closeTo(value, expected.values[index]);
    });
});
test("latest son ATR degeridir", () => {
    const result = atr.calculateATR(series(5), 3);
    assert.strictEqual(result.latest, result.values[result.values.length - 1]);
});
test("period 1 values True Rangee esittir", () => {
    const result = atr.calculateATR(series(4), 1);
    assert.deepStrictEqual(result.values, result.trueRanges);
});
test("period input uzunluguna esitse yalniz son ATR non-null", () => {
    assert.deepStrictEqual(atr.calculateATR(series(3), 3).values, [null, null, 4]);
});
test("sabit range serisi sabit ATR uretir", () => {
    assert.deepStrictEqual(atr.calculateATR(series(5), 2).values, [null, 4, 4, 4, 4]);
});
test("input mutation yapilmaz", () => {
    const input = series(3);
    const options = { nowMs: 5000 };
    const before = JSON.stringify({ input, options });
    atr.calculateATR(input, 2, options);
    assert.strictEqual(JSON.stringify({ input, options }), before);
});
test("output mutation sonraki cagriyi etkilemez", () => {
    const input = series(3);
    const first = atr.calculateATR(input, 2);
    first.openTimes.push(9);
    first.trueRanges[0] = 999;
    first.values[1] = 999;
    first.rejected.push({});
    assert.strictEqual(atr.calculateATR(input, 2).trueRanges[0], 4);
});
test("ayni input deterministic sonuc uretir", () => {
    const input = series(4);
    assert.deepStrictEqual(atr.calculateATR(input, 2), atr.calculateATR(input, 2));
});
test("raw isClosed ATR sonucunu degistirmez", () => {
    const left = series(3).map((item) => Object.assign({}, item, { isClosed: true }));
    const right = series(3).map((item) => Object.assign({}, item, { isClosed: false }));
    assert.deepStrictEqual(
        atr.calculateATR(left, 2).values,
        atr.calculateATR(right, 2).values
    );
});
test("numeric string OHLC candlelari kabul edilir", () => {
    const input = candle("0", {
        closeTime: "999", open: "10", high: "12", low: "8", close: "11", volume: "5"
    });
    assert.strictEqual(atr.calculateATR([input], 1).trueRanges[0], 4);
});
test("NON_FINITE_RESULT korumasi calisir", () => {
    const input = candle(0, {
        open: 0, high: Number.MAX_VALUE, low: -Number.MAX_VALUE, close: 0
    });
    assert.strictEqual(atr.calculateATR([input], 1).error, "NON_FINITE_RESULT");
});
test("butun ATR degerleri negatif olmayan finite sayidir", () => {
    atr.calculateATR(series(6), 3).values.filter((value) => value !== null)
        .forEach((value) => assert.ok(Number.isFinite(value) && value >= 0));
});
test("period dogrulamasi seri kontrolunden once yapilir", () => {
    assert.strictEqual(atr.calculateATR(null, "14").error, "INVALID_PERIOD");
});
test("public API yalniz iki fonksiyondur", () => {
    assert.deepStrictEqual(Object.keys(atr).sort(), ["calculateATR", "normalizePeriod"]);
});
test("normalizeCandles gercek olarak cagrilir", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../js/hndai-v1/atrIndicator.js"), "utf8");
    assert.ok(source.includes("normalizer.normalizeCandles("));
});
test("validateCandleSequence gercek olarak cagrilir", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../js/hndai-v1/atrIndicator.js"), "utf8");
    assert.ok(source.includes("normalizer.validateCandleSequence(candles)"));
});
test("options mutate edilmez", () => {
    const options = { nowMs: 1000 };
    const before = JSON.stringify(options);
    atr.calculateATR(series(2), 1, options);
    assert.strictEqual(JSON.stringify(options), before);
});
test("bagimsiz 20 candle fixture eslesir", () => {
    const input = series(20, (index) => {
        const center = 100 + (index * 0.7) + ((index % 3) - 1);
        return {
            open: center, high: center + 2 + (index % 2),
            low: center - 1.5, close: center + 0.5, volume: 10 + index
        };
    });
    const expected = independentAtr(input, 14);
    const actual = atr.calculateATR(input, 14);
    actual.trueRanges.forEach((value, index) => closeTo(value, expected.ranges[index]));
    actual.values.forEach((value, index) => {
        if (value !== null) closeTo(value, expected.values[index]);
    });
});

let passed = 0;
for (const current of tests) {
    try {
        current.callback();
        passed += 1;
        console.log(`PASS:${current.name}`);
    } catch (error) {
        console.error(`HND_ATR_INDICATOR_TEST_FAILED:${current.name}`);
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
        break;
    }
}

if (passed === tests.length) {
    console.log(`HND_ATR_INDICATOR_TESTS_PASS:${tests.length}`);
}
