"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "../.."), modulePath = path.join(root, "js/hndai-v1/structureHistoricalShadowReplay.js");
const api = require(modulePath), tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function candles(count = 300) { const start = 1600000000000; return Array.from({ length: count }, (_, index) => {
    const open = 100 + index / 10, close = open + (index % 2 ? -0.2 : 0.2);
    return { openTime: start + index * 900000, closeTime: start + (index + 1) * 900000 - 1,
        open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 10 + index };
}); }
function config(change = {}) { return Object.assign(api.getDefaultConfig(), change); }
function browser(evaluator) { const window = { HNDStructureHistoricalShadowEvaluator: evaluator };
    vm.runInNewContext(fs.readFileSync(modulePath, "utf8"), { window, JSON, Object, Array, Number, Math, Date, Error });
    return window.HNDStructureHistoricalShadowReplay; }
function evaluator() { return { evaluateHistoricalShadow(prefix) { const index = prefix.length - 250;
    return { comparison: index % 3 === 1 ? "MATCH_ALLOW" : index % 3 === 2 ? "LEGACY_ALLOW_GATE_BLOCK" : "NOT_COMPARABLE", error: null }; } }; }
const fixtureApi = () => browser(evaluator());
test("CommonJS API", () => assert.strictEqual(api.getSchemaVersion(), "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1"));
test("browser global API", () => assert.strictEqual(fixtureApi().getSchemaVersion(), api.getSchemaVersion()));
test("exact public API", () => assert.deepStrictEqual(Object.keys(api).sort(), ["getSchemaVersion", "getDefaultConfig", "validateCandles", "runReplay", "exportReplay"].sort()));
test("default config exact", () => assert.deepStrictEqual(api.getDefaultConfig(), { symbol: "BTCUSDT", interval: "15m", warmupCandles: 250, maximumEvaluationCandles: 1000, includeNonComparable: true, evaluationCutoffTime: Number.MAX_SAFE_INTEGER }));
test("default config deep clone", () => { const c = api.getDefaultConfig(); c.symbol = "X"; assert.strictEqual(api.getDefaultConfig().symbol, "BTCUSDT"); });
for (const [name, change] of [["extra", { extra: true }], ["missing", null], ["symbol", { symbol: "X" }], ["interval", { interval: "1h" }], ["warmup", { warmupCandles: 0 }], ["maximum", { maximumEvaluationCandles: 10001 }], ["include", { includeNonComparable: 1 }], ["cutoff", { evaluationCutoffTime: 0 }]]) test(`invalid config ${name}`, () => {
    const c = change === null ? { symbol: "BTCUSDT" } : config(change); assert.strictEqual(fixtureApi().runReplay(candles(), c).status, "INVALID_INPUT"); });
test("invalid candle rejected", () => { const c = candles(); c[2].high = 1; assert.strictEqual(api.validateCandles(c).valid, false); });
test("unsafe number rejected", () => { const c = candles(); c[0].volume = Infinity; assert.strictEqual(api.validateCandles(c).valid, false); });
test("unordered rejected", () => { const c = candles(); [c[1], c[2]] = [c[2], c[1]]; assert.strictEqual(api.validateCandles(c).error, "CANDLES_NOT_ORDERED"); });
test("duplicate closeTime rejected", () => { const c = candles(); c[2].openTime = c[1].openTime; c[2].closeTime = c[1].closeTime; assert.strictEqual(api.validateCandles(c).error, "DUPLICATE_CLOSE_TIME"); });
test("after-cutoff candle excluded", () => { const c = candles(); const cutoff = c.at(-1).closeTime; c.push({ ...c.at(-1), openTime: cutoff + 1, closeTime: cutoff + 900000 }); const r = fixtureApi().runReplay(c, config({ evaluationCutoffTime: cutoff })); assert.strictEqual(r.evaluatedCandleCount, 50); });
test("cutoff deterministic", () => { const x = fixtureApi(), c = candles(), cutoff = c[275].closeTime, cfg = config({ evaluationCutoffTime: cutoff }); assert.deepStrictEqual(x.runReplay(c, cfg), x.runReplay(c, cfg)); });
test("core has no Date.now", () => assert.ok(!fs.readFileSync(modulePath, "utf8").includes("Date.now")));
test("insufficient history", () => assert.strictEqual(fixtureApi().runReplay(candles(250), config()).status, "INSUFFICIENT_HISTORY"));
test("dependency called for every lifecycle candle", () => { let calls = 0; const x = browser({ evaluateHistoricalShadow() { calls++; return { comparison: "MATCH_BLOCK" }; } }); x.runReplay(candles(252), config()); assert.strictEqual(calls, 252); });
test("missing dependency fail closed", () => assert.strictEqual(browser(null).runReplay(candles(), config()).status, "DEPENDENCY_FAILURE"));
test("dependency exception fail closed", () => { const x = browser({ evaluateHistoricalShadow() { throw Error("x"); } }); const r = x.runReplay(candles(251), config()); assert.deepStrictEqual([r.valid, r.status, r.error], [false, "DEPENDENCY_FAILURE", "DEPENDENCY_EXCEPTION"]); });
test("look-ahead protected", () => { const seen = []; const x = browser({ evaluateHistoricalShadow(prefix) { seen.push(prefix.length); return { comparison: "MATCH_ALLOW" }; } }); x.runReplay(candles(254), config()); assert.deepStrictEqual(seen, Array.from({length:254},(_,i)=>i+1)); });
test("warmup not observations", () => assert.strictEqual(fixtureApi().runReplay(candles(), config()).evaluatedCandleCount, 50));
test("each evaluation once", () => { const r = fixtureApi().runReplay(candles(), config()); assert.strictEqual(new Set(r.observations.map(x => x.key)).size, r.observations.length); });
test("deterministic keys", () => { const r = fixtureApi().runReplay(candles(251), config()); assert.strictEqual(r.observations[0].key, `BTCUSDT|15m|${candles(251)[250].closeTime}|0`); });
test("deterministic result", () => { const x = fixtureApi(), c = candles(); assert.deepStrictEqual(x.runReplay(c, config()), x.runReplay(c, config())); });
test("input not mutated", () => { const x = fixtureApi(), c = candles(), before = clone(c), cfg = config(), cb = clone(cfg); x.runReplay(c, cfg); assert.deepStrictEqual([c, cfg], [before, cb]); });
test("counters", () => { const r = fixtureApi().runReplay(candles(256), config()); assert.deepStrictEqual([r.matchCount, r.mismatchCount, r.notComparableCount, r.failureCount], [2, 2, 2, 0]); });
test("rates", () => { const r = fixtureApi().runReplay(candles(256), config()); assert.deepStrictEqual([r.matchRate, r.mismatchRate], [50, 50]); });
test("duplicate candidate compared once", () => { const x=browser({evaluateHistoricalShadow(){return{comparison:"MATCH_ALLOW",candidateKey:"SAME"};}}),r=x.runReplay(candles(254),config());assert.deepStrictEqual([r.comparableCount,r.matchCount,r.duplicateCandidateCount,r.notComparableCount],[1,1,3,3]);assert.ok(r.warnings.includes("DUPLICATE_CANDIDATES_SKIPPED:3")); });
test("zero denominator rates null", () => { const x = browser({ evaluateHistoricalShadow() { return { comparison: "NOT_COMPARABLE" }; } }), r = x.runReplay(candles(251), config()); assert.deepStrictEqual([r.matchRate, r.mismatchRate], [null, null]); });
test("source tags all records", () => { const r = fixtureApi().runReplay(candles(256), config()); assert.ok(r.source === "HISTORICAL_REPLAY" && r.observations.every(x => x.source === "HISTORICAL_REPLAY")); });
test("readiness false all records", () => { const r = fixtureApi().runReplay(candles(256), config()); assert.ok(r.countsTowardLiveReadiness === false && r.observations.every(x => x.countsTowardLiveReadiness === false)); });
test("no live writers", () => assert.ok(!/(Collection|Telemetry|ReadinessGate|localStorage|sessionStorage|fetch\()/.test(fs.readFileSync(modulePath, "utf8"))));
test("safe export", () => { const text = fixtureApi().exportReplay(fixtureApi().runReplay(candles(251), config())); assert.strictEqual(JSON.parse(text).source, "HISTORICAL_REPLAY"); assert.ok(!/(apiKey|computerPath|username|rawBinance|liveSnapshot)/i.test(text)); });
test("export strips injected fields", () => { const r = fixtureApi().runReplay(candles(251), config()); r.apiKey = "secret"; r.observations[0].rawBinance = [1, 2, 3]; const text = fixtureApi().exportReplay(r); assert.ok(!text.includes("secret") && !text.includes("rawBinance")); });
test("invalid export rejected", () => assert.strictEqual(api.exportReplay({}), null));
const html = fs.readFileSync(path.join(root, "index.html"), "utf8"), ui = fs.readFileSync(path.join(root, "js/ui.js"), "utf8");
test("UI initial NOT RUN", () => assert.match(html, /historicalShadowReplayStatus">NOT RUN/));
test("warning always present", () => assert.match(html, /DOES NOT COUNT TOWARD LIVE READINESS/));
test("duplicate candidate UI present", () => assert.match(html, /historicalShadowReplayDuplicateCandidates/));
test("pending lifecycle UI present", () => ["PendingCreated","PendingResolved","PendingExpired","UnmatchedEvents"].forEach(x=>assert.match(html,new RegExp(`historicalShadowReplay${x}`))));
test("deterministic cutoff passed", () => assert.match(ui, /config\.evaluationCutoffTime = server\.serverTime/));
test("paginated Binance request", () => assert.match(ui, /fetchClosedCandles/));
test("safe DOM", () => assert.ok(!ui.includes("innerHTML")));
test("missing DOM guarded", () => assert.match(ui, /if \(!runButton \|\| !exportButton\) return/));
test("no activation button", () => assert.ok(!/<button[^>]*>[^<]*(Enable|Activate|Unlock|Start Trading)/i.test(html)));
test("script order", () => assert.ok(html.indexOf("structurePendingCandidateContract.js") < html.indexOf("structureHistoricalLegacyCandidateAdapter.js") && html.indexOf("structureHistoricalLegacyCandidateAdapter.js") < html.indexOf("structureHistoricalShadowReplay.js") && html.indexOf("structureHistoricalReplayBinancePager.js") < html.indexOf("structureHistoricalShadowReplay.js") && html.indexOf("structureHistoricalShadowReplay.js") < html.indexOf("js/ui.js")));
test("export filename", () => assert.match(ui, /HNDai-historical-shadow-replay-\$\{/));
test("disclaimer exact", () => assert.strictEqual(fixtureApi().runReplay(candles(251), config()).disclaimer, "Historical diagnostic replay only; results do not count as live readiness evidence and do not authorize paper or real trading."));
(async () => { let assertions = 0; for (const item of tests) { try { await item.fn(); assertions++; } catch (error) { console.error(`FAIL: ${item.name}`); throw error; } } console.log(`Structure Historical Shadow Replay tests passed: ${tests.length} scenarios, ${assertions} assertions.`); })().catch(error => { console.error(error); process.exitCode = 1; });
