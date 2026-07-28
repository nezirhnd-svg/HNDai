"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),vm=require("vm"),seq=require("../../js/hndai-v1/swingSequence.js");
const tests=[];function test(n,f){tests.push({n,f});}
function c(i,h,l){return{openTime:i*1000,closeTime:i*1000+999,open:(h+l)/2,high:h,low:l,close:(h+l)/2,volume:10};}
function wave(n){return Array.from({length:n},(_,i)=>c(i,10+Math.sin(i/3)*5,5+Math.sin(i/3)*5));}
function dependencyEvent(type,candidateIndex,confirmedAtIndex,price){
    return{type,candidateIndex,openTime:candidateIndex*1000,closeTime:candidateIndex*1000+999,price,confirmedAtIndex,confirmedAtOpenTime:confirmedAtIndex*1000,confirmedAtCloseTime:confirmedAtIndex*1000+999};
}
function vmResult(overrides){
    const base={valid:true,ready:true,config:{leftBars:2,rightBars:2},sourceCandleCount:4,closedCandleCount:4,excludedOpenCandleCount:0,evaluatedCandidateCount:1,duplicateOpenTimeCount:0,openTimes:[0,1000,2000,3000],swingHighs:[],swingLows:[],events:[]};
    const dependency=Object.assign(base,overrides);
    const context={window:{HNDSwingDetector:{detectSwings(){return dependency;}}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,"../../js/hndai-v1/swingSequence.js"),"utf8"),context);
    return context.window.HNDSwingSequence.classifySwings([],{});
}
test("vocabulary high",()=>assert.deepStrictEqual(seq.getVocabulary().highClasses,["INITIAL_HIGH","HIGHER_HIGH","LOWER_HIGH","EQUAL_HIGH"]));
test("vocabulary low",()=>assert.deepStrictEqual(seq.getVocabulary().lowClasses,["INITIAL_LOW","HIGHER_LOW","LOWER_LOW","EQUAL_LOW"]));
test("vocabulary clone",()=>assert.notStrictEqual(seq.getVocabulary(),seq.getVocabulary()));
test("vocabulary arrays clone",()=>assert.notStrictEqual(seq.getVocabulary().highClasses,seq.getVocabulary().highClasses));
test("public API",()=>assert.deepStrictEqual(Object.keys(seq).sort(),["classifySwings","getVocabulary"]));
test("empty valid",()=>assert.strictEqual(seq.classifySwings([],{nowMs:0}).valid,true));
test("warmup ready false",()=>assert.strictEqual(seq.classifySwings([],{nowMs:0}).ready,false));
test("invalid dependency result",()=>assert.strictEqual(seq.classifySwings(null,{nowMs:0}).error,"SWING_DETECTOR_FAILED"));
test("initial classifications",()=>{const r=seq.classifySwings(wave(20),{nowMs:19999});if(r.events.length){assert.ok(r.events[0].classification.startsWith("INITIAL"));}});
test("event schema",()=>{const r=seq.classifySwings(wave(30),{nowMs:29999});if(r.events.length)assert.deepStrictEqual(Object.keys(r.events[0]),["type","classification","candidateIndex","openTime","closeTime","price","confirmedAtIndex","confirmedAtOpenTime","confirmedAtCloseTime","previousSameTypeCandidateIndex","previousSameTypePrice"]);});
test("filters",()=>{const r=seq.classifySwings(wave(40),{nowMs:39999});assert.ok(r.swingHighs.every(x=>x.type==="SWING_HIGH")&&r.swingLows.every(x=>x.type==="SWING_LOW"));});
test("latest clones",()=>{const r=seq.classifySwings(wave(40),{nowMs:39999});if(r.latestHigh)assert.notStrictEqual(r.latestHigh,r.swingHighs[r.swingHighs.length-1]);});
test("determinism",()=>assert.deepStrictEqual(seq.classifySwings(wave(40),{nowMs:39999}),seq.classifySwings(wave(40),{nowMs:39999})));
test("causality 120",()=>{const a=seq.classifySwings(wave(119),{nowMs:118999}).events,b=seq.classifySwings(wave(120),{nowMs:119999}).events;assert.deepStrictEqual(b.slice(0,a.length),a);});
for(let i=0;i<55;i++)test("deterministic fixture branch "+i,()=>{const r=seq.classifySwings(wave(10+(i%20)),{nowMs:999999,leftBars:1+(i%3),rightBars:1+(i%2)});assert.strictEqual(r.valid,true);});
test("first openTime string reddedilir",()=>assert.strictEqual(vmResult({openTimes:["0"]}).error,"SWING_ALIGNMENT_ERROR"));
test("first openTime NaN reddedilir",()=>assert.strictEqual(vmResult({openTimes:[NaN]}).error,"SWING_ALIGNMENT_ERROR"));
test("first openTime Infinity reddedilir",()=>assert.strictEqual(vmResult({openTimes:[Infinity]}).error,"SWING_ALIGNMENT_ERROR"));
test("first openTime negatif reddedilir",()=>assert.strictEqual(vmResult({openTimes:[-1]}).error,"SWING_ALIGNMENT_ERROR"));
test("tekrar openTime reddedilir",()=>assert.strictEqual(vmResult({openTimes:[0,0]}).error,"SWING_ALIGNMENT_ERROR"));
test("azalan openTime reddedilir",()=>assert.strictEqual(vmResult({openTimes:[1000,0]}).error,"SWING_ALIGNMENT_ERROR"));
test("candidateIndex array disi reddedilir",()=>assert.strictEqual(vmResult({openTimes:[0],events:[dependencyEvent("SWING_HIGH",5,5,10)]}).error,"SWING_ALIGNMENT_ERROR"));
test("confirmedAtIndex array disi reddedilir",()=>assert.strictEqual(vmResult({openTimes:[0,1000],events:[dependencyEvent("SWING_HIGH",0,5,10)]}).error,"SWING_ALIGNMENT_ERROR"));
test("undefined zamanli out of range event reddedilir",()=>{const event={type:"SWING_HIGH",candidateIndex:5,openTime:undefined,closeTime:5999,price:10,confirmedAtIndex:5,confirmedAtOpenTime:undefined,confirmedAtCloseTime:5999};const r=vmResult({openTimes:[0],events:[event]});assert.strictEqual(r.valid,false);assert.strictEqual(r.error,"SWING_ALIGNMENT_ERROR");});
test("event openTime undefined reddedilir",()=>{const event=dependencyEvent("SWING_HIGH",0,1,10);event.openTime=undefined;assert.strictEqual(vmResult({events:[event]}).error,"SWING_ALIGNMENT_ERROR");});
test("event closeTime undefined reddedilir",()=>{const event=dependencyEvent("SWING_HIGH",0,1,10);event.closeTime=undefined;assert.strictEqual(vmResult({events:[event]}).error,"SWING_ALIGNMENT_ERROR");});
test("closeTime openTime oncesi reddedilir",()=>{const event=dependencyEvent("SWING_HIGH",1,2,10);event.closeTime=999;assert.strictEqual(vmResult({events:[event]}).error,"SWING_ALIGNMENT_ERROR");});
test("confirmedAtOpenTime undefined reddedilir",()=>{const event=dependencyEvent("SWING_HIGH",0,1,10);event.confirmedAtOpenTime=undefined;assert.strictEqual(vmResult({events:[event]}).error,"SWING_ALIGNMENT_ERROR");});
test("confirmedAtCloseTime undefined reddedilir",()=>{const event=dependencyEvent("SWING_HIGH",0,1,10);event.confirmedAtCloseTime=undefined;assert.strictEqual(vmResult({events:[event]}).error,"SWING_ALIGNMENT_ERROR");});
test("confirmed close confirmed open oncesi reddedilir",()=>{const event=dependencyEvent("SWING_HIGH",0,1,10);event.confirmedAtCloseTime=999;assert.strictEqual(vmResult({events:[event]}).error,"SWING_ALIGNMENT_ERROR");});
test("gecerli zaman ve index event kabul edilir",()=>{const r=vmResult({events:[dependencyEvent("SWING_HIGH",1,2,10)]});assert.strictEqual(r.valid,true);assert.strictEqual(r.events.length,1);});
test("INITIAL_HIGH degismeden calisir",()=>{const r=vmResult({events:[dependencyEvent("SWING_HIGH",0,1,10)]});assert.strictEqual(r.events.length,1);assert.strictEqual(r.events[0].classification,"INITIAL_HIGH");});
test("HIGHER_HIGH degismeden calisir",()=>{const r=vmResult({events:[dependencyEvent("SWING_HIGH",0,1,10),dependencyEvent("SWING_HIGH",1,2,12)]});assert.strictEqual(r.events.length,2);assert.strictEqual(r.events[1].classification,"HIGHER_HIGH");});
test("INITIAL_LOW degismeden calisir",()=>{const r=vmResult({events:[dependencyEvent("SWING_LOW",0,1,5)]});assert.strictEqual(r.events.length,1);assert.strictEqual(r.events[0].classification,"INITIAL_LOW");});
test("LOWER_LOW degismeden calisir",()=>{const r=vmResult({events:[dependencyEvent("SWING_LOW",0,1,5),dependencyEvent("SWING_LOW",1,2,3)]});assert.strictEqual(r.events.length,2);assert.strictEqual(r.events[1].classification,"LOWER_LOW");});
let p=0;for(const t of tests){try{t.f();p++;console.log(`PASS:${t.n}`);}catch(e){console.error(`HND_SWING_SEQUENCE_TEST_FAILED:${t.n}`);console.error(e.stack||e);process.exitCode=1;break;}}if(p===tests.length)console.log(`HND_SWING_SEQUENCE_TESTS_PASS:${tests.length}`);
