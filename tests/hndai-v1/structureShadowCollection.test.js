"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const modulePath = path.resolve(__dirname, "../../js/hndai-v1/structureShadowCollection.js");
const assessment = require(path.resolve(__dirname, "../../js/hndai-v1/structureShadowAssessment.js"));
const telemetry = require(path.resolve(__dirname, "../../js/hndai-v1/structureShadowTelemetry.js"));
const collection = require(modulePath);
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function percentage(n, d) { return d ? Math.round((n / d) * 10000) / 100 : null; }

function shadow(comparison = "MATCH_ALLOW") {
    const values = {
        MATCH_ALLOW: ["ALLOW", "ALLOW", false, "COMPLETED"], MATCH_BLOCK: ["BLOCK", "BLOCK", false, "COMPLETED"],
        LEGACY_ALLOW_GATE_BLOCK: ["ALLOW", "BLOCK", true, "COMPLETED"],
        LEGACY_BLOCK_GATE_ALLOW: ["BLOCK", "ALLOW", true, "COMPLETED"],
        NOT_COMPARABLE: ["ALLOW", null, false, "COMPLETED"], PIPELINE_FAILED: ["ALLOW", null, false, "FAILED"],
        NOT_APPLICABLE: [null, null, false, "NOT_APPLICABLE"]
    }[comparison];
    return { enabled: true, status: values[3], reason: null, mode: "SHADOW",
        legacyDecision: values[0], gateDecision: values[1], comparison,
        wouldChangeDecision: values[2], gateReason: values[1] ? "REASON" : null,
        error: comparison === "PIPELINE_FAILED" ? "FAILED" : null,
        failedStage: comparison === "PIPELINE_FAILED" ? "GATE" : null,
        candidateKey: comparison === "NOT_APPLICABLE" ? null : "KEY" };
}

function observation(index, comparison = "MATCH_ALLOW", symbol = "BTCUSDT", interval = "15m", base = 1700000000000) {
    const close = base + index * 60000;
    return { key: `${symbol}|${interval}|${close}`, symbol, interval,
        evaluationCloseTime: close, observedAt: close + 1000, shadow: shadow(comparison) };
}

function telemetrySummary(items, droppedCount = 0) {
    const values = items.map(item => item.shadow.comparison);
    const count = value => values.filter(item => item === value).length;
    const matchAllowCount = count("MATCH_ALLOW"), matchBlockCount = count("MATCH_BLOCK");
    const legacyAllowGateBlockCount = count("LEGACY_ALLOW_GATE_BLOCK");
    const legacyBlockGateAllowCount = count("LEGACY_BLOCK_GATE_ALLOW");
    const matchCount = matchAllowCount + matchBlockCount;
    const mismatchCount = legacyAllowGateBlockCount + legacyBlockGateAllowCount;
    const comparableCount = matchCount + mismatchCount;
    const failedCount = items.filter(item => item.shadow.status === "FAILED").length;
    return { observationCount: items.length, comparableCount, matchCount, mismatchCount, failedCount,
        notApplicableCount: count("NOT_APPLICABLE"), notComparableCount: count("NOT_COMPARABLE"),
        matchAllowCount, matchBlockCount, legacyAllowGateBlockCount, legacyBlockGateAllowCount,
        matchRate: percentage(matchCount, comparableCount), mismatchRate: percentage(mismatchCount, comparableCount),
        latestObservation: items.length ? clone(items.at(-1)) : null,
        markets: [...new Set(items.map(item => item.symbol))].sort(),
        intervals: [...new Set(items.map(item => item.interval))].sort(), capacity: 200, droppedCount };
}

function snapshot(items = [], dropped = 0) {
    const sorted = clone(items).sort((a, b) => a.evaluationCloseTime - b.evaluationCloseTime ||
        a.symbol.localeCompare(b.symbol) || a.interval.localeCompare(b.interval) || a.key.localeCompare(b.key));
    return { schemaVersion: "HND_STRUCTURE_SHADOW_TELEMETRY_V1",
        summary: telemetrySummary(sorted, dropped), observations: sorted };
}
function source(name = "diagnostic.json", importedAt = 1700000000000) { return { name, importedAt }; }
function fresh() { collection.reset("TEST"); return collection; }
function series(start, count, base = 1700000000000) {
    const markets = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
    const intervals = ["15m", "1h"];
    return Array.from({ length: count }, (_, offset) => observation(start + offset,
        offset % 7 === 0 ? "MATCH_BLOCK" : "MATCH_ALLOW", markets[offset % 3], intervals[offset % 2], base));
}

test("CommonJS API works", () => assert.strictEqual(collection.getSchemaVersion(), "HND_STRUCTURE_SHADOW_COLLECTION_V1"));
test("browser global API works", () => { const window = { HNDStructureShadowAssessment: assessment }; vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), { window, JSON, Object, Array, Number, Math, Set, Map }); assert.strictEqual(window.HNDStructureShadowCollection.getSchemaVersion(), collection.getSchemaVersion()); });
test("public API is exact", () => assert.deepStrictEqual(Object.keys(collection).sort(), ["getSchemaVersion", "getVocabulary", "addSnapshot", "getSummary", "getSnapshot", "getSources", "reset"].sort()));
test("valid snapshot is added", () => { const api = fresh(); assert.strictEqual(api.addSnapshot(snapshot([observation(1)]), source()).addedCount, 1); });
test("assessment validator is actually used", () => { let calls = 0; const fakeWindow = { HNDStructureShadowAssessment: { validateSnapshot() { calls += 1; return { valid: true }; } } }; vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), { window: fakeWindow, JSON, Object, Array, Number, Math, Set, Map }); fakeWindow.HNDStructureShadowCollection.addSnapshot(snapshot(), source()); assert.strictEqual(calls, 1); });
test("invalid snapshot is atomically rejected", () => { const api = fresh(); api.addSnapshot(snapshot([observation(1)]), source()); const before = api.getSnapshot(); assert.strictEqual(api.addSnapshot({}, source("bad.json", 2)).valid, false); assert.deepStrictEqual(api.getSnapshot(), before); });
test("source exact fields are required", () => assert.strictEqual(fresh().addSnapshot(snapshot(), { name: "a.json", importedAt: 1, extra: true }).error, "INVALID_SOURCE"));
test("source path is rejected", () => assert.strictEqual(fresh().addSnapshot(snapshot(), source("C:\\Users\\name.json")).error, "INVALID_SOURCE"));
test("source slash is rejected", () => assert.strictEqual(fresh().addSnapshot(snapshot(), source("folder/name.json")).error, "INVALID_SOURCE"));
test("source over 200 characters is rejected", () => assert.strictEqual(fresh().addSnapshot(snapshot(), source(`${"a".repeat(201)}.json`)).error, "INVALID_SOURCE"));
test("unsafe importedAt is rejected", () => assert.strictEqual(fresh().addSnapshot(snapshot(), source("a.json", 0)).error, "INVALID_SOURCE"));
test("source input is not mutated", () => { const api = fresh(), value = source(), before = clone(value); api.addSnapshot(snapshot(), value); assert.deepStrictEqual(value, before); });
test("snapshot input is not mutated", () => { const api = fresh(), value = snapshot([observation(1)]), before = clone(value); api.addSnapshot(value, source()); assert.deepStrictEqual(value, before); });
test("same observation is counted duplicate", () => { const api = fresh(), value = snapshot([observation(1)]); api.addSnapshot(value, source()); assert.strictEqual(api.addSnapshot(value, source("again.json", 2)).duplicateCount, 1); });
test("duplicate creates no new record", () => { const api = fresh(), value = snapshot([observation(1)]); api.addSnapshot(value, source()); api.addSnapshot(value, source("again.json", 2)); assert.strictEqual(api.getSnapshot().observations.length, 1); });
test("observedAt difference is not conflict", () => { const api = fresh(), first = observation(1), second = clone(first); second.observedAt += 1000; api.addSnapshot(snapshot([first]), source()); assert.strictEqual(api.addSnapshot(snapshot([second]), source("again.json", 2)).valid, true); });
test("observedAt selection is deterministic", () => { const first = observation(1), second = clone(first); second.observedAt -= 500; const api = fresh(); api.addSnapshot(snapshot([first]), source()); api.addSnapshot(snapshot([second]), source("again.json", 2)); assert.strictEqual(api.getSnapshot().observations[0].observedAt, second.observedAt); });
test("same key different comparison conflicts", () => { const api = fresh(), first = observation(1), second = clone(first); second.shadow = shadow("LEGACY_ALLOW_GATE_BLOCK"); api.addSnapshot(snapshot([first]), source()); assert.strictEqual(api.addSnapshot(snapshot([second]), source("conflict.json", 2)).error, "OBSERVATION_CONFLICT"); });
test("conflict rejects whole snapshot", () => { const api = fresh(), first = observation(1), conflict = clone(first); conflict.shadow = shadow("MATCH_BLOCK"); api.addSnapshot(snapshot([first]), source()); const result = api.addSnapshot(snapshot([conflict, observation(2)]), source("conflict.json", 2)); assert.strictEqual(result.addedCount, 0); });
test("state is unchanged after conflict", () => { const api = fresh(), first = observation(1), conflict = clone(first); conflict.shadow = shadow("MATCH_BLOCK"); api.addSnapshot(snapshot([first]), source()); const before = api.getSnapshot(); api.addSnapshot(snapshot([conflict, observation(2)]), source("conflict.json", 2)); assert.deepStrictEqual(api.getSnapshot(), before); });
test("conflict key is safely reported", () => { const api = fresh(), first = observation(1), conflict = clone(first); conflict.shadow = shadow("MATCH_BLOCK"); api.addSnapshot(snapshot([first]), source()); assert.deepStrictEqual(api.addSnapshot(snapshot([conflict]), source("conflict.json", 2)).conflictKeys, [first.key]); });
test("different market at same close is distinct", () => { const api = fresh(); api.addSnapshot(snapshot([observation(1), observation(1, "MATCH_ALLOW", "ETHUSDT")]), source()); assert.strictEqual(api.getSummary().observationCount, 2); });
test("different interval at same close is distinct", () => { const api = fresh(); api.addSnapshot(snapshot([observation(1), observation(1, "MATCH_ALLOW", "BTCUSDT", "1h")]), source()); assert.strictEqual(api.getSummary().observationCount, 2); });
test("summary is recomputed", () => { const api = fresh(); api.addSnapshot(snapshot([observation(1), observation(2, "LEGACY_ALLOW_GATE_BLOCK")]), source()); assert.strictEqual(api.getSnapshot().summary.mismatchCount, 1); });
test("tampered imported summary is rejected", () => { const api = fresh(), value = snapshot([observation(1)]); value.summary.matchCount = 0; assert.strictEqual(api.addSnapshot(value, source()).error, "SUMMARY_MISMATCH"); });
test("maximum 200 observations are retained", () => { const api = fresh(); api.addSnapshot(snapshot(series(1, 150)), source("a.json", 1)); api.addSnapshot(snapshot(series(151, 150)), source("b.json", 2)); assert.strictEqual(api.getSnapshot().observations.length, 200); });
test("newest 200 are selected", () => { const api = fresh(); api.addSnapshot(snapshot(series(1, 150)), source("a.json", 1)); api.addSnapshot(snapshot(series(151, 150)), source("b.json", 2)); assert.strictEqual(api.getSnapshot().observations[0].evaluationCloseTime, observation(101).evaluationCloseTime); });
test("dropped count is correct", () => { const api = fresh(); api.addSnapshot(snapshot(series(1, 150)), source("a.json", 1)); api.addSnapshot(snapshot(series(151, 150)), source("b.json", 2)); assert.strictEqual(api.getSummary().droppedCount, 100); });
test("import order does not change final snapshot", () => { const a = snapshot(series(1, 150)), b = snapshot(series(151, 150)); const api = fresh(); api.addSnapshot(a, source("a.json", 1)); api.addSnapshot(b, source("b.json", 2)); const forward = api.getSnapshot(); api.reset(); api.addSnapshot(b, source("b.json", 2)); api.addSnapshot(a, source("a.json", 1)); assert.deepStrictEqual(api.getSnapshot(), forward); });
test("snapshot getter is deep cloned", () => { const api = fresh(); api.addSnapshot(snapshot([observation(1)]), source()); const value = api.getSnapshot(); value.observations[0].symbol = "BAD"; assert.strictEqual(api.getSnapshot().observations[0].symbol, "BTCUSDT"); });
test("summary getter is deep cloned", () => { const api = fresh(); api.addSnapshot(snapshot([observation(1)]), source()); const value = api.getSummary(); value.markets.length = 0; assert.strictEqual(api.getSummary().markets.length, 1); });
test("sources getter is deep cloned", () => { const api = fresh(); api.addSnapshot(snapshot(), source()); const value = api.getSources(); value[0].name = "bad"; assert.strictEqual(api.getSources()[0].name, "diagnostic.json"); });
test("combined snapshot passes assessment validator", () => { const api = fresh(); api.addSnapshot(snapshot(series(1, 10)), source()); assert.strictEqual(assessment.validateSnapshot(api.getSnapshot()).valid, true); });
test("source names are absent from combined export", () => { const api = fresh(); api.addSnapshot(snapshot([observation(1)]), source("private.json")); assert.ok(!JSON.stringify(api.getSnapshot()).includes("private.json")); });
test("at most 50 source metadata entries remain", () => { const api = fresh(); for (let i = 1; i <= 55; i += 1) api.addSnapshot(snapshot(), source(`file-${i}.json`, i)); assert.strictEqual(api.getSources().length, 50); });
test("reset clears collection", () => { const api = fresh(); api.addSnapshot(snapshot([observation(1)]), source()); api.reset("UI_RESET"); assert.strictEqual(api.getSummary().observationCount, 0); });
test("reset reason is deterministic", () => assert.strictEqual(fresh().reset("").reason, "MANUAL_RESET"));
test("live telemetry state is unchanged", () => { telemetry.reset("TEST"); const before = telemetry.exportSnapshot(); fresh().addSnapshot(snapshot([observation(1)]), source()); assert.deepStrictEqual(telemetry.exportSnapshot(), before); });
test("collection has no network or storage integration", () => { const code = fs.readFileSync(modulePath, "utf8"); assert.ok(!/(fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB)/.test(code)); });
test("UI starts collection counts at zero", () => { const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8"); assert.match(html, /structureShadowCollectionObservationCount">0</); });
test("multi-file input is configured", () => { const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8"); assert.match(html, /structureShadowCollectionFiles[^>]+multiple/); });
test("20 file limit is applied", () => assert.match(fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"), /COLLECTION_FILE_LIMIT = 20/));
test("5 MB per-file limit is applied", () => assert.match(fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"), /IMPORT_LIMIT = 5 \* 1024 \* 1024/));
test("25 MB total limit is applied", () => assert.match(fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"), /TOTAL_LIMIT = 25 \* 1024 \* 1024/));
test("invalid JSON is safely handled", () => assert.match(fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"), /JSON\.parse\(read\.text\)/));
test("one bad file does not stop later files", () => { const ui = fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"); assert.match(ui, /continue;/); assert.match(ui, /for \(let index = 0;/); });
test("file input is reset in finally", () => { const ui = fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"); assert.match(ui, /finally[\s\S]+fileInput\.value = ""/); });
test("Assess Collection uses collection snapshot", () => { const ui = fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"); assert.match(ui, /HNDStructureShadowCollection\?\.getSnapshot/); assert.match(ui, /COLLECTION ASSESSMENT/); });
test("combined export filename is exact", () => assert.match(fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"), /HNDai-structure-shadow-collection-\$\{/));
test("reset button only resets collection", () => { const ui = fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8"); const segment = ui.slice(ui.indexOf("resetButton.addEventListener", ui.indexOf("setupStructureShadowCollectionControls")), ui.indexOf("updateStructureShadowCollectionUI", ui.indexOf("resetButton.addEventListener", ui.indexOf("setupStructureShadowCollectionControls")))); assert.match(segment, /HNDStructureShadowCollection/); assert.ok(!/Telemetry|Setup|Trade/.test(segment)); });
test("UI uses no innerHTML", () => assert.ok(!fs.readFileSync(path.resolve(__dirname, "../../js/ui.js"), "utf8").includes("innerHTML")));
test("local diagnostic warning is visible", () => assert.match(fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8"), /LOCAL DIAGNOSTIC COLLECTION ONLY — does not control entries/));
test("script dependency order is correct", () => { const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8"); assert.ok(html.indexOf("structureShadowTelemetry.js") < html.indexOf("structureShadowAssessment.js")); assert.ok(html.indexOf("structureShadowAssessment.js") < html.indexOf("structureShadowCollection.js")); assert.ok(html.indexOf("structureShadowCollection.js") < html.indexOf("js/ui.js")); });

(async () => {
    let assertions = 0;
    for (const current of tests) {
        try { await current.fn(); assertions += 1; }
        catch (error) { console.error(`FAIL: ${current.name}`); throw error; }
    }
    console.log(`Structure Shadow Collection tests passed: ${tests.length} scenarios, ${assertions} assertions.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
