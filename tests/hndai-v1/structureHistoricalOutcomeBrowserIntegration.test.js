"use strict";
const assert = require("assert"), fs = require("fs"), http = require("http"), path = require("path");
const { chromium } = require("playwright");
const root = path.resolve(__dirname, "../.."), tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function contentType(file) { return file.endsWith(".html") ? "text/html; charset=utf-8" :
    file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "application/octet-stream"; }
function localServer() { return new Promise(resolve => { const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname, file = path.join(root, pathname === "/" ? "index.html" : pathname.slice(1));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-store" }); fs.createReadStream(file).pipe(response);
}); server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })); }); }
function chromePath() { return process.env.HND_CHROME_EXE || ["C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(fs.existsSync); }
async function openPage(browser, baseUrl) { const page = await browser.newPage();
    await page.addInitScript(() => { window.__hndListenerCounts = {}; const original = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (type, listener, options) { if (this && this.id)
            window.__hndListenerCounts[`${this.id}:${type}`] = (window.__hndListenerCounts[`${this.id}:${type}`] || 0) + 1;
            return original.call(this, type, listener, options); }; });
    await page.goto(`${baseUrl}/index.html`, { waitUntil: "load" }); return page; }
let page;
test("actual served ui asset version is deterministic", async () => assert.match(fs.readFileSync(path.join(root,"index.html"),"utf8"),/<script src="js\/ui\.js\?v=6"><\/script>/));
test("historical plan evidence browser dependency loads", async () => assert.strictEqual(await page.evaluate(() =>
    typeof window.HNDStructureHistoricalPlanEvidence?.buildPlanEvidence), "function"));
test("historical RR cap browser dependency loads after authoritative outcome analyzer", async () => {
    const result = await page.evaluate(() => ({ rr: typeof window.HNDStructureHistoricalRrCapScenarioAnalyzer?.analyzeScenarios,
        outcome: typeof window.HNDStructureHistoricalMismatchOutcomeAnalyzer?.analyzeOutcomes }));
    assert.deepStrictEqual(result, { rr: "function", outcome: "function" });
});
test("DOMContentLoaded lifecycle binds exact outcome buttons once", async () => { const counts = await page.evaluate(() => window.__hndListenerCounts);
    assert.strictEqual(counts["analyzeHistoricalMismatchOutcomes:click"],1); assert.strictEqual(counts["exportHistoricalMismatchOutcomes:click"],1); });
test("DOMContentLoaded lifecycle binds exact RR cap buttons once", async () => { const counts = await page.evaluate(() => window.__hndListenerCounts);
    assert.strictEqual(counts["analyzeHistoricalRrCapScenarios:click"],1); assert.strictEqual(counts["exportHistoricalRrCapScenarios:click"],1); });
test("complete lifecycle repeated setup stays idempotent", async () => { const result = await page.evaluate(() => {
    setupStructureHistoricalOutcomeControls(); setupStructureHistoricalOutcomeControls();
    return { readyState: document.readyState, counts: window.__hndListenerCounts }; });
    assert.strictEqual(result.readyState,"complete"); assert.strictEqual(result.counts["analyzeHistoricalMismatchOutcomes:click"],1); assert.strictEqual(result.counts["exportHistoricalMismatchOutcomes:click"],1); });
test("actual button click after replay and mismatch updates outcome UI", async () => { await page.evaluate(() => {
    lastStructureHistoricalShadowReplay = { valid:true,schemaVersion:"HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1",source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,
        observations:[{key:"BTCUSDT|4h|1999|0",candidateKey:"C1",symbol:"BTCUSDT",interval:"4h",evaluationCloseTime:1999,source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,category:"MISMATCH",comparison:"LEGACY_ALLOW_GATE_BLOCK",legacyPlanEvidence:null}] };
    lastStructureHistoricalMismatchAnalysis = { valid:true,schemaVersion:"HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1",source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,status:"REVIEW_ITEMS_FOUND",mismatchCount:1,reviewItems:[] };
    lastStructureHistoricalShadowReplayCandles = [{openTime:1000,closeTime:1999,open:100,high:101,low:99,close:100,volume:10}]; });
    await page.locator("#analyzeHistoricalMismatchOutcomes").click();
    assert.strictEqual(await page.locator("#historicalOutcomeStatus").textContent(),"NO EVALUABLE ITEMS"); });
test("provenance-bound plan evidence updates outcome UI", async () => { await page.evaluate(() => {
    const evidence={direction:"LONG",entryMode:"ZONE",entryPrice:100,entryLow:99,entryHigh:101,stopLoss:90,takeProfit:110,
        symbol:"BTCUSDT",interval:"4h",candidateKey:"C1",setupCandidateKey:"SETUP-C1",evaluationCloseTime:1999,
        source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,setupCore:"SETUP_CORE",planCore:"PLAN_CORE"};
    lastStructureHistoricalShadowReplay={valid:true,schemaVersion:"HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1",source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,
        observations:[{key:"BTCUSDT|4h|1999|0",candidateKey:"C1",symbol:"BTCUSDT",interval:"4h",evaluationCloseTime:1999,source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,category:"MISMATCH",comparison:"LEGACY_ALLOW_GATE_BLOCK",legacyPlanEvidence:evidence}]};
    lastStructureHistoricalMismatchAnalysis={valid:true,schemaVersion:"HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1",source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,status:"REVIEW_ITEMS_FOUND",mismatchCount:1,reviewItems:[]};
    const future=Array.from({length:24},(_,index)=>({openTime:2000+index*1000,closeTime:2999+index*1000,
        open:102,high:index===1?111:105,low:index===0?99:95,close:102,volume:10}));
    lastStructureHistoricalShadowReplayCandles=[{openTime:1000,closeTime:1999,open:100,high:101,low:99,close:100,volume:10}].concat(future); });
    await page.locator("#analyzeHistoricalMismatchOutcomes").click();
    assert.strictEqual(await page.locator("#historicalOutcomeStatus").textContent(),"OUTCOMES AVAILABLE");
    assert.strictEqual(await page.locator("#historicalOutcomeTpFirst").textContent(),"1"); });
test("real RR cap click renders five scenarios, exports JSON, and isolates critical live state", async () => {
    const result = await page.evaluate(async () => {
        const evidence={direction:"LONG",entryMode:"ZONE",entryPrice:100,entryLow:99,entryHigh:101,stopLoss:90,takeProfit:150,
            symbol:"BTCUSDT",interval:"4h",candidateKey:"C1",setupCandidateKey:"SETUP-C1",evaluationCloseTime:1999,
            source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,setupCore:"SETUP_CORE",planCore:"PLAN_CORE"};
        lastStructureHistoricalShadowReplay={valid:true,schemaVersion:"HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1",source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,
            observations:[{key:"BTCUSDT|4h|1999|0",candidateKey:"C1",symbol:"BTCUSDT",interval:"4h",evaluationCloseTime:1999,source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,category:"MISMATCH",comparison:"LEGACY_ALLOW_GATE_BLOCK",legacyPlanEvidence:evidence}]};
        lastStructureHistoricalMismatchAnalysis={valid:true,schemaVersion:"HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1",source:"HISTORICAL_REPLAY",countsTowardLiveReadiness:false,status:"REVIEW_ITEMS_FOUND",mismatchCount:1,reviewItems:[]};
        const future=Array.from({length:24},(_,index)=>({openTime:2000+index*1000,closeTime:2999+index*1000,
            open:102,high:index===1?121:105,low:index===0?99:95,close:102,volume:10}));
        lastStructureHistoricalShadowReplayCandles=[{openTime:1000,closeTime:1999,open:100,high:101,low:99,close:100,volume:10}].concat(future);
        const critical=()=>JSON.stringify({setup:window.HNDSetupEngine?.getCurrentSetup?.(),plan:window.HNDTradePlanEngine?.getCurrentPlan?.(),
            trade:window.HNDTradeEngine?.getActiveTrade?.(),readiness:document.querySelector("#historicalRrCapReadiness")?.textContent});
        const before=critical(); document.querySelector("#analyzeHistoricalRrCapScenarios").click(); await Promise.resolve();
        const json=window.HNDStructureHistoricalRrCapScenarioAnalyzer.exportScenarioAnalysis(lastStructureHistoricalRrCapScenarioAnalysis);
        return {before,after:critical(),status:document.querySelector("#historicalRrCapStatus").textContent,
            readiness:document.querySelector("#historicalRrCapReadiness").textContent,
            summaries:document.querySelector("#historicalRrCapSummaryBody").children.length,
            details:document.querySelector("#historicalRrCapDetailBody").children.length,
            exported:JSON.parse(json),max2:lastStructureHistoricalRrCapScenarioAnalysis.scenarioItems.find(item=>item.scenario==="MAX_2R")}; });
    assert.strictEqual(result.status,"SCENARIOS AVAILABLE"); assert.strictEqual(result.readiness,"NONE");
    assert.strictEqual(result.summaries,5); assert.strictEqual(result.details,5);
    assert.strictEqual(result.before,result.after); assert.strictEqual(result.exported.countsTowardLiveReadiness,false);
    assert.deepStrictEqual([result.max2.originalTakeProfit,result.max2.scenarioTakeProfit,result.max2.scenarioOutcome],[150,120,"TP_FIRST"]); });
test("RR cap script order is outcome analyzer then scenario analyzer then UI", async () => {
    const html=fs.readFileSync(path.join(root,"index.html"),"utf8");
    assert.ok(html.indexOf("structureHistoricalMismatchOutcomeAnalyzer.js")<html.indexOf("structureHistoricalRrCapScenarioAnalyzer.js"));
    assert.ok(html.indexOf("structureHistoricalRrCapScenarioAnalyzer.js")<html.indexOf("js/ui.js?v=6")); });
(async()=>{const own=process.env.HND_TEST_BASE_URL?null:await localServer(),base=process.env.HND_TEST_BASE_URL||own.url;
    const browser=await chromium.launch({headless:true,executablePath:chromePath()}); let assertions=0;
    try{page=await openPage(browser,base);for(const item of tests){try{await item.fn();assertions+=1;}catch(error){console.error(`FAIL:${item.name}`);throw error;}}
        console.log(`Historical Outcome Browser Integration tests passed: ${tests.length} scenarios, ${assertions} assertions.`);
    }finally{await browser.close();if(own)await new Promise(resolve=>own.server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
