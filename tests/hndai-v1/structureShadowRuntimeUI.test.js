"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptCode = fs.readFileSync(path.join(root, "script.js"), "utf8");
const uiCode = fs.readFileSync(path.join(root, "js/ui.js"), "utf8");

function classList(initial) {
    const values = new Set(initial || []);
    return {
        add: value => values.add(value), remove: value => values.delete(value),
        contains: value => values.has(value), [Symbol.iterator]: () => values.values()
    };
}

function loadRuntime() {
    const listeners = {};
    const elements = {
        structureShadowToggle: {
            checked: true,
            addEventListener(type, handler) { listeners[type] = handler; }
        },
        structureShadowToggleState: { textContent: "STALE" }
    };
    const document = {
        getElementById(id) { return elements[id] || null; },
        createElement() { return { textContent: "", appendChild() {} }; }
    };
    const context = {
        window: {}, document,
        console: { log() {}, warn() {}, error() {} },
        setInterval() { return 1; }, clearInterval() {},
        fetchCandles: async () => [], fetchPrice: async () => 1,
        analyzeMarket: () => ({ signal: "WAIT" }),
        getLiveStructureZoneQualificationOptions: () => ({}),
        getLiveStructureHistoricalInputOptions: () => ({ structureLookback: 3,
            structureHistoryLimit: 100, rawZoneHistoryLimit: 200 })
    };
    vm.runInNewContext(scriptCode, context);
    return { api: context.window.HNDStructureShadowRuntimeTestAPI,
        toggle: elements.structureShadowToggle, state: elements.structureShadowToggleState,
        change: () => listeners.change() };
}

function loadUI(includeElements = true) {
    const ids = ["structureShadowCard", "structureShadowMode", "structureShadowStatus",
        "structureShadowLegacyDecision", "structureShadowGateDecision",
        "structureShadowComparison", "structureShadowWouldChange", "structureShadowGateReason",
        "structureShadowError", "structureShadowFailedStage", "structureShadowCandidateKey"];
    const elements = {};
    if (includeElements) ids.forEach(id => {
        elements[id] = { textContent: "", classList: classList(id === "structureShadowCard"
            ? ["card", "structure-shadow-state-off"] : []) };
    });
    const document = {
        getElementById(id) { return elements[id] || null; },
        createElement() { return { textContent: "", appendChild() {} }; }
    };
    const context = {
        document, window: {}, activeTrade: null,
        console: { log() {}, warn() {}, error() {} },
        Blob: function () {}, URL: { createObjectURL() {}, revokeObjectURL() {} }
    };
    vm.runInNewContext(uiCode, context);
    return { update: context.updateStructureShadowUI, elements };
}

function loadHistoricalMismatchUI(options = {}) {
    const listeners = new Map(), elements = {};
    function element(id) {
        const item = { id, textContent: "", children: [], classList: classList(), disabled: false,
            addEventListener(type, handler) { const key = `${id}:${type}`, list = listeners.get(key) || []; list.push(handler); listeners.set(key, list); },
            appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; },
            click() { (listeners.get(`${id}:click`) || []).forEach(handler => handler({ target: item })); }, remove() {} };
        return item;
    }
    ["historicalMismatchAnalyzerStatus", "historicalMismatchObservations", "historicalMismatchComparable",
        "historicalMismatchMatches", "historicalMismatchMismatches", "historicalMismatchFailures",
        "historicalMismatchNotComparable", "historicalMismatchMatchRate", "historicalMismatchMismatchRate",
        "historicalMismatchWarning", "historicalMismatchReview", "historicalMismatchReviewBody"]
        .forEach(id => { elements[id] = element(id); });
    ["historicalOutcomeStatus", "historicalOutcomeMismatches", "historicalOutcomeEvaluable",
        "historicalOutcomeNotEvaluable", "historicalOutcomeTpFirst", "historicalOutcomeSlFirst",
        "historicalOutcomeAmbiguous", "historicalOutcomeEntryNotReached", "historicalOutcomeOpen",
        "historicalOutcomeInsufficient", "historicalOutcomeWarning", "historicalOutcomeReview",
        "historicalOutcomeReviewBody"].forEach(id => { elements[id] = element(id); });
    ["historicalRrCapStatus", "historicalRrCapReadiness", "historicalRrCapWarning",
        "historicalRrCapReview", "historicalRrCapSummaryBody", "historicalRrCapDetailBody"]
        .forEach(id => { elements[id] = element(id); });
    if (options.analyze !== false) elements.analyzeHistoricalMismatch = element("analyzeHistoricalMismatch");
    if (options.export !== false) elements.exportHistoricalMismatchAnalysis = element("exportHistoricalMismatchAnalysis");
    if (options.outcomeAnalyze !== false) elements.analyzeHistoricalMismatchOutcomes = element("analyzeHistoricalMismatchOutcomes");
    if (options.outcomeExport !== false) elements.exportHistoricalMismatchOutcomes = element("exportHistoricalMismatchOutcomes");
    if (options.rrCapAnalyze !== false) elements.analyzeHistoricalRrCapScenarios = element("analyzeHistoricalRrCapScenarios");
    if (options.rrCapExport !== false) elements.exportHistoricalRrCapScenarios = element("exportHistoricalRrCapScenarios");
    const document = { readyState: options.readyState || "complete", body: element("body"),
        getElementById(id) { return elements[id] || null; }, createElement(tag) { return element(tag); }, addEventListener() {} };
    const analysis = { valid: true, status: "REVIEW_ITEMS_FOUND", observationCount: 2, comparableCount: 2,
        matchCount: 1, mismatchCount: 1, failureCount: 0, notComparableCount: 0, matchRate: 50, mismatchRate: 50,
        reviewItems: [{ priority: "HIGH", symbol: "BTCUSDT", interval: "4h", category: "LEGACY_ALLOW_GATE_BLOCK",
            legacyDecision: "ALLOW", gateDecision: "BLOCK", legacyReason: "SETUP_CREATED", gateReason: "NO_EVENT",
            builderStatus: "INPUT_READY", suggestedReview: "Compare direct evidence." }] };
    const outcome = { valid: true, status: "NO_EVALUABLE_ITEMS", analyzedMismatchCount: 1, evaluableCount: 0,
        notEvaluableCount: 1, tpFirstCount: 0, slFirstCount: 0, ambiguousCount: 0, entryNotReachedCount: 0,
        openAtHorizonCount: 0, insufficientFutureDataCount: 0, outcomeItems: [] };
    const rrCap = { valid: true, status: "SCENARIOS_AVAILABLE", countsTowardLiveReadiness: false,
        scenarioSummaries: [{ scenario: "MAX_2R", maxR: 2, evaluableCount: 1, notEvaluableCount: 0,
            tpFirstCount: 1, slFirstCount: 0, ambiguousCount: 0, entryNotReachedCount: 0,
            openAtHorizonCount: 0, insufficientFutureDataCount: 0 }],
        scenarioItems: [{ symbol: "BTCUSDT", interval: "4h", scenario: "MAX_2R", direction: "LONG",
            entryPrice: 100, stopLoss: 90, originalTakeProfit: 150, scenarioTakeProfit: 120,
            wasCapped: true, scenarioOutcome: "TP_FIRST" }] };
    const context = { document, window: { HNDStructureHistoricalMismatchAnalyzer: {
            analyzeReplay() { return clone(analysis); }, exportAnalysis() { return "{}"; } } }, activeTrade: null,
        console: { log() {}, warn() {}, error() {} }, Blob: function () {},
        URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} }, Date };
    if (options.outcomeDependency !== false) context.window.HNDStructureHistoricalMismatchOutcomeAnalyzer = {
        analyzeOutcomes() { return clone(outcome); }, exportOutcomeAnalysis() { return "{}"; } };
    if (options.rrCapDependency !== false) context.window.HNDStructureHistoricalRrCapScenarioAnalyzer = {
        analyzeScenarios() { return clone(rrCap); }, exportScenarioAnalysis() { return "{}"; } };
    vm.runInNewContext(uiCode, context);
    return { context, elements, listenerCount(id) { return (listeners.get(`${id}:click`) || []).length; },
        setReplay(value) { vm.runInNewContext(`lastStructureHistoricalShadowReplay = ${JSON.stringify(value)}`, context); },
        setOutcomeInputs() { vm.runInNewContext(`lastStructureHistoricalShadowReplay = ${JSON.stringify({schemaVersion:"HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1"})}; lastStructureHistoricalMismatchAnalysis = ${JSON.stringify(analysis)}; lastStructureHistoricalShadowReplayCandles = [];`, context); },
        installOutcomeDependency() { context.window.HNDStructureHistoricalMismatchOutcomeAnalyzer = {
            analyzeOutcomes() { return clone(outcome); }, exportOutcomeAnalysis() { return "{}"; } }; },
        installRrCapDependency() { context.window.HNDStructureHistoricalRrCapScenarioAnalyzer = {
            analyzeScenarios() { return clone(rrCap); }, exportScenarioAnalysis() { return "{}"; } }; },
        setup() { vm.runInNewContext("setupStructureHistoricalMismatchControls(); setupStructureHistoricalOutcomeControls(); setupStructureHistoricalRrCapControls();", context); } };
}

function candles() {
    return [
        { time: 1000, closeTime: 1999, open: 10, high: 12, low: 9, close: 11, volume: 5 },
        { time: 2000, closeTime: 2999, open: 11, high: 13, low: 10, close: 12, volume: 6 },
        { time: 3000, closeTime: 3999, open: 12, high: 14, low: 11, close: 13, volume: 7 }
    ];
}

function diagnostic(status, overrides) {
    const shadowResult = status === "COMPLETED" ? Object.assign({
        mode: "SHADOW", status: "COMPLETED", legacyDecision: "ALLOW",
        gateDecision: "ALLOW", comparison: "MATCH_ALLOW", wouldChangeDecision: false,
        gateReason: "STRUCTURE_MATCH", error: null, candidateKey: "KEY-1",
        diagnostics: { failedStage: null }
    }, overrides) : status === "FAILED" ? Object.assign({
        mode: "SHADOW", status: "FAILED", legacyDecision: "ALLOW",
        gateDecision: null, comparison: "PIPELINE_FAILED", wouldChangeDecision: false,
        gateReason: null, error: "PIPELINE_STAGE_FAILED", candidateKey: "KEY-1",
        diagnostics: { failedStage: "STRUCTURE_BREAK" }
    }, overrides) : null;
    return {
        enabled: status !== "DISABLED", status,
        reason: status === "NOT_APPLICABLE" ? "EXISTING_SETUP_EVALUATION"
            : status === "FAILED" ? "PIPELINE_STAGE_FAILED" : status === "DISABLED"
                ? "FEATURE_DISABLED" : null,
        legacyResult: status === "DISABLED" ? null : { decision: "ALLOW", reason: "SETUP_CREATED",
            candidate: { key: "KEY-1" } },
        shadowResult
    };
}

test("browser scripts are in complete dependency order before setup engine", () => {
    const order = ["candleNormalizer.js", "swingDetector.js", "swingSequence.js",
        "structureBreakDetector.js", "structureEventContract.js", "bosChochResolver.js",
        "structureStateSnapshot.js", "structureSetupGate.js", "structureSetupAdapter.js",
        "structurePipelineOrchestrator.js", "structureShadowMode.js", "js/setupEngine.js"];
    let previous = -1;
    order.forEach(name => {
        const index = html.indexOf(name); assert.ok(index > previous, name); previous = index;
    });
});

test("toggle is unchecked by default and visible state is OFF", () => {
    const tag = html.match(/<input id="structureShadowToggle"[^>]*>/)?.[0] || "";
    assert.ok(tag); assert.strictEqual(/\schecked(?:\s|=|>)/.test(tag), false);
    assert.ok(html.includes('id="structureShadowToggleState">OFF</span>'));
    const runtime = loadRuntime(); assert.strictEqual(runtime.toggle.checked, false);
    assert.strictEqual(runtime.api.isEnabled(), false);
});

test("toggle changes only in-memory flag and uses no persistent storage", () => {
    const runtime = loadRuntime(); runtime.toggle.checked = true; runtime.change();
    assert.strictEqual(runtime.api.isEnabled(), true); assert.strictEqual(runtime.state.textContent, "SHADOW");
    runtime.toggle.checked = false; runtime.change(); assert.strictEqual(runtime.api.isEnabled(), false);
    const shadowCode = scriptCode.slice(scriptCode.indexOf("HND_STRUCTURE_SHADOW_LEFT_BARS"),
        scriptCode.indexOf("HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS"));
    for (const token of ["localStorage", "sessionStorage", "cookie"]) assert.ok(!shadowCode.includes(token));
});

test("disabled setup fields carry false and skip context preparation", () => {
    const api = loadRuntime().api;
    assert.deepStrictEqual(clone(api.buildStructureShadowSetupFields(
        [{ invalid: true }], "BTCUSDT", "15m", 3000, false)), {
        featureFlags: { structureShadowEnabled: false }, structureShadowContext: null
    });
});

test("enabled setup fields carry true and exact context", () => {
    const fields = clone(loadRuntime().api.buildStructureShadowSetupFields(
        candles(), "BTCUSDT", "15m", 3500, true));
    assert.deepStrictEqual(fields.featureFlags, { structureShadowEnabled: true });
    assert.deepStrictEqual(Object.keys(fields.structureShadowContext).sort(),
        ["analysisContext", "evaluationContext", "rawCandles"]);
});

test("candle conversion is exact OHLCV and does not mutate source", () => {
    const source = candles(); const before = clone(source);
    const output = clone(loadRuntime().api.normalizeStructureShadowCandles(source));
    assert.deepStrictEqual(source, before);
    assert.deepStrictEqual(Object.keys(output[0]),
        ["openTime", "closeTime", "open", "high", "low", "close", "volume"]);
    assert.deepStrictEqual(output[0], {
        openTime: 1000, closeTime: 1999, open: 10, high: 12, low: 9, close: 11, volume: 5
    });
});

test("evaluation context uses the last closed candle", () => {
    const context = clone(loadRuntime().api.buildStructureShadowContext(
        candles(), "BTCUSDT", "15m", 3500));
    assert.deepStrictEqual(context.evaluationContext, {
        symbol: "BTCUSDT", interval: "15m", evaluationAtIndex: 1,
        evaluationOpenTime: 2000, evaluationCloseTime: 2999
    });
    assert.deepStrictEqual(context.analysisContext, {
        symbol: "BTCUSDT", interval: "15m", nowMs: 3500, leftBars: 2, rightBars: 2
    });
});

test("open candle is retained in raw input but excluded from evaluation", () => {
    const context = clone(loadRuntime().api.buildStructureShadowContext(
        candles(), "BTCUSDT", "15m", 3500));
    assert.strictEqual(context.rawCandles.length, 3);
    assert.strictEqual(context.evaluationContext.evaluationAtIndex, 1);
});

test("invalid or no closed candle produces null context without blocking setup fields", () => {
    const api = loadRuntime().api;
    assert.strictEqual(api.buildStructureShadowContext(candles(), "BTCUSDT", "15m", 500), null);
    const fields = clone(api.buildStructureShadowSetupFields(
        [{ invalid: true }], "BTCUSDT", "15m", 3500, true));
    assert.deepStrictEqual(fields.featureFlags, { structureShadowEnabled: true });
    assert.strictEqual(fields.structureShadowContext, null);
    assert.ok(scriptCode.includes("window.HNDSetupEngine.evaluate({"));
});

test("shadow decisions are not consumed by setup plan or trade decisions", () => {
    for (const token of ["effectiveDecision", "gateDecision"]) assert.ok(!scriptCode.includes(token));
    assert.ok(!fs.readFileSync(path.join(root, "js/tradePlanEngine.js"), "utf8").includes("StructureShadow"));
    assert.ok(!fs.readFileSync(path.join(root, "js/tradeEngine.js"), "utf8").includes("StructureShadow"));
    assert.ok(scriptCode.includes("updateUI(result, price, setupState, tradePlanState, tradeState"));
});

for (const status of ["DISABLED", "COMPLETED", "FAILED", "NOT_APPLICABLE"]) {
    test("UI safely renders " + status, () => {
        const fixture = loadUI(); fixture.update(diagnostic(status));
        assert.strictEqual(fixture.elements.structureShadowStatus.textContent, status);
        if (status === "DISABLED") assert.strictEqual(fixture.elements.structureShadowMode.textContent, "OFF");
        if (status === "FAILED") {
            assert.strictEqual(fixture.elements.structureShadowFailedStage.textContent, "STRUCTURE_BREAK");
            assert.ok(fixture.elements.structureShadowCard.classList.contains("structure-shadow-state-error"));
        }
        if (status === "NOT_APPLICABLE") {
            assert.strictEqual(fixture.elements.structureShadowGateReason.textContent,
                "EXISTING_SETUP_EVALUATION");
        }
    });
}

test("mismatch is warning-only and explicitly diagnostic", () => {
    const fixture = loadUI(); fixture.update(diagnostic("COMPLETED", {
        gateDecision: "BLOCK", comparison: "LEGACY_ALLOW_GATE_BLOCK",
        wouldChangeDecision: true, gateReason: "DIRECTION_MISMATCH"
    }));
    assert.strictEqual(fixture.elements.structureShadowWouldChange.textContent,
        "YES — diagnostic only");
    assert.ok(fixture.elements.structureShadowCard.classList.contains("structure-shadow-state-mismatch"));
});

test("missing shadow DOM elements never throw", () => {
    assert.doesNotThrow(() => loadUI(false).update(diagnostic("FAILED")));
});

test("shadow UI writes with textContent and never innerHTML", () => {
    const start = uiCode.indexOf("function updateStructureShadowUI");
    const end = uiCode.indexOf("function updateActiveTradeUI", start);
    const source = uiCode.slice(start, end);
    assert.ok(source.includes("setText(")); assert.ok(!source.includes("innerHTML"));
});

test("existing setup integration coverage remains present", () => {
    const integration = fs.readFileSync(path.join(root,
        "tests/hndai-v1/setupEngineStructureShadowIntegration.test.js"), "utf8");
    assert.ok(integration.includes("existing setup locked path is unchanged and not applicable"));
});

test("historical mismatch buttons bind exactly one listener", () => {
    const fixture = loadHistoricalMismatchUI(); fixture.setup(); fixture.setup();
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalMismatch"), 1);
    assert.strictEqual(fixture.listenerCount("exportHistoricalMismatchAnalysis"), 1);
});

test("historical replay analyze click updates UI", () => {
    const fixture = loadHistoricalMismatchUI(); fixture.setReplay({ schemaVersion: "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1" });
    fixture.elements.analyzeHistoricalMismatch.click();
    assert.strictEqual(fixture.elements.historicalMismatchAnalyzerStatus.textContent, "REVIEW ITEMS FOUND");
    assert.strictEqual(fixture.elements.historicalMismatchMismatches.textContent, 1);
    assert.strictEqual(fixture.elements.historicalMismatchReviewBody.children.length, 1);
});

test("historical mismatch export binds without analyze button", () => {
    const fixture = loadHistoricalMismatchUI({ analyze: false });
    assert.strictEqual(fixture.listenerCount("exportHistoricalMismatchAnalysis"), 1);
    assert.doesNotThrow(() => fixture.elements.exportHistoricalMismatchAnalysis.click());
});

test("historical mismatch analyze binds without export button", () => {
    const fixture = loadHistoricalMismatchUI({ export: false }); fixture.setReplay({ schemaVersion: "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1" });
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalMismatch"), 1);
    assert.doesNotThrow(() => fixture.elements.analyzeHistoricalMismatch.click());
});

test("historical outcome buttons bind exactly one listener", () => {
    const fixture = loadHistoricalMismatchUI(); fixture.setup(); fixture.setup();
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalMismatchOutcomes"), 1);
    assert.strictEqual(fixture.listenerCount("exportHistoricalMismatchOutcomes"), 1);
});

test("historical outcome uses exact real HTML button IDs", () => {
    assert.match(html, /id="analyzeHistoricalMismatchOutcomes"/);
    assert.match(html, /id="exportHistoricalMismatchOutcomes"/);
    assert.match(uiCode, /getElementById\("analyzeHistoricalMismatchOutcomes"\)/);
    assert.match(uiCode, /getElementById\("exportHistoricalMismatchOutcomes"\)/);
});

test("historical outcome binds immediately while DOM reports loading", () => {
    const fixture = loadHistoricalMismatchUI({ readyState: "loading" });
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalMismatchOutcomes"), 1);
    assert.strictEqual(fixture.listenerCount("exportHistoricalMismatchOutcomes"), 1);
});

test("historical outcome analyze updates UI", () => {
    const fixture = loadHistoricalMismatchUI(); fixture.setOutcomeInputs();
    fixture.elements.analyzeHistoricalMismatchOutcomes.click();
    assert.strictEqual(fixture.elements.historicalOutcomeStatus.textContent, "NO EVALUABLE ITEMS");
    assert.strictEqual(fixture.elements.historicalOutcomeNotEvaluable.textContent, 1);
});

test("historical outcome dependency may load after listener setup", () => {
    const fixture = loadHistoricalMismatchUI({ outcomeDependency: false }); fixture.setOutcomeInputs();
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalMismatchOutcomes"), 1);
    fixture.installOutcomeDependency(); fixture.elements.analyzeHistoricalMismatchOutcomes.click();
    assert.strictEqual(fixture.elements.historicalOutcomeStatus.textContent, "NO EVALUABLE ITEMS");
});

test("historical outcome export binds without analyze button", () => {
    const fixture = loadHistoricalMismatchUI({ outcomeAnalyze: false });
    assert.strictEqual(fixture.listenerCount("exportHistoricalMismatchOutcomes"), 1);
    assert.doesNotThrow(() => fixture.elements.exportHistoricalMismatchOutcomes.click());
});

test("historical outcome analyze binds without export button", () => {
    const fixture = loadHistoricalMismatchUI({ outcomeExport: false }); fixture.setOutcomeInputs();
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalMismatchOutcomes"), 1);
    assert.doesNotThrow(() => fixture.elements.analyzeHistoricalMismatchOutcomes.click());
});

test("historical RR cap buttons bind exactly one listener", () => {
    const fixture = loadHistoricalMismatchUI(); fixture.setup(); fixture.setup();
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalRrCapScenarios"), 1);
    assert.strictEqual(fixture.listenerCount("exportHistoricalRrCapScenarios"), 1);
});

test("historical RR cap uses exact real HTML IDs and safety text", () => {
    assert.match(html, /id="analyzeHistoricalRrCapScenarios"/);
    assert.match(html, /id="exportHistoricalRrCapScenarios"/);
    assert.match(html, /DIAGNOSTIC SCENARIO ONLY — DOES NOT CHANGE LIVE TP/);
    assert.match(uiCode, /getElementById\("analyzeHistoricalRrCapScenarios"\)/);
    assert.match(uiCode, /getElementById\("exportHistoricalRrCapScenarios"\)/);
});

test("historical RR cap binds immediately while DOM reports loading", () => {
    const fixture = loadHistoricalMismatchUI({ readyState: "loading" });
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalRrCapScenarios"), 1);
    assert.strictEqual(fixture.listenerCount("exportHistoricalRrCapScenarios"), 1);
});

test("historical RR cap analyze updates summary and detail UI", () => {
    const fixture = loadHistoricalMismatchUI(); fixture.setOutcomeInputs();
    fixture.elements.analyzeHistoricalRrCapScenarios.click();
    assert.strictEqual(fixture.elements.historicalRrCapStatus.textContent, "SCENARIOS AVAILABLE");
    assert.strictEqual(fixture.elements.historicalRrCapReadiness.textContent, "NONE");
    assert.strictEqual(fixture.elements.historicalRrCapSummaryBody.children.length, 1);
    assert.strictEqual(fixture.elements.historicalRrCapDetailBody.children.length, 1);
});

test("historical RR cap dependency may load after listener setup", () => {
    const fixture = loadHistoricalMismatchUI({ rrCapDependency: false }); fixture.setOutcomeInputs();
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalRrCapScenarios"), 1);
    fixture.installRrCapDependency(); fixture.elements.analyzeHistoricalRrCapScenarios.click();
    assert.strictEqual(fixture.elements.historicalRrCapStatus.textContent, "SCENARIOS AVAILABLE");
});

test("historical RR cap export binds without analyze button", () => {
    const fixture = loadHistoricalMismatchUI({ rrCapAnalyze: false });
    assert.strictEqual(fixture.listenerCount("exportHistoricalRrCapScenarios"), 1);
    assert.doesNotThrow(() => fixture.elements.exportHistoricalRrCapScenarios.click());
});

test("historical RR cap analyze binds without export button", () => {
    const fixture = loadHistoricalMismatchUI({ rrCapExport: false }); fixture.setOutcomeInputs();
    assert.strictEqual(fixture.listenerCount("analyzeHistoricalRrCapScenarios"), 1);
    assert.doesNotThrow(() => fixture.elements.analyzeHistoricalRrCapScenarios.click());
});

test("historical RR cap export filename is deterministic", () => {
    assert.match(uiCode, /HNDai-historical-rr-cap-scenarios-/);
});

let passed = 0;
for (const item of tests) {
    try { item.fn(); passed += 1; console.log("PASS:" + item.name); }
    catch (error) {
        console.error("HND_STRUCTURE_SHADOW_RUNTIME_UI_TEST_FAILED:" + item.name);
        console.error(error.stack || error); process.exitCode = 1; break;
    }
}
if (passed === tests.length) {
    console.log("HND_STRUCTURE_SHADOW_RUNTIME_UI_TESTS_PASS:" + tests.length);
}
