"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const modulePath = path.resolve(__dirname, "../../js/hndai-v1/structureShadowTelemetry.js");
const telemetry = require(modulePath);
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function shadow(comparison, overrides) {
    const mismatch = ["LEGACY_ALLOW_GATE_BLOCK", "LEGACY_BLOCK_GATE_ALLOW"].includes(comparison);
    const legacyDecision = comparison === "LEGACY_BLOCK_GATE_ALLOW" || comparison === "MATCH_BLOCK"
        ? "BLOCK" : "ALLOW";
    const gateDecision = comparison === "PIPELINE_FAILED" || comparison === "NOT_COMPARABLE"
        ? null : comparison === "LEGACY_ALLOW_GATE_BLOCK" || comparison === "MATCH_BLOCK"
            ? "BLOCK" : "ALLOW";
    const result = Object.assign({
        mode: "SHADOW", status: "COMPLETED", legacyDecision,
        gateDecision, comparison, wouldChangeDecision: mismatch,
        gateReason: gateDecision ? "STRUCTURE_REASON" : null,
        error: null, candidateKey: "KEY-1", diagnostics: { failedStage: null }
    }, overrides?.shadowResult || {});
    return Object.assign({
        enabled: true, status: result.status, reason: null,
        legacyResult: { decision: legacyDecision, reason: "LEGACY_REASON",
            candidate: { key: "KEY-1" } }, shadowResult: result
    }, overrides?.wrapper || {});
}

function notApplicable() {
    return {
        enabled: true, status: "NOT_APPLICABLE", reason: "EXISTING_SETUP_EVALUATION",
        legacyResult: null, shadowResult: null
    };
}

function failedWithoutResult() {
    return {
        enabled: true, status: "FAILED", reason: "SHADOW_EVALUATION_EXCEPTION",
        legacyResult: { decision: "ALLOW", reason: "SETUP_CREATED",
            candidate: { key: "KEY-1" } }, shadowResult: null
    };
}

function observation(comparison, overrides) {
    return Object.assign({
        symbol: "BTCUSDT", interval: "15m", evaluationCloseTime: 1999,
        observedAt: 2000, shadow: typeof comparison === "string" ? shadow(comparison) : comparison
    }, overrides || {});
}

function fresh() { telemetry.reset("TEST_RESET"); return telemetry; }

function loadBrowser() {
    const code = fs.readFileSync(modulePath, "utf8");
    const window = {};
    vm.runInNewContext(code, { window, JSON, Object, Array, Number, Math, Set, RegExp });
    return window.HNDStructureShadowTelemetry;
}

test("CommonJS and browser global APIs work", () => {
    assert.strictEqual(telemetry.getSchemaVersion(), "HND_STRUCTURE_SHADOW_TELEMETRY_V1");
    assert.strictEqual(loadBrowser().getSchemaVersion(), "HND_STRUCTURE_SHADOW_TELEMETRY_V1");
});

test("public API is exact", () => assert.deepStrictEqual(Object.keys(telemetry).sort(), [
    "record", "getSummary", "getObservations", "reset", "exportSnapshot", "getSchemaVersion"
].sort()));

test("valid observation is recorded", () => {
    const api = fresh(); const result = api.record(observation("MATCH_ALLOW"));
    assert.strictEqual(result.valid, true); assert.strictEqual(result.recorded, true);
    assert.strictEqual(api.getSummary().observationCount, 1);
});

test("record never mutates input", () => {
    const api = fresh(); const input = observation("MATCH_ALLOW"); const before = clone(input);
    api.record(input); assert.deepStrictEqual(input, before);
});

test("getter outputs are deep clones", () => {
    const api = fresh(); api.record(observation("MATCH_ALLOW"));
    const list = api.getObservations(); list[0].shadow.comparison = "BROKEN";
    const summary = api.getSummary(); summary.latestObservation.shadow.comparison = "BROKEN";
    assert.strictEqual(api.getObservations()[0].shadow.comparison, "MATCH_ALLOW");
    assert.strictEqual(api.getSummary().latestObservation.shadow.comparison, "MATCH_ALLOW");
});

test("invalid observation does not change state", () => {
    const api = fresh(); api.record(observation("MATCH_ALLOW")); const before = api.exportSnapshot();
    for (const input of [null, {}, observation("MATCH_ALLOW", { symbol: "btc" }),
        observation("MATCH_ALLOW", { interval: "" }), observation("MATCH_ALLOW", { evaluationCloseTime: 0 }),
        observation("MATCH_ALLOW", { extra: true }), observation({ invalid: true })]) {
        assert.strictEqual(api.record(input).valid, false);
    }
    assert.deepStrictEqual(api.exportSnapshot(), before);
});

test("DISABLED observation is skipped", () => {
    const api = fresh(); const result = api.record(observation({
        enabled: false, status: "DISABLED", reason: "FEATURE_DISABLED",
        legacyResult: null, shadowResult: null
    }));
    assert.strictEqual(result.valid, true); assert.strictEqual(result.recorded, false);
    assert.strictEqual(api.getSummary().observationCount, 0);
});

test("same dedup key replaces without double count", () => {
    const api = fresh(); api.record(observation("NOT_COMPARABLE"));
    const result = api.record(observation("MATCH_ALLOW", { observedAt: 5000 }));
    assert.strictEqual(result.replaced, true); assert.strictEqual(api.getSummary().observationCount, 1);
    assert.strictEqual(api.getSummary().matchAllowCount, 1);
});

test("same close time with different symbol is distinct", () => {
    const api = fresh(); api.record(observation("MATCH_ALLOW"));
    api.record(observation("MATCH_ALLOW", { symbol: "ETHUSDT" }));
    assert.strictEqual(api.getSummary().observationCount, 2);
    assert.deepStrictEqual(api.getSummary().markets, ["BTCUSDT", "ETHUSDT"]);
});

test("same close time with different interval is distinct", () => {
    const api = fresh(); api.record(observation("MATCH_ALLOW"));
    api.record(observation("MATCH_ALLOW", { interval: "1h" }));
    assert.strictEqual(api.getSummary().observationCount, 2);
    assert.deepStrictEqual(api.getSummary().intervals, ["15m", "1h"]);
});

test("capacity is limited to 200 observations", () => {
    const api = fresh();
    for (let index = 1; index <= 205; index += 1) {
        api.record(observation("MATCH_ALLOW", {
            evaluationCloseTime: index, observedAt: index + 1000
        }));
    }
    assert.strictEqual(api.getObservations().length, 200);
    assert.strictEqual(api.getSummary().capacity, 200);
});

test("oldest unique observation is evicted", () => {
    const api = fresh();
    for (let index = 1; index <= 201; index += 1) api.record(observation("MATCH_ALLOW", {
        evaluationCloseTime: index, observedAt: index + 1000
    }));
    assert.strictEqual(api.getObservations()[0].evaluationCloseTime, 2);
    assert.strictEqual(api.getObservations().at(-1).evaluationCloseTime, 201);
});

test("droppedCount tracks unique evictions only", () => {
    const api = fresh();
    for (let index = 1; index <= 202; index += 1) api.record(observation("MATCH_ALLOW", {
        evaluationCloseTime: index, observedAt: index + 1000
    }));
    api.record(observation("MATCH_BLOCK", { evaluationCloseTime: 202, observedAt: 9999 }));
    assert.strictEqual(api.getSummary().droppedCount, 2);
});

test("match counters are correct", () => {
    const api = fresh(); api.record(observation("MATCH_ALLOW"));
    api.record(observation("MATCH_BLOCK", { evaluationCloseTime: 2999 }));
    const value = api.getSummary(); assert.strictEqual(value.matchCount, 2);
    assert.strictEqual(value.matchAllowCount, 1); assert.strictEqual(value.matchBlockCount, 1);
});

test("mismatch counters are correct", () => {
    const api = fresh(); api.record(observation("LEGACY_ALLOW_GATE_BLOCK"));
    api.record(observation("LEGACY_BLOCK_GATE_ALLOW", { evaluationCloseTime: 2999 }));
    const value = api.getSummary(); assert.strictEqual(value.mismatchCount, 2);
    assert.strictEqual(value.legacyAllowGateBlockCount, 1);
    assert.strictEqual(value.legacyBlockGateAllowCount, 1);
});

test("NOT_APPLICABLE is outside comparable denominator", () => {
    const api = fresh(); api.record(observation(notApplicable())); const value = api.getSummary();
    assert.strictEqual(value.notApplicableCount, 1); assert.strictEqual(value.comparableCount, 0);
});

test("NOT_COMPARABLE is outside comparable denominator", () => {
    const api = fresh(); api.record(observation("NOT_COMPARABLE")); const value = api.getSummary();
    assert.strictEqual(value.notComparableCount, 1); assert.strictEqual(value.comparableCount, 0);
});

test("PIPELINE_FAILED is error outside comparable denominator", () => {
    const api = fresh(); api.record(observation("PIPELINE_FAILED")); const value = api.getSummary();
    assert.strictEqual(value.failedCount, 1); assert.strictEqual(value.comparableCount, 0);
});

test("FAILED wrapper without result is counted as error", () => {
    const api = fresh(); api.record(observation(failedWithoutResult())); const value = api.getSummary();
    assert.strictEqual(value.failedCount, 1);
    assert.strictEqual(value.latestObservation.shadow.comparison, "PIPELINE_FAILED");
});

test("zero denominator rates are null", () => {
    const value = fresh().getSummary(); assert.strictEqual(value.matchRate, null);
    assert.strictEqual(value.mismatchRate, null);
});

test("match and mismatch rates are percentages", () => {
    const api = fresh(); api.record(observation("MATCH_ALLOW"));
    api.record(observation("MATCH_BLOCK", { evaluationCloseTime: 2999 }));
    api.record(observation("LEGACY_ALLOW_GATE_BLOCK", { evaluationCloseTime: 3999 }));
    const value = api.getSummary(); assert.strictEqual(value.matchRate, 66.67);
    assert.strictEqual(value.mismatchRate, 33.33);
});

test("reset clears telemetry state only", () => {
    const api = fresh(); const external = { setup: "PENDING", plan: "READY", trade: "OPEN" };
    api.record(observation("MATCH_ALLOW")); const result = api.reset("UI_RESET");
    assert.strictEqual(result.observationCount, 0); assert.strictEqual(api.getSummary().droppedCount, 0);
    assert.deepStrictEqual(external, { setup: "PENDING", plan: "READY", trade: "OPEN" });
});

test("export snapshot is deep cloned and deterministic", () => {
    const api = fresh(); api.record(observation("MATCH_ALLOW"));
    const first = api.exportSnapshot(); const second = api.exportSnapshot();
    assert.deepStrictEqual(first, second); first.observations[0].symbol = "BROKEN";
    assert.strictEqual(api.exportSnapshot().observations[0].symbol, "BTCUSDT");
});

const root = path.resolve(__dirname, "../..");
const scriptCode = fs.readFileSync(path.join(root, "script.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const uiCode = fs.readFileSync(path.join(root, "js/ui.js"), "utf8");

test("runtime record is gated by enabled flag and successful setup", () => {
    const start = scriptCode.indexOf("let structureShadowTelemetry = null");
    const end = scriptCode.indexOf("window.HNDLastSetupEvaluation", start);
    const source = scriptCode.slice(start, end);
    assert.ok(source.includes("setupEvaluationSucceeded && structureShadowEnabled"));
    assert.ok(source.includes('structureShadow.status !== "DISABLED"'));
    assert.ok(source.indexOf("telemetry.record({") > source.indexOf("setupEvaluationSucceeded"));
});

test("telemetry is not passed to setup plan or trade decisions", () => {
    assert.ok(!scriptCode.includes("effectiveDecision")); assert.ok(!scriptCode.includes("gateDecision"));
    const planStart = scriptCode.indexOf("HNDTradePlanEngine.evaluate({");
    const planEnd = scriptCode.indexOf("});", planStart);
    const tradeStart = scriptCode.indexOf("HNDTradeEngine.evaluate({");
    const tradeEnd = scriptCode.indexOf("});", tradeStart);
    assert.ok(!scriptCode.slice(planStart, planEnd).includes("structureShadowTelemetry"));
    assert.ok(!scriptCode.slice(tradeStart, tradeEnd).includes("structureShadowTelemetry"));
});

function loadUI() {
    const ids = ["structureShadowObservations", "structureShadowObservationCount",
        "structureShadowComparableCount", "structureShadowMatchCount",
        "structureShadowMismatchCount", "structureShadowMatchRate", "structureShadowErrorCount",
        "structureShadowNotApplicableCount", "structureShadowNotComparableCount",
        "structureShadowCapacity", "resetStructureShadowObservations",
        "exportStructureShadowDiagnostics"];
    const listeners = {};
    const values = new Map();
    const elements = {};
    ids.forEach(id => { elements[id] = {
        textContent: "", classList: { add(v) { values.set(v, true); }, remove(v) { values.delete(v); },
            contains(v) { return values.has(v); }, [Symbol.iterator]: function* () {} },
        addEventListener(type, fn) { listeners[id + ":" + type] = fn; }
    }; });
    let resetCalls = 0; let exported = null;
    const telemetryMock = {
        reset() { resetCalls += 1; }, getSummary() { return fresh().getSummary(); },
        exportSnapshot() { return { schemaVersion: "SAFE", observations: [] }; }
    };
    const document = {
        getElementById(id) { return elements[id] || null; }, body: { appendChild() {} },
        createElement() { return { click() {}, remove() {}, set href(v) {}, set download(v) { exported = v; } }; }
    };
    const context = { document, window: { HNDStructureShadowTelemetry: telemetryMock }, activeTrade: null,
        console: { log() {}, warn() {}, error() {} },
        Blob: function (parts) { this.parts = parts; },
        URL: { createObjectURL() { return "blob:safe"; }, revokeObjectURL() {} }
    };
    vm.runInNewContext(uiCode, context);
    return { context, elements, listeners, values, resetCalls: () => resetCalls,
        exported: () => exported };
}

test("UI safely renders empty telemetry", () => {
    const fixture = loadUI(); fixture.context.updateStructureShadowTelemetryUI(null);
    assert.strictEqual(fixture.elements.structureShadowObservationCount.textContent, 0);
    assert.strictEqual(fixture.elements.structureShadowMatchRate.textContent, "-");
    assert.strictEqual(fixture.elements.structureShadowCapacity.textContent, "0 / 200");
});

test("UI safely renders match summary", () => {
    const fixture = loadUI(); fixture.context.updateStructureShadowTelemetryUI({
        observationCount: 2, comparableCount: 2, matchCount: 2, mismatchCount: 0,
        matchRate: 100, failedCount: 0, notApplicableCount: 0,
        notComparableCount: 0, capacity: 200
    });
    assert.strictEqual(fixture.elements.structureShadowMatchRate.textContent, "100.00%");
    assert.strictEqual(fixture.values.has("telemetry-mismatch"), false);
});

test("UI safely marks mismatch and error summaries", () => {
    const fixture = loadUI(); fixture.context.updateStructureShadowTelemetryUI({
        observationCount: 2, comparableCount: 1, matchCount: 0, mismatchCount: 1,
        matchRate: 0, failedCount: 0, notApplicableCount: 0, notComparableCount: 1, capacity: 200
    });
    assert.strictEqual(fixture.values.has("telemetry-mismatch"), true);
    fixture.context.updateStructureShadowTelemetryUI({ observationCount: 2, capacity: 200,
        failedCount: 1, mismatchCount: 1 });
    assert.strictEqual(fixture.values.has("telemetry-error"), true);
});

test("reset button calls telemetry reset only", () => {
    const fixture = loadUI(); fixture.listeners["resetStructureShadowObservations:click"]();
    assert.strictEqual(fixture.resetCalls(), 1);
    assert.ok(!uiCode.includes("HNDSetupEngine?.reset"));
    assert.ok(!uiCode.includes("HNDTradeEngine?.reset"));
});

test("export creates diagnostic-only dated JSON filename", () => {
    const fixture = loadUI(); fixture.listeners["exportStructureShadowDiagnostics:click"]();
    assert.match(fixture.exported(), /^HNDai-structure-shadow-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);
    assert.ok(!uiCode.slice(uiCode.indexOf("function downloadStructureShadowDiagnostics"),
        uiCode.indexOf("function setupStructureShadowTelemetryControls")).includes("localStorage"));
});

test("telemetry script order is correct", () => {
    const shadowIndex = html.indexOf("structureShadowMode.js");
    const telemetryIndex = html.indexOf("structureShadowTelemetry.js");
    const setupIndex = html.indexOf("js/setupEngine.js");
    assert.ok(shadowIndex < telemetryIndex && telemetryIndex < setupIndex);
});

test("production module contains no persistence network or decision engine integration", () => {
    const code = fs.readFileSync(modulePath, "utf8");
    for (const token of ["localStorage", "sessionStorage", "indexedDB", "document.cookie",
        "fetch(", "XMLHttpRequest", "WebSocket", "setupEngine", "tradePlan", "tradeEngine",
        "entryPrice", "stopLoss", "takeProfit", "Date.now", "Math.random"]) {
        assert.strictEqual(code.includes(token), false, token);
    }
});

test("existing test packages remain present", () => {
    assert.ok(fs.existsSync(path.join(root, "tests/hndai-v1/structureShadowRuntimeUI.test.js")));
    assert.ok(fs.existsSync(path.join(root,
        "tests/hndai-v1/setupEngineStructureShadowIntegration.test.js")));
});

let passed = 0;
for (const item of tests) {
    try { item.fn(); passed += 1; console.log("PASS:" + item.name); }
    catch (error) {
        console.error("HND_STRUCTURE_SHADOW_TELEMETRY_TEST_FAILED:" + item.name);
        console.error(error.stack || error); process.exitCode = 1; break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_SHADOW_TELEMETRY_TESTS_PASS:" + tests.length);
}
