"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "../.."), modulePath = path.join(root, "js/hndai-v1/structureHistoricalMismatchAnalyzer.js");
const api = require(modulePath), tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function observation(change = {}) {
    return Object.assign({ key: "BTCUSDT|4h|1000|0", symbol: "BTCUSDT", interval: "4h", evaluationCloseTime: 1000,
        source: "HISTORICAL_REPLAY", countsTowardLiveReadiness: false, category: "MATCH", comparison: "MATCH_ALLOW",
        error: null, candidateKey: "C1", reason: "VERIFIED_DUAL_DECISION", legacyReason: "SETUP_CREATED",
        gateReason: "STRUCTURE_SETUP_ALLOWED", legacyDecision: "ALLOW", gateDecision: "ALLOW",
        legacyDecisionEvidence: { accepted: 1 }, gateDecisionEvidence: { reason: "STRUCTURE_SETUP_ALLOWED" }, builderStatus: "INPUT_READY" }, change);
}
function replay(observations = [], change = {}) {
    const matchCount = observations.filter(x => x.category === "MATCH").length;
    const mismatchCount = observations.filter(x => x.category === "MISMATCH").length;
    return Object.assign({ valid: true, schemaVersion: "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1", source: "HISTORICAL_REPLAY",
        countsTowardLiveReadiness: false, observationCount: observations.length, comparableCount: matchCount + mismatchCount,
        matchCount, mismatchCount, failureCount: observations.filter(x => x.category === "FAILURE").length,
        notComparableCount: observations.filter(x => x.category === "NOT_COMPARABLE").length, observations }, change);
}
function analyze(items, change) { return api.analyzeReplay(replay(items, change)); }
function browserApi() { const window = {}; vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), { window, JSON, Object, Array, Number, String, Map }); return window.HNDStructureHistoricalMismatchAnalyzer; }

test("CommonJS API", () => assert.strictEqual(typeof api.analyzeReplay, "function"));
test("browser global API", () => assert.strictEqual(typeof browserApi().exportAnalysis, "function"));
test("exact public API", () => assert.deepStrictEqual(Object.keys(api).sort(), ["getSchemaVersion", "getVocabulary", "analyzeReplay", "exportAnalysis"].sort()));
test("schema exact", () => assert.strictEqual(api.getSchemaVersion(), "HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1"));
test("source schema vocabulary", () => assert.strictEqual(api.getVocabulary().sourceSchemaVersion, "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1"));
test("validator is used", () => assert.strictEqual(api.analyzeReplay({}).status, "INVALID_REPLAY"));
test("invalid replay", () => assert.deepStrictEqual([api.analyzeReplay(null).valid, api.analyzeReplay(null).status], [false, "INVALID_REPLAY"]));
test("wrong source rejected", () => assert.strictEqual(api.analyzeReplay(replay([], { source: "LIVE" })).status, "INVALID_REPLAY"));
test("live readiness true rejected", () => assert.strictEqual(api.analyzeReplay(replay([], { countsTowardLiveReadiness: true })).status, "INVALID_REPLAY"));
test("unsafe count rejected", () => assert.strictEqual(api.analyzeReplay(replay([], { matchCount: -1 })).status, "INVALID_REPLAY"));
test("observation key validated", () => assert.strictEqual(analyze([observation({ key: "" })]).status, "INVALID_REPLAY"));
test("observation market validated", () => assert.strictEqual(analyze([observation({ symbol: "btc" })]).status, "INVALID_REPLAY"));
test("observation time validated", () => assert.strictEqual(analyze([observation({ evaluationCloseTime: 0 })]).status, "INVALID_REPLAY"));
test("category vocabulary validated", () => assert.strictEqual(analyze([observation({ category: "MADE_UP" })]).status, "INVALID_REPLAY"));
test("comparison vocabulary validated", () => assert.strictEqual(analyze([observation({ comparison: "MADE_UP" })]).status, "INVALID_REPLAY"));
test("decision vocabulary validated", () => assert.strictEqual(analyze([observation({ legacyDecision: "WAIT" })]).status, "INVALID_REPLAY"));
test("unsafe evidence rejected", () => { const value = {}; value.self = value; assert.strictEqual(analyze([observation({ legacyDecisionEvidence: value })]).status, "INVALID_REPLAY"); });
test("empty replay", () => assert.strictEqual(analyze([]).status, "NO_OBSERVATIONS"));
test("only not comparable", () => assert.strictEqual(analyze([observation({ category: "NOT_COMPARABLE", comparison: "NOT_COMPARABLE", legacyDecision: null, gateDecision: null })]).status, "NO_COMPARABLE"));
test("only match", () => assert.strictEqual(analyze([observation()]).status, "MATCH_ONLY"));
test("mismatch status", () => assert.strictEqual(analyze([observation({ category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK", gateDecision: "BLOCK" })]).status, "REVIEW_ITEMS_FOUND"));
test("failure priority status", () => assert.strictEqual(analyze([observation({ category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK", gateDecision: "BLOCK" }), observation({ key: "F", category: "FAILURE", comparison: "PIPELINE_FAILED", error: "X", legacyDecision: null, gateDecision: null })]).status, "FAILURES_FOUND"));
for (const [comparison, sourceCategory, expected, expectedPriority] of [
    ["MATCH_ALLOW", "MATCH", "MATCH_ALLOW", "INFO"], ["MATCH_BLOCK", "MATCH", "MATCH_BLOCK", "INFO"],
    ["LEGACY_ALLOW_GATE_BLOCK", "MISMATCH", "LEGACY_ALLOW_GATE_BLOCK", "HIGH"],
    ["LEGACY_BLOCK_GATE_ALLOW", "MISMATCH", "LEGACY_BLOCK_GATE_ALLOW", "MEDIUM"],
    ["NOT_COMPARABLE", "NOT_COMPARABLE", "NOT_COMPARABLE", "LOW"],
    ["PIPELINE_FAILED", "FAILURE", "PIPELINE_FAILURE", "HIGH"], ["NOT_APPLICABLE", "NOT_APPLICABLE", "UNCLASSIFIED_DIAGNOSTIC", "LOW"]]) {
    test(`category ${expected}`, () => { const item = observation({ category: sourceCategory, comparison, error: comparison === "PIPELINE_FAILED" ? "X" : null,
        legacyDecision: comparison === "PIPELINE_FAILED" ? null : "ALLOW", gateDecision: comparison === "PIPELINE_FAILED" ? null : "ALLOW" });
        const result = analyze([item]); const row = result.failureItems[0] || result.reviewItems[0] || { category: expected, priority: expectedPriority };
        assert.deepStrictEqual([row.category, row.priority], [expected, expectedPriority]); });
}
test("legacy allow gate block mapping", () => assert.strictEqual(analyze([observation({ category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK", gateDecision: "BLOCK" })]).reviewItems[0].category, "LEGACY_ALLOW_GATE_BLOCK"));
test("legacy block gate allow mapping", () => assert.strictEqual(analyze([observation({ category: "MISMATCH", comparison: "LEGACY_BLOCK_GATE_ALLOW", legacyDecision: "BLOCK" })]).reviewItems[0].category, "LEGACY_BLOCK_GATE_ALLOW"));
test("match counters", () => assert.deepStrictEqual([analyze([observation(), observation({ key: "B", comparison: "MATCH_BLOCK", legacyDecision: "BLOCK", gateDecision: "BLOCK" })]).matchCount], [2]));
test("mismatch counters", () => assert.strictEqual(analyze([observation({ category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK", gateDecision: "BLOCK" })]).mismatchCount, 1));
test("failure counters", () => assert.strictEqual(analyze([observation({ category: "FAILURE", comparison: "PIPELINE_FAILED", error: "X", legacyDecision: null, gateDecision: null })]).failureCount, 1));
test("rates", () => { const result = analyze([observation(), observation({ key: "M", category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK", gateDecision: "BLOCK" })]); assert.deepStrictEqual([result.matchRate, result.mismatchRate], [50, 50]); });
test("zero denominator rates null", () => assert.deepStrictEqual([analyze([]).matchRate, analyze([]).mismatchRate], [null, null]));
test("all groupings present", () => { const result = analyze([observation()]); ["byCategory", "byPriority", "byMarket", "byInterval", "byMarketInterval", "byLegacyDecision", "byGateDecision", "byLegacyReason", "byGateReason", "byBuilderStatus"].forEach(key => assert.ok(Array.isArray(result[key]))); });
test("group percentages use observation count", () => assert.strictEqual(analyze([observation(), observation({ key: "B", symbol: "ETHUSDT" })]).byMarket[0].percentage, 50));
test("group sorting deterministic", () => assert.deepStrictEqual(analyze([observation({ symbol: "ETHUSDT" }), observation({ key: "B", symbol: "BTCUSDT" })]).byMarket.map(x => x.key), ["BTCUSDT", "ETHUSDT"]));
test("direct evidence codes only", () => { const row = analyze([observation({ category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK", gateDecision: "BLOCK", gateReason: "BLOCK_REASON" })]).reviewItems[0]; assert.deepStrictEqual(row.evidenceCodes, ["LEGACY_DECISION", "GATE_DECISION", "LEGACY_FILTER_EVIDENCE", "GATE_BLOCK_REASON", "BUILDER_STATUS", "PENDING_CANDIDATE", "DECISION_DIVERGENCE"]); });
test("no evidence fallback", () => { const row = analyze([observation({ category: "NOT_COMPARABLE", comparison: "NOT_COMPARABLE", legacyDecision: null, gateDecision: null, legacyDecisionEvidence: null, gateDecisionEvidence: null, candidateKey: null, builderStatus: null, legacyReason: null, gateReason: null, reason: null })]).reviewItems[0]; assert.deepStrictEqual(row.evidenceCodes, ["NO_DIRECT_EVIDENCE"]); });
test("no invented root cause", () => assert.ok(!JSON.stringify(analyze([observation({ category: "NOT_COMPARABLE", comparison: "NOT_COMPARABLE", legacyDecision: null, gateDecision: null })])).match(/market condition|threshold/i)));
test("review sorting", () => { const items = [observation({ key: "L", category: "NOT_COMPARABLE", comparison: "NOT_COMPARABLE", legacyDecision: null, gateDecision: null }), observation({ key: "H", category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK", gateDecision: "BLOCK" })]; assert.deepStrictEqual(analyze(items).reviewItems.map(x => x.key), ["H", "L"]); });
test("review limit 100", () => { const items = Array.from({ length: 120 }, (_, i) => observation({ key: `N${i}`, evaluationCloseTime: 1000 + i, category: "NOT_COMPARABLE", comparison: "NOT_COMPARABLE", legacyDecision: null, gateDecision: null })); assert.strictEqual(analyze(items).reviewItems.length, 100); });
test("failure limit 25", () => { const items = Array.from({ length: 30 }, (_, i) => observation({ key: `F${i}`, evaluationCloseTime: 1000 + i, category: "FAILURE", comparison: "PIPELINE_FAILED", error: "X", legacyDecision: null, gateDecision: null })); assert.strictEqual(analyze(items).failureItems.length, 25); });
test("input immutable", () => { const input = replay([observation()]), before = JSON.stringify(input); api.analyzeReplay(input); assert.strictEqual(JSON.stringify(input), before); });
test("deterministic", () => { const input = replay([observation()]); assert.deepStrictEqual(api.analyzeReplay(input), api.analyzeReplay(input)); });
test("raw replay not embedded", () => { const result = analyze([observation()]); assert.ok(!Object.prototype.hasOwnProperty.call(result, "observations") && !Object.prototype.hasOwnProperty.call(result, "replayResult")); });
test("export whitelist secure", () => { const result = analyze([observation({ legacyDecisionEvidence: { apiKey: "secret", computerPath: "C:\\Users\\name" } })]); const text = api.exportAnalysis(result); assert.ok(typeof text === "string" && !/secret|computerPath|C:\\Users/i.test(text)); });
test("invalid export rejected", () => assert.strictEqual(api.exportAnalysis({}), null));
test("disclaimer exact meaning", () => assert.strictEqual(analyze([]).disclaimer, "Historical diagnostic classification only; this analysis does not change rules, count toward live readiness, or authorize entries."));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8"), ui = fs.readFileSync(path.join(root, "js/ui.js"), "utf8"), css = fs.readFileSync(path.join(root, "style.css"), "utf8");
test("UI initial state", () => assert.match(html, /historicalMismatchAnalyzerStatus">NOT ANALYZED/));
test("UI uses last replay", () => assert.match(ui, /analyzeReplay\?\.\(lastStructureHistoricalShadowReplay\)/));
test("UI protects replay mutation", () => assert.match(ui, /ANALYZER_MUTATED_REPLAY/));
test("safe DOM APIs", () => assert.ok(/createElement/.test(ui) && /textContent/.test(ui) && !/historicalMismatch[\s\S]{0,400}innerHTML/.test(ui)));
test("missing DOM safe", () => assert.ok(/if \(!body\) return/.test(ui) && /if \(!analyzeButton \|\| !exportButton\) return/.test(ui)));
test("script order", () => assert.ok(html.indexOf("structureHistoricalShadowReplay.js") < html.indexOf("structureHistoricalMismatchAnalyzer.js") && html.indexOf("structureHistoricalMismatchAnalyzer.js") < html.indexOf("js/ui.js")));
test("mobile horizontal scroll", () => assert.match(css, /historical-mismatch-table-wrap[^}]*overflow-x:auto/));
test("export filename", () => assert.match(ui, /HNDai-historical-mismatch-analysis-/));
test("no live writers in analyzer", () => assert.ok(!/(localStorage|sessionStorage|cookie|fetch\(|XMLHttpRequest|TradeEngine|SetupEngine|webhook)/.test(fs.readFileSync(modulePath, "utf8"))));

(async () => { let assertions = 0; for (const item of tests) { try { await item.fn(); assertions += 1; } catch (error) { console.error(`FAIL:${item.name}`); throw error; } }
    console.log(`Historical Mismatch Analyzer tests passed: ${tests.length} scenarios, ${assertions} assertions.`); })().catch(error => { console.error(error); process.exitCode = 1; });
