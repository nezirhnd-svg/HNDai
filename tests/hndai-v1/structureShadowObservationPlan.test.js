"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const modulePath = path.resolve(__dirname, "../../js/hndai-v1/structureShadowObservationPlan.js");
const assessment = require(path.resolve(__dirname, "../../js/hndai-v1/structureShadowAssessment.js"));
const collection = require(path.resolve(__dirname, "../../js/hndai-v1/structureShadowCollection.js"));
const telemetry = require(path.resolve(__dirname, "../../js/hndai-v1/structureShadowTelemetry.js"));
const api = require(modulePath), tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function pct(n, d) { return d ? Math.round(n / d * 10000) / 100 : null; }
function sh(c = "MATCH_ALLOW") { const m = { MATCH_ALLOW:["ALLOW","ALLOW",false,"COMPLETED"], MATCH_BLOCK:["BLOCK","BLOCK",false,"COMPLETED"], LEGACY_ALLOW_GATE_BLOCK:["ALLOW","BLOCK",true,"COMPLETED"], LEGACY_BLOCK_GATE_ALLOW:["BLOCK","ALLOW",true,"COMPLETED"], NOT_COMPARABLE:["ALLOW",null,false,"COMPLETED"], NOT_APPLICABLE:[null,null,false,"NOT_APPLICABLE"], PIPELINE_FAILED:["ALLOW",null,false,"FAILED"] }[c]; return { enabled:true,status:m[3],reason:null,mode:"SHADOW",legacyDecision:m[0],gateDecision:m[1],comparison:c,wouldChangeDecision:m[2],gateReason:m[1]?"R":null,error:c==="PIPELINE_FAILED"?"E":null,failedStage:c==="PIPELINE_FAILED"?"GATE":null,candidateKey:c==="NOT_APPLICABLE"?null:"K" }; }
function obs(i, c="MATCH_ALLOW", symbol="BTCUSDT", interval="15m") { const t=1700000000000+i*60000; return {key:`${symbol}|${interval}|${t}`,symbol,interval,evaluationCloseTime:t,observedAt:t+1,shadow:sh(c)}; }
function summary(items) { const v=items.map(x=>x.shadow.comparison), count=x=>v.filter(y=>y===x).length, ma=count("MATCH_ALLOW"),mb=count("MATCH_BLOCK"),la=count("LEGACY_ALLOW_GATE_BLOCK"),lb=count("LEGACY_BLOCK_GATE_ALLOW"),match=ma+mb,mis=la+lb,comp=match+mis; return {observationCount:items.length,comparableCount:comp,matchCount:match,mismatchCount:mis,failedCount:count("PIPELINE_FAILED"),notApplicableCount:count("NOT_APPLICABLE"),notComparableCount:count("NOT_COMPARABLE"),matchAllowCount:ma,matchBlockCount:mb,legacyAllowGateBlockCount:la,legacyBlockGateAllowCount:lb,matchRate:pct(match,comp),mismatchRate:pct(mis,comp),latestObservation:items.length?clone(items.at(-1)):null,markets:[...new Set(items.map(x=>x.symbol))].sort(),intervals:[...new Set(items.map(x=>x.interval))].sort(),capacity:200,droppedCount:0}; }
function snap(items=[]) { const sorted=clone(items).sort((a,b)=>a.evaluationCloseTime-b.evaluationCloseTime||a.symbol.localeCompare(b.symbol)||a.interval.localeCompare(b.interval)||a.key.localeCompare(b.key)); return {schemaVersion:"HND_STRUCTURE_SHADOW_TELEMETRY_V1",summary:summary(sorted),observations:sorted}; }
function plan(over={}) { return Object.assign({markets:["BTCUSDT"],intervals:["15m"],targetObservationsPerCell:2,targetComparablePerCell:1},over); }
function fullFixture() { let i=1,out=[]; for(const s of ["BTCUSDT","ETHUSDT","SOLUSDT"]) for(const tf of ["15m","1h"]) for(let n=0;n<20;n++,i++) out.push(obs(i,n<8?"MATCH_ALLOW":n<10?"LEGACY_ALLOW_GATE_BLOCK":n<15?"NOT_COMPARABLE":"NOT_APPLICABLE",s,tf)); return out; }
test("CommonJS API works",()=>assert.strictEqual(api.getSchemaVersion(),"HND_STRUCTURE_SHADOW_OBSERVATION_PLAN_V1"));
test("browser global API works",()=>{const window={HNDStructureShadowAssessment:assessment};vm.runInNewContext(fs.readFileSync(modulePath,"utf8"),{window,JSON,Object,Array,Number,Math,Set,Map});assert.strictEqual(window.HNDStructureShadowObservationPlan.getSchemaVersion(),api.getSchemaVersion());});
test("public API is exact",()=>assert.deepStrictEqual(Object.keys(api).sort(),["getSchemaVersion","getVocabulary","getDefaultPlan","validatePlan","evaluateProgress"].sort()));
test("default plan is exact",()=>assert.deepStrictEqual(api.getDefaultPlan(),{markets:["BTCUSDT","ETHUSDT","SOLUSDT"],intervals:["15m","1h"],targetObservationsPerCell:20,targetComparablePerCell:10}));
test("default plan is cloned",()=>{const p=api.getDefaultPlan();p.markets.length=0;assert.strictEqual(api.getDefaultPlan().markets.length,3);});
test("valid plan accepted",()=>assert.strictEqual(api.validatePlan(plan()).valid,true));
test("missing field rejected",()=>{const p=plan();delete p.intervals;assert.strictEqual(api.validatePlan(p).valid,false);});
test("extra field rejected",()=>assert.strictEqual(api.validatePlan({...plan(),extra:1}).valid,false));
test("duplicate market rejected",()=>assert.strictEqual(api.validatePlan(plan({markets:["BTCUSDT","BTCUSDT"]})).error,"DUPLICATE_PLAN_VALUE"));
test("duplicate interval rejected",()=>assert.strictEqual(api.validatePlan(plan({intervals:["15m","15m"]})).error,"DUPLICATE_PLAN_VALUE"));
test("lowercase market rejected",()=>assert.strictEqual(api.validatePlan(plan({markets:["btc"]})).valid,false));
test("empty interval rejected",()=>assert.strictEqual(api.validatePlan(plan({intervals:[""]})).valid,false));
test("market list limit applied",()=>assert.strictEqual(api.validatePlan(plan({markets:Array.from({length:11},(_,i)=>`M${i}`)})).valid,false));
test("interval list limit applied",()=>assert.strictEqual(api.validatePlan(plan({intervals:Array.from({length:11},(_,i)=>`${i}m`)})).valid,false));
test("cell limit applied",()=>assert.strictEqual(api.validatePlan(plan({markets:Array.from({length:8},(_,i)=>`M${i}`),intervals:Array.from({length:7},(_,i)=>`${i}m`)})).error,"INVALID_PLAN_DIMENSIONS"));
test("zero target rejected",()=>assert.strictEqual(api.validatePlan(plan({targetObservationsPerCell:0})).valid,false));
test("unsafe target rejected",()=>assert.strictEqual(api.validatePlan(plan({targetObservationsPerCell:1.5})).valid,false));
test("target over 200 rejected",()=>assert.strictEqual(api.validatePlan(plan({targetObservationsPerCell:201})).valid,false));
test("total target over capacity rejected",()=>assert.strictEqual(api.validatePlan(plan({markets:["A","B"],intervals:["1","2"],targetObservationsPerCell:51})).error,"TOTAL_TARGET_EXCEEDS_CAPACITY"));
test("comparable cannot exceed observation target",()=>assert.strictEqual(api.validatePlan(plan({targetComparablePerCell:3})).error,"COMPARABLE_TARGET_EXCEEDS_OBSERVATION_TARGET"));
test("plan input not mutated",()=>{const p=plan({markets:["ETHUSDT","BTCUSDT"]}),before=clone(p);api.validatePlan(p);assert.deepStrictEqual(p,before);});
test("plan output is canonical",()=>assert.deepStrictEqual(api.validatePlan(plan({markets:["ETHUSDT","BTCUSDT"]})).plan.markets,["BTCUSDT","ETHUSDT"]));
test("assessment validator is used",()=>{let calls=0;const window={HNDStructureShadowAssessment:{validateSnapshot(){calls++;return{valid:true};}}};vm.runInNewContext(fs.readFileSync(modulePath,"utf8"),{window,JSON,Object,Array,Number,Math,Set,Map});window.HNDStructureShadowObservationPlan.evaluateProgress(snap(),plan());assert.strictEqual(calls,1);});
test("invalid snapshot rejected",()=>assert.strictEqual(api.evaluateProgress({},plan()).status,"INVALID_SNAPSHOT"));
test("empty snapshot not started",()=>assert.strictEqual(api.evaluateProgress(snap(),plan()).status,"NOT_STARTED"));
test("single cell observation counted",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1)]),plan()).cells[0].observationCount,1));
test("comparable types counted",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1),obs(2,"MATCH_BLOCK"),obs(3,"LEGACY_ALLOW_GATE_BLOCK"),obs(4,"LEGACY_BLOCK_GATE_ALLOW")]),plan({targetObservationsPerCell:4,targetComparablePerCell:4})).cells[0].comparableCount,4));
test("NOT_APPLICABLE not comparable",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1,"NOT_APPLICABLE")]),plan()).cells[0].comparableCount,0));
test("NOT_COMPARABLE not comparable",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1,"NOT_COMPARABLE")]),plan()).cells[0].comparableCount,0));
test("PIPELINE_FAILED is error not comparable",()=>{const c=api.evaluateProgress(snap([obs(1,"PIPELINE_FAILED")]),plan()).cells[0];assert.deepStrictEqual([c.failedCount,c.comparableCount],[1,0]);});
test("match and mismatch counts correct",()=>{const c=api.evaluateProgress(snap([obs(1),obs(2,"LEGACY_ALLOW_GATE_BLOCK")]),plan()).cells[0];assert.deepStrictEqual([c.matchCount,c.mismatchCount],[1,1]);});
test("remaining never negative",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1),obs(2),obs(3)]),plan()).cells[0].observationRemaining,0));
test("progress caps at 100",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1),obs(2),obs(3)]),plan()).cells[0].observationProgress,100));
test("cell incomplete without comparable target",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1,"NOT_COMPARABLE"),obs(2,"NOT_APPLICABLE")]),plan()).cells[0].status,"IN_PROGRESS"));
test("cell incomplete without observation target",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1)]),plan({targetComparablePerCell:1})).cells[0].status,"IN_PROGRESS"));
test("cell target met with both targets",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1),obs(2,"NOT_COMPARABLE")]),plan()).cells[0].status,"CELL_TARGET_MET"));
test("all six cells produce TARGETS_MET",()=>assert.strictEqual(api.evaluateProgress(snap(fullFixture())).status,"TARGETS_MET"));
test("default has six cells",()=>assert.strictEqual(api.evaluateProgress(snap()).cellCount,6));
test("default targets are 120 and 60",()=>{const r=api.evaluateProgress(snap());assert.deepStrictEqual([r.targetObservationCount,r.targetComparableCount],[120,60]);});
test("out of plan does not contribute",()=>assert.strictEqual(api.evaluateProgress(snap([obs(1,"MATCH_ALLOW","XRPUSDT")]),plan()).plannedObservationCount,0));
test("out of plan market reported",()=>assert.deepStrictEqual(api.evaluateProgress(snap([obs(1,"MATCH_ALLOW","XRPUSDT")]),plan()).outOfPlanMarkets,["XRPUSDT"]));
test("out of plan interval reported",()=>assert.deepStrictEqual(api.evaluateProgress(snap([obs(1,"MATCH_ALLOW","BTCUSDT","4h")]),plan()).outOfPlanIntervals,["4h"]));
test("next targets sorted deterministically",()=>{const p=api.getDefaultPlan(),r=api.evaluateProgress(snap([obs(1,"MATCH_ALLOW","BTCUSDT","15m")]),p);assert.strictEqual(r.nextTargets[0].key,"BTCUSDT|1h");});
test("next targets limited to six",()=>assert.ok(api.evaluateProgress(snap()).nextTargets.length<=6));
test("result deterministic",()=>{const s=snap(fullFixture().slice(0,20));assert.deepStrictEqual(api.evaluateProgress(s),api.evaluateProgress(s));});
test("snapshot input not mutated",()=>{const s=snap([obs(1)]),before=clone(s);api.evaluateProgress(s);assert.deepStrictEqual(s,before);});
test("disclaimer denies trade authorization",()=>assert.match(api.evaluateProgress(snap()).disclaimer,/does not authorize entries or trading/));
test("collection and telemetry remain unchanged",()=>{collection.reset("T");telemetry.reset("T");const c=collection.getSnapshot(),t=telemetry.exportSnapshot();api.evaluateProgress(c);assert.deepStrictEqual([collection.getSnapshot(),telemetry.exportSnapshot()],[c,t]);});
test("module contains no network storage or decision integration",()=>assert.ok(!/(fetch\(|XMLHttpRequest|localStorage|sessionStorage|Binance|TradeEngine|SetupEngine)/.test(fs.readFileSync(modulePath,"utf8"))));
test("UI initial status is NOT STARTED",()=>assert.match(fs.readFileSync(path.resolve(__dirname,"../../index.html"),"utf8"),/structureObservationPlanStatus">NOT STARTED/));
test("UI table uses safe DOM APIs",()=>{const u=fs.readFileSync(path.resolve(__dirname,"../../js/ui.js"),"utf8");assert.match(u,/createElement\("td"\)/);assert.ok(!u.includes("innerHTML"));});
test("update uses collection snapshot",()=>assert.match(fs.readFileSync(path.resolve(__dirname,"../../js/ui.js"),"utf8"),/HNDStructureShadowCollection\?\.getSnapshot/));
test("progress export filename is exact",()=>assert.match(fs.readFileSync(path.resolve(__dirname,"../../js/ui.js"),"utf8"),/HNDai-structure-observation-progress-\$\{/));
test("script order is dependency safe",()=>{const h=fs.readFileSync(path.resolve(__dirname,"../../index.html"),"utf8");assert.ok(h.indexOf("structureShadowCollection.js")<h.indexOf("structureShadowObservationPlan.js")&&h.indexOf("structureShadowObservationPlan.js")<h.indexOf("js/ui.js"));});
(async()=>{let assertions=0;for(const current of tests){try{await current.fn();assertions++;}catch(error){console.error(`FAIL: ${current.name}`);throw error;}}console.log(`Structure Shadow Observation Plan tests passed: ${tests.length} scenarios, ${assertions} assertions.`);})().catch(error=>{console.error(error);process.exitCode=1;});
