(function () {
    "use strict";
    const HND_PARITY_VERSION = "4.6.3.2";
    const HND_PARITY_SCHEMA_VERSION = 1;
    const HND_PARITY_PROFILE_VERSION = "HND-LIVE-REPLAY-PARITY-V1";
    const HND_PARITY_LIVE_CANDLE_LIMIT = 500;
    const HND_PARITY_ALLOWED_REPLAY_COUNTS = Object.freeze([2000, 10000]);
    const HND_PARITY_REFERENCE_REPETITIONS = 2;
    const HND_PARITY_WINDOW_BARS = 500;
    const HND_PARITY_WARMUP_BARS = 500;
    const HND_PARITY_CHUNK_BARS = 20;
    const HND_PARITY_PROGRESS_INTERVAL_MS = 200;
    const HND_PARITY_CHECKPOINT_INTERVAL_BARS = 100;
    const HND_PARITY_MAX_MISMATCHES = 50;
    const HND_PARITY_MAX_CAPTURE_HISTORY = 5;
    const HND_PARITY_LIVE_CAPTURE_MAX_AGE_MS = 20000;
    const HND_PARITY_STORAGE_KEY = "HNDai.parityValidation.v4.6.3.2";
    const HND_PARITY_RULESET_FINGERPRINT = "EB573423E9475944F0956BB88C7B102B419473A5BDE9A97662D4D6B5EA67BBE9";
    const HND_PARITY_50K_REQUIRED_SOURCE_CANDLES = 50000;
    const HND_PARITY_MAX_STORED_SUMMARIES = 5;
    const COLUMN_KEYS = Object.freeze(["openTime", "open", "high", "low", "close", "volume", "closeTime"]);
    const STRIP_KEYS = new Set(["debug", "lastEvaluation", "requestId", "durationMs", "candlesPerSecond", "evaluatedAt", "capturedAt", "completedAt", "updatedAt", "lastAccessedAt"]);
    let initialized = false, listenersInitialized = false, worker = null, activeRequestId = null, activeValidation = null;
    let captures = [], lastResult = null, lastLiveResult = null, lastHistoricalResult = null, lastEvaluation = null;
    let history = readHistory();
    let options = { getHistoricalDataset: async () => null, getReplayResult: () => null,
        getReplayState: () => null, getMarketContext: () => ({}), getReplayProfile: () => ({}) };
    let state = createState();

    function createState() { return { version:HND_PARITY_VERSION,schemaVersion:HND_PARITY_SCHEMA_VERSION,
        profileVersion:HND_PARITY_PROFILE_VERSION,initialized:initialized,status:"IDLE",phase:"IDLE",activeRequestId:null,
        symbol:null,interval:null,liveCaptureAvailable:false,liveCaptureId:null,liveCaptureAgeMs:null,
        liveParity:null,historicalParity:null,pass2K:false,pass10K:false,
        overallStatus:"IDLE",progressPercent:0,currentRepetition:0,mismatchCount:0,mismatches:[],
        startedAt:null,completedAt:null,lastResult:null,history:clone(history),lastEvaluation:null }; }
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
    function sanitizeForParity(value, seen = new WeakSet()) {
        if (value == null) return null;
        if (["string","boolean"].includes(typeof value)) return value;
        if (typeof value === "number") return Number.isFinite(value) ? Number(value.toPrecision(15)) : null;
        if (["function","undefined","symbol"].includes(typeof value)) return undefined;
        if (typeof Node !== "undefined" && value instanceof Node) return undefined;
        if (value instanceof Error) return undefined;
        if (seen.has(value)) return null; seen.add(value);
        if (Array.isArray(value)) return value.map(item => sanitizeForParity(item, seen) ?? null);
        const result = {}; Object.keys(value).sort().forEach(key => {
            if (STRIP_KEYS.has(key)) return; const clean = sanitizeForParity(value[key], seen); if (clean !== undefined) result[key] = clean;
        }); return result;
    }
    function canonical(value) { if (value == null) return "null";
        if (typeof value === "number") return Number.isFinite(value) ? value.toPrecision(15) : "null";
        if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
        if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
        return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
    function hash(value) { const textValue=canonical(value); let valueHash=2166136261;
        for(let index=0;index<textValue.length;index++) valueHash=Math.imul(valueHash^textValue.charCodeAt(index),16777619)>>>0;
        return valueHash.toString(16).padStart(8,"0").toUpperCase(); }
    function checksumCandles(list) { return hash(list.map(c=>[c.time,c.open,c.high,c.low,c.close,c.volume,c.closeTime])); }
    function checksumColumns(columns) { let valueHash=2166136261; for(let index=0;index<columns.openTime.length;index++) for(const key of COLUMN_KEYS){
        const value=columns[key][index], textValue=Number.isInteger(value)?String(value):value.toPrecision(15);
        for(let character=0;character<textValue.length;character++) valueHash=Math.imul(valueHash^textValue.charCodeAt(character),16777619)>>>0;
    } return valueHash.toString(16).padStart(8,"0").toUpperCase(); }
    function buildEvidenceScope(symbol,interval,profileVersion,rulesetFingerprint) {
        return [String(symbol||""),String(interval||""),String(profileVersion||""),String(rulesetFingerprint||"")].join("|");
    }
    function isLiveEvidenceApplicable(liveResult,context={}) { return liveResult?.status==="LIVE_STATELESS_PARITY_PASS" &&
        liveResult.symbol===String(context.symbol||"") && liveResult.interval===String(context.interval||"") &&
        liveResult.profileVersion===HND_PARITY_PROFILE_VERSION && liveResult.rulesetFingerprint===HND_PARITY_RULESET_FINGERPRINT &&
        liveResult.mismatchCount===0 && liveResult.forbiddenNetworkCallCount===0; }
    function isHistoricalEvidenceUsable(item,context,count) { return item?.status==="HISTORICAL_STATEFUL_PARITY_PASS" &&
        item.symbol===String(context.symbol||"") && item.interval===String(context.interval||"") &&
        item.profileVersion===HND_PARITY_PROFILE_VERSION && item.rulesetFingerprint===HND_PARITY_RULESET_FINGERPRINT &&
        item.selectedCandleCount===count && HND_PARITY_ALLOWED_REPLAY_COUNTS.includes(item.selectedCandleCount) &&
        item.mismatchCount===0 && item.deterministic===true && item.forbiddenNetworkCallCount===0; }
    function calculateEvidenceStatus(evidenceHistory,liveResult,context={}) {
        const matching2KSummary=evidenceHistory.find(item=>isHistoricalEvidenceUsable(item,context,2000))||null;
        const matching10KSummary=evidenceHistory.find(item=>isHistoricalEvidenceUsable(item,context,10000))||null;
        const livePass=isLiveEvidenceApplicable(liveResult,context),pass2K=Boolean(matching2KSummary),pass10K=Boolean(matching10KSummary);
        const sameDatasetLineage=Boolean(matching2KSummary?.originalDatasetId&&matching10KSummary?.originalDatasetId&&
            matching2KSummary.originalDatasetId===matching10KSummary.originalDatasetId);
        const sameOriginalCount=Number.isInteger(matching2KSummary?.originalCandleCount)&&matching2KSummary.originalCandleCount===matching10KSummary?.originalCandleCount;
        const sourceDatasetCandleCount=sameOriginalCount?matching2KSummary.originalCandleCount:null;
        const sourceDatasetSufficientFor50K=sameOriginalCount&&sourceDatasetCandleCount>=HND_PARITY_50K_REQUIRED_SOURCE_CANDLES;
        const overallPass=livePass&&pass2K&&pass10K&&sameDatasetLineage;
        const ready=overallPass&&sourceDatasetSufficientFor50K;
        return {scopeKey:buildEvidenceScope(context.symbol,context.interval,HND_PARITY_PROFILE_VERSION,HND_PARITY_RULESET_FINGERPRINT),
            livePass,pass2K,pass10K,matching2KSummary:clone(matching2KSummary),matching10KSummary:clone(matching10KSummary),
            sameDatasetLineage,sourceDatasetCandleCount,sourceDatasetSufficientFor50K,
            overallStatus:overallPass?"PASS_WITH_MTF_AND_TICK_PENDING":"PENDING",
            singleTimeframe50KDiagnosticReady:ready};
    }
    function currentContext(){const context=options.getMarketContext?.()||{};return{symbol:String(context.symbol||captures[0]?.symbol||""),interval:String(context.interval||captures[0]?.interval||"")};}
    function refreshEvidence(context=currentContext()) { const evidence=calculateEvidenceStatus(history,lastLiveResult,context);
        state.symbol=context.symbol;state.interval=context.interval;state.pass2K=evidence.pass2K;state.pass10K=evidence.pass10K;
        state.liveParity=evidence.livePass?"LIVE_STATELESS_PARITY_PASS":lastLiveResult?"NOT_APPLICABLE":"PENDING";
        state.overallStatus=evidence.overallStatus;if(evidence.overallStatus==="PASS_WITH_MTF_AND_TICK_PENDING"&&!activeRequestId)state.status=evidence.overallStatus;
        return evidence; }
    function normalizeAnalysis(analysis={}) { return sanitizeForParity({ signal:analysis.signal??null,trend:analysis.trend??null,
        confidence:finite(analysis.confidence),rawConfidence:finite(analysis.rawConfidence),bullScore:finite(analysis.bullScore),
        bearScore:finite(analysis.bearScore),dominantScore:finite(analysis.dominantScore),opposingScore:finite(analysis.opposingScore),
        marketStrength:finite(analysis.marketStrength),conflictScore:finite(analysis.conflictScore),scoreDifference:finite(analysis.scoreDifference),
        marketBias:analysis.marketBias??null,ema20:finite(analysis.ema20),ema50:finite(analysis.ema50),ema200:finite(analysis.ema200),
        rsi:finite(analysis.rsi),breakdown:analysis.breakdown??null,evidence:analysis.evidence??null }); }
    function normalizeCandle(candle) { const normalized={time:Number(candle?.time),open:Number(candle?.open),high:Number(candle?.high),
        low:Number(candle?.low),close:Number(candle?.close),volume:Number(candle?.volume),closeTime:Number(candle?.closeTime)};
        return Object.values(normalized).every(Number.isFinite) ? normalized : null; }
    function debug(reason,error,extra={}) { const context=currentContext(),evidence=calculateEvidenceStatus(history,lastLiveResult,context);lastEvaluation={debug:{version:HND_PARITY_VERSION,profileVersion:HND_PARITY_PROFILE_VERSION,
        primaryReason:reason,requestId:state.activeRequestId,context:{symbol:state.symbol,interval:state.interval},
        progress:{phase:state.phase,repetition:state.currentRepetition,percent:state.progressPercent},mismatchCount:state.mismatchCount,
        evidence:{currentScopeKey:evidence.scopeKey,currentSymbol:context.symbol,currentInterval:context.interval,profileVersion:HND_PARITY_PROFILE_VERSION,rulesetFingerprint:HND_PARITY_RULESET_FINGERPRINT,liveApplicable:evidence.livePass,pass2KApplicable:evidence.pass2K,pass10KApplicable:evidence.pass10K,liveEvidenceContext:lastLiveResult?{symbol:lastLiveResult.symbol,interval:lastLiveResult.interval}:null,historical2KContext:evidence.matching2KSummary?{symbol:evidence.matching2KSummary.symbol,interval:evidence.matching2KSummary.interval,originalDatasetId:evidence.matching2KSummary.originalDatasetId,originalCandleCount:evidence.matching2KSummary.originalCandleCount}:null,historical10KContext:evidence.matching10KSummary?{symbol:evidence.matching10KSummary.symbol,interval:evidence.matching10KSummary.interval,originalDatasetId:evidence.matching10KSummary.originalDatasetId,originalCandleCount:evidence.matching10KSummary.originalCandleCount}:null,sameDatasetLineage:evidence.sameDatasetLineage,sourceDatasetCandleCount:evidence.sourceDatasetCandleCount,sourceDatasetSufficientFor50K:evidence.sourceDatasetSufficientFor50K,requiredSourceCandleCount:HND_PARITY_50K_REQUIRED_SOURCE_CANDLES,readiness:evidence.singleTimeframe50KDiagnosticReady},
        error:{name:error?String(error.name||"Error"):null,message:error?String(error.message||error).slice(0,300):null},
        ...clone(extra),evaluatedAt:Date.now()}}; state.lastEvaluation=clone(lastEvaluation); }
    function captureLiveCycle(payload={}) { try {
        if (!Array.isArray(payload.candles) || !payload.candles.length || !Number.isFinite(Number(payload.price)) || Number(payload.price)<=0) return false;
        const normalizedCandles=payload.candles.slice(-HND_PARITY_LIVE_CANDLE_LIMIT).map(normalizeCandle); if(normalizedCandles.some(c=>!c)) return false;
        const normalized={analysis:normalizeAnalysis(payload.analysis),structure:sanitizeForParity(payload.structureEvents||[]),
            liquidity:sanitizeForParity(payload.liquidityZones||[]),strongestLiquidity:sanitizeForParity(payload.strongestLiquidity||null),
            qualifiedOrderBlocks:sanitizeForParity(payload.qualifiedPriceZones?.orderBlocks||[]),qualifiedFVGs:sanitizeForParity(payload.qualifiedPriceZones?.fvgs||[])};
        const fingerprints={}; Object.keys(normalized).forEach(key=>{fingerprints[key]=hash(normalized[key]);}); fingerprints.combined=hash(fingerprints);
        const capturedAt=Number.isFinite(Number(payload.capturedAt))?Number(payload.capturedAt):Date.now(), last=normalizedCandles.at(-1);
        const capture={version:HND_PARITY_VERSION,schemaVersion:HND_PARITY_SCHEMA_VERSION,profileVersion:HND_PARITY_PROFILE_VERSION,
            captureId:`HND-PARITY-CAPTURE-${capturedAt}-${Math.random().toString(36).slice(2,7)}`,symbol:String(payload.symbol||""),
            interval:String(payload.interval||""),capturedAt,candleCount:normalizedCandles.length,firstOpenTime:normalizedCandles[0].time,
            lastOpenTime:last.time,lastCloseTime:last.closeTime,currentPrice:Number(payload.price),candleChecksum:checksumCandles(normalizedCandles),
            normalized,fingerprints,observedStateful:{setup:sanitizeForParity(payload.setupState||null),plan:sanitizeForParity(payload.tradePlanState||null),
                trade:sanitizeForParity(payload.tradeState||null),mtf:sanitizeForParity(payload.mtfState||null)},candles:normalizedCandles};
        captures=[capture,...captures].slice(0,HND_PARITY_MAX_CAPTURE_HISTORY);state.liveCaptureAvailable=true;state.liveCaptureId=capture.captureId;
        state.liveCaptureAgeMs=Math.max(0,Date.now()-capture.capturedAt);state.symbol=capture.symbol;state.interval=capture.interval;
        const previous=captures[1];const contextChanged=Boolean(previous&&(previous.symbol!==capture.symbol||previous.interval!==capture.interval));
        if(contextChanged)lastLiveResult=null;
        const evidence=refreshEvidence({symbol:capture.symbol,interval:capture.interval});
        if(!activeRequestId&&!evidence.livePass){state.status="LIVE_CAPTURE_READY";state.phase=contextChanged?"EVIDENCE_CONTEXT_CHANGED":"LIVE_CAPTURE_READY";}debug("LIVE_CAPTURE_RECORDED",null,{contextChanged});render();return clone(capture);
    } catch(error){debug("PARITY_ERROR",error);return false;} }
    function livePreflight() { const capture=captures[0],context=options.getMarketContext()||{};if(!capture)return "LIVE_CAPTURE_MISSING";
        if(Date.now()-capture.capturedAt>HND_PARITY_LIVE_CAPTURE_MAX_AGE_MS)return "LIVE_CAPTURE_STALE";
        if(capture.symbol!==String(context.symbol||"")||capture.interval!==String(context.interval||""))return "LIVE_CONTEXT_MISMATCH";
        if(capture.candleCount<200||!Number.isFinite(capture.currentPrice)||capture.currentPrice<=0)return "LIVE_CAPTURE_MISSING";return null; }
    function isActive(requestId){return Boolean(requestId)&&requestId===activeRequestId&&requestId===state.activeRequestId;}
    function terminateWorker(){if(worker){worker.terminate();worker=null;}}
    function createWorker(requestId){terminateWorker();worker=new Worker("js/parityWorker.js?v=4.6.3.2");worker.onmessage=event=>handleWorkerMessage(requestId,event.data||{});
        worker.onerror=event=>fail(requestId,"PARITY_WORKER_ERROR",new Error(event.message||"Parity worker failed"));return worker;}
    function begin(status,phase){const requestId=`HND-PARITY-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;activeRequestId=requestId;
        state.status=status;state.phase=phase;state.activeRequestId=requestId;state.startedAt=Date.now();state.completedAt=null;state.progressPercent=0;
        state.mismatchCount=0;state.mismatches=[];render();return requestId;}
    function validateLiveSnapshot(){if(activeRequestId)return false;const reason=livePreflight();if(reason){state.status=reason;state.phase=reason;debug(reason);render();return false;}
        const capture=captures[0],requestId=begin("RUNNING_LIVE_PARITY","RUNNING_LIVE_PARITY");state.symbol=capture.symbol;state.interval=capture.interval;
        activeValidation={requestId,mode:"LIVE",symbol:capture.symbol,interval:capture.interval,selectedCandleCount:null,selectedChecksum:null,originalDatasetId:null,replayEventChecksum:null,captureId:capture.captureId,captureCandleChecksum:capture.candleChecksum,profileVersion:HND_PARITY_PROFILE_VERSION,rulesetFingerprint:HND_PARITY_RULESET_FINGERPRINT,startedAt:state.startedAt};debug("LIVE_PARITY_STARTED");
        try{createWorker(requestId).postMessage({type:"VALIDATE_LIVE_STATELESS",requestId,timestamp:Date.now(),context:{symbol:capture.symbol,interval:capture.interval},capture:clone(capture),replayProfile:clone(options.getReplayProfile()),rulesetFingerprint:HND_PARITY_RULESET_FINGERPRINT});return true;}
        catch(error){fail(requestId,"PARITY_WORKER_ERROR",error);return false;} }
    function validateDataset(dataset,requested,context,replayResult){const metadata=dataset?.metadata,columns=dataset?.columns;
        if(!metadata||!columns||COLUMN_KEYS.some(key=>!(columns[key] instanceof Float64Array)))return "REPLAY_DATASET_MISMATCH";
        const length=columns.openTime.length;if(COLUMN_KEYS.some(key=>columns[key].length!==length)||length<requested||metadata.symbol!==context.symbol||metadata.interval!==context.interval||metadata.gapCount!==0||metadata.duplicateCount!==0||metadata.invalidCount!==0||metadata.chronological!==true||metadata.closedOnly!==true||metadata.source==="STALE_CACHE")return "REPLAY_DATASET_MISMATCH";
        const sliced=sliceDataset(dataset,requested);if(sliced.metadata.selectedChecksum!==replayResult?.datasetMetadata?.selectedChecksum||replayResult?.datasetMetadata?.selectedCandleCount!==requested||
            (replayResult?.datasetMetadata?.originalDatasetId&&sliced.metadata.originalDatasetId!==replayResult.datasetMetadata.originalDatasetId)||
            (Number.isInteger(replayResult?.datasetMetadata?.originalCandleCount)&&sliced.metadata.originalCandleCount!==replayResult.datasetMetadata.originalCandleCount))return "REPLAY_DATASET_MISMATCH";return null;}
    function sliceDataset(dataset,requested){const start=dataset.columns.openTime.length-requested,columns={};COLUMN_KEYS.forEach(key=>{columns[key]=dataset.columns[key].slice(start);});return{columns,metadata:{symbol:dataset.metadata.symbol,interval:dataset.metadata.interval,
        selectedCandleCount:requested,selectedFirstOpenTime:columns.openTime[0],selectedLastOpenTime:columns.openTime[requested-1],selectedChecksum:checksumColumns(columns),originalDatasetId:dataset.metadata.datasetId||dataset.metadata.originalDatasetId||null,originalCandleCount:dataset.columns.openTime.length,source:dataset.metadata.source,closedOnly:dataset.metadata.closedOnly,chronological:dataset.metadata.chronological,gapCount:dataset.metadata.gapCount,duplicateCount:dataset.metadata.duplicateCount,invalidCount:dataset.metadata.invalidCount}};}
    function transferList(columns){return COLUMN_KEYS.map(key=>columns[key].buffer);}
    async function validateLastReplay(){if(activeRequestId)return false;const replayState=options.getReplayState(),replayResult=options.getReplayResult();
        let reason=null;if(!replayResult)reason="REPLAY_RESULT_MISSING";else if(replayState?.status!=="COMPLETED_DIAGNOSTIC")reason="REPLAY_RESULT_NOT_COMPLETED";
        else if(replayResult?.summary?.deterministic!==true)reason="REPLAY_RESULT_NONDETERMINISTIC";
        const requested=Number(replayResult?.datasetMetadata?.selectedCandleCount);if(!reason&&(!HND_PARITY_ALLOWED_REPLAY_COUNTS.includes(requested)||!replayResult.datasetMetadata?.selectedChecksum||!Array.isArray(replayResult.checkpoints)||!Array.isArray(replayResult.trades)))reason="REPLAY_RESULT_MISSING";
        if(reason){state.status="HISTORICAL_STATEFUL_PARITY_FAIL";state.phase=reason;debug(reason);render();return false;}
        const context=options.getMarketContext()||{},requestId=begin("RUNNING_HISTORICAL_PARITY","HISTORICAL_PREFLIGHT");state.symbol=String(context.symbol||"");state.interval=String(context.interval||"");debug("HISTORICAL_PARITY_STARTED");
        try{const dataset=await options.getHistoricalDataset({symbol:state.symbol,interval:state.interval,requestedCandleCount:requested});if(!isActive(requestId))return false;
            const invalid=validateDataset(dataset,requested,{symbol:state.symbol,interval:state.interval},replayResult);if(invalid)throw Object.assign(new Error(invalid),{parityReason:invalid});
            const selected=sliceDataset(dataset,requested),profile=options.getReplayProfile();state.phase="HISTORICAL_WORKER_START";
            activeValidation={requestId,mode:"HISTORICAL",symbol:state.symbol,interval:state.interval,selectedCandleCount:requested,selectedChecksum:selected.metadata.selectedChecksum,originalDatasetId:selected.metadata.originalDatasetId,originalCandleCount:selected.metadata.originalCandleCount,replayEventChecksum:replayResult.summary?.eventChecksum||null,captureId:null,captureCandleChecksum:null,profileVersion:HND_PARITY_PROFILE_VERSION,rulesetFingerprint:HND_PARITY_RULESET_FINGERPRINT,startedAt:state.startedAt};render();
            createWorker(requestId).postMessage({type:"VALIDATE_HISTORICAL_STATEFUL",requestId,timestamp:Date.now(),context:{symbol:state.symbol,interval:state.interval},datasetMetadata:selected.metadata,columns:selected.columns,replayProfile:clone(profile),expectedReplayResult:clone(replayResult),rulesetFingerprint:HND_PARITY_RULESET_FINGERPRINT,validationSnapshot:clone(activeValidation),config:{selectedCandleCount:requested,repetitions:HND_PARITY_REFERENCE_REPETITIONS,windowBars:HND_PARITY_WINDOW_BARS,warmupBars:HND_PARITY_WARMUP_BARS,chunkBars:HND_PARITY_CHUNK_BARS,progressIntervalMs:HND_PARITY_PROGRESS_INTERVAL_MS,checkpointIntervalBars:HND_PARITY_CHECKPOINT_INTERVAL_BARS,maxMismatches:HND_PARITY_MAX_MISMATCHES}},transferList(selected.columns));return true;
        }catch(error){fail(requestId,error.parityReason||"PARITY_ERROR",error);return false;} }
    async function runFullValidation(){if(activeRequestId)return false;const locked=currentContext();if(!validateLiveSnapshot())return false;
        const wait=()=>new Promise(resolve=>{const timer=setInterval(()=>{if(!activeRequestId){clearInterval(timer);resolve();}},50);});await wait();const now=currentContext();
        if(now.symbol!==locked.symbol||now.interval!==locked.interval||!isLiveEvidenceApplicable(lastLiveResult,locked)){state.status="LIVE_CONTEXT_MISMATCH";state.phase="LIVE_CONTEXT_MISMATCH";debug("LIVE_CONTEXT_MISMATCH");render();return false;}return validateLastReplay();}
    function handleWorkerMessage(requestId,message){if(!isActive(requestId)||message.requestId!==requestId)return;
        if(message.type==="PREFLIGHT_PASSED")state.phase="PREFLIGHT_PASSED";
        if(message.type==="REPETITION_STARTED"){state.phase=`REFERENCE_REPETITION_${message.repetition}`;state.currentRepetition=message.repetition;debug("REFERENCE_REPETITION_STARTED");}
        if(message.type==="REPETITION_COMPLETED"){state.phase=`REFERENCE_REPETITION_${message.repetition}_COMPLETED`;debug("REFERENCE_REPETITION_COMPLETED");}
        if(message.type==="PROGRESS")state.progressPercent=Math.max(0,Math.min(100,Number(message.progressPercent)||0));
        if(message.type==="PAUSED"){state.status="PAUSED";state.phase="PAUSED";debug("PARITY_PAUSED");}
        if(message.type==="RESUMED"){state.status="RUNNING_HISTORICAL_PARITY";state.phase=`REFERENCE_REPETITION_${state.currentRepetition}`;debug("PARITY_RESUMED");}
        if(message.type==="LIVE_PARITY_COMPLETED")completeLive(requestId,message.result);
        if(message.type==="HISTORICAL_PARITY_COMPLETED")completeHistorical(requestId,message.result);
        if(message.type==="CANCELLED")cancelled(requestId);
        if(message.type==="ERROR")fail(requestId,message.reason||"PARITY_WORKER_ERROR",new Error(message.error?.message||message.reason));render();}
    function finish(requestId,result){if(!isActive(requestId))return false;lastResult=clone(result);state.lastResult=clone(lastResult);state.status=result.status;state.phase=result.status;
        state.progressPercent=100;state.mismatchCount=result.mismatchCount||0;state.mismatches=clone(result.mismatches||[]);state.completedAt=Date.now();activeRequestId=null;state.activeRequestId=null;terminateWorker();return true;}
    function completeLive(requestId,result){const locked=activeValidation;if(!locked||locked.mode!=="LIVE"||locked.requestId!==requestId||result.captureId!==locked.captureId||result.symbol!==locked.symbol||result.interval!==locked.interval||result.candleChecksum!==locked.captureCandleChecksum||result.profileVersion!==locked.profileVersion||result.rulesetFingerprint!==locked.rulesetFingerprint){fail(requestId,"LIVE_CONTEXT_MISMATCH",new Error("Live result metadata mismatch"));return;}if(!finish(requestId,result))return;lastLiveResult=clone(result);state.liveParity=result.status;
        debug(result.status);updateOverall();activeValidation=null;render();}
    function completeHistorical(requestId,result){const locked=activeValidation;if(!locked||locked.mode!=="HISTORICAL"||locked.requestId!==requestId||result.symbol!==locked.symbol||result.interval!==locked.interval||result.selectedCandleCount!==locked.selectedCandleCount||result.selectedChecksum!==locked.selectedChecksum||result.originalDatasetId!==locked.originalDatasetId||result.originalCandleCount!==locked.originalCandleCount||result.replayEventChecksum!==locked.replayEventChecksum||result.profileVersion!==locked.profileVersion||result.rulesetFingerprint!==locked.rulesetFingerprint){fail(requestId,"VALIDATION_SNAPSHOT_MISMATCH",new Error("Historical result metadata mismatch"));return;}if(!finish(requestId,result))return;lastHistoricalResult=clone(result);state.historicalParity=result.status;
        if(result.status==="HISTORICAL_STATEFUL_PARITY_PASS")storeSummary(result);
        debug(result.referenceDeterministic?result.status:"REFERENCE_NONDETERMINISTIC");updateOverall();activeValidation=null;render();}
    function updateOverall(){return refreshEvidence();}
    function cancelled(requestId){if(!isActive(requestId))return;state.status="CANCELLED";state.phase="CANCELLED";state.completedAt=Date.now();debug("PARITY_CANCELLED");activeRequestId=null;state.activeRequestId=null;activeValidation=null;terminateWorker();render();}
    function fail(requestId,reason,error){if(requestId&&!isActive(requestId))return;state.status="ERROR";state.phase=reason;state.completedAt=Date.now();debug(reason,error);activeRequestId=null;state.activeRequestId=null;activeValidation=null;terminateWorker();render();}
    function pause(){if(!activeRequestId||state.status!=="RUNNING_HISTORICAL_PARITY"||!worker)return false;worker.postMessage({type:"PAUSE",requestId:activeRequestId,timestamp:Date.now()});return true;}
    function resume(){if(!activeRequestId||state.status!=="PAUSED"||!worker)return false;worker.postMessage({type:"RESUME",requestId:activeRequestId,timestamp:Date.now()});return true;}
    function cancel(){if(!activeRequestId||!worker)return false;const requestId=activeRequestId;worker.postMessage({type:"CANCEL",requestId,timestamp:Date.now()});setTimeout(()=>{if(isActive(requestId))cancelled(requestId);},250);return true;}
    function reset(){activeRequestId=null;activeValidation=null;terminateWorker();lastResult=null;lastLiveResult=null;lastHistoricalResult=null;state=createState();state.initialized=initialized;if(captures[0]){state.liveCaptureAvailable=true;state.liveCaptureId=captures[0].captureId;}refreshEvidence();render();return getState();}
    function readHistory(){try{const parsed=JSON.parse(localStorage.getItem(HND_PARITY_STORAGE_KEY)||"[]");return Array.isArray(parsed)?parsed.slice(0,HND_PARITY_MAX_STORED_SUMMARIES):[];}catch(_){return[];}}
    function storeSummary(result){try{const summary={completedAt:Date.now(),symbol:result.symbol,interval:result.interval,selectedCandleCount:result.selectedCandleCount,selectedChecksum:result.selectedChecksum,originalDatasetId:result.originalDatasetId,originalCandleCount:result.originalCandleCount,replayEventChecksum:result.replayEventChecksum,profileVersion:result.profileVersion,rulesetFingerprint:result.rulesetFingerprint,parityDigest:result.parityDigest,mismatchCount:result.mismatchCount,deterministic:result.referenceDeterministic,forbiddenNetworkCallCount:result.forbiddenNetworkCallCount,status:result.status};const same=item=>item.symbol===summary.symbol&&item.interval===summary.interval&&item.selectedCandleCount===summary.selectedCandleCount&&item.selectedChecksum===summary.selectedChecksum&&item.originalDatasetId===summary.originalDatasetId&&item.originalCandleCount===summary.originalCandleCount&&item.profileVersion===summary.profileVersion&&item.rulesetFingerprint===summary.rulesetFingerprint;history=[summary,...history.filter(item=>!same(item))].slice(0,HND_PARITY_MAX_STORED_SUMMARIES);localStorage.setItem(HND_PARITY_STORAGE_KEY,JSON.stringify(history));state.history=clone(history);}catch(_){} }
    function getState(){if(captures[0])state.liveCaptureAgeMs=Math.max(0,Date.now()-captures[0].capturedAt);return clone({...state,lastResult,history,lastEvaluation});}
    function getLastResult(){return clone(lastResult);} function getLastLiveCapture(){return clone(captures[0]||null);} function getMismatchList(){return clone(state.mismatches);} function getHistory(){return clone(history);} function getLastDebug(){return clone(lastEvaluation?.debug||null);} function explainLastEvaluation(){return clone(lastEvaluation);}
    function exportParityJSON(){if(!lastResult)return false;try{const payload={version:HND_PARITY_VERSION,profileVersion:HND_PARITY_PROFILE_VERSION,result:lastResult,history},blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=`HNDai-parity-${state.symbol}-${state.interval}.json`;anchor.hidden=true;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),0);return true;}catch(error){debug("PARITY_ERROR",error);return false;}}
    function text(id,value){const element=document.getElementById(id);if(element)element.textContent=String(value??"-");}
    function renderMismatches(){const body=document.getElementById("parityMismatchBody");if(!body)return;while(body.firstChild)body.removeChild(body.firstChild);const rows=state.mismatches.slice(0,HND_PARITY_MAX_MISMATCHES);if(!rows.length){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=6;cell.textContent="0 mismatches";row.appendChild(cell);body.appendChild(row);return;}rows.forEach(item=>{const row=document.createElement("tr");[item.layer,item.path,canonical(item.expected).slice(0,160),canonical(item.actual).slice(0,160),item.candleIndex??"-",item.candleTime?new Date(item.candleTime).toISOString():"-"].forEach(value=>{const cell=document.createElement("td");cell.textContent=String(value);row.appendChild(cell);});body.appendChild(row);});}
    function render(){const capture=captures[0],historical=lastHistoricalResult,evidence=refreshEvidence(),liveApplicable=isLiveEvidenceApplicable(lastLiveResult,currentContext());state.liveCaptureAgeMs=capture?Math.max(0,Date.now()-capture.capturedAt):null;
        text("parityValidationStatus",state.status==="PASS_WITH_MTF_AND_TICK_PENDING"?"PASS WITH LIMITATIONS":state.status);text("parityValidationPhase",state.phase);
        text("parityLiveCaptureAge",capture?`${state.liveCaptureAgeMs} ms`:"-");text("parityLiveMarket",capture?`${capture.symbol} / ${capture.interval}`:"-");text("parityLiveCandleChecksum",capture?.candleChecksum||"-");
        text("parityLiveAnalysis",liveApplicable?(lastLiveResult.expected?.fingerprints?.analysis===lastLiveResult.actual?.fingerprints?.analysis?"PASS":"FAIL"):(lastLiveResult?"NOT APPLICABLE":"-"));
        text("parityLiveStructure",liveApplicable?(lastLiveResult.expected?.fingerprints?.structure===lastLiveResult.actual?.fingerprints?.structure?"PASS":"FAIL"):(lastLiveResult?"NOT APPLICABLE":"-"));
        text("parityLiveLiquidity",liveApplicable?(lastLiveResult.expected?.fingerprints?.liquidity===lastLiveResult.actual?.fingerprints?.liquidity?"PASS":"FAIL"):(lastLiveResult?"NOT APPLICABLE":"-"));
        const zonesPass=liveApplicable&&lastLiveResult.expected?.fingerprints?.qualifiedOrderBlocks===lastLiveResult.actual?.fingerprints?.qualifiedOrderBlocks&&lastLiveResult.expected?.fingerprints?.qualifiedFVGs===lastLiveResult.actual?.fingerprints?.qualifiedFVGs;text("parityLiveZones",liveApplicable?(zonesPass?"PASS":"FAIL"):(lastLiveResult?"NOT APPLICABLE":"-"));
        const replay=historical?null:options.getReplayResult?.();text("parityReplayDataset",historical?.selectedChecksum||replay?.datasetMetadata?.selectedChecksum||"-");text("parityReplayCandleCount",historical?.selectedCandleCount||replay?.datasetMetadata?.selectedCandleCount||"-");
        text("parityReplayCheckpoints",historical?.counts?.checkpoints??"-");text("parityReplaySetup",historical?.counts?.setup??"-");text("parityReplayPlan",historical?.counts?.plan??"-");text("parityReplayTrades",historical?.counts?.trade??"-");text("parityReplaySummary",historical?.status||"-");text("parityReplayDeterministic",historical?String(historical.referenceDeterministic):"-");
        text("parityMismatchCount",state.mismatchCount?`${state.mismatchCount} mismatches`:"0 mismatches");text("parityDigest",historical?.parityDigest||lastLiveResult?.actual?.fingerprints?.combined||"-");text("parityPass2K",state.pass2K?`PASS — ${state.symbol} ${state.interval}`:"PENDING — current context");text("parityPass10K",state.pass10K?`PASS — ${state.symbol} ${state.interval}`:"PENDING — current context");text("parityOverallStatus",state.overallStatus==="PASS_WITH_MTF_AND_TICK_PENDING"?"PASS WITH LIMITATIONS":state.overallStatus);let readinessText="NOT READY";if(evidence.singleTimeframe50KDiagnosticReady)readinessText="READY FOR 50K SINGLE-TIMEFRAME DIAGNOSTIC";else if(history.length&&!evidence.pass2K&&!evidence.pass10K)readinessText="NOT READY — EVIDENCE CONTEXT MISMATCH";else if(evidence.pass2K&&evidence.pass10K&&evidence.sourceDatasetSufficientFor50K&&!evidence.livePass)readinessText="NOT READY — LIVE VALIDATION REQUIRED";else if(evidence.pass2K&&evidence.pass10K&&evidence.sourceDatasetCandleCount!=null)readinessText=`NOT READY — SOURCE DATASET ${evidence.sourceDatasetCandleCount} / ${HND_PARITY_50K_REQUIRED_SOURCE_CANDLES}`;else if(evidence.pass2K&&evidence.pass10K)readinessText="NOT READY — SOURCE DATASET SIZE UNVERIFIED";text("parity50KReadiness",readinessText);
        const progress=document.getElementById("parityValidationProgress");if(progress)progress.value=state.progressPercent;const running=Boolean(activeRequestId);
        [["parityValidateLive",running],["parityValidateReplay",running],["parityRunFull",running],["parityPause",state.status!=="RUNNING_HISTORICAL_PARITY"],["parityResume",state.status!=="PAUSED"],["parityCancel",!running],["parityExport",!lastResult]].forEach(([id,disabled])=>{const el=document.getElementById(id);if(el)el.disabled=disabled;});
        const panel=document.querySelector(".parity-validation");if(panel){panel.dataset.debugReason=lastEvaluation?.debug?.primaryReason||"";panel.dataset.state=JSON.stringify({status:state.status,phase:state.phase,mismatchCount:state.mismatchCount,pass2K:state.pass2K,pass10K:state.pass10K,overallStatus:state.overallStatus,live:lastLiveResult,historical:lastHistoricalResult});}renderMismatches();}
    function setupListeners(){if(listenersInitialized)return;const bind=(id,handler)=>document.getElementById(id)?.addEventListener("click",handler);bind("parityValidateLive",validateLiveSnapshot);bind("parityValidateReplay",validateLastReplay);bind("parityRunFull",runFullValidation);bind("parityPause",pause);bind("parityResume",resume);bind("parityCancel",cancel);bind("parityExport",exportParityJSON);listenersInitialized=true;}
    function init(initOptions={}){if(initialized)return getState();options={...options,...initOptions};initialized=true;state.initialized=true;setupListeners();refreshEvidence();debug("PARITY_INITIALIZED");render();return getState();}
    window.HNDParityEngine={init,captureLiveCycle,validateLiveSnapshot,validateLastReplay,runFullValidation,pause,resume,cancel,reset,getState,getLastResult,getLastLiveCapture,getMismatchList,getHistory,exportParityJSON,getLastDebug,explainLastEvaluation};
    window.HNDParityTest={sanitizeForParity,canonical,hash,checksumCandles,checksumColumns,normalizeAnalysis,normalizeCandle,sliceDataset,validateDataset,buildEvidenceScope,isLiveEvidenceApplicable,calculateEvidenceStatus,rulesetFingerprint:HND_PARITY_RULESET_FINGERPRINT,requiredSourceCandleCount:HND_PARITY_50K_REQUIRED_SOURCE_CANDLES};
})();
