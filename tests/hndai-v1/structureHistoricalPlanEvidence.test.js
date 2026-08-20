"use strict";

const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "../.."), modulePath = path.join(root,
    "js/hndai-v1/structureHistoricalPlanEvidence.js");
const common = require(modulePath), tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const clone = value => JSON.parse(JSON.stringify(value));
function candles(extra = []) {
    return [{ time: 1000, closeTime: 1999, open: 109, high: 111, low: 108, close: 110, volume: 10 },
        { time: 2000, closeTime: 2999, open: 110, high: 112, low: 109, close: 110, volume: 10 }].concat(extra);
}
function zone() { return { id: "OB-1", kind: "ORDER_BLOCK", type: "BULLISH", status: "ACTIVE",
    top: 102, bottom: 100, structureEventId: "EVENT-1" }; }
function candidate() { return { key: "BTCUSDT|15m|LONG|EVENT-1|OB-1", direction: "LONG",
    sourceType: "ORDER_BLOCK", zoneIds: ["OB-1"], orderBlockId: "OB-1", fvgId: null,
    structureEventId: "EVENT-1", entryLow: 100, entryHigh: 102, entryTarget: 101,
    atr: 10, distanceATR: 0.8, quality: 90, mtfAlignment: { status: "ALIGNED", score: 5 },
    zones: [zone()] }; }
function input(change = {}) { return Object.assign({ symbol: "BTCUSDT", interval: "15m", price: 110,
    candles: candles(), analysis: { signal: "LONG", marketBias: "BULLISH" },
    qualifiedPriceZones: { orderBlocks: [], fvgs: [] }, mtfState: { rows: [] } }, change); }
function context(change = {}) { return Object.assign({ symbol: "BTCUSDT", interval: "15m",
    candidateKey: "PENDING-CANDIDATE-1", evaluationCloseTime: 2999 }, change); }
function decision(change = {}) { return Object.assign({ valid: true, decision: "ALLOW",
    candidate: candidate() }, change); }
function load() {
    const window = { console, HNDSmartMoney: {
        detectLiquidityZones(options) { return options.candles.length === 2 ? [] : [{ future: true }]; },
        getStrongestLiquidityZones() { return { overall: null, buySide: null, sellSide: null }; }
    } };
    vm.runInNewContext(fs.readFileSync(path.join(root, "js/setupEngine.js"), "utf8"),
        { window, console, JSON, Object, Array, Number, Math, Date, Set, String, Boolean });
    vm.runInNewContext(fs.readFileSync(path.join(root, "js/tradePlanEngine.js"), "utf8"),
        { window, console, JSON, Object, Array, Number, Math, Date, Map, Set, String, Boolean });
    vm.runInNewContext(fs.readFileSync(modulePath, "utf8"),
        { window, console, JSON, Object, Array, Number, Math, Date, Map, Set, String, Boolean });
    return window;
}
test("CommonJS API", () => assert.strictEqual(typeof common.buildPlanEvidence, "function"));
test("browser global API", () => assert.strictEqual(typeof load().HNDStructureHistoricalPlanEvidence.buildPlanEvidence, "function"));
test("exact public API", () => assert.deepStrictEqual(Object.keys(common).sort(),
    ["getSchemaVersion", "getVocabulary", "buildPlanEvidence"].sort()));
test("schema exact", () => assert.strictEqual(common.getSchemaVersion(),
    "HND_STRUCTURE_HISTORICAL_PLAN_EVIDENCE_V1"));
test("ALLOW creates direct authoritative evidence", () => {
    const result = load().HNDStructureHistoricalPlanEvidence.buildPlanEvidence(input(), decision(), context());
    assert.deepStrictEqual([result.valid, result.status, result.evidence.direction,
        result.evidence.entryMode], [true, "PLAN_EVIDENCE_AVAILABLE", "LONG", "ZONE"]);
});
test("direct levels come from shared plan core", () => {
    const window = load(), result = window.HNDStructureHistoricalPlanEvidence.buildPlanEvidence(input(), decision(), context());
    const setup = window.HNDSetupEngine.buildSetupFromCandidate(candidate(), input(), input().candles, 2999);
    const plan = window.HNDTradePlanEngine.buildPlan({ setupState: { currentSetup: setup },
        liquidityZones: [], strongestLiquidity: { overall: null, buySide: null, sellSide: null } },
        { evaluationTime: 2999 }).plan;
    assert.deepStrictEqual([result.evidence.entryPrice, result.evidence.stopLoss, result.evidence.takeProfit],
        [plan.entryPrice, plan.stopLoss, plan.takeProfit]);
});
test("setup shared core preserves live field parity", () => {
    const window = load(), pure = window.HNDSetupEngine.buildSetupFromCandidate(candidate(), input(), input().candles, 2999);
    assert.deepStrictEqual([pure.direction, pure.entryLow, pure.entryHigh, pure.entryTarget,
        pure.invalidationPrice], ["LONG", 100, 102, 101, 99.5]);
    assert.deepStrictEqual([pure.createdAt, pure.updatedAt, pure.stateChangedAt], [2999, 2999, 2999]);
});
test("trade plan shared core uses historical timestamp", () => {
    const window = load(), setup = window.HNDSetupEngine.buildSetupFromCandidate(candidate(), input(), input().candles, 2999);
    const plan = window.HNDTradePlanEngine.buildPlan({ setupState: { currentSetup: setup }, liquidityZones: [] },
        { evaluationTime: 2999 }).plan;
    assert.deepStrictEqual([plan.createdAt, plan.updatedAt, plan.stateChangedAt], [2999, 2999, 2999]);
});
test("global dataset changes do not alter evidence", () => {
    const window = load(), api = window.HNDStructureHistoricalPlanEvidence;
    window.candles = candles([{ time: 3000, closeTime: 3999, open: 1, high: 999, low: 1, close: 2, volume: 1 }]);
    const first = api.buildPlanEvidence(input(), decision(), context());
    window.candles = [];
    const second = api.buildPlanEvidence(input(), decision(), context());
    assert.deepStrictEqual(first, second);
});
test("future candle in plan input rejected", () => {
    const future = { time: 3000, closeTime: 3999, open: 110, high: 120, low: 100, close: 115, volume: 10 };
    assert.strictEqual(load().HNDStructureHistoricalPlanEvidence.buildPlanEvidence(
        input({ candles: candles([future]) }), decision(), context()).error, "FUTURE_CANDLE");
});
test("evaluation close must bind last prefix candle", () => assert.strictEqual(
    load().HNDStructureHistoricalPlanEvidence.buildPlanEvidence(input(), decision(),
        context({ evaluationCloseTime: 3999 })).error, "EVALUATION_CANDLE_MISMATCH"));
test("provenance exact", () => {
    const evidence = load().HNDStructureHistoricalPlanEvidence.buildPlanEvidence(input(), decision(), context()).evidence;
    assert.deepStrictEqual([evidence.symbol, evidence.interval, evidence.candidateKey,
        evidence.setupCandidateKey, evidence.evaluationCloseTime, evidence.source,
        evidence.countsTowardLiveReadiness], ["BTCUSDT", "15m", "PENDING-CANDIDATE-1",
        candidate().key, 2999, "HISTORICAL_REPLAY", false]);
});
test("BLOCK is not applicable and does not create a legacy plan", () => {
    const result = load().HNDStructureHistoricalPlanEvidence.buildPlanEvidence(input(),
        decision({ decision: "BLOCK", candidate: null }), context());
    assert.deepStrictEqual([result.status, result.evidence], ["NOT_APPLICABLE", null]);
});
test("missing direct candidate fails closed", () => assert.strictEqual(
    load().HNDStructureHistoricalPlanEvidence.buildPlanEvidence(input(),
        decision({ candidate: null }), context()).status, "NOT_EVALUABLE"));
test("dependency absence fails closed", () => assert.strictEqual(
    common.buildPlanEvidence(input(), decision(), context()).status, "NOT_EVALUABLE"));
test("state isolation", () => {
    const window = load(), setupBefore = clone(window.HNDSetupEngine.getState()),
        planBefore = clone(window.HNDTradePlanEngine.getState());
    window.HNDStructureHistoricalPlanEvidence.buildPlanEvidence(input(), decision(), context());
    assert.deepStrictEqual(clone(window.HNDSetupEngine.getState()), setupBefore);
    assert.deepStrictEqual(clone(window.HNDTradePlanEngine.getState()), planBefore);
});
test("inputs immutable", () => {
    const values = [input(), decision(), context()], before = JSON.stringify(values);
    load().HNDStructureHistoricalPlanEvidence.buildPlanEvidence(...values);
    assert.strictEqual(JSON.stringify(values), before);
});
test("deterministic", () => {
    const api = load().HNDStructureHistoricalPlanEvidence;
    assert.deepStrictEqual(api.buildPlanEvidence(input(), decision(), context()),
        api.buildPlanEvidence(input(), decision(), context()));
});
test("historical builder has no time or stateful live calls", () => {
    const source = fs.readFileSync(modulePath, "utf8");
    assert.ok(!/Date\.now|\.evaluate\(|\.reset\(|HNDTradeEngine|localStorage|sessionStorage|fetch\(/.test(source));
});
test("detectLiquidityZones accepts explicit candle prefix", () => {
    const source = fs.readFileSync(path.join(root, "js/smartmoney.js"), "utf8");
    assert.ok(source.includes("getSmartMoneyCandleData(options.candles)"));
    assert.ok(source.includes("getSwings(normalizedOptions.lookback, data)"));
});
test("actual liquidity core ignores changed global dataset when prefix is explicit", () => {
    const sandbox = { console: { log() {} } }; sandbox.window = sandbox;
    vm.runInNewContext(fs.readFileSync(path.join(root, "js/smartmoney.js"), "utf8"), sandbox);
    const highs = [2, 5, 2, 5, 2], prefix = highs.map((high, index) => ({ time: 1000 + index * 1000,
        open: 1, high, low: 0.5, close: 1, volume: 10 }));
    sandbox.candles = [{ time: 1, open: 999, high: 1000, low: 998, close: 999, volume: 1 }];
    const first = clone(sandbox.HNDSmartMoney.detectLiquidityZones({ candles: prefix,
        lookback: 1, minTouches: 2 }));
    sandbox.candles = [];
    const second = clone(sandbox.HNDSmartMoney.detectLiquidityZones({ candles: prefix,
        lookback: 1, minTouches: 2 }));
    assert.ok(first.length > 0); assert.deepStrictEqual(first, second);
});

(async () => { let assertions = 0; for (const item of tests) {
    try { await item.fn(); assertions += 1; } catch (error) {
        console.error(`FAIL:${item.name}`); throw error;
    }
} console.log(`Historical Plan Evidence tests passed: ${tests.length} scenarios, ${assertions} assertions.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
