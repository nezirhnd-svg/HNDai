"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm"),childProcess=require("child_process");
const root=path.resolve(__dirname,"../..");
const context={console,fetch,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
    Date,Math,JSON,Object,Array,Number,String,Boolean,Set,Map,Promise,Error,URLSearchParams,
    document:{querySelector(){return null;},getElementById(){return null;},addEventListener(){},removeEventListener(){},visibilityState:"visible"}};
context.window=context;
const window=context;
const files=[
 "js/api.js","js/indicators.js","js/smartmoney.js","js/strategy.js","js/mtf.js",
 "js/hndai-v1/candleNormalizer.js","js/hndai-v1/timeframeAggregator.js","js/hndai-v1/swingDetector.js",
 "js/hndai-v1/swingSequence.js","js/hndai-v1/structureBreakDetector.js","js/hndai-v1/structureEventContract.js",
 "js/hndai-v1/bosChochResolver.js","js/hndai-v1/structureStateSnapshot.js","js/hndai-v1/structureSetupGate.js",
 "js/hndai-v1/structureSetupAdapter.js","js/hndai-v1/structurePipelineOrchestrator.js",
 "js/hndai-v1/structurePendingCandidateContract.js","js/setupEngine.js",
 "js/hndai-v1/structureHistoricalLegacyInputBuilder.js","js/hndai-v1/structureHistoricalLegacyEvaluator.js",
 "js/hndai-v1/structureHistoricalLegacyCandidateAdapter.js","js/hndai-v1/structureHistoricalReplayBinancePager.js",
 "js/hndai-v1/structureHistoricalShadowReplay.js"];
function run(file){vm.runInNewContext(fs.readFileSync(path.join(root,file),"utf8"),context,{filename:file});}
run(files.shift());
if(process.argv.includes("--native-powershell")){
 const host="https://api.binance.com";
 function psJson(uri){const command=`$ProgressPreference='SilentlyContinue'; Invoke-RestMethod -Uri '${uri}' -Method Get -TimeoutSec 30 | ConvertTo-Json -Depth 5 -Compress`;
  return JSON.parse(childProcess.execFileSync("powershell.exe",["-NoProfile","-Command",command],{encoding:"utf8",maxBuffer:32*1024*1024}));}
 window.HNDAPI.fetchBinanceServerTime=async()=>psJson(`${host}/api/v3/time`);
 window.HNDAPI.fetchHistoricalKlinesPage=async options=>{const raw=psJson(`${host}/api/v3/klines?symbol=${options.symbol}&interval=${options.interval}&limit=${options.limit}&endTime=${options.endTime}`),list=Array.isArray(raw)?raw:Array.isArray(raw&&raw.value)?raw.value:[];return list.map(item=>item&&Array.isArray(item.value)?item.value:item).map(row=>({openTime:Number(row[0]),closeTime:Number(row[6]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5])}));};
}
files.forEach(run);
(async()=>{const cutoff=(await window.HNDAPI.fetchBinanceServerTime({silent:true})).serverTime,results=[];
for(const symbol of ["BTCUSDT","ETHUSDT","SOLUSDT"])for(const interval of ["15m","4h"]){
 const paged=await window.HNDStructureHistoricalReplayBinancePager.fetchClosedCandles({symbol,interval,candleCount:interval==="15m"?4000:3000,evaluationCutoffTime:cutoff,pageSize:1000,requestDelayMs:200});
 if(!paged.valid){results.push({symbol,interval,pagerError:paged.error,pagerErrorDetail:paged.errorDetail||null,pageCount:paged.pageCount});continue;}
 const config=window.HNDStructureHistoricalShadowReplay.getDefaultConfig();Object.assign(config,{symbol,interval,evaluationCutoffTime:cutoff,maximumEvaluationCandles:Math.max(1,paged.candles.length-config.warmupCandles)});
 const r=window.HNDStructureHistoricalShadowReplay.runReplay(paged.candles,config);
 results.push({symbol,interval,input:r.inputCandleCount,evaluated:r.evaluatedCandleCount,builderReady:r.builderReadyCount,builderUnavailable:r.builderUnavailableCount,byBuilderStatus:r.byBuilderStatus,pendingCreated:r.pendingCandidateCreatedCount,pendingResolved:r.pendingCandidateResolvedCount,pendingExpired:r.pendingCandidateExpiredCount,legacyAvailable:r.legacyDecisionAvailableCount,legacyAllow:r.legacyAllowCount,legacyBlock:r.legacyBlockCount,legacyUnavailable:r.legacyUnavailableCount,gateAvailable:r.gateDecisionAvailableCount,comparable:r.comparableCount,match:r.matchCount,mismatch:r.mismatchCount,failure:r.failureCount,topLegacyReason:r.byLegacyReason[0]||null,topBuilderStatus:r.byBuilderStatus[0]||null});
 console.log(JSON.stringify(results.at(-1)));
}
console.log("RESULTS="+JSON.stringify(results));})().catch(error=>{console.error(error);process.exitCode=1;});
