"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const core = require("../../js/hndai-v1/coreIndicatorSnapshot.js");
const ema = require("../../js/hndai-v1/emaIndicator.js");
const rsi = require("../../js/hndai-v1/rsiIndicator.js");
const atr = require("../../js/hndai-v1/atrIndicator.js");
const volume = require("../../js/hndai-v1/volumeIndicator.js");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function candle(i, overrides) {
    return Object.assign({
        openTime: i * 1000, closeTime: i * 1000 + 999,
        open: 100 + i, high: 102 + i, low: 98 + i, close: 101 + i,
        volume: 10 + (i % 11)
    }, overrides);
}
function fixture(count) { return Array.from({ length: count }, (_, i) => candle(i)); }
function build(input, nowMs) { return core.buildSnapshot(input, { nowMs }); }
const periods = { ema20: 20, ema50: 50, ema200: 200, rsi14: 14, atr14: 14, volume20: 20 };

test("getPeriods dogru degerleri dondurur", () => assert.deepStrictEqual(core.getPeriods(), periods));
test("getPeriods yeni nesne dondurur", () => assert.notStrictEqual(core.getPeriods(), core.getPeriods()));
test("invalid nowMs reddedilir", () => assert.strictEqual(build([], -1).error, "INVALID_NOW_MS"));
test("nowMs kontrolu seri kontrolunden once yapilir", () => assert.strictEqual(core.buildSnapshot(null, {}).error, "INVALID_NOW_MS"));
test("non-array candle serisi reddedilir", () => assert.strictEqual(build(null, 0).error, "INVALID_CANDLE_SERIES"));
test("bos seri valid fakat ready false", () => { const r=build([],0); assert.ok(r.valid&&!r.ready); });
test("canonical candle kabul edilir", () => assert.strictEqual(build([candle(0)],999).valid,true));
test("Binance kline kabul edilir", () => assert.strictEqual(build([[0,100,102,98,101,10,999]],999).valid,true));
test("invalid candle tum islemi reddeder", () => assert.strictEqual(build([candle(0,{volume:-1})],999).error,"INVALID_CANDLE_SERIES"));
test("rejected reason aktarilir", () => assert.strictEqual(build([null],0).rejected[0].reason,"INVALID_INPUT"));
test("rejected inputIndex korunur", () => assert.strictEqual(build([candle(0),null],999).rejected[0].inputIndex,1));
test("duplicate son gecerli kaydi kullanir", () => assert.strictEqual(build([candle(0),candle(0,{close:100})],999).snapshots[0].close,100));
test("duplicateOpenTimeCount aktarilir", () => assert.strictEqual(build([candle(0),candle(0)],999).duplicateOpenTimeCount,1));
test("raw sira openTimes sonucunu degistirmez", () => assert.deepStrictEqual(build([candle(2),candle(0),candle(1)],2999).openTimes,[0,1000,2000]));
test("sourceCandleCount dogru", () => assert.strictEqual(build(fixture(3),1500).sourceCandleCount,3));
test("closedCandleCount dogru", () => assert.strictEqual(build(fixture(3),1999).closedCandleCount,2));
test("excludedOpenCandleCount dogru", () => assert.strictEqual(build(fixture(3),1999).excludedOpenCandleCount,1));
test("acik candle snapshot uretmez", () => assert.strictEqual(build(fixture(3),1999).snapshots.length,2));
test("raw isClosed alanina guvenilmez", () => assert.strictEqual(build([candle(0,{isClosed:true})],0).snapshots.length,0));
test("daha ileri nowMs yeni snapshot ekler", () => assert.ok(build(fixture(3),2999).snapshots.length>build(fixture(3),1999).snapshots.length));
const integration = fixture(220);
const integrated = build(integration,219999);
const closes = integration.map(x=>x.close);
const e20=ema.calculateEMA(closes,20), e50=ema.calculateEMA(closes,50), e200=ema.calculateEMA(closes,200);
const rr=rsi.calculateRSI(closes,14), aa=atr.calculateATR(integration,14,{nowMs:219999});
const vv=volume.calculateVolumeMetrics(integration,20,{nowMs:219999});
test("EMA20 component sonucu hizalanir",()=>assert.strictEqual(integrated.snapshots[219].ema20,e20.values[219]));
test("EMA50 component sonucu hizalanir",()=>assert.strictEqual(integrated.snapshots[219].ema50,e50.values[219]));
test("EMA200 component sonucu hizalanir",()=>assert.strictEqual(integrated.snapshots[219].ema200,e200.values[219]));
test("RSI14 component sonucu hizalanir",()=>assert.strictEqual(integrated.snapshots[219].rsi14,rr.values[219]));
test("ATR14 component sonucu hizalanir",()=>assert.strictEqual(integrated.snapshots[219].atr14,aa.values[219]));
test("Volume20 average sonucu hizalanir",()=>assert.strictEqual(integrated.snapshots[219].averageVolume20,vv.averageVolumes[219]));
test("Volume20 ratio sonucu hizalanir",()=>assert.strictEqual(integrated.snapshots[219].volumeRatio20,vv.ratios[219]));
test("snapshot yalniz beklenen alanlari icerir",()=>assert.deepStrictEqual(Object.keys(integrated.snapshots[0]),["openTime","closeTime","close","ema20","ema50","ema200","rsi14","atr14","averageVolume20","volumeRatio20","isReady"]));
test("snapshots uzunlugu closed sayisina esittir",()=>assert.strictEqual(integrated.snapshots.length,integrated.closedCandleCount));
test("openTimes snapshots ile hizalidir",()=>assert.deepStrictEqual(integrated.openTimes,integrated.snapshots.map(x=>x.openTime)));
test("warmup snapshot alanlari null kalir",()=>assert.strictEqual(integrated.snapshots[0].ema20,null));
test("199 closed candle overall ready false",()=>assert.strictEqual(build(fixture(199),198999).ready,false));
test("200 closed candle overall ready true",()=>assert.strictEqual(build(fixture(200),199999).ready,true));
test("ilk tam ready snapshot index 199 olur",()=>{assert.strictEqual(integrated.snapshots[198].isReady,false);assert.strictEqual(integrated.snapshots[199].isReady,true);});
test("latest son snapshot degeridir",()=>assert.deepStrictEqual(integrated.latest,integrated.snapshots[219]));
test("latest bos seride null",()=>assert.strictEqual(build([],0).latest,null));
test("sifir volume baseline ratio null olabilir",()=>assert.strictEqual(build(fixture(200).map((x)=>Object.assign({},x,{volume:0})),199999).latest.volumeRatio20,null));
test("null volume ratio isReady degerini bozmaz",()=>assert.strictEqual(build(fixture(200).map((x)=>Object.assign({},x,{volume:0})),199999).ready,true));
test("input mutation yapilmaz",()=>{const x=fixture(3),s=JSON.stringify(x);build(x,2999);assert.strictEqual(JSON.stringify(x),s);});
test("options mutation yapilmaz",()=>{const o={nowMs:999},s=JSON.stringify(o);core.buildSnapshot([candle(0)],o);assert.strictEqual(JSON.stringify(o),s);});
test("output mutation sonraki cagriyi etkilemez",()=>{const a=build(integration,219999);a.snapshots[0].close=0;a.periods.ema20=1;assert.notStrictEqual(build(integration,219999).snapshots[0].close,0);});
test("ayni input deterministic sonuc uretir",()=>assert.deepStrictEqual(build(fixture(20),19999),build(fixture(20),19999)));
test("public API yalniz iki fonksiyondur",()=>assert.deepStrictEqual(Object.keys(core).sort(),["buildSnapshot","getPeriods"]));
test("butun dependency fonksiyonlari gercek olarak cagrilir",()=>{const s=fs.readFileSync(path.join(__dirname,"../../js/hndai-v1/coreIndicatorSnapshot.js"),"utf8");["normalizeCandles","validateCandleSequence","calculateEMA","calculateRSI","calculateATR","calculateVolumeMetrics"].forEach(x=>assert.ok(s.includes(x)));});
test("indicator formulleri yeniden yazilmamistir",()=>{const s=fs.readFileSync(path.join(__dirname,"../../js/hndai-v1/coreIndicatorSnapshot.js"),"utf8");["averageGain","previousAtr","rollingSum","high - low"].forEach(x=>assert.ok(!s.includes(x)));});
test("numeric string candle degerleri kabul edilir",()=>assert.strictEqual(build([candle("0",{closeTime:"999",open:"100",high:"102",low:"98",close:"101",volume:"10"})],999).valid,true));
test("component dizileri closed sayisiyla hizalidir",()=>assert.strictEqual(integrated.snapshots.length,220));
test("ATR openTimes hizalidir",()=>assert.deepStrictEqual(aa.openTimes,integrated.openTimes));
test("Volume openTimes hizalidir",()=>assert.deepStrictEqual(vv.openTimes,integrated.openTimes));
test("periods output mutationa karsi guvenlidir",()=>{const a=build([],0);a.periods.ema20=1;assert.strictEqual(build([],0).periods.ema20,20);});
test("snapshots yeni nesnelerdir",()=>assert.notStrictEqual(build(integration,219999).snapshots[0],build(integration,219999).snapshots[0]));
test("rejected yeni nesnelerdir",()=>assert.notStrictEqual(build([null],0).rejected[0],build([null],0).rejected[0]));
test("latest snapshot ile ayni referans degildir",()=>assert.notStrictEqual(integrated.latest,integrated.snapshots[219]));

let passed=0;for(const current of tests){try{current.fn();passed++;console.log(`PASS:${current.name}`);}catch(error){console.error(`HND_CORE_INDICATOR_SNAPSHOT_TEST_FAILED:${current.name}`);console.error(error.stack||error);process.exitCode=1;break;}}
if(passed===tests.length)console.log(`HND_CORE_INDICATOR_SNAPSHOT_TESTS_PASS:${tests.length}`);
