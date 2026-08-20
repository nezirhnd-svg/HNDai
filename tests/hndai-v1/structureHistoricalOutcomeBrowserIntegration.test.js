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
test("DOMContentLoaded lifecycle binds exact outcome buttons once", async () => { const counts = await page.evaluate(() => window.__hndListenerCounts);
    assert.strictEqual(counts["analyzeHistoricalMismatchOutcomes:click"],1); assert.strictEqual(counts["exportHistoricalMismatchOutcomes:click"],1); });
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
(async()=>{const own=process.env.HND_TEST_BASE_URL?null:await localServer(),base=process.env.HND_TEST_BASE_URL||own.url;
    const browser=await chromium.launch({headless:true,executablePath:chromePath()}); let assertions=0;
    try{page=await openPage(browser,base);for(const item of tests){try{await item.fn();assertions+=1;}catch(error){console.error(`FAIL:${item.name}`);throw error;}}
        console.log(`Historical Outcome Browser Integration tests passed: ${tests.length} scenarios, ${assertions} assertions.`);
    }finally{await browser.close();if(own)await new Promise(resolve=>own.server.close(resolve));}})().catch(error=>{console.error(error);process.exitCode=1;});
