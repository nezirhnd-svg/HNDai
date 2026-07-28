"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ema = require("../../js/hndai-v1/emaIndicator.js");

const EPSILON = 1e-12;
const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) <= EPSILON, `${actual} != ${expected}`);
}

test("period 1 kabul edilir", () => {
    assert.strictEqual(ema.normalizePeriod(1), 1);
});
test("period 20 kabul edilir", () => {
    assert.strictEqual(ema.normalizePeriod(20), 20);
});
test("period 0 reddedilir", () => {
    assert.strictEqual(ema.normalizePeriod(0), null);
});
test("negatif period reddedilir", () => {
    assert.strictEqual(ema.normalizePeriod(-1), null);
});
test("ondalikli period reddedilir", () => {
    assert.strictEqual(ema.normalizePeriod(2.5), null);
});
test("period string reddedilir", () => {
    assert.strictEqual(ema.normalizePeriod("20"), null);
});
test("non-array value series reddedilir", () => {
    assert.deepStrictEqual(ema.calculateEMA(null, 3), {
        valid: false, error: "INVALID_VALUE_SERIES", period: 3,
        multiplier: null, ready: false, seedIndex: null, values: [], latest: null
    });
});
test("bos seri gecerli fakat ready false", () => {
    const result = ema.calculateEMA([], 3);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ready, false);
    assert.deepStrictEqual(result.values, []);
    assert.strictEqual(result.latest, null);
});
test("numeric string degerler kabul edilir", () => {
    const result = ema.calculateEMA(["1", "2", "3"], 2);
    assert.strictEqual(result.valid, true);
    result.values.filter((value) => value !== null).forEach((value) => {
        assert.strictEqual(typeof value, "number");
    });
});
test("null deger seriyi reddeder", () => {
    assert.strictEqual(ema.calculateEMA([1, null, 3], 2).error, "INVALID_VALUE_SERIES");
});
test("boolean deger seriyi reddeder", () => {
    assert.strictEqual(ema.calculateEMA([1, true, 3], 2).error, "INVALID_VALUE_SERIES");
});
test("NaN deger seriyi reddeder", () => {
    assert.strictEqual(ema.calculateEMA([1, NaN, 3], 2).error, "INVALID_VALUE_SERIES");
});
test("Infinity deger seriyi reddeder", () => {
    assert.strictEqual(ema.calculateEMA([1, Infinity, 3], 2).error, "INVALID_VALUE_SERIES");
});
test("seri perioddan kisaysa null output uretir", () => {
    assert.deepStrictEqual(ema.calculateEMA([1, 2], 3).values, [null, null]);
});
test("values uzunlugu input uzunluguyla aynidir", () => {
    assert.strictEqual(ema.calculateEMA([1, 2, 3, 4], 3).values.length, 4);
});
test("seedIndex period eksi birdir", () => {
    assert.strictEqual(ema.calculateEMA([1, 2, 3], 3).seedIndex, 2);
});
test("seed oncesi outputlar null", () => {
    assert.deepStrictEqual(ema.calculateEMA([1, 2, 3], 3).values.slice(0, 2), [null, null]);
});
test("seed arithmetic mean degeridir", () => {
    closeTo(ema.calculateEMA([2, 4, 6], 3).values[2], 4);
});
test("multiplier dogru hesaplanir", () => {
    closeTo(ema.calculateEMA([1, 2, 3], 3).multiplier, 0.5);
});
test("seed sonrasi ilk EMA dogru hesaplanir", () => {
    closeTo(ema.calculateEMA([1, 2, 3, 4], 3).values[3], 3);
});
test("coklu EMA zinciri dogru hesaplanir", () => {
    const result = ema.calculateEMA([1, 2, 3, 4, 5], 3);
    closeTo(result.values[3], 3);
    closeTo(result.values[4], 4);
});
test("latest son EMA degeridir", () => {
    const result = ema.calculateEMA([1, 2, 3, 4, 5], 3);
    assert.strictEqual(result.latest, result.values[result.values.length - 1]);
});
test("period 1 input degerlerini aynen uretir", () => {
    assert.deepStrictEqual(ema.calculateEMA([1, 2, 3], 1).values, [1, 2, 3]);
});
test("period input uzunluguna esitse yalniz son deger non-null olur", () => {
    assert.deepStrictEqual(ema.calculateEMA([1, 2, 3], 3).values, [null, null, 2]);
});
test("sabit seri sabit EMA uretir", () => {
    assert.deepStrictEqual(ema.calculateEMA([5, 5, 5, 5], 2).values, [null, 5, 5, 5]);
});
test("artan seri beklenen EMA uretir", () => {
    assert.deepStrictEqual(ema.calculateEMA([1, 2, 3, 4], 2).values, [
        null, 1.5, 2.5, 3.5
    ]);
});
test("azalan seri beklenen EMA uretir", () => {
    assert.deepStrictEqual(ema.calculateEMA([4, 3, 2, 1], 2).values, [
        null, 3.5, 2.5, 1.5
    ]);
});
test("input mutation yapilmaz", () => {
    const input = ["1", 2, 3];
    const before = JSON.stringify(input);
    ema.calculateEMA(input, 2);
    assert.strictEqual(JSON.stringify(input), before);
});
test("output mutation sonraki cagriyi etkilemez", () => {
    const first = ema.calculateEMA([1, 2, 3], 2);
    first.values[1] = 999;
    assert.strictEqual(ema.calculateEMA([1, 2, 3], 2).values[1], 1.5);
});
test("ayni input deterministic sonuc uretir", () => {
    assert.deepStrictEqual(
        ema.calculateEMA([1, 2, 3, 4], 3),
        ema.calculateEMA([1, 2, 3, 4], 3)
    );
});
test("multiplier period 1 icin 1", () => {
    assert.strictEqual(ema.calculateEMA([1], 1).multiplier, 1);
});
test("bos period 1 serisi ready false", () => {
    assert.strictEqual(ema.calculateEMA([], 1).ready, false);
});
test("numeric string ciktilari number olur", () => {
    assert.strictEqual(typeof ema.calculateEMA(["1", "2"], 1).values[0], "number");
});
test("gecersiz sonucta values bos dizi olur", () => {
    assert.deepStrictEqual(ema.calculateEMA([1, {}], 2).values, []);
});
test("NON_FINITE_RESULT korumasi calisir", () => {
    const result = ema.calculateEMA([Number.MAX_VALUE, Number.MAX_VALUE], 2);
    assert.deepStrictEqual(result, {
        valid: false, error: "NON_FINITE_RESULT", period: 2,
        multiplier: 2 / 3, ready: false, seedIndex: null, values: [], latest: null
    });
});
test("public API yalniz iki fonksiyon icerir", () => {
    assert.deepStrictEqual(Object.keys(ema).sort(), ["calculateEMA", "normalizePeriod"]);
});
test("dependency candleNormalizer uzerinden kullanilir", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../../js/hndai-v1/emaIndicator.js"), "utf8"
    );
    assert.ok(source.includes('require("./candleNormalizer.js")'));
});
test("calculateEMA finiteCandleNumber gercek olarak cagirir", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../../js/hndai-v1/emaIndicator.js"), "utf8"
    );
    assert.ok(source.includes("normalizer.finiteCandleNumber(rawValues[index])"));
});
test("gecersiz period seri kontrolunden once gelir", () => {
    assert.strictEqual(ema.calculateEMA(null, "3").error, "INVALID_PERIOD");
});
test("safe integer siniri disindaki period reddedilir", () => {
    assert.strictEqual(ema.normalizePeriod(Number.MAX_SAFE_INTEGER + 1), null);
});

let passed = 0;
for (const current of tests) {
    try {
        current.callback();
        passed += 1;
        console.log(`PASS:${current.name}`);
    } catch (error) {
        console.error(`HND_EMA_INDICATOR_TEST_FAILED:${current.name}`);
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
        break;
    }
}

if (passed === tests.length) {
    console.log(`HND_EMA_INDICATOR_TESTS_PASS:${tests.length}`);
}
