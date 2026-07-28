"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm");
const trend=require("../../js/hndai-v1/trendRegime.js");
const tests=[];function test(n,f){tests.push({n,f});}
function snap(o){return Object.assign({openTime:0,closeTime:999,close:12,ema20:11,ema50:10,ema200:9,atr14:2,isReady:true},o);}
function stub(snapshots,extra){return Object.assign({valid:true,error:null,sourceCandleCount:snapshots.length,closedCandleCount:snapshots.length,excludedOpenCandleCount:0,openTimes:snapshots.map(x=>x.openTime),snapshots,duplicateOpenTimeCount:0},extra);}
function withCore(result){let calls=0;const context={window:{HNDCoreIndicatorSnapshot:{buildSnapshot(){calls++;return result;}}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../../js/hndai-v1/trendRegime.js"),"utf8"),context);return{api:context.window.HNDTrendRegime,calls:()=>calls};}
function candle(i,p){return{openTime:i*1000,closeTime:i*1000+999,open:p,high:p+1,low:p-1,close:p,volume:10};}
const cases=[
["vocabulary directions",()=>assert.deepStrictEqual(trend.getVocabulary().directions,["BULLISH","BEARISH","NEUTRAL"])],
["vocabulary alignments",()=>assert.deepStrictEqual(trend.getVocabulary().alignments,["BULLISH","BEARISH","MIXED"])],
["vocabulary positions",()=>assert.deepStrictEqual(trend.getVocabulary().pricePositions,["ABOVE_EMA200","BELOW_EMA200","AT_EMA200"])],
["vocabulary new object",()=>assert.notStrictEqual(trend.getVocabulary(),trend.getVocabulary())],
["vocabulary arrays new",()=>assert.notStrictEqual(trend.getVocabulary().directions,trend.getVocabulary().directions)],
["core dependency called",()=>{const x=withCore(stub([]));x.api.analyzeTrend([],{});assert.strictEqual(x.calls(),1);}],
["core called once",()=>{const x=withCore(stub([]));x.api.analyzeTrend([],{});assert.strictEqual(x.calls(),1);}],
["core invalid",()=>assert.strictEqual(withCore({valid:false,error:"X"}).api.analyzeTrend([],{}).error,"CORE_SNAPSHOT_FAILED")],
["coreError preserved",()=>assert.strictEqual(withCore({valid:false,error:"X"}).api.analyzeTrend([],{}).coreError,"X")],
["core counts preserved",()=>assert.strictEqual(withCore({valid:false,error:"X",sourceCandleCount:3}).api.analyzeTrend([],{}).sourceCandleCount,3)],
["openTimes array check",()=>assert.strictEqual(withCore(stub([],{openTimes:null})).api.analyzeTrend([],{}).error,"CORE_ALIGNMENT_ERROR")],
["snapshots array check",()=>assert.strictEqual(withCore(stub([],{snapshots:null})).api.analyzeTrend([],{}).error,"CORE_ALIGNMENT_ERROR")],
["length alignment",()=>assert.strictEqual(withCore(stub([snap()],{openTimes:[]})).api.analyzeTrend([],{}).error,"CORE_ALIGNMENT_ERROR")],
["openTime alignment",()=>assert.strictEqual(withCore(stub([snap()],{openTimes:[1]})).api.analyzeTrend([],{}).error,"CORE_ALIGNMENT_ERROR")],
["ascending alignment",()=>assert.strictEqual(withCore(stub([snap(),snap()])).api.analyzeTrend([],{}).error,"CORE_ALIGNMENT_ERROR")],
["empty valid",()=>assert.strictEqual(withCore(stub([])).api.analyzeTrend([],{}).ready,false)],
["warmup produces",()=>assert.strictEqual(withCore(stub([snap({isReady:false})])).api.analyzeTrend([],{}).regimes.length,1)],
["warmup not ready",()=>assert.strictEqual(withCore(stub([snap({isReady:false})])).api.analyzeTrend([],{}).latest.isReady,false)],
["warmup null classifications",()=>assert.strictEqual(withCore(stub([snap({isReady:false})])).api.analyzeTrend([],{}).latest.direction,null)],
["bullish alignment",()=>assert.strictEqual(withCore(stub([snap()])).api.analyzeTrend([],{}).latest.alignment,"BULLISH")],
["bearish alignment",()=>assert.strictEqual(withCore(stub([snap({ema20:7,ema50:8,ema200:9,close:6})])).api.analyzeTrend([],{}).latest.alignment,"BEARISH")],
["equal mixed",()=>assert.strictEqual(withCore(stub([snap({ema20:9,ema50:9})])).api.analyzeTrend([],{}).latest.alignment,"MIXED")],
["mixed order",()=>assert.strictEqual(withCore(stub([snap({ema20:10,ema50:11,ema200:9})])).api.analyzeTrend([],{}).latest.alignment,"MIXED")],
["above position",()=>assert.strictEqual(withCore(stub([snap()])).api.analyzeTrend([],{}).latest.pricePosition,"ABOVE_EMA200")],
["below position",()=>assert.strictEqual(withCore(stub([snap({close:8})])).api.analyzeTrend([],{}).latest.pricePosition,"BELOW_EMA200")],
["at position",()=>assert.strictEqual(withCore(stub([snap({close:9})])).api.analyzeTrend([],{}).latest.pricePosition,"AT_EMA200")],
["bullish direction",()=>assert.strictEqual(withCore(stub([snap()])).api.analyzeTrend([],{}).latest.direction,"BULLISH")],
["bearish direction",()=>assert.strictEqual(withCore(stub([snap({ema20:7,ema50:8,ema200:9,close:6})])).api.analyzeTrend([],{}).latest.direction,"BEARISH")],
["bullish below neutral",()=>assert.strictEqual(withCore(stub([snap({close:8})])).api.analyzeTrend([],{}).latest.direction,"NEUTRAL")],
["bearish above neutral",()=>assert.strictEqual(withCore(stub([snap({ema20:7,ema50:8,ema200:9,close:10})])).api.analyzeTrend([],{}).latest.direction,"NEUTRAL")],
["mixed neutral",()=>assert.strictEqual(withCore(stub([snap({ema20:10,ema50:11})])).api.analyzeTrend([],{}).latest.direction,"NEUTRAL")],
["normalized distance",()=>assert.strictEqual(withCore(stub([snap()])).api.analyzeTrend([],{}).latest.ema20To50Atr,.5)],
["bearish signed",()=>assert.ok(withCore(stub([snap({ema20:7,ema50:8,ema200:9})])).api.analyzeTrend([],{}).latest.ema20To50Atr<0)],
["zero ATR null",()=>assert.strictEqual(withCore(stub([snap({atr14:0})])).api.analyzeTrend([],{}).latest.ema20To50Atr,null)],
["invalid openTime",()=>assert.strictEqual(withCore(stub([snap({openTime:-1})],{openTimes:[-1]})).api.analyzeTrend([],{}).error,"INVALID_READY_SNAPSHOT")],
["invalid closeTime",()=>assert.strictEqual(withCore(stub([snap({closeTime:Infinity})])).api.analyzeTrend([],{}).error,"INVALID_READY_SNAPSHOT")],
["reverse time",()=>assert.strictEqual(withCore(stub([snap({closeTime:-1})])).api.analyzeTrend([],{}).error,"INVALID_READY_SNAPSHOT")],
["invalid close",()=>assert.strictEqual(withCore(stub([snap({close:NaN})])).api.analyzeTrend([],{}).error,"INVALID_READY_SNAPSHOT")],
["invalid EMA",()=>assert.strictEqual(withCore(stub([snap({ema20:NaN})])).api.analyzeTrend([],{}).error,"INVALID_READY_SNAPSHOT")],
["negative ATR",()=>assert.strictEqual(withCore(stub([snap({atr14:-1})])).api.analyzeTrend([],{}).error,"INVALID_READY_SNAPSHOT")],
["regime schema",()=>assert.strictEqual(Object.keys(withCore(stub([snap()])).api.analyzeTrend([],{}).latest).length,13)],
["regime length",()=>assert.strictEqual(withCore(stub([snap()])).api.analyzeTrend([],{}).regimes.length,1)],
["latest value",()=>{const r=withCore(stub([snap()])).api.analyzeTrend([],{});assert.strictEqual(JSON.stringify(r.latest),JSON.stringify(r.regimes[0]));}],
["latest clone",()=>{const r=withCore(stub([snap()])).api.analyzeTrend([],{});assert.notStrictEqual(r.latest,r.regimes[0]);}],
["overall last ready",()=>assert.strictEqual(withCore(stub([snap({isReady:false})])).api.analyzeTrend([],{}).ready,false)],
["deterministic",()=>{const x=withCore(stub([snap()]));assert.deepStrictEqual(x.api.analyzeTrend([],{}),x.api.analyzeTrend([],{}));}],
["public API",()=>assert.deepStrictEqual(Object.keys(trend).sort(),["analyzeTrend","getVocabulary"])],
["source count",()=>assert.strictEqual(withCore(stub([snap()],{sourceCandleCount:2})).api.analyzeTrend([],{}).sourceCandleCount,2)]
];cases.forEach(x=>test(x[0],x[1]));
const up=Array.from({length:230},(_,i)=>candle(i,100+i));const down=Array.from({length:230},(_,i)=>candle(i,400-i));const flat=Array.from({length:230},(_,i)=>candle(i,100));
test("real bullish pipeline",()=>assert.strictEqual(trend.analyzeTrend(up,{nowMs:229999}).latest.direction,"BULLISH"));
test("real bearish pipeline",()=>assert.strictEqual(trend.analyzeTrend(down,{nowMs:229999}).latest.direction,"BEARISH"));
test("real flat pipeline",()=>{const r=trend.analyzeTrend(flat,{nowMs:229999});assert.strictEqual(r.latest.alignment,"MIXED");assert.strictEqual(r.latest.direction,"NEUTRAL");});
test("future candle causality",()=>assert.deepStrictEqual(trend.analyzeTrend(up,{nowMs:228999}).regimes,trend.analyzeTrend(up.slice(0,229),{nowMs:228999}).regimes));
test("coreError INVALID_NOW_MS aynen korunur",()=>assert.strictEqual(withCore({valid:false,error:"INVALID_NOW_MS"}).api.analyzeTrend([],{}).coreError,"INVALID_NOW_MS"));
test("coreError bos string aynen korunur",()=>assert.strictEqual(withCore({valid:false,error:""}).api.analyzeTrend([],{}).coreError,""));
test("coreError zero aynen korunur",()=>assert.strictEqual(withCore({valid:false,error:0}).api.analyzeTrend([],{}).coreError,0));
test("coreError false aynen korunur",()=>assert.strictEqual(withCore({valid:false,error:false}).api.analyzeTrend([],{}).coreError,false));
test("coreError null aynen korunur",()=>assert.strictEqual(withCore({valid:false,error:null}).api.analyzeTrend([],{}).coreError,null));
test("sourceCandleCount aynen aktarilir",()=>assert.strictEqual(withCore(stub([snap()],{sourceCandleCount:7})).api.analyzeTrend([],{}).sourceCandleCount,7));
test("closedCandleCount aynen aktarilir",()=>assert.strictEqual(withCore(stub([snap()],{closedCandleCount:6})).api.analyzeTrend([],{}).closedCandleCount,6));
test("excludedOpenCandleCount aynen aktarilir",()=>assert.strictEqual(withCore(stub([snap()],{excludedOpenCandleCount:1})).api.analyzeTrend([],{}).excludedOpenCandleCount,1));
test("duplicateOpenTimeCount aynen aktarilir",()=>assert.strictEqual(withCore(stub([snap()],{duplicateOpenTimeCount:3})).api.analyzeTrend([],{}).duplicateOpenTimeCount,3));
test("gecersiz sayac sifira cevrilir",()=>{const r=withCore(stub([],{sourceCandleCount:"x",closedCandleCount:-1,excludedOpenCandleCount:NaN,duplicateOpenTimeCount:null})).api.analyzeTrend([],{});assert.deepStrictEqual([r.sourceCandleCount,r.closedCandleCount,r.excludedOpenCandleCount,r.duplicateOpenTimeCount],[0,0,0,0]);});
test("openTimes yeni dizi olarak doner",()=>{const c=stub([snap()]),r=withCore(c).api.analyzeTrend([],{});assert.notStrictEqual(r.openTimes,c.openTimes);});
test("regimes yeni dizi olarak doner",()=>{const x=withCore(stub([snap()]));assert.notStrictEqual(x.api.analyzeTrend([],{}).regimes,x.api.analyzeTrend([],{}).regimes);});
test("regime nesneleri yeni referans doner",()=>{const x=withCore(stub([snap()]));assert.notStrictEqual(x.api.analyzeTrend([],{}).regimes[0],x.api.analyzeTrend([],{}).regimes[0]);});
test("latest regime nesnesinden bagimsizdir",()=>{const r=withCore(stub([snap()])).api.analyzeTrend([],{});assert.notStrictEqual(r.latest,r.regimes[0]);});
test("raw candle dizisi mutate edilmez",()=>{const raw=[{x:1}],before=JSON.stringify(raw);withCore(stub([])).api.analyzeTrend(raw,{});assert.strictEqual(JSON.stringify(raw),before);});
test("raw candle nesneleri mutate edilmez",()=>{const item={x:1},raw=[item],before=JSON.stringify(item);withCore(stub([])).api.analyzeTrend(raw,{});assert.strictEqual(JSON.stringify(item),before);});
test("options nesnesi mutate edilmez",()=>{const o={nowMs:1},before=JSON.stringify(o);withCore(stub([])).api.analyzeTrend([],o);assert.strictEqual(JSON.stringify(o),before);});
test("core sonucu mutate edilmez",()=>{const c=stub([snap()]),before=JSON.stringify(c);withCore(c).api.analyzeTrend([],{});assert.strictEqual(JSON.stringify(c),before);});
test("core snapshot nesnesi mutate edilmez",()=>{const s=snap(),c=stub([s]),before=JSON.stringify(s);withCore(c).api.analyzeTrend([],{});assert.strictEqual(JSON.stringify(s),before);});
test("output mutation sonraki cagriyi etkilemez acceptance",()=>{const x=withCore(stub([snap()])),a=x.api.analyzeTrend([],{});a.openTimes[0]=9;a.regimes[0].close=0;a.latest.close=0;const b=x.api.analyzeTrend([],{});assert.deepStrictEqual([b.openTimes[0],b.regimes[0].close,b.latest.close],[0,12,12]);});
test("ready false snapshot degerleri aynen kopyalanir",()=>{const s=snap({isReady:false,close:7,ema20:null}),r=withCore(stub([s])).api.analyzeTrend([],{}).latest;assert.deepStrictEqual([r.close,r.ema20,r.ema50,r.ema200,r.atr14],[7,null,10,9,2]);});
test("ready false siniflandirma alanlari null kalir acceptance",()=>{const r=withCore(stub([snap({isReady:false})])).api.analyzeTrend([],{}).latest;assert.deepStrictEqual([r.alignment,r.pricePosition,r.direction,r.ema20To50Atr,r.ema50To200Atr],[null,null,null,null,null]);});
test("non-finite ema20To50Atr guvenli hata",()=>{const r=withCore(stub([snap({ema20:Number.MAX_VALUE,ema50:-Number.MAX_VALUE,ema200:-Number.MAX_VALUE,atr14:1})])).api.analyzeTrend([],{});assert.strictEqual(r.error,"NON_FINITE_TREND_METRIC");});
test("non-finite ema50To200Atr guvenli hata",()=>{const r=withCore(stub([snap({ema20:Number.MAX_VALUE,ema50:Number.MAX_VALUE,ema200:-Number.MAX_VALUE,atr14:1})])).api.analyzeTrend([],{});assert.strictEqual(r.error,"NON_FINITE_TREND_METRIC");});
test("regime semasi tam alan adlariyla dogrulanir",()=>assert.deepStrictEqual(Object.keys(withCore(stub([snap()])).api.analyzeTrend([],{}).latest),["openTime","closeTime","close","ema20","ema50","ema200","atr14","alignment","pricePosition","direction","ema20To50Atr","ema50To200Atr","isReady"]));
test("ilk 199 pipeline regime hazir degildir",()=>assert.ok(trend.analyzeTrend(up,{nowMs:229999}).regimes.slice(0,199).every(x=>x.isReady===false)));
test("index 199 ve sonrasi pipeline hazirdir",()=>assert.ok(trend.analyzeTrend(up,{nowMs:229999}).regimes.slice(199).every(x=>x.isReady===true)));
let p=0;for(const t of tests){try{t.f();p++;console.log(`PASS:${t.n}`);}catch(e){console.error(`HND_TREND_REGIME_TEST_FAILED:${t.n}`);console.error(e.stack||e);process.exitCode=1;break;}}if(p===tests.length)console.log(`HND_TREND_REGIME_TESTS_PASS:${tests.length}`);
