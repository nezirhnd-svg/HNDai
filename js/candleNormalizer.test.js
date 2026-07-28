"use strict";

const assert = require("assert");
const normalizer = require("../../js/hndai-v1/candleNormalizer.js");

const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

function raw(overrides) {
    return Object.assign({
        openTime: 1000,
        closeTime: 1999,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 5
    }, overrides);
}

function canonical(overrides) {
    return Object.assign({
        openTime: 1000,
        closeTime: 1999,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 5,
        isClosed: false
    }, overrides);
}

test("finite number kabul edilir", () => {
    assert.strictEqual(normalizer.finiteCandleNumber(105.5), 105.5);
});
test("numeric string kabul edilir", () => {
    assert.strictEqual(normalizer.finiteCandleNumber(" 105.50 "), 105.5);
});
test("null reddedilir", () => {
    assert.strictEqual(normalizer.finiteCandleNumber(null), null);
});
test("bos string reddedilir", () => {
    assert.strictEqual(normalizer.finiteCandleNumber(""), null);
    assert.strictEqual(normalizer.finiteCandleNumber("   "), null);
});
test("boolean reddedilir", () => {
    assert.strictEqual(normalizer.finiteCandleNumber(true), null);
});
test("Binance kline normalize edilir", () => {
    assert.deepStrictEqual(
        normalizer.normalizeCandle([1000, "10", "12", "9", "11", "5", 1999]),
        canonical()
    );
});
test("canonical object normalize edilir", () => {
    assert.deepStrictEqual(normalizer.normalizeCandle(raw()), canonical());
});
test("alias object reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle({
        time: 1000, timestamp: 1999, o: 10, h: 12, l: 9, c: 11, v: 5
    }), null);
});
test("gecersiz openTime reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ openTime: 1.5 })), null);
});
test("closeTime openTimedan kucukse reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ closeTime: 999 })), null);
});
test("gecersiz fiyat reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ open: "bad" })), null);
});
test("negatif volume reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ volume: -1 })), null);
});
test("high open degerinden kucukse reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ high: 9.5 })), null);
});
test("high close degerinden kucukse reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ high: 10.5 })), null);
});
test("low open degerinden buyukse reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ low: 10.5, close: 11 })), null);
});
test("low close degerinden buyukse reddedilir", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ low: 10.5, close: 10 })), null);
});
test("nowMs ile closed candle true", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw(), { nowMs: 1999 }).isClosed, true);
});
test("acik candle false", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw(), { nowMs: 1998 }).isClosed, false);
});
test("gecersiz nowMs false", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw(), { nowMs: "2000" }).isClosed, false);
});
test("normalizeCandles ascending siralar", () => {
    const result = normalizer.normalizeCandles([
        raw({ openTime: 2000, closeTime: 2999 }),
        raw()
    ]);
    assert.deepStrictEqual(result.candles.map((candle) => candle.openTime), [1000, 2000]);
});
test("duplicate openTime icin son gecerli kayit korunur", () => {
    const result = normalizer.normalizeCandles([raw({ close: 10 }), raw({ close: 11 })]);
    assert.strictEqual(result.candles.length, 1);
    assert.strictEqual(result.candles[0].close, 11);
    assert.strictEqual(result.duplicateOpenTimeCount, 1);
});
test("rejected reason dogru uretilir", () => {
    const result = normalizer.normalizeCandles([
        null,
        raw({ openTime: -1 }),
        raw({ open: NaN }),
        raw({ volume: -1 }),
        raw({ high: 8 })
    ]);
    assert.deepStrictEqual(result.rejected, [
        { inputIndex: 0, reason: "INVALID_INPUT" },
        { inputIndex: 1, reason: "INVALID_TIME" },
        { inputIndex: 2, reason: "INVALID_PRICE" },
        { inputIndex: 3, reason: "INVALID_VOLUME" },
        { inputIndex: 4, reason: "INVALID_RANGE" }
    ]);
});
test("validateCandleSequence gecerli diziye true verir", () => {
    assert.deepStrictEqual(normalizer.validateCandleSequence([
        canonical(),
        canonical({ openTime: 2000, closeTime: 2999 })
    ]), { valid: true, errors: [] });
});
test("sira bozuksa hata uretir", () => {
    const result = normalizer.validateCandleSequence([
        canonical({ openTime: 2000, closeTime: 2999 }),
        canonical()
    ]);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.includes("NON_ASCENDING_OPEN_TIME"));
});
test("input immutability ve deterministic sonuc", () => {
    const input = [raw()];
    const options = { nowMs: 2000 };
    const beforeInput = JSON.stringify(input);
    const beforeOptions = JSON.stringify(options);
    const first = normalizer.normalizeCandles(input, options);
    const second = normalizer.normalizeCandles(input, options);
    assert.strictEqual(JSON.stringify(input), beforeInput);
    assert.strictEqual(JSON.stringify(options), beforeOptions);
    assert.deepStrictEqual(first, second);
    assert.notStrictEqual(first.candles, second.candles);
    assert.notStrictEqual(first.candles[0], input[0]);
});
test("duplicate sayisi birden cok silinen kaydi sayar", () => {
    const result = normalizer.normalizeCandles([raw(), raw(), raw()]);
    assert.strictEqual(result.duplicateOpenTimeCount, 2);
});
test("rejected inputIndex kaynak indeksini korur", () => {
    const result = normalizer.normalizeCandles([raw(), "bad", raw({ openTime: 2000, closeTime: 2999 })]);
    assert.deepStrictEqual(result.rejected, [{ inputIndex: 1, reason: "INVALID_INPUT" }]);
});
test("ciktida ek alan yok", () => {
    const result = normalizer.normalizeCandle(Object.assign(raw(), { extra: "ignored" }));
    assert.deepStrictEqual(Object.keys(result), [
        "openTime", "closeTime", "open", "high", "low", "close", "volume", "isClosed"
    ]);
});
test("NaN Infinity object ve array numeric kabul edilmez", () => {
    [NaN, Infinity, -Infinity, {}, []].forEach((value) => {
        assert.strictEqual(normalizer.finiteCandleNumber(value), null);
    });
});
test("raw isClosed kullanilmaz", () => {
    assert.strictEqual(normalizer.normalizeCandle(raw({ isClosed: true })).isClosed, false);
});
test("non-array normalizeCandles bos sonuc verir", () => {
    assert.deepStrictEqual(normalizer.normalizeCandles({}), {
        candles: [], rejected: [], duplicateOpenTimeCount: 0
    });
});
test("duplicate canonical sequence hatalari essizdir", () => {
    const result = normalizer.validateCandleSequence([canonical(), canonical(), canonical()]);
    assert.deepStrictEqual(result.errors, [
        "DUPLICATE_OPEN_TIME", "NON_ASCENDING_OPEN_TIME"
    ]);
});
test("canonical olmayan sequence candle reddedilir", () => {
    const result = normalizer.validateCandleSequence([raw()]);
    assert.deepStrictEqual(result, {
        valid: false, errors: ["INVALID_CANONICAL_CANDLE"]
    });
});
test("sequence input Array olmalidir", () => {
    assert.deepStrictEqual(normalizer.validateCandleSequence(null), {
        valid: false, errors: ["INVALID_SEQUENCE_INPUT"]
    });
});

let passed = 0;
for (const current of tests) {
    try {
        current.callback();
        passed += 1;
        console.log(`PASS:${current.name}`);
    } catch (error) {
        console.error(`HND_CANDLE_LAYER_TEST_FAILED:${current.name}`);
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
        break;
    }
}

if (passed === tests.length) {
    console.log(`HND_CANDLE_LAYER_TESTS_PASS:${tests.length}`);
}
