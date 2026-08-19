"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"../.."),modulePath=path.join(root,"js/hndai-v1/structureHistoricalLegacyInputBuilder.js"),api=require(modulePath),tests=[];
function test(name,fn){tests.push({name,fn});}
function candle(i,step=900000,start=1600000000000){const open=100+i/10,close=open+0.2;return{openTime:start+i*step,closeTime:start+(i+1)*step-1,open,high:close+1,low:open-1,close,volume:10+i};}
const prefix=Array.from({length:220},(_,i)=>candle(i));
const htf=Array.from({length:220},(_,i)=>candle(i,14400000,1200000000000));
function context(change={}){return Object.assign({symbol:"BTCUSDT",interval:"15m",evaluationIndex:219,evaluationCloseTime:prefix[219].closeTime,pendingCandidate:{key:"P"},higherTimeframeCandles:htf},change);}
function qualified(){return{generatedAt:prefix[219].openTime,orderBlocks:[{id:"OB",kind:"ORDER_BLOCK",type:"BULLISH",status:"ACTIVE"}],fvgs:[],structureEvents:[],legs:[],summary:{}};}
function load(change={}){const calls=[];const window={
 analyzeMarket(data){calls.push(["signal",data.length]);return change.analysis||{signal:"LONG",signalReason:"BULLISH TREND CONFIRMED",marketBias:"BULLISH",ema20:1,ema50:1,ema200:1,rsi:50,breakdown:{}};},
 detectStructureEvents(options){calls.push(["events",options.candles.length]);return change.events||[];},
 detectOrderBlocks(options){calls.push(["ob",options.candles.length]);return change.orderBlocks||[];},
 detectFVGs(options){calls.push(["fvg",options.candles.length]);return change.fvgs||[];},
 selectStructureConfirmedPriceZones(source,options){calls.push(["zones",source.candles.length,options.now]);if(change.zoneThrow)throw Error("zone");return change.zones===undefined?qualified():change.zones;},
 getLiveStructureZoneQualificationOptions(){calls.push(["options"]);return{maxEvents:100};},
 getLiveStructureHistoricalInputOptions(){return{structureLookback:3,structureHistoryLimit:100,rawZoneHistoryLimit:200};},
 HNDMTFEngine:{analyzeCandles(data,timeframe,cutoff){calls.push(["mtf",data.length,timeframe,cutoff]);return change.mtf||{status:"OK",trend:"BULL",timeframe};}}
};Object.assign(window,change.dependencies||{});vm.runInNewContext(fs.readFileSync(modulePath,"utf8"),{window,JSON,Object,Array,Number,Math,Set,String,Boolean,Error});return{api:window.HNDStructureHistoricalLegacyInputBuilder,calls,window};}
test("CommonJS API",()=>assert.strictEqual(typeof api.buildHistoricalInput,"function"));
test("browser global API",()=>assert.strictEqual(load().api.getSchemaVersion(),api.getSchemaVersion()));
test("exact public API",()=>assert.deepStrictEqual(Object.keys(api).sort(),["getSchemaVersion","getVocabulary","buildHistoricalInput"].sort()));
test("schema exact",()=>assert.strictEqual(api.getSchemaVersion(),"HND_STRUCTURE_HISTORICAL_LEGACY_INPUT_BUILDER_V1"));
test("vocabulary exact statuses",()=>assert.deepStrictEqual(api.getVocabulary().statuses,["INPUT_READY","INVALID_INPUT","INSUFFICIENT_HISTORY","DEPENDENCY_FAILURE","SIGNAL_UNAVAILABLE","ZONE_UNAVAILABLE","MTF_UNAVAILABLE"]));
test("vocabulary cloned",()=>{const v=api.getVocabulary();v.statuses[0]="X";assert.strictEqual(api.getVocabulary().statuses[0],"INPUT_READY");});
for(const [name,change] of [["extra",{extra:1}],["symbol",{symbol:"btc"}],["interval",{interval:"1h"}],["index",{evaluationIndex:218}],["cutoff",{evaluationCloseTime:0}],["pending",{pendingCandidate:null}],["htf",{higherTimeframeCandles:null}]])test("exact context rejects "+name,()=>assert.strictEqual(load().api.buildHistoricalInput(prefix,context(change)).status,"INVALID_INPUT"));
test("missing context field",()=>{const c=context();delete c.symbol;assert.strictEqual(load().api.buildHistoricalInput(prefix,c).status,"INVALID_INPUT");});
test("malformed candle",()=>{const p=JSON.parse(JSON.stringify(prefix));p[2].high=1;assert.strictEqual(load().api.buildHistoricalInput(p,context()).error,"MALFORMED_CANDLE");});
test("unordered candle",()=>{const p=JSON.parse(JSON.stringify(prefix));[p[2],p[3]]=[p[3],p[2]];assert.strictEqual(load().api.buildHistoricalInput(p,context()).error,"UNORDERED_CANDLES");});
test("input not mutated",()=>{const p=JSON.parse(JSON.stringify(prefix)),c=context(),before=JSON.stringify([p,c]);load().api.buildHistoricalInput(p,c);assert.strictEqual(JSON.stringify([p,c]),before);});
test("deterministic",()=>{const x=load().api;assert.deepStrictEqual(x.buildHistoricalInput(prefix,context()),x.buildHistoricalInput(prefix,context()));});
test("no Date.now",()=>assert.ok(!fs.readFileSync(modulePath,"utf8").includes("Date.now")));
test("no Math.random",()=>assert.ok(!fs.readFileSync(modulePath,"utf8").includes("Math.random")));
test("no storage network writers",()=>assert.ok(!/(localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|TradeEngine|Telemetry|Collection|Readiness)/.test(fs.readFileSync(modulePath,"utf8"))));
test("future prefix rejected",()=>{const p=JSON.parse(JSON.stringify(prefix));p[219].closeTime+=1;assert.strictEqual(load().api.buildHistoricalInput(p,context()).error,"FUTURE_CANDLE");});
test("open evaluation candle rejected",()=>assert.strictEqual(load().api.buildHistoricalInput(prefix,context({evaluationCloseTime:prefix[219].closeTime-1})).status,"INVALID_INPUT"));
test("insufficient warmup",()=>{const p=prefix.slice(0,219);assert.strictEqual(load().api.buildHistoricalInput(p,context({evaluationIndex:218,evaluationCloseTime:p[218].closeTime})).status,"INSUFFICIENT_HISTORY");});
test("signal authoritative call",()=>assert.ok(load().api.buildHistoricalInput(prefix,context()).sourceEvidence.signal.includes("analyzeMarket")));
test("indicator evidence",()=>assert.ok(load().api.buildHistoricalInput(prefix,context()).sourceEvidence.indicators.includes("indicator")));
test("price parity",()=>assert.strictEqual(load().api.buildHistoricalInput(prefix,context()).input.price,prefix[219].close));
test("SMC prefix parity",()=>{const x=load();x.api.buildHistoricalInput(prefix,context());assert.ok(x.calls.filter(c=>["events","ob","fvg"].includes(c[0])).every(c=>c[1]===220));});
test("order block dependency called",()=>assert.ok(load().api.buildHistoricalInput(prefix,context()).sourceEvidence.smc.includes("detectOrderBlocks")));
test("FVG dependency called",()=>assert.ok(load().api.buildHistoricalInput(prefix,context()).sourceEvidence.smc.includes("detectFVGs")));
test("zone qualification dependency called",()=>{const x=load();x.api.buildHistoricalInput(prefix,context());assert.ok(x.calls.some(c=>c[0]==="zones"));});
test("zone cutoff exact",()=>{const x=load();x.api.buildHistoricalInput(prefix,context());assert.strictEqual(x.calls.find(c=>c[0]==="zones")[2],context().evaluationCloseTime);});
test("direction parity",()=>assert.strictEqual(load().api.buildHistoricalInput(prefix,context()).input.analysis.signal,"LONG"));
test("distance quality inputs preserved",()=>assert.ok(Array.isArray(load().api.buildHistoricalInput(prefix,context()).input.qualifiedPriceZones.orderBlocks)));
test("MTF mapping 15m to 4h",()=>{const x=load();x.api.buildHistoricalInput(prefix,context());assert.strictEqual(x.calls.find(c=>c[0]==="mtf")[2],"4h");});
test("MTF closed only future rejected",()=>{const future={...htf[219],openTime:context().evaluationCloseTime+1,closeTime:context().evaluationCloseTime+2};assert.strictEqual(load().api.buildHistoricalInput(prefix,context({higherTimeframeCandles:[future]})).error,"FUTURE_HIGHER_TIMEFRAME_CANDLE");});
test("partial HTF rejected",()=>{const partial={...htf[0],closeTime:context().evaluationCloseTime+1};assert.strictEqual(load().api.buildHistoricalInput(prefix,context({higherTimeframeCandles:[partial]})).status,"INVALID_INPUT");});
test("missing MTF fail closed",()=>assert.strictEqual(load().api.buildHistoricalInput(prefix,context({higherTimeframeCandles:[]})).status,"MTF_UNAVAILABLE"));
test("4h missing MTF fail closed",()=>assert.strictEqual(load().api.buildHistoricalInput(prefix,context({interval:"4h",higherTimeframeCandles:[]})).error,"HIGHER_TIMEFRAME_REQUIRED_FOR_4H"));
test("WAIT signal unavailable",()=>assert.strictEqual(load({analysis:{signal:"WAIT",signalReason:"WAIT_SIGNAL"}}).api.buildHistoricalInput(prefix,context()).status,"SIGNAL_UNAVAILABLE"));
test("zone unavailable",()=>assert.strictEqual(load({zones:{orderBlocks:[],fvgs:[]}}).api.buildHistoricalInput(prefix,context()).status,"ZONE_UNAVAILABLE"));
test("dependency exception fail closed",()=>assert.strictEqual(load({zoneThrow:true}).api.buildHistoricalInput(prefix,context()).status,"DEPENDENCY_FAILURE"));
test("malformed strategy fail closed",()=>assert.strictEqual(load({analysis:{}}).api.buildHistoricalInput(prefix,context()).status,"DEPENDENCY_FAILURE"));
test("malformed zone fail closed",()=>assert.strictEqual(load({zones:{}}).api.buildHistoricalInput(prefix,context()).status,"DEPENDENCY_FAILURE"));
test("malformed MTF fail closed",()=>assert.strictEqual(load({mtf:{status:"NO_DATA"}}).api.buildHistoricalInput(prefix,context()).status,"MTF_UNAVAILABLE"));
test("INPUT_READY contract",()=>{const r=load().api.buildHistoricalInput(prefix,context());assert.deepStrictEqual([r.valid,r.status,r.error],[true,"INPUT_READY",null]);});
test("result exact minimum fields",()=>["valid","error","schemaVersion","status","input","sourceEvidence","warnings"].forEach(k=>assert.ok(Object.hasOwn(load().api.buildHistoricalInput(prefix,context()),k))));
test("canonical candle mapping",()=>assert.deepStrictEqual(Object.keys(load().api.buildHistoricalInput(prefix,context()).input.candles[0]).sort(),["time","closeTime","open","high","low","close","volume"].sort()));
test("pending candidate not substituted as zone",()=>assert.ok(!JSON.stringify(load().api.buildHistoricalInput(prefix,context()).input.qualifiedPriceZones).includes('"key":"P"')));
test("same bundle stable",()=>assert.strictEqual(JSON.stringify(load().api.buildHistoricalInput(prefix,context()).input),JSON.stringify(load().api.buildHistoricalInput(prefix,context()).input)));
test("source evidence complete",()=>assert.deepStrictEqual(Object.keys(load().api.buildHistoricalInput(prefix,context()).sourceEvidence).sort(),["signal","price","indicators","smc","sourceZone","mtf","evaluationCloseTime"].sort()));
test("evaluation cutoff evidence exact",()=>assert.strictEqual(load().api.buildHistoricalInput(prefix,context()).sourceEvidence.evaluationCloseTime,context().evaluationCloseTime));
test("CommonJS fails closed without live dependencies",()=>assert.strictEqual(api.buildHistoricalInput(prefix,context()).status,"DEPENDENCY_FAILURE"));
test("no hardcoded decision",()=>assert.ok(!/decision\s*:\s*["'](?:ALLOW|BLOCK)["']/.test(fs.readFileSync(modulePath,"utf8"))));
test("no readiness contribution",()=>assert.ok(!/countsTowardLiveReadiness\s*:\s*true/.test(fs.readFileSync(modulePath,"utf8"))));
test("no secrets in output",()=>assert.ok(!/(apiKey|username|computerPath|rawBinance)/i.test(JSON.stringify(load().api.buildHistoricalInput(prefix,context())))));
(async()=>{let n=0;for(const t of tests){try{await t.fn();n++;}catch(e){console.error(`FAIL: ${t.name}`);throw e;}}console.log(`Structure Historical Legacy Input Builder tests passed: ${tests.length} scenarios, ${n} assertions.`);})().catch(e=>{console.error(e);process.exitCode=1;});
