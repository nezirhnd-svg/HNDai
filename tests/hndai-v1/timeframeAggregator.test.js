"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const aggregator = require("../../js/hndai-v1/timeframeAggregator.js");

const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

function raw(openTime, overrides) {
    return Object.assign({
        openTime,
        closeTime: openTime + 59999,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 5
    }, overrides);
}

function fiveMinuteRaw(openTime, overrides) {
    return Object.assign({
        openTime,
        closeTime: openTime + 299999,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 5
    }, overrides);
}

function completeBucket(start) {
    return [
        raw(start, { open: 10, high: 12, low: 9, close: 11, volume: 1 }),
        raw(start + 60000, { open: 11, high: 14, low: 10, close: 13, volume: 2 }),
        raw(start + 120000, { open: 13, high: 15, low: 8, close: 9, volume: 3 }),
        raw(start + 180000, { open: 9, high: 11, low: 7, close: 10, volume: 4 }),
        raw(start + 240000, { open: 10, high: 13, low: 9, close: 12, volume: 5 })
    ];
}

function aggregate(inputs, overrides) {
    return aggregator.aggregateCandles(inputs, Object.assign({
        sourceInterval: "1m",
        targetInterval: "5m",
        nowMs: 999999
    }, overrides));
}

test("1m interval etiketi normalize edilir", () => {
    assert.strictEqual(aggregator.normalizeIntervalMs("1m"), 60000);
});
test("15m uppercase whitespace normalize edilir", () => {
    assert.strictEqual(aggregator.normalizeIntervalMs(" 15M "), 900000);
});
test("1h interval normalize edilir", () => {
    assert.strictEqual(aggregator.normalizeIntervalMs("1h"), 3600000);
});
test("1d interval normalize edilir", () => {
    assert.strictEqual(aggregator.normalizeIntervalMs("1d"), 86400000);
});
test("pozitif integer interval kabul edilir", () => {
    assert.strictEqual(aggregator.normalizeIntervalMs(12345), 12345);
});
test("gecersiz interval null dondurur", () => {
    [null, undefined, true, {}, [], "", "1w", "1M", "bogus", NaN, Infinity, 1.5]
        .forEach((value) => assert.strictEqual(aggregator.normalizeIntervalMs(value), null));
});
test("zero ve negatif interval reddedilir", () => {
    assert.strictEqual(aggregator.normalizeIntervalMs(0), null);
    assert.strictEqual(aggregator.normalizeIntervalMs(-1), null);
});
test("getBucketBounds dogru baslangic uretir", () => {
    assert.strictEqual(aggregator.getBucketBounds(420000, "5m").openTime, 300000);
});
test("getBucketBounds dogru kapanis uretir", () => {
    assert.strictEqual(aggregator.getBucketBounds(420000, "5m").closeTime, 599999);
});
test("gecersiz bucket input null dondurur", () => {
    assert.strictEqual(aggregator.getBucketBounds(-1, "5m"), null);
    assert.strictEqual(aggregator.getBucketBounds(0.5, "5m"), null);
    assert.strictEqual(aggregator.getBucketBounds(0, "1w"), null);
});
test("1m source 5m target config kabul edilir", () => {
    const result = aggregate([]);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.expectedSourceCandlesPerBucket, 5);
});
test("target sourcedan kucukse config reddedilir", () => {
    const result = aggregate([], { sourceInterval: "5m", targetInterval: "1m" });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, "INVALID_INTERVAL_CONFIG");
});
test("target sourcea bolunmuyorsa config reddedilir", () => {
    const result = aggregate([], { sourceInterval: 120000, targetInterval: 300000 });
    assert.strictEqual(result.valid, false);
});
test("non-array raw input guvenli sonuc uretir", () => {
    const result = aggregate(null);
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.candles, []);
    assert.deepStrictEqual(result.rejected, []);
});
test("bes adet 1m candle tek 5m candle uretir", () => {
    assert.strictEqual(aggregate(completeBucket(0)).candles.length, 1);
});
test("aggregated open ilk candledan gelir", () => {
    assert.strictEqual(aggregate(completeBucket(0)).candles[0].open, 10);
});
test("aggregated close son candledan gelir", () => {
    assert.strictEqual(aggregate(completeBucket(0)).candles[0].close, 12);
});
test("aggregated high maksimumdur", () => {
    assert.strictEqual(aggregate(completeBucket(0)).candles[0].high, 15);
});
test("aggregated low minimumdur", () => {
    assert.strictEqual(aggregate(completeBucket(0)).candles[0].low, 7);
});
test("aggregated volume toplamdir", () => {
    assert.strictEqual(aggregate(completeBucket(0)).candles[0].volume, 15);
});
test("complete ve zamani gecmis bucket closed true olur", () => {
    assert.strictEqual(aggregate(completeBucket(0), { nowMs: 299999 }).candles[0].isClosed, true);
});
test("current acik bucket closed false olur", () => {
    assert.strictEqual(aggregate(completeBucket(0), { nowMs: 299998 }).candles[0].isClosed, false);
});
test("missing middle source bucket incomplete olur", () => {
    const inputs = completeBucket(0);
    inputs.splice(2, 1);
    assert.deepStrictEqual(aggregate(inputs).incompleteBucketOpenTimes, [0]);
});
test("eksik ilk source bucket incomplete olur", () => {
    assert.deepStrictEqual(aggregate(completeBucket(0).slice(1)).incompleteBucketOpenTimes, [0]);
});
test("eksik son source bucket incomplete olur", () => {
    assert.deepStrictEqual(aggregate(completeBucket(0).slice(0, 4)).incompleteBucketOpenTimes, [0]);
});
test("incomplete bucket output icinde korunur", () => {
    const result = aggregate(completeBucket(0).slice(0, 4));
    assert.strictEqual(result.candles.length, 1);
    assert.strictEqual(result.candles[0].isClosed, false);
});
test("misaligned source aggregation disinda kalir", () => {
    const result = aggregate([raw(1)]);
    assert.deepStrictEqual(result.candles, []);
    assert.deepStrictEqual(result.misalignedSourceOpenTimes, [1]);
});
test("misaligned openTime listesi sirali ve unique olur", () => {
    const result = aggregate([raw(120001), raw(1), raw(1, { close: 10 })]);
    assert.deepStrictEqual(result.misalignedSourceOpenTimes, [1, 120001]);
});
test("duplicate source icin son gecerli kayit kullanilir", () => {
    const inputs = completeBucket(0);
    inputs.push(raw(0, { open: 20, high: 22, low: 19, close: 21, volume: 8 }));
    assert.strictEqual(aggregate(inputs).candles[0].open, 20);
});
test("duplicateOpenTimeCount aktarilir", () => {
    const result = aggregate([raw(0), raw(0)]);
    assert.strictEqual(result.duplicateOpenTimeCount, 1);
});
test("normalizer rejected listesi dogru aktarilir", () => {
    const result = aggregate([null, raw(0), raw(60000, { volume: -1 })]);
    assert.deepStrictEqual(result.rejected, [
        { inputIndex: 0, reason: "INVALID_INPUT" },
        { inputIndex: 2, reason: "INVALID_VOLUME" }
    ]);
});
test("birden fazla target bucket ascending uretilir", () => {
    const result = aggregate(completeBucket(300000).concat(completeBucket(0)).reverse());
    assert.deepStrictEqual(result.candles.map((candle) => candle.openTime), [0, 300000]);
});
test("5m source 15m target dogru aggregate edilir", () => {
    const inputs = [
        fiveMinuteRaw(0, { open: 1, high: 4, low: 1, close: 3, volume: 2 }),
        fiveMinuteRaw(300000, { open: 3, high: 6, low: 2, close: 5, volume: 3 }),
        fiveMinuteRaw(600000, { open: 5, high: 7, low: 4, close: 6, volume: 4 })
    ];
    const result = aggregator.aggregateCandles(inputs, {
        sourceInterval: "5m", targetInterval: "15m", nowMs: 899999
    });
    assert.deepStrictEqual(result.candles[0], {
        openTime: 0, closeTime: 899999, open: 1, high: 7,
        low: 1, close: 6, volume: 9, isClosed: true
    });
});
test("target sourcea esitse OHLCV korunur", () => {
    const input = raw(0);
    const candle = aggregate([input], { targetInterval: "1m", nowMs: 59999 }).candles[0];
    ["open", "high", "low", "close", "volume"].forEach((key) => {
        assert.strictEqual(candle[key], input[key]);
    });
});
test("input immutability ve deterministic sonuc", () => {
    const inputs = completeBucket(0);
    const options = { sourceInterval: "1m", targetInterval: "5m", nowMs: 599999 };
    const before = JSON.stringify({ inputs, options });
    const first = aggregator.aggregateCandles(inputs, options);
    const second = aggregator.aggregateCandles(inputs, options);
    assert.strictEqual(JSON.stringify({ inputs, options }), before);
    assert.deepStrictEqual(first, second);
});
test("raw isClosed alani kullanilmaz", () => {
    const inputs = completeBucket(0).map((candle) => Object.assign(candle, { isClosed: true }));
    assert.strictEqual(aggregate(inputs, { nowMs: 0 }).candles[0].isClosed, false);
});
test("gecersiz nowMs tum output candlelari acik birakir", () => {
    assert.strictEqual(aggregate(completeBucket(0), { nowMs: "999999" }).candles[0].isClosed, false);
});
test("output candleda yalniz sekiz canonical alan vardir", () => {
    assert.deepStrictEqual(Object.keys(aggregate(completeBucket(0)).candles[0]), [
        "openTime", "closeTime", "open", "high", "low", "close", "volume", "isClosed"
    ]);
});
test("output mutation baska cagrinin sonucunu etkilemez", () => {
    const inputs = completeBucket(0);
    const first = aggregate(inputs);
    first.candles[0].close = 999;
    first.rejected.push({});
    first.misalignedSourceOpenTimes.push(9);
    first.incompleteBucketOpenTimes.push(9);
    assert.strictEqual(aggregate(inputs).candles[0].close, 12);
});
test("rejected nesneleri clone edilir", () => {
    const first = aggregate([null]);
    const second = aggregate([null]);
    assert.notStrictEqual(first.rejected, second.rejected);
    assert.notStrictEqual(first.rejected[0], second.rejected[0]);
});
test("incomplete listesi clone edilir", () => {
    const inputs = completeBucket(0).slice(0, 4);
    const first = aggregate(inputs);
    first.incompleteBucketOpenTimes.push(9);
    assert.deepStrictEqual(aggregate(inputs).incompleteBucketOpenTimes, [0]);
});
test("misaligned listesi clone edilir", () => {
    const first = aggregate([raw(1)]);
    first.misalignedSourceOpenTimes.push(9);
    assert.deepStrictEqual(aggregate([raw(1)]).misalignedSourceOpenTimes, [1]);
});
test("validateCandleSequence gercek olarak cagriliyor", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../../js/hndai-v1/timeframeAggregator.js"), "utf8"
    );
    assert.ok(source.includes("normalizer.validateCandleSequence(candles)"));
});
test("dependency candleNormalizer uzerinden kullaniliyor", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../../js/hndai-v1/timeframeAggregator.js"), "utf8"
    );
    assert.ok(source.includes('require("./candleNormalizer.js")'));
    assert.ok(source.includes("normalizer.normalizeCandles"));
});

let passed = 0;
for (const current of tests) {
    try {
        current.callback();
        passed += 1;
        console.log(`PASS:${current.name}`);
    } catch (error) {
        console.error(`HND_TIMEFRAME_AGGREGATOR_TEST_FAILED:${current.name}`);
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
        break;
    }
}

if (passed === tests.length) {
    console.log(`HND_TIMEFRAME_AGGREGATOR_TESTS_PASS:${tests.length}`);
}
