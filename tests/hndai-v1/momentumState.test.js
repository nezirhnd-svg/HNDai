"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const momentum=require("../../js/hndai-v1/momentumState.js");const tests=[];function test(n,f){tests.push({n,f});}
function snap(o){return Object.assign({openTime:0,closeTime:999,close:10,rsi14:50,averageVolume20:10,volumeRatio20:1,isReady:true},o);}
function coreResult(ss,o){return Object.assign({valid:true,error:null,sourceCandleCount:ss.length,closedCandleCount:ss.length,excludedOpenCandleCount:0,openTimes:ss.map(x=>x.openTime),snapshots:ss,duplicateOpenTimeCount:0},o);}
function stub(result){let calls=0;const c={window:{HNDCoreIndicatorSnapshot:{buildSnapshot(){calls++;return result;}}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../../js/hndai-v1/momentumState.js"),"utf8"),c);return{api:c.window.HNDMomentumState,calls:()=>calls};}
function state(o){return stub(coreResult([snap(o)])).api.analyzeMomentum([],{});}
test("vocabulary directions",()=>assert.deepStrictEqual(momentum.getVocabulary().directions,["BULLISH","BEARISH","NEUTRAL"]));
test("vocabulary RSI states",()=>assert.strictEqual(momentum.getVocabulary().rsiStates.length,5));
test("vocabulary volume states",()=>assert.deepStrictEqual(momentum.getVocabulary().volumeStates,["EXPANDED","NORMAL","QUIET","UNKNOWN"]));
test("vocabulary new object",()=>assert.notStrictEqual(momentum.getVocabulary(),momentum.getVocabulary()));
test("vocabulary new arrays",()=>assert.notStrictEqual(momentum.getVocabulary().rsiStates,momentum.getVocabulary().rsiStates));
test("core once",()=>{const x=stub(coreResult([]));x.api.analyzeMomentum([],{});assert.strictEqual(x.calls(),1);});
["INVALID_NOW_MS","",0,false,null].forEach((v,i)=>test("core error preserves "+i,()=>assert.strictEqual(stub({valid:false,error:v}).api.analyzeMomentum([],{}).coreError,v)));
test("core invalid error",()=>assert.strictEqual(stub({valid:false,error:"X"}).api.analyzeMomentum([],{}).error,"CORE_SNAPSHOT_FAILED"));
test("openTimes alignment",()=>assert.strictEqual(stub(coreResult([],{openTimes:null})).api.analyzeMomentum([],{}).error,"CORE_ALIGNMENT_ERROR"));
test("snapshots alignment",()=>assert.strictEqual(stub(coreResult([],{snapshots:null})).api.analyzeMomentum([],{}).error,"CORE_ALIGNMENT_ERROR"));
test("length alignment",()=>assert.strictEqual(stub(coreResult([snap()],{openTimes:[]})).api.analyzeMomentum([],{}).error,"CORE_ALIGNMENT_ERROR"));
test("index alignment",()=>assert.strictEqual(stub(coreResult([snap()],{openTimes:[1]})).api.analyzeMomentum([],{}).error,"CORE_ALIGNMENT_ERROR"));
test("ascending alignment",()=>assert.strictEqual(stub(coreResult([snap(),snap()])).api.analyzeMomentum([],{}).error,"CORE_ALIGNMENT_ERROR"));
test("warmup creates state",()=>assert.strictEqual(state({isReady:false}).states.length,1));
test("warmup not ready",()=>assert.strictEqual(state({isReady:false}).latest.isReady,false));
test("warmup classifications null",()=>assert.deepStrictEqual([state({isReady:false}).latest.rsiState,state({isReady:false}).latest.volumeState,state({isReady:false}).latest.direction],[null,null,null]));
[[70,"OVERBOUGHT"],[69.999,"BULLISH"],[50,"NEUTRAL"],[49.999,"BEARISH"],[30,"OVERSOLD"],[30.001,"BEARISH"]].forEach(x=>test("RSI boundary "+x[0],()=>assert.strictEqual(state({rsi14:x[0]}).latest.rsiState,x[1])));
[[60,"BULLISH"],[40,"BEARISH"],[50,"NEUTRAL"]].forEach(x=>test("direction "+x[1],()=>assert.strictEqual(state({rsi14:x[0]}).latest.direction,x[1])));
[[null,"UNKNOWN"],[1.5,"EXPANDED"],[1.499,"NORMAL"],[.75,"NORMAL"],[.749,"QUIET"]].forEach(x=>test("volume boundary "+x[0],()=>assert.strictEqual(state({volumeRatio20:x[0]}).latest.volumeState,x[1])));
test("invalid openTime",()=>assert.strictEqual(stub(coreResult([snap({openTime:-1})],{openTimes:[-1]})).api.analyzeMomentum([],{}).error,"INVALID_READY_SNAPSHOT"));
test("invalid closeTime",()=>assert.strictEqual(state({closeTime:Infinity}).error,"INVALID_READY_SNAPSHOT"));
test("reverse time",()=>assert.strictEqual(state({closeTime:-1}).error,"INVALID_READY_SNAPSHOT"));
test("invalid close",()=>assert.strictEqual(state({close:NaN}).error,"INVALID_READY_SNAPSHOT"));
test("negative RSI",()=>assert.strictEqual(state({rsi14:-1}).error,"INVALID_READY_SNAPSHOT"));
test("RSI above 100",()=>assert.strictEqual(state({rsi14:101}).error,"INVALID_READY_SNAPSHOT"));
test("negative average volume",()=>assert.strictEqual(state({averageVolume20:-1}).error,"INVALID_READY_SNAPSHOT"));
test("negative volume ratio",()=>assert.strictEqual(state({volumeRatio20:-1}).error,"INVALID_READY_SNAPSHOT"));
test("nonfinite volume ratio",()=>assert.strictEqual(state({volumeRatio20:Infinity}).error,"INVALID_READY_SNAPSHOT"));
test("exact state schema",()=>assert.deepStrictEqual(Object.keys(state({}).latest),["openTime","closeTime","close","rsi14","averageVolume20","volumeRatio20","rsiState","volumeState","direction","isReady"]));
test("counts transfer",()=>{const r=stub(coreResult([snap()],{sourceCandleCount:3,closedCandleCount:2,excludedOpenCandleCount:1,duplicateOpenTimeCount:4})).api.analyzeMomentum([],{});assert.deepStrictEqual([r.sourceCandleCount,r.closedCandleCount,r.excludedOpenCandleCount,r.duplicateOpenTimeCount],[3,2,1,4]);});
test("invalid counts zero",()=>{const r=stub(coreResult([],{sourceCandleCount:"x",closedCandleCount:-1,excludedOpenCandleCount:NaN,duplicateOpenTimeCount:null})).api.analyzeMomentum([],{});assert.deepStrictEqual([r.sourceCandleCount,r.closedCandleCount,r.excludedOpenCandleCount,r.duplicateOpenTimeCount],[0,0,0,0]);});
test("openTimes clone",()=>{const c=coreResult([snap()]),r=stub(c).api.analyzeMomentum([],{});assert.notStrictEqual(r.openTimes,c.openTimes);});
test("states clone",()=>{const x=stub(coreResult([snap()]));assert.notStrictEqual(x.api.analyzeMomentum([],{}).states,x.api.analyzeMomentum([],{}).states);});
test("state object clone",()=>{const x=stub(coreResult([snap()]));assert.notStrictEqual(x.api.analyzeMomentum([],{}).states[0],x.api.analyzeMomentum([],{}).states[0]);});
test("latest clone",()=>{const r=state({});assert.notStrictEqual(r.latest,r.states[0]);});
test("raw input immutable",()=>{const a=[{x:1}],s=JSON.stringify(a);stub(coreResult([])).api.analyzeMomentum(a,{});assert.strictEqual(JSON.stringify(a),s);});
test("options immutable",()=>{const o={nowMs:1},s=JSON.stringify(o);stub(coreResult([])).api.analyzeMomentum([],o);assert.strictEqual(JSON.stringify(o),s);});
test("core immutable",()=>{const c=coreResult([snap()]),s=JSON.stringify(c);stub(c).api.analyzeMomentum([],{});assert.strictEqual(JSON.stringify(c),s);});
test("output mutation isolation",()=>{const x=stub(coreResult([snap()])),a=x.api.analyzeMomentum([],{});a.openTimes[0]=9;a.latest.close=0;a.states[0].close=0;assert.strictEqual(x.api.analyzeMomentum([],{}).latest.close,10);});
test("determinism",()=>{const x=stub(coreResult([snap()]));assert.deepStrictEqual(x.api.analyzeMomentum([],{}),x.api.analyzeMomentum([],{}));});
test("public API",()=>assert.deepStrictEqual(Object.keys(momentum).sort(),["analyzeMomentum","getVocabulary"]));
function candle(i,p){return{openTime:i*1000,closeTime:i*1000+999,open:p,high:p+1,low:p-1,close:p,volume:10};}
const up=Array.from({length:230},(_,i)=>candle(i,100+i)),down=Array.from({length:230},(_,i)=>candle(i,400-i)),flat=Array.from({length:230},(_,i)=>candle(i,100));
test("pipeline rising",()=>{const r=momentum.analyzeMomentum(up,{nowMs:229999});assert.deepStrictEqual([r.latest.rsiState,r.latest.direction],["OVERBOUGHT","BULLISH"]);});
test("pipeline falling",()=>{const r=momentum.analyzeMomentum(down,{nowMs:229999});assert.deepStrictEqual([r.latest.rsiState,r.latest.direction],["OVERSOLD","BEARISH"]);});
test("pipeline flat",()=>{const r=momentum.analyzeMomentum(flat,{nowMs:229999});assert.deepStrictEqual([r.latest.rsiState,r.latest.direction],["NEUTRAL","NEUTRAL"]);});
test("first 199 not ready",()=>assert.ok(momentum.analyzeMomentum(up,{nowMs:229999}).states.slice(0,199).every(x=>!x.isReady)));
test("index 199 onward ready",()=>assert.ok(momentum.analyzeMomentum(up,{nowMs:229999}).states.slice(199).every(x=>x.isReady)));
test("future causality",()=>assert.deepStrictEqual(momentum.analyzeMomentum(up,{nowMs:228999}).states,momentum.analyzeMomentum(up.slice(0,229),{nowMs:228999}).states));
test("source code dependency",()=>assert.ok(fs.readFileSync(path.join(__dirname,"../../js/hndai-v1/momentumState.js"),"utf8").includes("core.buildSnapshot(rawCandles, options)")));
let p=0;for(const t of tests){try{t.f();p++;console.log(`PASS:${t.n}`);}catch(e){console.error(`HND_MOMENTUM_STATE_TEST_FAILED:${t.n}`);console.error(e.stack||e);process.exitCode=1;break;}}if(p===tests.length)console.log(`HND_MOMENTUM_STATE_TESTS_PASS:${tests.length}`);
