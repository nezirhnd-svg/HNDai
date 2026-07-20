(function () {
    "use strict";

    const HND_BACKTEST_BENCHMARK_VERSION = "4.6.0";
    const HND_BACKTEST_BENCHMARK_SCHEMA_VERSION = 1;
    const HND_BACKTEST_BENCHMARK_PROFILE_VERSION = "HND-BENCHMARK-PROFILE-V1";
    const HND_BENCHMARK_STORAGE_KEY = "HNDai.backtestBenchmark.v4.6.0";
    const HND_BENCHMARK_WARMUP_CANDLES = 2000;
    const HND_BENCHMARK_RUN_CANDLES = 10000;
    const HND_BENCHMARK_REPETITIONS = 3;
    const HND_BENCHMARK_CHUNK_SIZE = 250;
    const HND_BENCHMARK_PROGRESS_INTERVAL_MS = 200;
    const HND_BENCHMARK_MAX_CANDLES = 250000;
    const HND_BENCHMARK_MAX_ESTIMATED_BYTES = 512 * 1024 * 1024;
    const HND_BENCHMARK_MAX_HISTORY = 10;
    const HND_BENCHMARK_MAX_SEED_CANDLES = 500;
    const HND_BENCHMARK_VARIANCE_WARNING_PERCENT = 15;
    const HND_BENCHMARK_FRAME_GAP_WARNING_MS = 120;
    const HND_BENCHMARK_FRAME_GAP_CRITICAL_MS = 500;
    const DEBUG_REASONS = Object.freeze({
        BENCHMARK_INITIALIZED: "BENCHMARK_INITIALIZED", BENCHMARK_STARTED: "BENCHMARK_STARTED",
        PREFLIGHT_PASSED: "PREFLIGHT_PASSED", PREFLIGHT_MEMORY_REJECTED: "PREFLIGHT_MEMORY_REJECTED",
        WARMUP_STARTED: "WARMUP_STARTED", WARMUP_COMPLETED: "WARMUP_COMPLETED",
        RUN_STARTED: "RUN_STARTED", RUN_COMPLETED: "RUN_COMPLETED",
        BENCHMARK_PAUSED: "BENCHMARK_PAUSED", BENCHMARK_RESUMED: "BENCHMARK_RESUMED",
        BENCHMARK_CANCELLED: "BENCHMARK_CANCELLED", BENCHMARK_COMPLETED: "BENCHMARK_COMPLETED",
        BENCHMARK_NONDETERMINISTIC: "BENCHMARK_NONDETERMINISTIC",
        WORKER_UNAVAILABLE: "WORKER_UNAVAILABLE", WORKER_ERROR: "WORKER_ERROR",
        STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE", BENCHMARK_ERROR: "BENCHMARK_ERROR"
    });

    let initialized = false, listenersInitialized = false, worker = null, activeRequestId = null;
    let getSeedCandles = () => [], getMarketContext = () => ({}), history = [], lastEvaluation = null;
    let frameRequestId = null, frameLastTime = null, frameGaps = [], longTaskObserver = null;
    let longTaskCount = null, jsHeapBefore = null, jsHeapPeak = null;
    let state = createState();

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function createState() {
        return { version: HND_BACKTEST_BENCHMARK_VERSION, schemaVersion: HND_BACKTEST_BENCHMARK_SCHEMA_VERSION,
            profileVersion: HND_BACKTEST_BENCHMARK_PROFILE_VERSION, initialized: false, status: "IDLE", phase: "IDLE",
            progressPercent: 0, currentRun: 0, totalRuns: HND_BENCHMARK_REPETITIONS,
            processedCandles: 0, targetCandles: HND_BENCHMARK_RUN_CANDLES,
            startedAt: null, completedAt: null, context: null, config: null,
            lastResult: null, history: [], lastEvaluation: null };
    }
    function finite(value, fallback = null) { return Number.isFinite(value) ? value : fallback; }
    function environment() {
        return { hardwareConcurrency: finite(navigator?.hardwareConcurrency),
            deviceMemoryHint: finite(navigator?.deviceMemory), userAgentFamily: /Chrom/i.test(navigator?.userAgent || "") ? "CHROMIUM" : "OTHER",
            crossOriginIsolated: window.crossOriginIsolated === true,
            performanceMemoryAvailable: Boolean(performance?.memory),
            longTaskObserverAvailable: typeof PerformanceObserver === "function" };
    }
    function config() {
        return { version: HND_BACKTEST_BENCHMARK_VERSION, profileVersion: HND_BACKTEST_BENCHMARK_PROFILE_VERSION,
            warmupCandles: HND_BENCHMARK_WARMUP_CANDLES, runCandles: HND_BENCHMARK_RUN_CANDLES,
            repetitions: HND_BENCHMARK_REPETITIONS, chunkSize: HND_BENCHMARK_CHUNK_SIZE,
            progressIntervalMs: HND_BENCHMARK_PROGRESS_INTERVAL_MS, maximumCandles: HND_BENCHMARK_MAX_CANDLES,
            maximumEstimatedBytes: HND_BENCHMARK_MAX_ESTIMATED_BYTES,
            maxSeedCandles: HND_BENCHMARK_MAX_SEED_CANDLES, seed: 4600131 };
    }
    function debug(reason, error = null, memory = null) {
        lastEvaluation = { debug: { version: HND_BACKTEST_BENCHMARK_VERSION,
            profileVersion: HND_BACKTEST_BENCHMARK_PROFILE_VERSION, primaryReason: reason,
            status: state.status, phase: state.phase, requestId: activeRequestId, environment: environment(),
            progress: { currentRun: state.currentRun, totalRuns: state.totalRuns,
                processedCandles: state.processedCandles, targetCandles: state.targetCandles,
                percent: state.progressPercent },
            memory: { estimatedPeakWorkingBytes: memory?.estimatedPeakWorkingBytes ?? state.lastResult?.memory?.estimatedPeakWorkingBytes ?? null,
                jsHeapBefore, jsHeapPeak, jsHeapAfter: performance?.memory?.usedJSHeapSize ?? null },
            timing: { startedAt: state.startedAt, completedAt: state.completedAt,
                durationMs: state.startedAt ? (state.completedAt || Date.now()) - state.startedAt : null },
            error: { name: error ? String(error?.name || "Error") : null,
                message: error ? String(error?.message || error).slice(0, 300) : null }, evaluatedAt: Date.now() } };
        state.lastEvaluation = clone(lastEvaluation); return lastEvaluation;
    }
    function readHistory() {
        try { const parsed = JSON.parse(localStorage.getItem(HND_BENCHMARK_STORAGE_KEY) || "[]");
            return Array.isArray(parsed) ? parsed.slice(0, HND_BENCHMARK_MAX_HISTORY) : []; }
        catch (error) { debug(DEBUG_REASONS.STORAGE_UNAVAILABLE, error); return []; }
    }
    function writeHistory() {
        try { localStorage.setItem(HND_BENCHMARK_STORAGE_KEY, JSON.stringify(history.slice(0, HND_BENCHMARK_MAX_HISTORY))); }
        catch (error) { debug(DEBUG_REASONS.STORAGE_UNAVAILABLE, error); }
    }
    function safeSeed() {
        try { const input = getSeedCandles(); if (!Array.isArray(input)) return [];
            return input.slice(-HND_BENCHMARK_MAX_SEED_CANDLES).map(c => ({ time: Number(c?.time), open: Number(c?.open),
                high: Number(c?.high), low: Number(c?.low), close: Number(c?.close), volume: Number(c?.volume) }))
                .filter(c => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) &&
                    Number.isFinite(c.low) && Number.isFinite(c.close) && Number.isFinite(c.volume) &&
                    c.open > 0 && c.close > 0 && c.high >= Math.max(c.open, c.close) && c.low > 0 &&
                    c.low <= Math.min(c.open, c.close) && c.volume >= 0); }
        catch (error) { return []; }
    }
    function percentile(values, ratio) { if (!values.length) return null; const sorted = [...values].sort((a,b)=>a-b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]; }
    function median(values) { if (!values.length) return null; const sorted=[...values].sort((a,b)=>a-b), mid=Math.floor(sorted.length/2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2; }
    function responsiveness() {
        const average = frameGaps.length ? frameGaps.reduce((a,b)=>a+b,0)/frameGaps.length : 0;
        const maximum = frameGaps.length ? Math.max(...frameGaps) : 0;
        return { frameSampleCount: frameGaps.length, averageFrameGapMs: average,
            p95FrameGapMs: percentile(frameGaps, .95), maximumFrameGapMs: maximum,
            warningGapCount: frameGaps.filter(v=>v>HND_BENCHMARK_FRAME_GAP_WARNING_MS).length,
            criticalGapCount: frameGaps.filter(v=>v>HND_BENCHMARK_FRAME_GAP_CRITICAL_MS).length,
            longTaskCount };
    }
    function heartbeat(now) { if (frameLastTime !== null) frameGaps.push(now-frameLastTime); frameLastTime=now;
        if (performance?.memory) jsHeapPeak=Math.max(jsHeapPeak || 0, performance.memory.usedJSHeapSize);
        frameRequestId=requestAnimationFrame(heartbeat); }
    function startMonitoring() {
        frameGaps=[]; frameLastTime=null; jsHeapBefore=performance?.memory?.usedJSHeapSize ?? null; jsHeapPeak=jsHeapBefore;
        frameRequestId=requestAnimationFrame(heartbeat); longTaskCount=null;
        if (typeof PerformanceObserver === "function") { try { longTaskCount=0; longTaskObserver=new PerformanceObserver(list=>{longTaskCount+=list.getEntries().length;}); longTaskObserver.observe({entryTypes:["longtask"]}); } catch(error){longTaskCount=null;} }
    }
    function stopMonitoring() { if(frameRequestId!==null) cancelAnimationFrame(frameRequestId); frameRequestId=null;
        longTaskObserver?.disconnect(); longTaskObserver=null; }
    function summarize(message) {
        const runs=message.runs || [], durations=runs.map(r=>r.durationMs), throughputs=runs.map(r=>r.candlesPerSecond);
        const avgDuration=durations.reduce((a,b)=>a+b,0)/durations.length, avgThroughput=throughputs.reduce((a,b)=>a+b,0)/throughputs.length;
        const medianThroughput=median(throughputs), std=Math.sqrt(durations.reduce((s,v)=>s+(v-avgDuration)**2,0)/durations.length);
        const cv=avgDuration ? std/avgDuration*100 : 0, responsive=responsiveness();
        const deterministic=new Set(runs.map(r=>r.checksum)).size===1;
        const memorySafe=message.memory.estimatedPeakWorkingBytes<=HND_BENCHMARK_MAX_ESTIMATED_BYTES;
        const warnings=[]; if(cv>HND_BENCHMARK_VARIANCE_WARNING_PERCENT)warnings.push("HIGH_VARIANCE");
        if(responsive.maximumFrameGapMs>HND_BENCHMARK_FRAME_GAP_WARNING_MS)warnings.push("UI_FRAME_GAP");
        if(!memorySafe)warnings.push("MEMORY_LIMIT"); if(!deterministic)warnings.push("NONDETERMINISTIC");
        let recommendation="SAFE_FOR_50K";
        if(!deterministic||responsive.maximumFrameGapMs>HND_BENCHMARK_FRAME_GAP_CRITICAL_MS||!memorySafe)recommendation="UNSAFE";
        else if(warnings.includes("HIGH_VARIANCE"))recommendation="CAUTION_HIGH_VARIANCE";
        else if(warnings.includes("UI_FRAME_GAP"))recommendation="CAUTION_UI_LAG";
        else recommendation="SAFE_FOR_250K_ESTIMATE";
        const jsHeapAfter=performance?.memory?.usedJSHeapSize ?? null;
        return { version:HND_BACKTEST_BENCHMARK_VERSION, profileVersion:HND_BACKTEST_BENCHMARK_PROFILE_VERSION,
            completedAt:Date.now(), context:clone(state.context), config:clone(state.config),
            environment:environment(), warmup:clone(message.warmup), runs:clone(runs),
            memory:{...clone(message.memory),jsHeapBefore,jsHeapPeak,jsHeapAfter,jsHeapDelta:jsHeapBefore!==null&&jsHeapAfter!==null?jsHeapAfter-jsHeapBefore:null,jsHeapLimit:performance?.memory?.jsHeapSizeLimit??null},
            responsiveness:responsive, summary:{ repetitions:runs.length, medianDurationMs:median(durations), averageDurationMs:avgDuration,
                minimumDurationMs:Math.min(...durations),maximumDurationMs:Math.max(...durations),medianCandlesPerSecond:medianThroughput,
                averageCandlesPerSecond:avgThroughput,millisecondsPerCandle:1000/medianThroughput,coefficientOfVariationPercent:cv,
                estimated50000DurationMs:50000/medianThroughput*1000,estimated250000DurationMs:250000/medianThroughput*1000,
                datasetChecksum:message.datasetChecksum,deterministic,responsive:responsive.maximumFrameGapMs<=HND_BENCHMARK_FRAME_GAP_WARNING_MS&&responsive.criticalGapCount===0,
                memorySafe,recommendation,warnings } };
    }
    function text(id,value){const el=document.getElementById(id);if(el)el.textContent=String(value);}
    function formatMs(value){return Number.isFinite(value)?`${value.toFixed(2)} ms`:"-";}
    function formatRate(value){return Number.isFinite(value)?value.toFixed(0):"-";}
    function formatBytes(value){return Number.isFinite(value)?`${(value/1048576).toFixed(2)} MB`:"UNAVAILABLE";}
    function renderRuns(runs=[]) { const body=document.getElementById("backtestBenchmarkRunBody"); if(!body)return; body.replaceChildren();
        if(!runs.length){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=7;cell.textContent="No completed runs";row.appendChild(cell);body.appendChild(row);return;}
        runs.forEach(run=>{const row=document.createElement("tr");[run.runNumber,run.candleCount,formatMs(run.durationMs),formatRate(run.candlesPerSecond),run.millisecondsPerCandle.toFixed(5),formatMs(run.p95ChunkMs),run.checksum].forEach(value=>{const cell=document.createElement("td");cell.textContent=String(value);row.appendChild(cell);});body.appendChild(row);}); }
    function render() { text("backtestBenchmarkStatus",state.status);text("backtestBenchmarkPhase",state.phase);text("backtestBenchmarkProcessed",`${state.processedCandles} / ${state.targetCandles}`);text("backtestBenchmarkCurrentRun",`${state.currentRun} / ${state.totalRuns}`);
        const progress=document.getElementById("backtestBenchmarkProgress");if(progress)progress.value=state.progressPercent;
        const result=state.lastResult, summary=result?.summary, memory=result?.memory, responsive=result?.responsiveness;
        text("backtestMetricThroughput",formatRate(summary?.medianCandlesPerSecond));text("backtestMetricDuration",formatMs(summary?.medianDurationMs));
        text("backtestMetricVariation",Number.isFinite(summary?.coefficientOfVariationPercent)?`${summary.coefficientOfVariationPercent.toFixed(2)}%`:"-");
        text("backtestMetricFrameGap",formatMs(responsive?.maximumFrameGapMs));text("backtestMetricHeap",formatBytes(memory?.jsHeapDelta));
        text("backtestMetricWorkerMemory",formatBytes(memory?.estimatedPeakWorkingBytes));text("backtestMetric50K",formatMs(summary?.estimated50000DurationMs));
        text("backtestMetric250K",formatMs(summary?.estimated250000DurationMs));text("backtestMetricRecommendation",summary?.recommendation||"-");
        const panel=document.getElementById("backtestBenchmarkPanel");if(panel&&result){panel.dataset.hardwareConcurrency=String(result.environment?.hardwareConcurrency??"");panel.dataset.deviceMemoryHint=String(result.environment?.deviceMemoryHint??"");panel.dataset.warmupDurationMs=String(result.warmup?.durationMs??"");panel.dataset.criticalFrameGapCount=String(responsive?.criticalGapCount??"");panel.dataset.jsHeapBefore=String(memory?.jsHeapBefore??"");panel.dataset.jsHeapPeak=String(memory?.jsHeapPeak??"");panel.dataset.jsHeapAfter=String(memory?.jsHeapAfter??"");}
        renderRuns(result?.runs||[]); const running=["PREFLIGHT","WARMING_UP","RUNNING","PAUSED"].includes(state.status);
        const setDisabled=(id,v)=>{const el=document.getElementById(id);if(el)el.disabled=v;};setDisabled("backtestBenchmarkStart",running);
        setDisabled("backtestBenchmarkPause",state.status!=="RUNNING"&&state.status!=="WARMING_UP");setDisabled("backtestBenchmarkResume",state.status!=="PAUSED");
        setDisabled("backtestBenchmarkCancel",!running);setDisabled("backtestBenchmarkExport",!state.lastResult);
    }
    function finishWorker(){worker?.terminate();worker=null;activeRequestId=null;stopMonitoring();}
    function onWorkerMessage(event) { const message=event.data||{};if(message.requestId!==activeRequestId)return;
        if(message.type==="PHASE_STARTED"){if(message.phase==="PREFLIGHT"){state.status="PREFLIGHT";state.phase="PREFLIGHT";debug(DEBUG_REASONS.PREFLIGHT_PASSED,null,message.memory);}
            else if(message.phase==="WARMUP"){state.status="WARMING_UP";state.phase="WARMUP";state.currentRun=0;state.targetCandles=HND_BENCHMARK_WARMUP_CANDLES;debug(DEBUG_REASONS.WARMUP_STARTED);}
            else {state.status="RUNNING";state.phase=`RUN ${message.runNumber}`;state.currentRun=message.runNumber;state.targetCandles=HND_BENCHMARK_RUN_CANDLES; if(message.warmup)state.warmup=clone(message.warmup);debug(message.runNumber===1?DEBUG_REASONS.WARMUP_COMPLETED:DEBUG_REASONS.RUN_STARTED);}}
        else if(message.type==="PROGRESS"){state.processedCandles=message.processedCandles;state.targetCandles=message.targetCandles;state.progressPercent=message.progressPercent;}
        else if(message.type==="PAUSED"){state.status="PAUSED";debug(DEBUG_REASONS.BENCHMARK_PAUSED);}
        else if(message.type==="RESUMED"){state.status=state.currentRun?"RUNNING":"WARMING_UP";debug(DEBUG_REASONS.BENCHMARK_RESUMED);}
        else if(message.type==="CANCELLED"){state.status="CANCELLED";state.phase="CANCELLED";state.completedAt=Date.now();debug(DEBUG_REASONS.BENCHMARK_CANCELLED);finishWorker();}
        else if(message.type==="ERROR"){state.status="ERROR";state.phase="ERROR";state.completedAt=Date.now();debug(message.error?.name==="PreflightError"?DEBUG_REASONS.PREFLIGHT_MEMORY_REJECTED:DEBUG_REASONS.WORKER_ERROR,message.error,message.memory);finishWorker();}
        else if(message.type==="COMPLETED"){state.status="COMPLETED";state.phase="COMPLETED";state.progressPercent=100;state.processedCandles=HND_BENCHMARK_RUN_CANDLES;state.completedAt=Date.now();state.lastResult=summarize(message);
            history=[clone(state.lastResult),...history].slice(0,HND_BENCHMARK_MAX_HISTORY);writeHistory();debug(state.lastResult.summary.deterministic?DEBUG_REASONS.BENCHMARK_COMPLETED:DEBUG_REASONS.BENCHMARK_NONDETERMINISTIC);finishWorker();}
        state.history=clone(history);render(); }
    function start(){if(["PREFLIGHT","WARMING_UP","RUNNING","PAUSED"].includes(state.status))return false;if(typeof Worker!=="function"){state.status="ERROR";debug(DEBUG_REASONS.WORKER_UNAVAILABLE);render();return false;}
        reset(false);activeRequestId=`HND-BENCH-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;state.status="PREFLIGHT";state.phase="PREFLIGHT";state.startedAt=Date.now();state.context=clone(getMarketContext()||{});state.config=config();startMonitoring();
        try{worker=new Worker("js/backtestBenchmarkWorker.js");worker.onmessage=onWorkerMessage;worker.onerror=event=>{state.status="ERROR";state.phase="ERROR";state.completedAt=Date.now();debug(DEBUG_REASONS.WORKER_ERROR,new Error(event.message||"Worker error"));finishWorker();render();};
            worker.postMessage({type:"START",requestId:activeRequestId,timestamp:Date.now(),config:state.config,seedCandles:safeSeed(),marketContext:state.context});debug(DEBUG_REASONS.BENCHMARK_STARTED);render();return true;}
        catch(error){state.status="ERROR";debug(DEBUG_REASONS.BENCHMARK_ERROR,error);finishWorker();render();return false;}}
    function pause(){if(!worker||!["RUNNING","WARMING_UP"].includes(state.status))return false;worker.postMessage({type:"PAUSE",requestId:activeRequestId,timestamp:Date.now()});return true;}
    function resume(){if(!worker||state.status!=="PAUSED")return false;worker.postMessage({type:"RESUME",requestId:activeRequestId,timestamp:Date.now()});return true;}
    function cancel(){if(!worker||!["PREFLIGHT","WARMING_UP","RUNNING","PAUSED"].includes(state.status))return false;worker.postMessage({type:"CANCEL",requestId:activeRequestId,timestamp:Date.now()});setTimeout(()=>{if(worker){state.status="CANCELLED";state.phase="CANCELLED";state.completedAt=Date.now();debug(DEBUG_REASONS.BENCHMARK_CANCELLED);finishWorker();render();}},100);return true;}
    function reset(doRender=true){if(worker)finishWorker();const keepHistory=history,keepInitialized=initialized;state=createState();state.initialized=keepInitialized;state.history=clone(keepHistory);if(doRender)render();return getState();}
    function openPanel(){const panel=document.getElementById("backtestBenchmarkPanel"),button=document.getElementById("backtestBenchmarkButton");if(panel)panel.hidden=false;button?.setAttribute("aria-expanded","true");}
    function closePanel(){const panel=document.getElementById("backtestBenchmarkPanel"),button=document.getElementById("backtestBenchmarkButton");if(panel)panel.hidden=true;button?.setAttribute("aria-expanded","false");}
    function exportJSON(){if(!state.lastResult)return false;try{const blob=new Blob([JSON.stringify(state.lastResult,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`HNDai-backtest-capacity-${Date.now()}.json`;a.hidden=true;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);return true;}catch(error){debug(DEBUG_REASONS.BENCHMARK_ERROR,error);return false;}}
    function setupListeners(){if(listenersInitialized)return;const bind=(id,event,handler)=>document.getElementById(id)?.addEventListener(event,handler);bind("backtestBenchmarkButton","click",openPanel);bind("backtestBenchmarkStart","click",start);bind("backtestBenchmarkPause","click",pause);bind("backtestBenchmarkResume","click",resume);bind("backtestBenchmarkCancel","click",cancel);bind("backtestBenchmarkExport","click",exportJSON);bind("backtestBenchmarkClose","click",closePanel);listenersInitialized=true;}
    function init(options={}){if(initialized)return getState();if(typeof options.getSeedCandles==="function")getSeedCandles=options.getSeedCandles;if(typeof options.getMarketContext==="function")getMarketContext=options.getMarketContext;history=readHistory();initialized=true;state.initialized=true;state.history=clone(history);if(history.length)state.lastResult=clone(history[0]);setupListeners();debug(DEBUG_REASONS.BENCHMARK_INITIALIZED);render();return getState();}
    function getState(){return clone({...state,history,lastEvaluation});} function getLastResult(){return clone(state.lastResult);} function getHistory(){return clone(history);} function getLastDebug(){return clone(lastEvaluation?.debug||null);} function explainLastEvaluation(){return clone(lastEvaluation);}
    window.HNDBacktestBenchmark={init,openPanel,closePanel,start,pause,resume,cancel,reset,getState,getLastResult,getHistory,exportJSON,getLastDebug,explainLastEvaluation};
})();
