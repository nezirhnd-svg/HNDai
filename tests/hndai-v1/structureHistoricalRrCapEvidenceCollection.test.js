"use strict";
const assert = require("assert"), api = require("../../js/hndai-v1/structureHistoricalRrCapEvidenceCollection.js"), tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function scenario(key, time, outcome = "TP_FIRST", candidate = "C1") { return api.getVocabulary().scenarios.map((name, index) => ({
    key, candidateKey: candidate, symbol: "BTCUSDT", interval: "15m", evaluationCloseTime: time,
    scenario: name, maxR: index ? index + 1 : null, direction: "LONG", entryPrice: 100, stopLoss: 90,
    originalTakeProfit: 150, scenarioTakeProfit: index ? 100 + (index + 1) * 10 : 150,
    originalOutcome: outcome, scenarioOutcome: outcome, outcomeAt: time + 900000, entryReachedAt: time + 900000, barsObserved: 1
})); }
function evidence(unit, rows) { return { unitId: unit.id, source: "HISTORICAL_REPLAY", countsTowardLiveReadiness: false,
    gridValid: true, candleGrid: { count: unit.expectedCandleCount }, inputChecksum: "fixture",
    scenarioAnalysis: { valid: true, schemaVersion: "HND_STRUCTURE_HISTORICAL_RR_CAP_SCENARIO_ANALYSIS_V1",
        source: "HISTORICAL_REPLAY", countsTowardLiveReadiness: false, scenarioItems: rows } }; }
function advanceTo(unitPredicate, rowsFactory) { let cp = api.createManifest(), unit;
    while ((unit = api.getNextWorkUnit(cp)) && !unitPredicate(unit)) {
        const result = api.ingestWorkUnit(cp, evidence(unit, rowsFactory ? rowsFactory(unit) : [])); assert.strictEqual(result.valid, true); cp = result.checkpoint;
    } return { cp, unit }; }
test("exact API and safety vocabulary", () => { assert.strictEqual(api.getSchemaVersion(), "HND_STRUCTURE_HISTORICAL_RR_CAP_EVIDENCE_COLLECTION_V1");
    assert.deepStrictEqual(Object.keys(api).sort(), ["getSchemaVersion","getVocabulary","getDefaultConfig","createManifest","validateCheckpoint","getNextWorkUnit","ingestWorkUnit","lockExploratory","aggregateCollection","finalizeCollection","exportCheckpoint","exportCollection"].sort());
    assert.deepStrictEqual(api.getVocabulary().outcomes, ["TP_FIRST","SL_FIRST","AMBIGUOUS_SAME_BAR","ENTRY_NOT_REACHED","OPEN_AT_HORIZON","INSUFFICIENT_FUTURE_DATA","NOT_EVALUABLE"]); });
test("immutable periods and six matrix cells", () => { const config = api.getDefaultConfig(); assert.deepStrictEqual(config.markets, ["BTCUSDT","ETHUSDT","SOLUSDT"]); assert.deepStrictEqual(config.intervals, ["15m","4h"]);
    assert.deepStrictEqual(config.splits, { exploratory:{start:1640995200000,end:1735689599999},oos:{start:1735689600000,end:1782863999999} });
    const cp = api.createManifest(config); assert.strictEqual(new Set(cp.workUnits.map(x => `${x.symbol}|${x.interval}`)).size, 6); assert.ok(cp.workUnits.length <= 120); });
test("config is exact bounded and hashed", () => { const config = api.getDefaultConfig(); config.concurrency = 2; assert.strictEqual(api.createManifest(config), null);
    const cp = api.createManifest(); const changed = JSON.parse(JSON.stringify(cp)); changed.config.requestDelayMs += 1; assert.strictEqual(api.validateCheckpoint(changed).valid, false); });
test("deterministic manifest and unit plan", () => assert.deepStrictEqual(api.createManifest(), api.createManifest()));
test("plan and event duplicates do not increase sample", () => { let cp = api.createManifest(), unit = api.getNextWorkUnit(cp), time = unit.evaluationStart;
    let result = api.ingestWorkUnit(cp, evidence(unit, scenario("P1", time).concat(scenario("P2", time)))); assert.strictEqual(result.valid, true); cp = result.checkpoint;
    assert.strictEqual(api.aggregateCollection(cp).splits.EXPLORATORY.sampleCount, 1); assert.ok(cp.exclusions.some(x => x.reason === "DUPLICATE_PLAN")); });
test("scenario rows are paired and never five samples", () => { let cp = api.createManifest(), unit = api.getNextWorkUnit(cp);
    cp = api.ingestWorkUnit(cp, evidence(unit, scenario("PAIR", unit.evaluationStart))).checkpoint;
    const aggregate = api.aggregateCollection(cp).splits.EXPLORATORY; assert.strictEqual(aggregate.sampleCount, 1); assert.strictEqual(aggregate.scenarios.MAX_5R.sampleCount, 1); });
test("cross-timeframe overlapping episode is deterministic", () => { let cp = api.createManifest(); let unit = api.getNextWorkUnit(cp);
    cp = api.ingestWorkUnit(cp, evidence(unit, scenario("EARLY", unit.evaluationStart).map(x => ({...x,outcomeAt:unit.evaluationStart+6*60*60*1000})))).checkpoint;
    while ((unit = api.getNextWorkUnit(cp)) && !(unit.symbol === "BTCUSDT" && unit.interval === "4h")) cp = api.ingestWorkUnit(cp, evidence(unit, [])).checkpoint;
    const overlapTime = unit.evaluationStart; const rows = scenario("LATE", overlapTime, "TP_FIRST", "C2").map(x => ({...x, interval:"4h"}));
    cp = api.ingestWorkUnit(cp, evidence(unit, rows)).checkpoint; assert.ok(cp.exclusions.some(x => x.reason === "OVERLAPPING_EPISODE")); });
test("all outcomes stay separate", () => { let cp = api.createManifest(), unit = api.getNextWorkUnit(cp), rows = [];
    api.getVocabulary().outcomes.forEach((outcome,index) => rows.push(...scenario(`P${index}`, unit.evaluationStart + index * unit.intervalMs * 2, outcome, `C${index}`)));
    cp = api.ingestWorkUnit(cp, evidence(unit, rows)).checkpoint; const original = api.aggregateCollection(cp).splits.EXPLORATORY.scenarios.ORIGINAL_UNCAPPED;
    api.getVocabulary().outcomes.forEach(outcome => assert.strictEqual(original[outcome], 1)); assert.strictEqual(original.resolvedDirectionalCount, 2); });
test("OOS cannot start before exploratory lock and boundary purge rejects cross split", () => { const advanced = advanceTo(x => x.split === "OOS"); assert.strictEqual(advanced.unit, null);
    const locked = api.lockExploratory(advanced.cp); assert.ok(locked); assert.strictEqual(api.getNextWorkUnit(locked).split, "OOS");
    const unit = api.getNextWorkUnit(locked), rows = scenario("BAD", unit.evaluationStart - unit.intervalMs).map(x => ({...x, evaluationCloseTime:unit.evaluationStart-unit.intervalMs}));
    assert.strictEqual(api.ingestWorkUnit(locked, evidence(unit, rows)).valid, false); });
test("coverage exposes micro imbalance and per-cell minimum", () => { const aggregate = api.aggregateCollection(api.createManifest()).splits.EXPLORATORY;
    assert.deepStrictEqual(aggregate.coverage, { minimum:0, maximum:0, imbalanceRatio:null, balanced:false }); });
test("checkpoint unknown fields and corruption fail closed", () => { const cp = api.createManifest(); cp.unknown = true; assert.strictEqual(api.validateCheckpoint(cp).valid, false);
    const cp2 = api.createManifest(); cp2.checkpointHash = "bad"; assert.strictEqual(api.validateCheckpoint(cp2).error, "CHECKPOINT_INTEGRITY_FAILURE");
    const cp3 = api.createManifest(); cp3.dependencySchemas.outcome = "UNKNOWN"; assert.strictEqual(api.validateCheckpoint(cp3).valid, false); });
test("exports are whitelist, raw candles absent, readiness NONE", () => { const cp = api.createManifest(); const json = api.exportCheckpoint(cp); assert.ok(!json.includes("rawCandles")); assert.strictEqual(JSON.parse(json).readiness, "NONE");
    const locked = api.lockExploratory(advanceTo(x => x.split === "OOS").cp), result = api.finalizeCollection(locked), exported = JSON.parse(api.exportCollection(result));
    assert.deepStrictEqual(Object.keys(exported).sort(), ["schemaVersion","source","sourceSha","countsTowardLiveReadiness","readiness","status","configHash","checkpointHash","aggregate","disclaimer"].sort()); });
let passed = 0; for (const item of tests) { try { item.fn(); passed += 1; console.log("PASS:" + item.name); } catch (error) { console.error("FAIL:" + item.name); console.error(error.stack); process.exitCode = 1; break; } }
if (passed === tests.length) console.log("HND_STRUCTURE_HISTORICAL_RR_CAP_EVIDENCE_COLLECTION_TESTS_PASS:" + passed);
