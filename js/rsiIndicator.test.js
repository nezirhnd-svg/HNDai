"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const rsi = require("../../js/hndai-v1/rsiIndicator.js");

const EPSILON = 1e-12;
const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) <= EPSILON, `${actual} != ${expected}`);
}

function independentWilder(values, period) {
    const output = values.map(() => null);
    let gainSum = 0;
    let lossSum = 0;
    for (let index = 1; index <= period; index += 1) {
        const delta = values[index] - values[index - 1];
        gainSum += delta > 0 ? delta : 0;
        lossSum += delta < 0 ? -delta : 0;
    }
    let averageGain = gainSum / period;
    let averageLoss = lossSum / period;
    function value() {
        if (averageGain === 0 && averageLoss === 0) return 50;
        if (averageLoss === 0) return 100;
        if (averageGain === 0) return 0;
        return 100 - (100 / (1 + (averageGain / averageLoss)));
    }
    output[period] = value();
    for (let index = period + 1; index < values.length; index += 1) {
        const delta = values[index] - values[index - 1];
        const gain = delta > 0 ? delta : 0;
        const loss = delta < 0 ? -delta : 0;
        averageGain = ((averageGain * (period - 1)) + gain) / period;
        averageLoss = ((averageLoss * (period - 1)) + loss) / period;
        output[index] = value();
    }
    return output;
}

test("period 1 kabul edilir", () => {
    assert.strictEqual(rsi.normalizePeriod(1), 1);
});
test("period 14 kabul edilir", () => {
    assert.strictEqual(rsi.normalizePeriod(14), 14);
});
test("period 0 reddedilir", () => {
    assert.strictEqual(rsi.normalizePeriod(0), null);
});
test("negatif period reddedilir", () => {
    assert.strictEqual(rsi.normalizePeriod(-1), null);
});
test("ondalikli period reddedilir", () => {
    assert.strictEqual(rsi.normalizePeriod(1.5), null);
});
test("period string reddedilir", () => {
    assert.strictEqual(rsi.normalizePeriod("14"), null);
});
test("safe integer disi period reddedilir", () => {
    assert.strictEqual(rsi.normalizePeriod(Number.MAX_SAFE_INTEGER + 1), null);
});
test("non-array seri reddedilir", () => {
    assert.deepStrictEqual(rsi.calculateRSI(null, 14), {
        valid: false, error: "INVALID_VALUE_SERIES", period: 14,
        ready: false, seedIndex: null, values: [], latest: null
    });
});
test("bos seri valid fakat ready false", () => {
    const result = rsi.calculateRSI([], 14);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ready, false);
    assert.deepStrictEqual(result.values, []);
});
test("numeric string degerler kabul edilir", () => {
    assert.strictEqual(rsi.calculateRSI(["10", "11"], 1).valid, true);
});
test("null deger seriyi reddeder", () => {
    assert.strictEqual(rsi.calculateRSI([1, null], 1).error, "INVALID_VALUE_SERIES");
});
test("boolean deger seriyi reddeder", () => {
    assert.strictEqual(rsi.calculateRSI([1, true], 1).error, "INVALID_VALUE_SERIES");
});
test("NaN deger seriyi reddeder", () => {
    assert.strictEqual(rsi.calculateRSI([1, NaN], 1).error, "INVALID_VALUE_SERIES");
});
test("Infinity deger seriyi reddeder", () => {
    assert.strictEqual(rsi.calculateRSI([1, Infinity], 1).error, "INVALID_VALUE_SERIES");
});
test("seri period arti 1den kisaysa null output", () => {
    assert.deepStrictEqual(rsi.calculateRSI([1, 2, 3], 3).values, [null, null, null]);
});
test("values uzunlugu input uzunluguna esit", () => {
    assert.strictEqual(rsi.calculateRSI([1, 2, 3, 4], 3).values.length, 4);
});
test("seedIndex period degeridir", () => {
    assert.strictEqual(rsi.calculateRSI([1, 2, 3, 4], 3).seedIndex, 3);
});
test("seed oncesi outputlar null", () => {
    assert.deepStrictEqual(
        rsi.calculateRSI([1, 2, 3, 4], 3).values.slice(0, 3),
        [null, null, null]
    );
});
test("yalniz yukselen seed RSI 100 uretir", () => {
    assert.strictEqual(rsi.calculateRSI([1, 2, 3, 4], 3).values[3], 100);
});
test("yalniz dusen seed RSI 0 uretir", () => {
    assert.strictEqual(rsi.calculateRSI([4, 3, 2, 1], 3).values[3], 0);
});
test("sabit seed RSI 50 uretir", () => {
    assert.strictEqual(rsi.calculateRSI([2, 2, 2, 2], 3).values[3], 50);
});
test("karisik seed RSI dogru hesaplanir", () => {
    closeTo(rsi.calculateRSI([10, 12, 11, 14], 3).values[3], 5 / 6 * 100);
});
test("ilk Wilder smoothing dogru hesaplanir", () => {
    const result = rsi.calculateRSI([10, 12, 11, 14, 13], 3);
    const expectedGain = (((5 / 3) * 2) + 0) / 3;
    const expectedLoss = (((1 / 3) * 2) + 1) / 3;
    closeTo(result.values[4], 100 - (100 / (1 + expectedGain / expectedLoss)));
});
test("coklu Wilder zinciri dogru hesaplanir", () => {
    const input = [10, 12, 11, 14, 13, 15, 14];
    const expected = independentWilder(input, 3);
    const actual = rsi.calculateRSI(input, 3).values;
    actual.forEach((value, index) => {
        if (value !== null) closeTo(value, expected[index]);
    });
});
test("latest son RSI degeridir", () => {
    const result = rsi.calculateRSI([10, 12, 11, 14, 13], 3);
    assert.strictEqual(result.latest, result.values[result.values.length - 1]);
});
test("period 1 yukseliste 100", () => {
    assert.deepStrictEqual(rsi.calculateRSI([10, 11], 1).values, [null, 100]);
});
test("period 1 dususte 0", () => {
    assert.deepStrictEqual(rsi.calculateRSI([11, 10], 1).values, [null, 0]);
});
test("period 1 sabitte 50", () => {
    assert.deepStrictEqual(rsi.calculateRSI([10, 10], 1).values, [null, 50]);
});
test("tek elemanli period 1 ready false", () => {
    assert.strictEqual(rsi.calculateRSI([10], 1).ready, false);
});
test("sabit uzun seri butun RSI degerlerinde 50 uretir", () => {
    assert.deepStrictEqual(rsi.calculateRSI([5, 5, 5, 5, 5], 2).values, [
        null, null, 50, 50, 50
    ]);
});
test("butun RSI degerleri 0 100 araliginda", () => {
    const values = rsi.calculateRSI([1, 4, 2, 8, 3, 9, 0], 2).values;
    values.filter((value) => value !== null).forEach((value) => {
        assert.ok(value >= 0 && value <= 100);
    });
});
test("input mutation yapilmaz", () => {
    const input = ["10", 11, 12];
    const before = JSON.stringify(input);
    rsi.calculateRSI(input, 2);
    assert.strictEqual(JSON.stringify(input), before);
});
test("output mutation sonraki cagriyi etkilemez", () => {
    const first = rsi.calculateRSI([10, 11], 1);
    first.values[1] = 0;
    assert.strictEqual(rsi.calculateRSI([10, 11], 1).values[1], 100);
});
test("ayni input deterministic sonuc uretir", () => {
    const input = [10, 12, 11, 14, 13];
    assert.deepStrictEqual(rsi.calculateRSI(input, 3), rsi.calculateRSI(input, 3));
});
test("NON_FINITE_RESULT korumasi calisir", () => {
    const result = rsi.calculateRSI([-Number.MAX_VALUE, Number.MAX_VALUE], 1);
    assert.strictEqual(result.error, "NON_FINITE_RESULT");
    assert.deepStrictEqual(result.values, []);
});
test("numeric string ciktilari number olur", () => {
    assert.strictEqual(typeof rsi.calculateRSI(["10", "11"], 1).values[1], "number");
});
test("gecersiz sonuc values bos dizidir", () => {
    assert.deepStrictEqual(rsi.calculateRSI([1, {}], 1).values, []);
});
test("period dogrulamasi seri kontrolunden once yapilir", () => {
    assert.strictEqual(rsi.calculateRSI(null, "14").error, "INVALID_PERIOD");
});
test("public API yalniz iki fonksiyondur", () => {
    assert.deepStrictEqual(Object.keys(rsi).sort(), ["calculateRSI", "normalizePeriod"]);
});
test("dependency candleNormalizer uzerinden kullanilir", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../../js/hndai-v1/rsiIndicator.js"), "utf8"
    );
    assert.ok(source.includes('require("./candleNormalizer.js")'));
});
test("calculateRSI finiteCandleNumber gercek olarak cagirir", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../../js/hndai-v1/rsiIndicator.js"), "utf8"
    );
    assert.ok(source.includes("normalizer.finiteCandleNumber(rawValues[index])"));
});
test("delta dogru komsu indekslerden hesaplanir", () => {
    assert.strictEqual(rsi.calculateRSI([10, 20, 19], 1).values[2], 0);
});
test("seed yalniz ilk period degisimi kullanir", () => {
    const result = rsi.calculateRSI([10, 11, 12, 1], 2);
    assert.strictEqual(result.values[2], 100);
});
test("sonraki RSI Wilder seed ortalamalarindan devam eder", () => {
    const input = [10, 12, 11, 14, 13];
    const expected = independentWilder(input, 3);
    closeTo(rsi.calculateRSI(input, 3).values[4], expected[4]);
});
test("klasik referans fixture bagimsiz formulle eslesir", () => {
    const fixture = [
        44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
        45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64
    ];
    const expected = independentWilder(fixture, 14);
    const actual = rsi.calculateRSI(fixture, 14).values;
    for (let index = 14; index < fixture.length; index += 1) {
        closeTo(actual[index], expected[index]);
    }
});

let passed = 0;
for (const current of tests) {
    try {
        current.callback();
        passed += 1;
        console.log(`PASS:${current.name}`);
    } catch (error) {
        console.error(`HND_RSI_INDICATOR_TEST_FAILED:${current.name}`);
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
        break;
    }
}

if (passed === tests.length) {
    console.log(`HND_RSI_INDICATOR_TESTS_PASS:${tests.length}`);
}
