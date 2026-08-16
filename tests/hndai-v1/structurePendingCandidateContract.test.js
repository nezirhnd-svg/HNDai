"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), vm = require("vm");
const modulePath = path.resolve(__dirname, "../../js/hndai-v1/structurePendingCandidateContract.js"), api = require(modulePath), tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const swing = { type: "SWING_HIGH", candidateIndex: 5, confirmedAtIndex: 7, confirmedAtCloseTime: 8000 };
const context = { symbol: "BTCUSDT", interval: "15m", evaluationAtIndex: 7, evaluationCloseTime: 8000 };
function made(s = swing, c = context, p) { return api.createCandidate(s, c, p); }
function event(change = {}) { return Object.assign({ id: "E1", symbol: "BTCUSDT", interval: "15m", direction: "BULLISH",
    levelType: "SWING_HIGH", levelCandidateIndex: 5, levelConfirmedAtIndex: 7,
    levelConfirmedAtCloseTime: 8000, breakAtIndex: 9, breakCloseTime: 10000 }, change); }
const resolveContext = { symbol: "BTCUSDT", interval: "15m", evaluationAtIndex: 9, evaluationCloseTime: 10000 };
test("exact public API", () => assert.deepStrictEqual(Object.keys(api).sort(), ["getSchemaVersion","getVocabulary","getDefaultPolicy","createCandidate","resolveCandidate","expireCandidate"].sort()));
test("schema exact", () => assert.strictEqual(api.getSchemaVersion(), "HND_STRUCTURE_PENDING_CANDIDATE_V1"));
test("browser global", () => { const window={};vm.runInNewContext(fs.readFileSync(modulePath,"utf8"),{window,JSON,Object,Array,Number,String,Set,encodeURIComponent});assert.strictEqual(window.HNDStructurePendingCandidateContract.getSchemaVersion(),api.getSchemaVersion()); });
test("vocabulary statuses exact", () => assert.deepStrictEqual(api.getVocabulary().statuses,["PENDING","RESOLVED","EXPIRED","INVALID"]));
test("default policy exact", () => assert.deepStrictEqual(api.getDefaultPolicy(),{maximumPendingBars:100}));
test("default policy deep clone", () => {const p=api.getDefaultPolicy();p.maximumPendingBars=1;assert.strictEqual(api.getDefaultPolicy().maximumPendingBars,100);});
test("confirmed swing creates pending", () => assert.strictEqual(made().candidate.status,"PENDING"));
test("high maps long", () => assert.strictEqual(made().candidate.direction,"LONG"));
test("low maps short", () => assert.strictEqual(made({...swing,type:"SWING_LOW"}).candidate.direction,"SHORT"));
test("candidate required fields", () => ["key","symbol","interval","direction","sourceSwingId","sourceSwingType","sourceSwingCandidateIndex","sourceSwingConfirmedAtIndex","sourceSwingConfirmedAtCloseTime","createdAtIndex","createdAtCloseTime","status","resolvedByEventId","resolvedAtIndex","resolvedAtCloseTime","expiresAtIndex"].forEach(k=>assert.ok(Object.hasOwn(made().candidate,k))));
test("candidate deterministic", () => assert.deepStrictEqual(made(),made()));
test("same swing same key", () => assert.strictEqual(made().candidate.key,made().candidate.key));
test("expires index policy", () => assert.strictEqual(made().candidate.expiresAtIndex,107));
test("custom expiry policy", () => assert.strictEqual(made(swing,context,{maximumPendingBars:3}).candidate.expiresAtIndex,10));
test("create does not mutate", () => {const s={...swing},c={...context};made(s,c);assert.deepStrictEqual([s,c],[swing,context]);});
test("future confirmation rejected", () => assert.strictEqual(made({...swing,confirmedAtIndex:8}).status,"INVALID"));
test("past confirmation rejected", () => assert.strictEqual(made({...swing,confirmedAtIndex:6}).status,"INVALID"));
test("confirmation time mismatch rejected", () => assert.strictEqual(made({...swing,confirmedAtCloseTime:7999}).status,"INVALID"));
test("unknown swing type rejected", () => assert.strictEqual(made({...swing,type:"X"}).status,"INVALID"));
test("invalid candidate index rejected", () => assert.strictEqual(made({...swing,candidateIndex:-1}).status,"INVALID"));
test("invalid confirmation order rejected", () => assert.strictEqual(made({...swing,candidateIndex:7}).status,"INVALID"));
test("invalid market rejected", () => assert.strictEqual(made(swing,{...context,symbol:""}).status,"INVALID"));
test("invalid policy rejected", () => assert.strictEqual(made(swing,context,{maximumPendingBars:0}).status,"INVALID"));
test("extra policy field rejected", () => assert.strictEqual(made(swing,context,{maximumPendingBars:100,x:1}).status,"INVALID"));
test("exact source event resolves", () => assert.strictEqual(api.resolveCandidate(made().candidate,event(),resolveContext).status,"RESOLVED"));
test("resolution records event id", () => assert.strictEqual(api.resolveCandidate(made().candidate,event(),resolveContext).candidate.resolvedByEventId,"E1"));
test("resolution records index", () => assert.strictEqual(api.resolveCandidate(made().candidate,event(),resolveContext).candidate.resolvedAtIndex,9));
test("resolution records time", () => assert.strictEqual(api.resolveCandidate(made().candidate,event(),resolveContext).candidate.resolvedAtCloseTime,10000));
test("resolve does not mutate", () => {const c=made().candidate,b=JSON.stringify(c);api.resolveCandidate(c,event(),resolveContext);assert.strictEqual(JSON.stringify(c),b);});
for (const [name,change] of [["wrong symbol",{symbol:"ETHUSDT"}],["wrong interval",{interval:"4h"}],["wrong direction",{direction:"BEARISH"}],["wrong type",{levelType:"SWING_LOW"}],["wrong candidate index",{levelCandidateIndex:4}],["wrong confirmation index",{levelConfirmedAtIndex:6}],["wrong confirmation time",{levelConfirmedAtCloseTime:7999}],["same candle",{breakAtIndex:7,breakCloseTime:8000}],["wrong event close",{breakCloseTime:9999}]] ) test(name+" resolution rejected",()=>assert.strictEqual(api.resolveCandidate(made().candidate,event(change),resolveContext).status,"INVALID"));
test("wrong context market rejected", () => assert.strictEqual(api.resolveCandidate(made().candidate,event(),{...resolveContext,symbol:"ETHUSDT"}).status,"INVALID"));
test("wrong context index rejected", () => assert.strictEqual(api.resolveCandidate(made().candidate,event(),{...resolveContext,evaluationAtIndex:10}).status,"INVALID"));
test("duplicate resolution rejected", () => {const r=api.resolveCandidate(made().candidate,event(),resolveContext).candidate;assert.strictEqual(api.resolveCandidate(r,event(),resolveContext).status,"INVALID");});
test("expired resolution rejected", () => {const c=made(swing,context,{maximumPendingBars:2}).candidate;assert.strictEqual(api.resolveCandidate(c,event(),resolveContext).error,"CANDIDATE_EXPIRED");});
test("not due expiration rejected", () => assert.strictEqual(api.expireCandidate(made().candidate,resolveContext).status,"INVALID"));
test("exact expiry succeeds", () => assert.strictEqual(api.expireCandidate(made().candidate,{...resolveContext,evaluationAtIndex:107,evaluationCloseTime:108000}).status,"EXPIRED"));
test("expiry does not mutate", () => {const c=made().candidate,b=JSON.stringify(c);api.expireCandidate(c,{...resolveContext,evaluationAtIndex:107,evaluationCloseTime:108000});assert.strictEqual(JSON.stringify(c),b);});
test("resolved cannot expire", () => {const r=api.resolveCandidate(made().candidate,event(),resolveContext).candidate;assert.strictEqual(api.expireCandidate(r,{...resolveContext,evaluationAtIndex:107,evaluationCloseTime:108000}).status,"INVALID");});
test("policy mismatch expiration rejected", () => assert.strictEqual(api.expireCandidate(made().candidate,{...resolveContext,evaluationAtIndex:107,evaluationCloseTime:108000},{maximumPendingBars:99}).status,"INVALID"));
test("no live state writer", () => assert.ok(!/(localStorage|sessionStorage|fetch\(|Collection|Telemetry|Readiness|TradeEngine)/.test(fs.readFileSync(modulePath,"utf8"))));
(async()=>{let n=0;for(const t of tests){try{await t.fn();n++;}catch(e){console.error(`FAIL: ${t.name}`);throw e;}}console.log(`Structure Pending Candidate Contract tests passed: ${tests.length} scenarios, ${n} assertions.`);})().catch(e=>{console.error(e);process.exitCode=1;});
