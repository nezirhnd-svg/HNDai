"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.resolve(__dirname, "../.."), modulePath = path.join(root,
    "js/hndai-v1/structureHistoricalRrCapScenarioAnalyzer.js");
const api = require(modulePath), tests = []; function test(name, fn) { tests.push({ name, fn }); }
const clone = value => JSON.parse(JSON.stringify(value));
function evidence(change = {}) { return Object.assign({ direction: "LONG", entryMode: "ZONE", entryPrice: 100,
    entryLow: 99, entryHigh: 101, stopLoss: 90, takeProfit: 150, symbol: "BTCUSDT", interval: "4h",
    candidateKey: "C1", setupCandidateKey: "SETUP-C1", evaluationCloseTime: 1999,
    source: "HISTORICAL_REPLAY", countsTowardLiveReadiness: false,
    setupCore: "SETUP_CORE", planCore: "PLAN_CORE" }, change); }
function observation(change = {}) { return Object.assign({ key: "BTCUSDT|4h|1999|0", candidateKey: "C1",
    symbol: "BTCUSDT", interval: "4h", evaluationCloseTime: 1999, source: "HISTORICAL_REPLAY",
    countsTowardLiveReadiness: false, category: "MISMATCH", comparison: "LEGACY_ALLOW_GATE_BLOCK",
    legacyPlanEvidence: evidence() }, change); }
function replay(item = observation()) { return { valid: true, schemaVersion: "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1",
    source: "HISTORICAL_REPLAY", countsTowardLiveReadiness: false, observations: [item] }; }
function mismatch() { return { valid: true, schemaVersion: "HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1",
    source: "HISTORICAL_REPLAY", countsTowardLiveReadiness: false, status: "REVIEW_ITEMS_FOUND",
    mismatchCount: 1, reviewItems: [] }; }
function candle(openTime, closeTime, open, high, low, close) { return { openTime, closeTime, open, high, low, close, volume: 10 }; }
function candles(rows) { return [candle(1000,1999,100,101,99,100)].concat(rows); }
function policy(bars = 2) { return { maximumForwardBars: bars, includeMatches: false }; }
function run(rows, item = observation(), bars = 2) { return api.analyzeScenarios(mismatch(), replay(item), candles(rows), policy(bars)); }
function scenario(result, key) { return result.scenarioItems.find(item => item.scenario === key); }
function browserApi(outcomeDependency) { const window = {};
    if (outcomeDependency !== undefined) window.HNDStructureHistoricalMismatchOutcomeAnalyzer = outcomeDependency;
    vm.runInNewContext(fs.readFileSync(modulePath,"utf8"), { window, JSON, Object, Array, Number, String, Map, Math });
    return window.HNDStructureHistoricalRrCapScenarioAnalyzer; }
test("CommonJS API",()=>assert.strictEqual(typeof api.analyzeScenarios,"function"));
test("exact public API",()=>assert.deepStrictEqual(Object.keys(api).sort(),
    ["getSchemaVersion","getVocabulary","getDefaultPolicy","analyzeScenarios","exportScenarioAnalysis"].sort()));
test("schema exact",()=>assert.strictEqual(api.getSchemaVersion(),"HND_STRUCTURE_HISTORICAL_RR_CAP_SCENARIO_ANALYSIS_V1"));
test("scenario vocabulary exact",()=>assert.deepStrictEqual(api.getVocabulary().scenarios,
    [{key:"ORIGINAL_UNCAPPED",maxR:null},{key:"MAX_2R",maxR:2},{key:"MAX_3R",maxR:3},{key:"MAX_4R",maxR:4},{key:"MAX_5R",maxR:5}]));
test("default policy preserves outcome horizon",()=>assert.deepStrictEqual(api.getDefaultPolicy(),{maximumForwardBars:24,includeMatches:false}));
test("LONG cap math",()=>{const result=run([candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)]);
    assert.deepStrictEqual([scenario(result,"MAX_2R").scenarioTakeProfit,scenario(result,"MAX_3R").scenarioTakeProfit,
        scenario(result,"MAX_4R").scenarioTakeProfit,scenario(result,"MAX_5R").scenarioTakeProfit],[120,130,140,150]);});
test("SHORT cap math",()=>{const item=observation({legacyPlanEvidence:evidence({direction:"SHORT",stopLoss:110,takeProfit:50})});
    const result=run([candle(2000,2999,100,101,95,98),candle(3000,3999,98,105,79,82)],item);
    assert.deepStrictEqual([scenario(result,"MAX_2R").scenarioTakeProfit,scenario(result,"MAX_3R").scenarioTakeProfit,
        scenario(result,"MAX_4R").scenarioTakeProfit,scenario(result,"MAX_5R").scenarioTakeProfit],[80,70,60,50]);});
test("LONG target inside cap preserved",()=>{const item=observation({legacyPlanEvidence:evidence({takeProfit:118})}),result=run([
    candle(2000,2999,100,105,99,102),candle(3000,3999,102,119,95,118)],item);
    assert.strictEqual(scenario(result,"MAX_2R").scenarioTakeProfit,118);assert.strictEqual(scenario(result,"MAX_2R").wasCapped,false);});
test("SHORT target inside cap preserved",()=>{const item=observation({legacyPlanEvidence:evidence({direction:"SHORT",stopLoss:110,takeProfit:82})}),result=run([
    candle(2000,2999,100,101,95,98),candle(3000,3999,98,105,81,82)],item);
    assert.strictEqual(scenario(result,"MAX_2R").scenarioTakeProfit,82);assert.strictEqual(scenario(result,"MAX_2R").wasCapped,false);});
test("original TP entry stop and direction are invariant",()=>{const result=run([candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)]);
    result.scenarioItems.forEach(item=>assert.deepStrictEqual([item.entryPrice,item.stopLoss,item.direction],[100,90,"LONG"]));
    assert.deepStrictEqual([scenario(result,"ORIGINAL_UNCAPPED").scenarioTakeProfit,
        scenario(result,"ORIGINAL_UNCAPPED").wasCapped],[150,false]);});
test("outcome analyzer receives only derived TP",()=>{const calls=[],dependency={analyzeOutcomes(m,r,c,p){calls.push(clone(r));return {
    valid:true,source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,analyzedMismatchCount:1,evaluableCount:1,
    notEvaluableCount:0,tpFirstCount:0,slFirstCount:0,ambiguousCount:0,entryNotReachedCount:0,openAtHorizonCount:1,
    insufficientFutureDataCount:0,outcomeItems:[{key:"K",candidateKey:"C",evaluationCloseTime:1,symbol:"BTCUSDT",interval:"4h",
        direction:"LONG",category:"OPEN_AT_HORIZON",entryReachedAt:2,outcomeAt:null,barsObserved:24}]};}};
    const local=browserApi(dependency),rp={observations:[{key:"K",candidateKey:"C",symbol:"BTCUSDT",interval:"4h",
        evaluationCloseTime:1,legacyPlanEvidence:evidence({candidateKey:"C",evaluationCloseTime:1})}]};
    const result=local.analyzeScenarios({},rp,[],policy());assert.strictEqual(result.valid,true);assert.strictEqual(calls.length,5);
    calls.slice(1).forEach((call,index)=>{const e=call.observations[0].legacyPlanEvidence;
        assert.deepStrictEqual([e.entryPrice,e.stopLoss,e.direction],[100,90,"LONG"]);assert.strictEqual(e.takeProfit,[120,130,140,150][index]);});});
test("MAX_2R can be TP first while original remains open",()=>{const result=run([
    candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)]);
    assert.deepStrictEqual([scenario(result,"ORIGINAL_UNCAPPED").scenarioOutcome,scenario(result,"MAX_2R").scenarioOutcome,
        scenario(result,"MAX_2R").outcomeChanged],["OPEN_AT_HORIZON","TP_FIRST",true]);});
test("SL first",()=>assert.strictEqual(scenario(run([candle(2000,2999,100,105,99,102),
    candle(3000,3999,102,110,89,92)]),"MAX_2R").scenarioOutcome,"SL_FIRST"));
test("ambiguous same bar",()=>assert.strictEqual(scenario(run([candle(2000,2999,100,105,99,102),
    candle(3000,3999,100,121,89,100)]),"MAX_2R").scenarioOutcome,"AMBIGUOUS_SAME_BAR"));
test("entry not reached",()=>assert.strictEqual(scenario(run([candle(2000,2999,105,108,102,106),
    candle(3000,3999,106,110,102,108)]),"MAX_2R").scenarioOutcome,"ENTRY_NOT_REACHED"));
test("open at horizon",()=>assert.strictEqual(scenario(run([candle(2000,2999,100,105,99,102),
    candle(3000,3999,102,110,95,101)]),"MAX_2R").scenarioOutcome,"OPEN_AT_HORIZON"));
test("insufficient future data",()=>assert.strictEqual(scenario(run([candle(2000,2999,100,105,99,102)]),
    "MAX_2R").scenarioOutcome,"INSUFFICIENT_FUTURE_DATA"));
test("entry and exit same bar stays ambiguous",()=>assert.strictEqual(scenario(run([
    candle(2000,2999,105,121,99,118),candle(3000,3999,118,119,110,115)]),"MAX_2R").scenarioOutcome,"AMBIGUOUS_SAME_BAR"));
test("missing evidence remains not evaluable",()=>{const result=run([candle(2000,2999,100,101,99,100),
    candle(3000,3999,100,101,99,100)],observation({legacyPlanEvidence:null}));
    assert.strictEqual(result.status,"NO_EVALUABLE_ITEMS");assert.ok(result.scenarioItems.every(item=>item.scenarioOutcome==="NOT_EVALUABLE"));});
test("provenance mismatch is never capped",()=>{const item=observation({legacyPlanEvidence:evidence({candidateKey:"OTHER"})}),result=run([
    candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)],item),max2=scenario(result,"MAX_2R");
    assert.deepStrictEqual([max2.scenarioOutcome,max2.originalTakeProfit,max2.scenarioTakeProfit,max2.originalR],
        ["NOT_EVALUABLE",null,null,null]);});
test("invalid policy fails closed",()=>assert.strictEqual(api.analyzeScenarios(mismatch(),replay(),candles([]),
    {maximumForwardBars:0,includeMatches:false}).status,"INVALID_INPUT"));
test("missing dependency fails closed",()=>assert.strictEqual(browserApi().analyzeScenarios({}, {}, [], policy()).status,"DEPENDENCY_FAILURE"));
test("dependency exception fails closed",()=>assert.strictEqual(browserApi({analyzeOutcomes(){throw new Error("boom");}})
    .analyzeScenarios({}, {}, [], policy()).status,"DEPENDENCY_FAILURE"));
test("malformed dependency result fails closed",()=>assert.strictEqual(browserApi({analyzeOutcomes(){return {};}})
    .analyzeScenarios({}, {}, [], policy()).status,"DEPENDENCY_FAILURE"));
test("inputs immutable",()=>{const m=mismatch(),r=replay(),c=candles([candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)]),p=policy();
    const before=JSON.stringify([m,r,c,p]);api.analyzeScenarios(m,r,c,p);assert.strictEqual(JSON.stringify([m,r,c,p]),before);});
test("deterministic repeat",()=>{const args=[mismatch(),replay(),candles([candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)]),policy()];
    assert.deepStrictEqual(api.analyzeScenarios(...args),api.analyzeScenarios(...args));});
test("readiness never contributes",()=>{const result=run([candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)]);
    assert.strictEqual(result.countsTowardLiveReadiness,false);assert.match(result.disclaimer,/DOES NOT CHANGE LIVE TP/);});
test("live state sentinels remain isolated",()=>{const state={setup:{id:1},plan:{id:2},trade:{id:3},readiness:{id:4}},before=clone(state);
    const local=browserApi({analyzeOutcomes(){return {valid:true,source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,
        analyzedMismatchCount:0,evaluableCount:0,notEvaluableCount:0,tpFirstCount:0,slFirstCount:0,ambiguousCount:0,
        entryNotReachedCount:0,openAtHorizonCount:0,insufficientFutureDataCount:0,outcomeItems:[]};}});
    local.analyzeScenarios({}, {observations:[]}, [], policy());assert.deepStrictEqual(state,before);});
test("five scenarios create five items per observation",()=>assert.strictEqual(run([
    candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)]).scenarioItems.length,5));
test("JSON export whitelist",()=>{const json=api.exportScenarioAnalysis(run([
    candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)])),parsed=JSON.parse(json);
    assert.deepStrictEqual(Object.keys(parsed).sort(),["schemaVersion","source","countsTowardLiveReadiness","status","policy",
        "analyzedItemCount","scenarioSummaries","scenarioItems","warnings","disclaimer"].sort());
    assert.ok(!/openTime|volume|rawCandles/.test(json));assert.ok(json.includes("originalTakeProfit")&&json.includes("scenarioTakeProfit")&&json.includes("outcomeChanged"));});
test("JSON nested whitelist drops injected fields",()=>{const result=run([
    candle(2000,2999,100,105,99,102),candle(3000,3999,102,121,95,118)]);
    result.scenarioItems[0].rawCandles=[{secret:true}];result.scenarioSummaries[0].unexpected="DROP";
    const json=api.exportScenarioAnalysis(result);assert.ok(!json.includes("rawCandles")&&!json.includes("unexpected")&&!json.includes("secret"));});
test("invalid export rejected",()=>assert.strictEqual(api.exportScenarioAnalysis({}),null));
test("module has no live writers network storage or clock",()=>{const source=fs.readFileSync(modulePath,"utf8");
    for(const token of ["HNDTradePlanEngine","HNDSetupEngine","HNDTradeEngine","Date.now","fetch(","XMLHttpRequest","WebSocket","localStorage","sessionStorage"])
        assert.ok(!source.includes(token),token);});
(async()=>{let passed=0;for(const item of tests){try{await item.fn();passed+=1;console.log("PASS:"+item.name);}catch(error){
    console.error("HND_HISTORICAL_RR_CAP_SCENARIO_TEST_FAILED:"+item.name);console.error(error.stack||error);process.exitCode=1;break;}}
    if(passed===tests.length)console.log("HND_HISTORICAL_RR_CAP_SCENARIO_TESTS_PASS:"+passed);})();
