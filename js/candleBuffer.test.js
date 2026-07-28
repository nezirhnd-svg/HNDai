"use strict";

const assert = require("assert");
const bufferModule = require("../../js/hndai-v1/candleBuffer.js");

const tests = [];

function test(name, callback) {
    tests.push({ name, callback });
}

function raw(openTime, overrides) {
    return Object.assign({
        openTime,
        closeTime: openTime + 999,
        open: 10,
        high: 12,
        low: 9,
        close: 11,
        volume: 5
    }, overrides);
}

function create(options) {
    return bufferModule.createCandleBuffer(options);
}

test("default maxCandles 500", () => {
    assert.strictEqual(create().getStats().maxCandles, 500);
});
test("gecerli maxCandles kabul edilir", () => {
    assert.strictEqual(create({ maxCandles: 3 }).getStats().maxCandles, 3);
});
test("gecersiz maxCandles varsayilan kullanir", () => {
    [0, -1, 1.5, "3", null].forEach((maxCandles) => {
        assert.strictEqual(create({ maxCandles }).getStats().maxCandles, 500);
    });
});
test("yeni candle INSERTED", () => {
    const result = create().upsert(raw(1000));
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.action, "INSERTED");
    assert.strictEqual(result.reason, null);
});
test("ayni openTime REPLACED", () => {
    const buffer = create();
    buffer.upsert(raw(1000));
    assert.strictEqual(buffer.upsert(raw(1000, { close: 10 })).action, "REPLACED");
});
test("replace buffer boyutunu artirmaz", () => {
    const buffer = create();
    buffer.upsert(raw(1000));
    buffer.upsert(raw(1000, { close: 10 }));
    assert.strictEqual(buffer.getStats().size, 1);
});
test("replace butun candle alanlarini gunceller", () => {
    const buffer = create();
    buffer.upsert(raw(1000));
    buffer.upsert(raw(1000, {
        closeTime: 2500, open: 20, high: 24, low: 18, close: 22, volume: 9
    }));
    assert.deepStrictEqual(buffer.getLatest(), {
        openTime: 1000, closeTime: 2500, open: 20, high: 24,
        low: 18, close: 22, volume: 9, isClosed: false
    });
});
test("acik candle kapali candlea guncellenir", () => {
    const buffer = create();
    buffer.upsert(raw(1000), { nowMs: 1500 });
    assert.strictEqual(buffer.getLatest().isClosed, false);
    buffer.upsert(raw(1000), { nowMs: 2000 });
    assert.strictEqual(buffer.getLatest().isClosed, true);
});
test("gecersiz candle REJECTED", () => {
    const result = create().upsert(null);
    assert.deepStrictEqual(result, {
        accepted: false, action: "REJECTED", candle: null,
        reason: "INVALID_INPUT", evictedOpenTimes: []
    });
});
test("rejected islem bufferi degistirmez", () => {
    const buffer = create();
    buffer.upsert(raw(1000));
    const before = buffer.getCandles();
    buffer.upsert(raw(2000, { volume: -1 }));
    assert.deepStrictEqual(buffer.getCandles(), before);
});
test("rejected reason normalizerdan gelir", () => {
    assert.strictEqual(create().upsert(raw(1000, { volume: -1 })).reason, "INVALID_VOLUME");
});
test("farkli ekleme sirasi ascending snapshot uretir", () => {
    const buffer = create();
    buffer.upsert(raw(3000));
    buffer.upsert(raw(1000));
    buffer.upsert(raw(2000));
    assert.deepStrictEqual(buffer.getCandles().map((c) => c.openTime), [1000, 2000, 3000]);
});
test("kapasite en eski candlei siler", () => {
    const buffer = create({ maxCandles: 2 });
    buffer.upsert(raw(1000));
    buffer.upsert(raw(2000));
    const result = buffer.upsert(raw(3000));
    assert.deepStrictEqual(result.evictedOpenTimes, [1000]);
    assert.deepStrictEqual(buffer.getCandles().map((c) => c.openTime), [2000, 3000]);
});
test("birden fazla eviction dogru siralanir", () => {
    const buffer = create({ maxCandles: 2 });
    const result = buffer.upsertMany([raw(4000), raw(1000), raw(3000), raw(2000)]);
    assert.deepStrictEqual(result.evictedOpenTimes, [1000, 2000]);
});
test("replace eviction uretmez", () => {
    const buffer = create({ maxCandles: 1 });
    buffer.upsert(raw(1000));
    assert.deepStrictEqual(buffer.upsert(raw(1000, { close: 10 })).evictedOpenTimes, []);
});
test("upsertMany insertedCount dogru", () => {
    assert.strictEqual(create().upsertMany([raw(1000), raw(2000)]).insertedCount, 2);
});
test("upsertMany replacedCount dogru", () => {
    const buffer = create();
    buffer.upsert(raw(1000));
    const result = buffer.upsertMany([raw(1000), raw(2000)]);
    assert.strictEqual(result.replacedCount, 1);
    assert.strictEqual(result.insertedCount, 1);
});
test("batch rejected listesi dogru", () => {
    const result = create().upsertMany([null, raw(1000), raw(2000, { volume: -1 })]);
    assert.deepStrictEqual(result.rejected, [
        { inputIndex: 0, reason: "INVALID_INPUT" },
        { inputIndex: 2, reason: "INVALID_VOLUME" }
    ]);
});
test("batch duplicate count dogru", () => {
    assert.strictEqual(create().upsertMany([raw(1000), raw(1000)]).duplicateOpenTimeCount, 1);
});
test("batch icindeki son duplicate korunur", () => {
    const result = create().upsertMany([raw(1000, { close: 10 }), raw(1000, { close: 11 })]);
    assert.strictEqual(result.candles[0].close, 11);
});
test("getCandles clone dondurur", () => {
    const buffer = create();
    buffer.upsert(raw(1000));
    const first = buffer.getCandles();
    const second = buffer.getCandles();
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first[0], second[0]);
});
test("getClosedCandles yalniz kapalilari dondurur", () => {
    const buffer = create();
    buffer.upsert(raw(1000), { nowMs: 1999 });
    buffer.upsert(raw(2000), { nowMs: 1999 });
    assert.deepStrictEqual(buffer.getClosedCandles().map((c) => c.openTime), [1000]);
});
test("getLatest dogru candlei dondurur", () => {
    const buffer = create();
    buffer.upsertMany([raw(3000), raw(1000)]);
    assert.strictEqual(buffer.getLatest().openTime, 3000);
});
test("getLatestClosed dogru candlei dondurur", () => {
    const buffer = create();
    buffer.upsert(raw(1000), { nowMs: 5000 });
    buffer.upsert(raw(2000), { nowMs: 5000 });
    buffer.upsert(raw(6000), { nowMs: 5000 });
    assert.strictEqual(buffer.getLatestClosed().openTime, 2000);
});
test("bos buffer latest null", () => {
    const buffer = create();
    assert.strictEqual(buffer.getLatest(), null);
    assert.strictEqual(buffer.getLatestClosed(), null);
});
test("stats sayaclari dogru", () => {
    const buffer = create({ maxCandles: 2 });
    buffer.upsert(raw(1000), { nowMs: 5000 });
    buffer.upsert(raw(2000), { nowMs: 0 });
    buffer.upsert(raw(2000), { nowMs: 5000 });
    buffer.upsert(null);
    buffer.upsert(raw(3000), { nowMs: 0 });
    assert.deepStrictEqual(buffer.getStats(), {
        size: 2, maxCandles: 2, firstOpenTime: 2000, lastOpenTime: 3000,
        closedCount: 1, openCount: 1, totalInserted: 3, totalReplaced: 1,
        totalRejected: 1, totalEvicted: 1
    });
});
test("clear icerigi ve sayaclari sifirlar", () => {
    const buffer = create({ maxCandles: 2 });
    buffer.upsert(raw(1000));
    buffer.upsert(null);
    assert.strictEqual(buffer.clear(), true);
    assert.deepStrictEqual(buffer.getStats(), {
        size: 0, maxCandles: 2, firstOpenTime: null, lastOpenTime: null,
        closedCount: 0, openCount: 0, totalInserted: 0, totalReplaced: 0,
        totalRejected: 0, totalEvicted: 0
    });
});
test("input immutability", () => {
    const candle = raw(1000);
    const rawCandles = [candle];
    const normalizeOptions = { nowMs: 2000 };
    const createOptions = { maxCandles: 2 };
    const before = JSON.stringify({ candle, rawCandles, normalizeOptions, createOptions });
    create(createOptions).upsertMany(rawCandles, normalizeOptions);
    assert.strictEqual(
        JSON.stringify({ candle, rawCandles, normalizeOptions, createOptions }),
        before
    );
});
test("output mutation internal statei etkilemez", () => {
    const buffer = create();
    const upsertResult = buffer.upsert(raw(1000));
    upsertResult.candle.close = 999;
    upsertResult.evictedOpenTimes.push(7);
    const manyResult = buffer.upsertMany([raw(2000)]);
    manyResult.candles[0].close = 888;
    manyResult.rejected.push({ inputIndex: 9, reason: "INVALID_INPUT" });
    buffer.getCandles()[0].close = 777;
    buffer.getClosedCandles().push({});
    buffer.getLatest().close = 666;
    const stats = buffer.getStats();
    stats.size = 99;
    assert.strictEqual(buffer.getCandles()[0].close, 11);
    assert.strictEqual(buffer.getStats().size, 2);
});
test("iki bagimsiz buffer deterministic sonuc uretir", () => {
    const inputs = [raw(3000), raw(1000), raw(2000)];
    const left = create({ maxCandles: 2 });
    const right = create({ maxCandles: 2 });
    left.upsertMany(inputs, { nowMs: 2500 });
    right.upsertMany(inputs, { nowMs: 2500 });
    assert.deepStrictEqual(left.getCandles(), right.getCandles());
    assert.deepStrictEqual(left.getStats(), right.getStats());
});
test("public API yalniz sekiz metot icerir", () => {
    assert.deepStrictEqual(Object.keys(create()).sort(), [
        "clear", "getCandles", "getClosedCandles", "getLatest",
        "getLatestClosed", "getStats", "upsert", "upsertMany"
    ]);
});
test("dependency candleNormalizer uzerinden kullaniliyor", () => {
    const source = require("fs").readFileSync(
        require("path").join(__dirname, "../../js/hndai-v1/candleBuffer.js"),
        "utf8"
    );
    assert.ok(source.includes('require("./candleNormalizer.js")'));
    assert.ok(source.includes("normalizer.normalizeCandles"));
});
test("non-array upsertMany guvenli", () => {
    assert.deepStrictEqual(create().upsertMany(null), {
        insertedCount: 0, replacedCount: 0, rejected: [],
        duplicateOpenTimeCount: 0, evictedOpenTimes: [], candles: []
    });
});
test("totalRejected batchteki tum rejected kayitlari sayar", () => {
    const buffer = create();
    buffer.upsertMany([null, "bad", raw(1000, { volume: -1 })]);
    assert.strictEqual(buffer.getStats().totalRejected, 3);
});
test("totalEvicted gercek silinen kayit sayisidir", () => {
    const buffer = create({ maxCandles: 1 });
    buffer.upsertMany([raw(1000), raw(2000), raw(3000)]);
    assert.strictEqual(buffer.getStats().totalEvicted, 2);
});
test("openCount ve closedCount size toplamini verir", () => {
    const buffer = create();
    buffer.upsertMany([raw(1000), raw(2000)], { nowMs: 1999 });
    const stats = buffer.getStats();
    assert.strictEqual(stats.openCount + stats.closedCount, stats.size);
});
test("duplicate batch totalRejected artirmaz", () => {
    const buffer = create();
    buffer.upsertMany([raw(1000), raw(1000)]);
    assert.strictEqual(buffer.getStats().totalRejected, 0);
});
test("options nesnesi mutate edilmez", () => {
    const options = { maxCandles: 2 };
    const before = JSON.stringify(options);
    create(options).upsert(raw(1000));
    assert.strictEqual(JSON.stringify(options), before);
});

let passed = 0;
for (const current of tests) {
    try {
        current.callback();
        passed += 1;
        console.log(`PASS:${current.name}`);
    } catch (error) {
        console.error(`HND_CANDLE_BUFFER_TEST_FAILED:${current.name}`);
        console.error(error && error.stack ? error.stack : error);
        process.exitCode = 1;
        break;
    }
}

if (passed === tests.length) {
    console.log(`HND_CANDLE_BUFFER_TESTS_PASS:${tests.length}`);
}
