"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "../.."), modulePath = path.join(root, "js/hndai-v1/structureHistoricalMismatchOutcomeAnalyzer.js");
const api = require(modulePath), tests = []; function test(name, fn) { tests.push({ name, fn }); }
const clone = value => JSON.parse(JSON.stringify(value));
function evidence(change = {}) { return Object.assign({ direction: "LONG", entryMode: "LIMIT", entryPrice: 100,
    entryLow: 99, entryHigh: 101, stopLoss: 90, takeProfit: 110 }, change); }
function observation(change = {}) { return Object.assign({ key: "BTCUSDT|4h|1999|0", candidateKey: "C1", symbol: "BTCUSDT",
    interval: "4h", evaluationCloseTime: 1999, source: "HISTORICAL_REPLAY", countsTowardLiveReadiness: false,
    category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK", legacyPlanEvidence: evidence() }, change); }
function replay(items = [observation()], change = {}) { return Object.assign({ valid: true,
    schemaVersion: "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1", source: "HISTORICAL_REPLAY",
    countsTowardLiveReadiness: false, observations: items }, change); }
function mismatch(change = {}) { return Object.assign({ valid: true,
    schemaVersion: "HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1", source: "HISTORICAL_REPLAY",
    countsTowardLiveReadiness: false, status: "REVIEW_ITEMS_FOUND", mismatchCount: 1, reviewItems: [] }, change); }
function candle(openTime, closeTime, open, high, low, close) { return { openTime, closeTime, open, high, low, close, volume: 10 }; }
function series(rows) { return [candle(1000,1999,100,102,98,100)].concat(rows); }
function run(rows, item = observation(), policy = { maximumForwardBars: 2, includeMatches: false }) {
    return api.analyzeOutcomes(mismatch(), replay([item]), series(rows), policy); }
function browserApi() { const window = {}; vm.runInNewContext(fs.readFileSync(modulePath,"utf8"), { window, JSON, Object, Array, Number, String, Map, Math }); return window.HNDStructureHistoricalMismatchOutcomeAnalyzer; }
test("CommonJS API",()=>assert.strictEqual(typeof api.analyzeOutcomes,"function"));
test("browser global API",()=>assert.strictEqual(typeof browserApi().exportOutcomeAnalysis,"function"));
test("exact public API",()=>assert.deepStrictEqual(Object.keys(api).sort(),["getSchemaVersion","getVocabulary","getDefaultPolicy","analyzeOutcomes","exportOutcomeAnalysis"].sort()));
test("schema exact",()=>assert.strictEqual(api.getSchemaVersion(),"HND_STRUCTURE_HISTORICAL_MISMATCH_OUTCOME_V1"));
test("vocabulary outcomes exact",()=>assert.deepStrictEqual(api.getVocabulary().outcomes,["TP_FIRST","SL_FIRST","AMBIGUOUS_SAME_BAR","ENTRY_NOT_REACHED","OPEN_AT_HORIZON","INSUFFICIENT_FUTURE_DATA","NOT_EVALUABLE","INVALID_INPUT"]));
test("default policy exact",()=>assert.deepStrictEqual(api.getDefaultPolicy(),{maximumForwardBars:24,includeMatches:false}));
test("default policy deep clone",()=>{const a=api.getDefaultPolicy();a.maximumForwardBars=1;assert.strictEqual(api.getDefaultPolicy().maximumForwardBars,24);});
for(const value of [{maximumForwardBars:0,includeMatches:false},{maximumForwardBars:501,includeMatches:false},{maximumForwardBars:1.2,includeMatches:false},{maximumForwardBars:1,includeMatches:0},{maximumForwardBars:1,includeMatches:false,x:1},{maximumForwardBars:1}])
    test("invalid policy rejected "+JSON.stringify(value),()=>assert.strictEqual(api.analyzeOutcomes(mismatch(),replay(),series([]),value).status,"INVALID_INPUT"));
test("invalid mismatch rejected",()=>assert.strictEqual(api.analyzeOutcomes({},replay(),series([])).status,"INVALID_INPUT"));
test("invalid replay rejected",()=>assert.strictEqual(api.analyzeOutcomes(mismatch(),{},series([])).status,"INVALID_INPUT"));
test("invalid candles rejected",()=>assert.strictEqual(api.analyzeOutcomes(mismatch(),replay(),null).status,"INVALID_INPUT"));
test("wrong mismatch source rejected",()=>assert.strictEqual(api.analyzeOutcomes(mismatch({source:"LIVE"}),replay(),series([])).status,"INVALID_INPUT"));
test("wrong replay readiness rejected",()=>assert.strictEqual(api.analyzeOutcomes(mismatch(),replay([], {countsTowardLiveReadiness:true}),series([])).status,"INVALID_INPUT"));
test("no mismatches",()=>assert.strictEqual(api.analyzeOutcomes(mismatch({mismatchCount:0}),replay([]),series([]),{maximumForwardBars:1,includeMatches:false}).status,"NO_MISMATCHES"));
test("plan evidence absent",()=>assert.strictEqual(run([],observation({legacyPlanEvidence:null}),{maximumForwardBars:1,includeMatches:false}).outcomeItems[0].category,"NOT_EVALUABLE"));
test("direction not inferred",()=>assert.strictEqual(run([],observation({legacyPlanEvidence:evidence({direction:null})}),{maximumForwardBars:1,includeMatches:false}).outcomeItems[0].direction,null));
test("entry not inferred",()=>assert.strictEqual(run([],observation({legacyPlanEvidence:evidence({entryPrice:null,entryLow:null,entryHigh:null})}),{maximumForwardBars:1,includeMatches:false}).outcomeItems[0].category,"NOT_EVALUABLE"));
test("stop not inferred",()=>assert.strictEqual(run([],observation({legacyPlanEvidence:evidence({stopLoss:null})}),{maximumForwardBars:1,includeMatches:false}).outcomeItems[0].category,"NOT_EVALUABLE"));
test("target not inferred",()=>assert.strictEqual(run([],observation({legacyPlanEvidence:evidence({takeProfit:null})}),{maximumForwardBars:1,includeMatches:false}).outcomeItems[0].category,"NOT_EVALUABLE"));
test("future scan starts after evaluation",()=>assert.strictEqual(run([candle(2000,2999,102,103,101,102),candle(3000,3999,102,110,99,105)]).outcomeItems[0].entryReachedAt,3999));
test("maximum horizon applied",()=>assert.strictEqual(run([candle(2000,2999,102,103,101,102),candle(3000,3999,102,103,101,102),candle(4000,4999,100,112,99,110)],observation(),{maximumForwardBars:2,includeMatches:false}).outcomeItems[0].category,"ENTRY_NOT_REACHED"));
test("entry not reached",()=>assert.strictEqual(run([candle(2000,2999,102,104,101,103),candle(3000,3999,103,105,102,104)]).outcomeItems[0].category,"ENTRY_NOT_REACHED"));
test("LONG TP first",()=>assert.strictEqual(run([candle(2000,2999,100,105,99,102),candle(3000,3999,102,111,95,108)]).outcomeItems[0].category,"TP_FIRST"));
test("LONG SL first",()=>assert.strictEqual(run([candle(2000,2999,100,105,99,102),candle(3000,3999,99,105,89,92)]).outcomeItems[0].category,"SL_FIRST"));
test("SHORT TP first",()=>assert.strictEqual(run([candle(2000,2999,100,101,95,98),candle(3000,3999,98,105,89,92)],observation({legacyPlanEvidence:evidence({direction:"SHORT",stopLoss:110,takeProfit:90})})).outcomeItems[0].category,"TP_FIRST"));
test("SHORT SL first",()=>assert.strictEqual(run([candle(2000,2999,100,101,95,98),candle(3000,3999,105,111,95,109)],observation({legacyPlanEvidence:evidence({direction:"SHORT",stopLoss:110,takeProfit:90})})).outcomeItems[0].category,"SL_FIRST"));
test("same bar TP SL ambiguous",()=>assert.strictEqual(run([candle(2000,2999,100,105,99,102),candle(3000,3999,100,111,89,100)]).outcomeItems[0].category,"AMBIGUOUS_SAME_BAR"));
test("entry and exit same bar ambiguous",()=>assert.strictEqual(run([candle(2000,2999,105,111,99,108),candle(3000,3999,108,109,105,106)]).outcomeItems[0].category,"AMBIGUOUS_SAME_BAR"));
test("open at horizon",()=>assert.strictEqual(run([candle(2000,2999,100,105,99,102),candle(3000,3999,102,105,95,101)]).outcomeItems[0].category,"OPEN_AT_HORIZON"));
test("insufficient future data",()=>assert.strictEqual(run([candle(2000,2999,100,105,99,102)]).outcomeItems[0].category,"INSUFFICIENT_FUTURE_DATA"));
test("duplicate candle rejected",()=>{const rows=series([candle(2000,2999,100,101,99,100)]);rows.push(clone(rows.at(-1)));assert.strictEqual(api.analyzeOutcomes(mismatch(),replay(),rows,{maximumForwardBars:1,includeMatches:false}).status,"INVALID_INPUT");});
test("unordered candle rejected",()=>{const rows=series([candle(2000,2999,100,101,99,100)]).reverse();assert.strictEqual(api.analyzeOutcomes(mismatch(),replay(),rows,{maximumForwardBars:1,includeMatches:false}).status,"INVALID_INPUT");});
test("inputs immutable",()=>{const m=mismatch(),r=replay(),c=series([candle(2000,2999,100,101,99,100)]),p={maximumForwardBars:1,includeMatches:false},before=JSON.stringify([m,r,c,p]);api.analyzeOutcomes(m,r,c,p);assert.strictEqual(JSON.stringify([m,r,c,p]),before);});
test("deterministic",()=>{const args=[mismatch(),replay(),series([candle(2000,2999,100,105,99,102)]),{maximumForwardBars:1,includeMatches:false}];assert.deepStrictEqual(api.analyzeOutcomes(...args),api.analyzeOutcomes(...args));});
test("no Date.now or network",()=>assert.ok(!/Date\.now|fetch\(|XMLHttpRequest|WebSocket/.test(fs.readFileSync(modulePath,"utf8"))));
test("counters correct",()=>{const result=run([candle(2000,2999,100,105,99,102),candle(3000,3999,102,111,95,108)]);assert.deepStrictEqual([result.evaluableCount,result.tpFirstCount,result.notEvaluableCount],[1,1,0]);});
test("groups deterministic",()=>{const items=[observation({key:"E",symbol:"ETHUSDT"}),observation({key:"B",candidateKey:"C2"})],result=api.analyzeOutcomes(mismatch({mismatchCount:2}),replay(items),series([candle(2000,2999,100,105,99,102),candle(3000,3999,102,111,95,108)]),{maximumForwardBars:2,includeMatches:false});assert.deepStrictEqual(result.byMarket.map(x=>x.key),["BTCUSDT","ETHUSDT"]);});
test("outcome item whitelist",()=>assert.deepStrictEqual(Object.keys(run([candle(2000,2999,100,105,99,102),candle(3000,3999,102,111,95,108)]).outcomeItems[0]).sort(),["key","candidateKey","symbol","interval","evaluationCloseTime","category","direction","entry","stopLoss","takeProfit","entryReachedAt","outcomeAt","barsObserved","directEvidenceCodes","diagnosticInterpretation"].sort()));
test("raw candles not exported",()=>{const result=run([candle(2000,2999,100,105,99,102),candle(3000,3999,102,111,95,108)]);assert.ok(!/openTime|volume/.test(api.exportOutcomeAnalysis(result)));});
test("disclaimer denies authorization",()=>assert.match(run([],observation({legacyPlanEvidence:null}),{maximumForwardBars:1,includeMatches:false}).disclaimer,/do not change rules.*authorize entries/i));
test("historical separation",()=>{const result=run([],observation({legacyPlanEvidence:null}),{maximumForwardBars:1,includeMatches:false});assert.deepStrictEqual([result.source,result.countsTowardLiveReadiness],["HISTORICAL_REPLAY",false]);});
test("include matches false",()=>assert.strictEqual(api.analyzeOutcomes(mismatch({mismatchCount:0}),replay([observation({category:"MATCH"})]),series([]),{maximumForwardBars:1,includeMatches:false}).status,"NO_MISMATCHES"));
test("include matches true",()=>assert.strictEqual(api.analyzeOutcomes(mismatch({mismatchCount:0}),replay([observation({category:"MATCH"})]),series([candle(2000,2999,100,105,99,102)]),{maximumForwardBars:1,includeMatches:true}).analyzedMismatchCount,1));
test("UI initial state",()=>assert.match(fs.readFileSync(path.join(root,"index.html"),"utf8"),/historicalOutcomeStatus">NOT ANALYZED/));
test("UI safe DOM",()=>{const ui=fs.readFileSync(path.join(root,"js/ui.js"),"utf8");assert.ok(ui.includes("updateStructureHistoricalOutcomeUI")&&ui.includes("createElement")&&!/historicalOutcome[\s\S]{0,300}innerHTML/.test(ui));});
test("UI export filename",()=>assert.match(fs.readFileSync(path.join(root,"js/ui.js"),"utf8"),/HNDai-historical-mismatch-outcomes-/));
test("script order",()=>{const html=fs.readFileSync(path.join(root,"index.html"),"utf8");assert.ok(html.indexOf("structureHistoricalMismatchAnalyzer.js")<html.indexOf("structureHistoricalMismatchOutcomeAnalyzer.js")&&html.indexOf("structureHistoricalMismatchOutcomeAnalyzer.js")<html.indexOf("js/ui.js"));});
test("mobile horizontal scroll",()=>assert.match(fs.readFileSync(path.join(root,"style.css"),"utf8"),/historical-outcome-table-wrap[^}]*overflow-x:auto/));
test("no live writers",()=>assert.ok(!/(HNDStructureShadowCollection|HNDStructureShadowTelemetry|HNDTradeEngine|HNDSetupEngine|localStorage|sessionStorage|webhook)/.test(fs.readFileSync(modulePath,"utf8"))));
(async()=>{let assertions=0;for(const item of tests){try{await item.fn();assertions+=1;}catch(error){console.error(`FAIL:${item.name}`);throw error;}}console.log(`Historical Mismatch Outcome Analyzer tests passed: ${tests.length} scenarios, ${assertions} assertions.`);})().catch(error=>{console.error(error);process.exitCode=1;});
