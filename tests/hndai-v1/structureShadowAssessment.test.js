"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const modulePath = path.resolve(__dirname, "../../js/hndai-v1/structureShadowAssessment.js");
const api = require(modulePath);
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function percentage(n, d) { return d ? Math.round((n / d) * 10000) / 100 : null; }

function projected(comparison = "MATCH_ALLOW") {
    const decisions = {
        MATCH_ALLOW: ["ALLOW", "ALLOW", false, "COMPLETED"],
        MATCH_BLOCK: ["BLOCK", "BLOCK", false, "COMPLETED"],
        LEGACY_ALLOW_GATE_BLOCK: ["ALLOW", "BLOCK", true, "COMPLETED"],
        LEGACY_BLOCK_GATE_ALLOW: ["BLOCK", "ALLOW", true, "COMPLETED"],
        NOT_COMPARABLE: ["ALLOW", null, false, "COMPLETED"],
        PIPELINE_FAILED: ["ALLOW", null, false, "FAILED"],
        NOT_APPLICABLE: [null, null, false, "NOT_APPLICABLE"]
    }[comparison];
    return {
        enabled: true, status: decisions[3], reason: null, mode: "SHADOW",
        legacyDecision: decisions[0], gateDecision: decisions[1], comparison,
        wouldChangeDecision: decisions[2], gateReason: decisions[1] ? "STRUCTURE_REASON" : null,
        error: comparison === "PIPELINE_FAILED" ? "PIPELINE_FAILED" : null,
        failedStage: comparison === "PIPELINE_FAILED" ? "GATE" : null,
        candidateKey: comparison === "NOT_APPLICABLE" ? null : "CANDIDATE-1"
    };
}

function observation(index = 1, comparison = "MATCH_ALLOW", symbol = "BTCUSDT", interval = "15m") {
    const close = 1700000000000 + index * 60000;
    return { key: `${symbol}|${interval}|${close}`, symbol, interval,
        evaluationCloseTime: close, observedAt: close + 1000, shadow: projected(comparison) };
}

function summary(observations, droppedCount = 0) {
    const values = observations.map(item => item.shadow.comparison);
    const count = value => values.filter(item => item === value).length;
    const matchAllowCount = count("MATCH_ALLOW");
    const matchBlockCount = count("MATCH_BLOCK");
    const legacyAllowGateBlockCount = count("LEGACY_ALLOW_GATE_BLOCK");
    const legacyBlockGateAllowCount = count("LEGACY_BLOCK_GATE_ALLOW");
    const matchCount = matchAllowCount + matchBlockCount;
    const mismatchCount = legacyAllowGateBlockCount + legacyBlockGateAllowCount;
    const comparableCount = matchCount + mismatchCount;
    const failedCount = observations.filter(item => item.shadow.status === "FAILED" ||
        item.shadow.comparison === "PIPELINE_FAILED").length;
    return { observationCount: observations.length, comparableCount, matchCount, mismatchCount,
        failedCount, notApplicableCount: count("NOT_APPLICABLE"),
        notComparableCount: count("NOT_COMPARABLE"), matchAllowCount, matchBlockCount,
        legacyAllowGateBlockCount, legacyBlockGateAllowCount,
        matchRate: percentage(matchCount, comparableCount), mismatchRate: percentage(mismatchCount, comparableCount),
        latestObservation: observations.length ? clone(observations.at(-1)) : null,
        markets: [...new Set(observations.map(item => item.symbol))].sort(),
        intervals: [...new Set(observations.map(item => item.interval))].sort(), capacity: 200, droppedCount };
}

function snapshot(observations = []) {
    return { schemaVersion: "HND_STRUCTURE_SHADOW_TELEMETRY_V1",
        summary: summary(observations), observations: clone(observations) };
}

function criteria(overrides = {}) {
    return Object.assign({ minObservationCount: 0, minComparableCount: 0,
        minMarketCount: 0, minIntervalCount: 0, maxMismatchRate: 100, maxFailureRate: 100 }, overrides);
}

function realistic(count = 100, mismatchCount = 0, failedCount = 0) {
    const markets = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    const intervals = ["15m", "1h"];
    return Array.from({ length: count }, (_, index) => {
        const comparison = index < failedCount ? "PIPELINE_FAILED"
            : index < failedCount + mismatchCount ? "LEGACY_ALLOW_GATE_BLOCK"
                : index % 2 ? "MATCH_BLOCK" : "MATCH_ALLOW";
        return observation(index + 1, comparison, markets[index % markets.length], intervals[index % intervals.length]);
    });
}

test("CommonJS API works", () => assert.strictEqual(api.getSchemaVersion(), "HND_STRUCTURE_SHADOW_ASSESSMENT_V1"));
test("browser global API works", () => { const window = {}; vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), { window, JSON, Object, Array, Number, Math, Set, RegExp }); assert.strictEqual(window.HNDStructureShadowAssessment.getSchemaVersion(), api.getSchemaVersion()); });
test("public API is exact", () => assert.deepStrictEqual(Object.keys(api).sort(), ["getSchemaVersion", "getVocabulary", "getDefaultCriteria", "validateSnapshot", "assessSnapshot"].sort()));
test("default criteria is exact", () => assert.deepStrictEqual(api.getDefaultCriteria(), { minObservationCount: 100, minComparableCount: 50, minMarketCount: 3, minIntervalCount: 2, maxMismatchRate: 5, maxFailureRate: 2 }));
test("default criteria is a deep clone", () => { const first = api.getDefaultCriteria(); first.minObservationCount = 0; assert.strictEqual(api.getDefaultCriteria().minObservationCount, 100); });
test("vocabulary is cloned", () => { const value = api.getVocabulary(); value.statuses.length = 0; assert.ok(api.getVocabulary().statuses.length); });
test("valid empty telemetry snapshot validates", () => assert.strictEqual(api.validateSnapshot(snapshot()).valid, true));
test("wrong schema is rejected", () => { const value = snapshot(); value.schemaVersion = "V2"; assert.strictEqual(api.validateSnapshot(value).error, "INVALID_SCHEMA_VERSION"); });
test("missing top field is rejected", () => { const value = snapshot(); delete value.summary; assert.strictEqual(api.validateSnapshot(value).valid, false); });
test("extra top field is rejected", () => { const value = snapshot(); value.extra = true; assert.strictEqual(api.validateSnapshot(value).valid, false); });
test("non-array observations are rejected", () => { const value = snapshot(); value.observations = {}; assert.strictEqual(api.validateSnapshot(value).error, "INVALID_OBSERVATIONS"); });
test("more than 200 observations are rejected", () => { const value = realistic(201); value.splice(200, 1, observation(201, "MATCH_ALLOW", "XRPUSDT", "4h")); const snap = snapshot(value); assert.strictEqual(api.validateSnapshot(snap).error, "OBSERVATION_LIMIT_EXCEEDED"); });
test("duplicate key is rejected", () => { const item = observation(); const snap = snapshot([item, clone(item)]); assert.strictEqual(api.validateSnapshot(snap).error, "DUPLICATE_OBSERVATION_KEY"); });
test("incorrect key is rejected", () => { const item = observation(); item.key = "BAD"; assert.strictEqual(api.validateSnapshot(snapshot([item])).error, "INVALID_OBSERVATION"); });
test("lowercase symbol is rejected", () => { const item = observation(); item.symbol = "btcusdt"; item.key = `btcusdt|15m|${item.evaluationCloseTime}`; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("empty interval is rejected", () => { const item = observation(); item.interval = ""; item.key = `BTCUSDT||${item.evaluationCloseTime}`; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("unsafe evaluation time is rejected", () => { const item = observation(); item.evaluationCloseTime = 0; item.key = "BTCUSDT|15m|0"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("unsafe observed time is rejected", () => { const item = observation(); item.observedAt = -1; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("unknown comparison is rejected", () => { const item = observation(); item.shadow.comparison = "UNKNOWN"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("unknown status is rejected", () => { const item = observation(); item.shadow.status = "DISABLED"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("unknown legacy decision is rejected", () => { const item = observation(); item.shadow.legacyDecision = "WAIT"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("unknown gate decision is rejected", () => { const item = observation(); item.shadow.gateDecision = "WAIT"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("MATCH_ALLOW decision mismatch is rejected", () => { const item = observation(); item.shadow.gateDecision = "BLOCK"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("MATCH_BLOCK decision mismatch is rejected", () => { const item = observation(1, "MATCH_BLOCK"); item.shadow.legacyDecision = "ALLOW"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("legacy allow gate block mismatch is rejected", () => { const item = observation(1, "LEGACY_ALLOW_GATE_BLOCK"); item.shadow.gateDecision = "ALLOW"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("legacy block gate allow mismatch is rejected", () => { const item = observation(1, "LEGACY_BLOCK_GATE_ALLOW"); item.shadow.legacyDecision = "ALLOW"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("wouldChangeDecision mismatch is rejected", () => { const item = observation(1, "LEGACY_ALLOW_GATE_BLOCK"); item.shadow.wouldChangeDecision = false; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("DISABLED observation is rejected", () => { const item = observation(); item.shadow.enabled = false; item.shadow.status = "DISABLED"; assert.strictEqual(api.validateSnapshot(snapshot([item])).valid, false); });
test("summary is independently recomputed", () => { const result = api.validateSnapshot(snapshot(realistic(6, 1, 1))); assert.strictEqual(result.recomputedSummary.observationCount, 6); assert.strictEqual(result.recomputedSummary.mismatchCount, 1); });
test("tampered match rate creates SUMMARY_MISMATCH", () => { const snap = snapshot([observation()]); snap.summary.matchRate = 1; const result = api.validateSnapshot(snap); assert.strictEqual(result.error, "SUMMARY_MISMATCH"); assert.ok(result.mismatches.some(item => item.field === "matchRate")); });
test("tampered mismatch count creates diagnostic", () => { const snap = snapshot([observation()]); snap.summary.mismatchCount = 1; const result = api.validateSnapshot(snap); assert.ok(result.mismatches.some(item => item.field === "mismatchCount")); });
test("match counters are correct", () => { const value = api.validateSnapshot(snapshot([observation(), observation(2, "MATCH_BLOCK")])).recomputedSummary; assert.deepStrictEqual([value.matchAllowCount, value.matchBlockCount, value.matchCount], [1, 1, 2]); });
test("mismatch counters are correct", () => { const value = api.validateSnapshot(snapshot([observation(1, "LEGACY_ALLOW_GATE_BLOCK"), observation(2, "LEGACY_BLOCK_GATE_ALLOW")])).recomputedSummary; assert.deepStrictEqual([value.legacyAllowGateBlockCount, value.legacyBlockGateAllowCount, value.mismatchCount], [1, 1, 2]); });
test("failure rate is correct", () => assert.strictEqual(api.assessSnapshot(snapshot(realistic(10, 0, 1)), criteria()).failureRate, 10));
test("zero denominator failure rate is null", () => assert.strictEqual(api.assessSnapshot(snapshot(), criteria()).failureRate, null));
test("missing criteria field is rejected", () => { const value = criteria(); delete value.minMarketCount; assert.strictEqual(api.assessSnapshot(snapshot(), value).status, "INVALID_CRITERIA"); });
test("extra criteria field is rejected", () => assert.strictEqual(api.assessSnapshot(snapshot(), Object.assign(criteria(), { extra: 1 })).status, "INVALID_CRITERIA"));
test("invalid criteria rate is rejected", () => assert.strictEqual(api.assessSnapshot(snapshot(), criteria({ maxMismatchRate: 101 })).status, "INVALID_CRITERIA"));
test("invalid criteria count is rejected", () => assert.strictEqual(api.assessSnapshot(snapshot(), criteria({ minObservationCount: 1.5 })).status, "INVALID_CRITERIA"));
test("insufficient data has priority", () => assert.strictEqual(api.assessSnapshot(snapshot([observation(1, "LEGACY_ALLOW_GATE_BLOCK")])).status, "INSUFFICIENT_DATA"));
test("high mismatch requires review", () => assert.strictEqual(api.assessSnapshot(snapshot(realistic(100, 6)), api.getDefaultCriteria()).status, "REVIEW_REQUIRED"));
test("high failure rate requires review", () => assert.strictEqual(api.assessSnapshot(snapshot(realistic(100, 0, 3)), api.getDefaultCriteria()).status, "REVIEW_REQUIRED"));
test("all diagnostic criteria can be met", () => assert.strictEqual(api.assessSnapshot(snapshot(realistic(100, 2, 1)), api.getDefaultCriteria()).status, "OBSERVATION_CRITERIA_MET"));
test("result includes disclaimer", () => assert.match(api.assessSnapshot(snapshot()).disclaimer, /does not authorize entries or trading/));
test("snapshot input is not mutated", () => { const value = snapshot(realistic(4)); const before = clone(value); api.assessSnapshot(value); assert.deepStrictEqual(value, before); });
test("criteria input is not mutated", () => { const value = criteria(); const before = clone(value); api.assessSnapshot(snapshot(), value); assert.deepStrictEqual(value, before); });
test("assessment is deterministic", () => { const value = snapshot(realistic(100, 2, 1)); assert.deepStrictEqual(api.assessSnapshot(value), api.assessSnapshot(value)); });
test("exceptions never escape", () => { const circular = {}; circular.self = circular; assert.doesNotThrow(() => api.validateSnapshot(circular)); assert.strictEqual(api.validateSnapshot(circular).valid, false); });
test("latest observation is validated", () => { const snap = snapshot([observation()]); snap.summary.latestObservation.observedAt += 1; assert.strictEqual(api.validateSnapshot(snap).error, "SUMMARY_MISMATCH"); });
test("droppedCount must be safe non-negative", () => { const snap = snapshot(); snap.summary.droppedCount = -1; assert.strictEqual(api.validateSnapshot(snap).error, "INVALID_SUMMARY"); });
test("UI avoids innerHTML", () => assert.ok(!fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8").includes("innerHTML")));
test("script order is telemetry then assessment then UI", () => { const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8"); assert.ok(html.indexOf("structureShadowTelemetry.js") < html.indexOf("structureShadowAssessment.js")); assert.ok(html.indexOf("structureShadowAssessment.js") < html.indexOf("js/ui.js")); });
test("UI import uses FileReader and 5 MB limit", () => { const ui = fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"); assert.match(ui, /new FileReader\(\)/); assert.match(ui, /5 \* 1024 \* 1024/); });
test("UI keeps assessment disclaimer visible", () => { const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8"); assert.match(html, /structureShadowAssessmentDisclaimer/); assert.match(html, /does not authorize entries or trading/); });

(async () => {
    let assertions = 0;
    for (const current of tests) {
        try { await current.fn(); assertions += 1; }
        catch (error) { console.error(`FAIL: ${current.name}`); throw error; }
    }
    console.log(`Structure Shadow Assessment tests passed: ${tests.length} scenarios, ${assertions} assertions.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
