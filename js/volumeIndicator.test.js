"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const volume = require("../../js/hndai-v1/volumeIndicator.js");
const EPSILON = 1e-12;
const tests = [];
function test(name, callback) { tests.push({ name, callback }); }
function closeTo(actual, expected) {
    assert.ok(Math.abs(actual - expected) <= EPSILON, `${actual} != ${expected}`);
}
function candle(openTime, value, overrides) {
    return Object.assign({
        openTime, closeTime: openTime + 999, open: 10, high: 12,
        low: 8, close: 11, volume: value
    }, overrides);
}
function candles(values) { return values.map((value, index) => candle(index * 1000, value)); }
function independent(values, period) {
    const averages = values.map(() => null);
    const ratios = values.map(() => null);
    for (let index = period; index < values.length; index += 1) {
        let sum = 0;
        for (let prior = index - period; prior < index; prior += 1) sum += values[prior];
        averages[index] = sum / period;
        ratios[index] = averages[index] === 0 ? null : values[index] / averages[index];
    }
    return { averages, ratios };
}

test("period 1 kabul edilir", () => assert.strictEqual(volume.normalizePeriod(1), 1));
test("period 20 kabul edilir", () => assert.strictEqual(volume.normalizePeriod(20), 20));
test("period 0 reddedilir", () => assert.strictEqual(volume.normalizePeriod(0), null));
test("negatif period reddedilir", () => assert.strictEqual(volume.normalizePeriod(-1), null));
test("ondalikli period reddedilir", () => assert.strictEqual(volume.normalizePeriod(1.5), null));
test("period string reddedilir", () => assert.strictEqual(volume.normalizePeriod("20"), null));
test("safe integer disi period reddedilir", () => {
    assert.strictEqual(volume.normalizePeriod(Number.MAX_SAFE_INTEGER + 1), null);
});
test("non-array candle serisi reddedilir", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(null, 2).error, "INVALID_CANDLE_SERIES");
});
test("bos seri valid fakat ready false", () => {
    const result = volume.calculateVolumeMetrics([], 2);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.ready, false);
});
test("canonical object candle kabul edilir", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([1, 2]), 1).valid, true);
});
test("Binance kline kabul edilir", () => {
    const result = volume.calculateVolumeMetrics([
        [0, 10, 12, 8, 11, 5, 999], [1000, 10, 12, 8, 11, 10, 1999]
    ], 1);
    assert.strictEqual(result.valid, true);
});
test("invalid candle butun hesabi reddeder", () => {
    const result = volume.calculateVolumeMetrics([candle(0, 1), candle(1000, -1)], 1);
    assert.strictEqual(result.error, "INVALID_CANDLE_SERIES");
    assert.deepStrictEqual(result.volumes, []);
});
test("rejected reason aktarilir", () => {
    assert.strictEqual(volume.calculateVolumeMetrics([candle(0, -1)], 1).rejected[0].reason, "INVALID_VOLUME");
});
test("rejected inputIndex korunur", () => {
    assert.strictEqual(volume.calculateVolumeMetrics([candle(0, 1), null], 1).rejected[0].inputIndex, 1);
});
test("duplicate openTime son gecerli kaydi kullanir", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics([
        candle(0, 1), candle(0, 2), candle(1000, 4)
    ], 1).volumes, [2, 4]);
});
test("duplicateOpenTimeCount aktarilir", () => {
    assert.strictEqual(volume.calculateVolumeMetrics([candle(0, 1), candle(0, 2)], 1).duplicateOpenTimeCount, 1);
});
test("raw sirasi openTimes sonucunu degistirmez", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics([
        candle(2000, 3), candle(0, 1), candle(1000, 2)
    ], 1).openTimes, [0, 1000, 2000]);
});
test("volumes canonical degerleri tasir", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics(candles(["1", "2"]), 1).volumes, [1, 2]);
});
test("seri period arti 1den kisaysa warmup null", () => {
    const result = volume.calculateVolumeMetrics(candles([1, 2]), 2);
    assert.deepStrictEqual(result.averageVolumes, [null, null]);
    assert.deepStrictEqual(result.ratios, [null, null]);
});
test("values uzunluklari candle sayisina esittir", () => {
    const result = volume.calculateVolumeMetrics(candles([1, 2, 3, 4]), 2);
    ["openTimes", "volumes", "averageVolumes", "ratios"].forEach((key) => {
        assert.strictEqual(result[key].length, 4);
    });
});
test("seedIndex period degeridir", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([1, 2, 3]), 2).seedIndex, 2);
});
test("seed oncesi averageVolumes null", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics(candles([1, 2, 3]), 2).averageVolumes.slice(0, 2), [null, null]);
});
test("seed oncesi ratios null", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics(candles([1, 2, 3]), 2).ratios.slice(0, 2), [null, null]);
});
test("ilk causal average dogru", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([10, 20, 30, 40]), 3).averageVolumes[3], 20);
});
test("current volume baselinea dahil edilmez", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([10, 20, 100]), 2).averageVolumes[2], 15);
});
test("ilk ratio dogru", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([10, 20, 30, 40]), 3).ratios[3], 2);
});
test("ikinci rolling average dogru", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([10, 20, 30, 40, 50]), 3).averageVolumes[4], 30);
});
test("ikinci rolling ratio dogru", () => {
    closeTo(volume.calculateVolumeMetrics(candles([10, 20, 30, 40, 50]), 3).ratios[4], 50 / 30);
});
test("coklu rolling zinciri dogru", () => {
    const values = [3, 7, 2, 9, 5, 12, 4];
    const expected = independent(values, 3);
    const result = volume.calculateVolumeMetrics(candles(values), 3);
    result.ratios.forEach((item, index) => {
        if (item !== null) closeTo(item, expected.ratios[index]);
    });
});
test("latest son hesaplanabilir sonucu tasir", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics(candles([10, 20]), 1).latest, {
        openTime: 1000, volume: 20, averageVolume: 10, ratio: 2
    });
});
test("period 1 baseline previous volumedur", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics(candles([10, 20]), 1).averageVolumes, [null, 10]);
});
test("period 1 ratio dogru", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics(candles([10, 20]), 1).ratios, [null, 2]);
});
test("tek candle period 1 ready false", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([10]), 1).ready, false);
});
test("sifir baseline ratio null uretir", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([0, 0, 5]), 2).ratios[2], null);
});
test("sifir baseline NON_FINITE_RESULT uretmez", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([0, 0, 5]), 2).valid, true);
});
test("sabit volume serisi ratio 1 uretir", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics(candles([5, 5, 5, 5]), 2).ratios, [null, null, 1, 1]);
});
test("input mutation yapilmaz", () => {
    const input = candles([1, 2, 3]); const options = { nowMs: 5 };
    const before = JSON.stringify({ input, options });
    volume.calculateVolumeMetrics(input, 2, options);
    assert.strictEqual(JSON.stringify({ input, options }), before);
});
test("output mutation sonraki cagriyi etkilemez", () => {
    const input = candles([1, 2, 3]); const first = volume.calculateVolumeMetrics(input, 2);
    first.openTimes.push(9); first.volumes[0] = 9; first.averageVolumes[2] = 9;
    first.ratios[2] = 9; first.latest.ratio = 9; first.rejected.push({});
    assert.notStrictEqual(volume.calculateVolumeMetrics(input, 2).latest.ratio, 9);
});
test("ayni input deterministic sonuc uretir", () => {
    const input = candles([1, 2, 3, 4]);
    assert.deepStrictEqual(volume.calculateVolumeMetrics(input, 2), volume.calculateVolumeMetrics(input, 2));
});
test("raw isClosed sonucu degistirmez", () => {
    const left = candles([1, 2, 3]).map((item) => Object.assign({}, item, { isClosed: true }));
    const right = candles([1, 2, 3]).map((item) => Object.assign({}, item, { isClosed: false }));
    assert.deepStrictEqual(volume.calculateVolumeMetrics(left, 2).ratios, volume.calculateVolumeMetrics(right, 2).ratios);
});
test("numeric string volume kabul edilir", () => {
    assert.deepStrictEqual(volume.calculateVolumeMetrics(candles(["10", "20"]), 1).volumes, [10, 20]);
});
test("NON_FINITE_RESULT korumasi calisir", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(candles([
        Number.MAX_VALUE, Number.MAX_VALUE, 1
    ]), 2).error, "NON_FINITE_RESULT");
});
test("butun finite ratio degerleri negatif olmayan number", () => {
    volume.calculateVolumeMetrics(candles([1, 2, 3, 4]), 2).ratios
        .filter((item) => item !== null).forEach((item) => assert.ok(Number.isFinite(item) && item >= 0));
});
test("period dogrulamasi seri kontrolunden once yapilir", () => {
    assert.strictEqual(volume.calculateVolumeMetrics(null, "2").error, "INVALID_PERIOD");
});
test("public API yalniz iki fonksiyondur", () => {
    assert.deepStrictEqual(Object.keys(volume).sort(), ["calculateVolumeMetrics", "normalizePeriod"]);
});
test("normalizer fonksiyonlari gercek olarak cagrilir", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../js/hndai-v1/volumeIndicator.js"), "utf8");
    assert.ok(source.includes("normalizer.normalizeCandles("));
    assert.ok(source.includes("normalizer.validateCandleSequence(candles)"));
});
test("bagimsiz 30 candle fixture eslesir", () => {
    const values = Array.from({ length: 30 }, (_, index) => ((index * 7) % 19) + 1);
    const expected = independent(values, 7);
    const result = volume.calculateVolumeMetrics(candles(values), 7);
    result.averageVolumes.forEach((item, index) => {
        if (item !== null) closeTo(item, expected.averages[index]);
    });
    result.ratios.forEach((item, index) => {
        if (item !== null) closeTo(item, expected.ratios[index]);
    });
});

let passed = 0;
for (const current of tests) {
    try { current.callback(); passed += 1; console.log(`PASS:${current.name}`); }
    catch (error) {
        console.error(`HND_VOLUME_INDICATOR_TEST_FAILED:${current.name}`);
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1; break;
    }
}
if (passed === tests.length) console.log(`HND_VOLUME_INDICATOR_TESTS_PASS:${tests.length}`);
