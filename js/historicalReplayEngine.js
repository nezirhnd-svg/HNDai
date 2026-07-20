(function () {
    "use strict";
    const HND_HISTORICAL_REPLAY_VERSION = "4.6.3.3.1";
    const HND_HISTORICAL_REPLAY_SCHEMA_VERSION = 1;
    const HND_HISTORICAL_REPLAY_PROFILE_VERSION = "HND-REPLAY-DIAGNOSTIC-V1";
    const HND_REPLAY_ALLOWED_COUNTS = Object.freeze([2000, 10000, 50000, 100000]);
    const HND_REPLAY_DEFAULT_COUNT = 2000;
    const HND_REPLAY_WINDOW_BARS = 500;
    const HND_REPLAY_MIN_WARMUP_BARS = 500;
    const HND_REPLAY_REPETITIONS = 2;
    const HND_REPLAY_CHUNK_BARS = 20;
    const HND_REPLAY_PROGRESS_INTERVAL_MS = 200;
    const HND_REPLAY_MAX_TRADES = 1000;
    const HND_REPLAY_MAX_SETUP_EVENTS = 2000;
    const HND_REPLAY_MAX_PLAN_EVENTS = 2000;
    const HND_REPLAY_MAX_CHECKPOINTS = 250;
    const HND_REPLAY_CHECKPOINT_INTERVAL_BARS = 100;
    const HND_REPLAY_STORAGE_KEY = "HNDai.historicalReplayDiagnostics.v4.6.3.3.1";
    const HND_REPLAY_MAX_STORED_SUMMARIES = 5;
    const COLUMN_KEYS = Object.freeze(["openTime", "open", "high", "low", "close", "volume", "closeTime"]);
    let initialized = false, listenersInitialized = false, worker = null, activeRequestId = null;
    let options = { getHistoricalDataset: async () => null, getLoaderState: () => null,
        getMarketContext: () => ({}), getReplayProfile: () => ({}) };
    let lastResult = null, lastEvaluation = null, history = readHistory();
    let state = createState();

    function createState() { return { version: HND_HISTORICAL_REPLAY_VERSION,
        schemaVersion: HND_HISTORICAL_REPLAY_SCHEMA_VERSION, profileVersion: HND_HISTORICAL_REPLAY_PROFILE_VERSION,
        initialized: initialized, status: "IDLE", phase: "IDLE", activeRequestId: null,
        symbol: null, interval: null, selectedCandleCount: HND_REPLAY_DEFAULT_COUNT,
        warmupBars: HND_REPLAY_MIN_WARMUP_BARS, evaluatedBars: 0, currentRepetition: 0,
        totalRepetitions: HND_REPLAY_REPETITIONS, processedBars: 0, totalBars: 0,
        progressPercent: 0, startedAt: null, completedAt: null, datasetMetadata: null,
        lastResult: null, history: clone(history), lastEvaluation: null }; }
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function isActive(requestId) { return Boolean(requestId) && requestId === activeRequestId && requestId === state.activeRequestId; }
    function checksumColumns(columns) { let hash = 2166136261;
        for (let index = 0; index < columns.openTime.length; index++) for (const key of COLUMN_KEYS) {
            const value = columns[key][index], textValue = Number.isInteger(value) ? String(value) : value.toPrecision(15);
            for (let character = 0; character < textValue.length; character++) hash = Math.imul(hash ^ textValue.charCodeAt(character), 16777619) >>> 0;
        } return hash.toString(16).padStart(8, "0").toUpperCase(); }
    function validateDataset(dataset, requested, context, loaderState) {
        const metadata = dataset?.metadata, columns = dataset?.columns;
        if (!metadata || !columns || COLUMN_KEYS.some(key => !(columns[key] instanceof Float64Array))) return "DATASET_INVALID";
        const length = columns.openTime.length;
        if (COLUMN_KEYS.some(key => columns[key].length !== length) || length < requested ||
            metadata.symbol !== context.symbol || metadata.interval !== context.interval ||
            metadata.gapCount !== 0 || metadata.duplicateCount !== 0 || metadata.invalidCount !== 0 ||
            metadata.chronological !== true || metadata.closedOnly !== true || !metadata.checksum) return "DATASET_INVALID";
        if (metadata.source === "STALE_CACHE") return "DATASET_STALE_BLOCKED";
        const loaderMetadata = loaderState?.datasetMetadata;
        if (loaderState?.status === "READY_STALE" && loaderMetadata?.symbol === metadata.symbol &&
            loaderMetadata?.interval === metadata.interval && loaderMetadata?.datasetId === metadata.datasetId &&
            loaderMetadata?.source === "STALE_CACHE") return "DATASET_STALE_BLOCKED";
        return null;
    }
    function sliceDataset(dataset, requested) { const start = dataset.columns.openTime.length - requested, columns = {};
        COLUMN_KEYS.forEach(key => { columns[key] = dataset.columns[key].slice(start); });
        const selectedChecksum = checksumColumns(columns);
        return { columns, metadata: { originalDatasetId: dataset.metadata.datasetId,
            originalChecksum: dataset.metadata.checksum, originalCandleCount: dataset.columns.openTime.length,
            selectedCandleCount: requested, selectedFirstOpenTime: columns.openTime[0],
            selectedLastOpenTime: columns.openTime[requested - 1], selectedChecksum,
            source: dataset.metadata.source, closedOnly: dataset.metadata.closedOnly,
            chronological: dataset.metadata.chronological, gapCount: dataset.metadata.gapCount,
            duplicateCount: dataset.metadata.duplicateCount } };
    }
    function validateProfile(profile) { return profile && Number.isInteger(profile.structureHistoryLimit) &&
        Number.isInteger(profile.rawZoneHistoryLimit) && profile.structureQualificationOptions &&
        profile.replayWindowBars === HND_REPLAY_WINDOW_BARS && profile.mtfMode === "NOT_INCLUDED"; }
    function validate100KParityGate(requested) {
        if (requested !== 100000) return null;
        const parity = window.HNDParityEngine?.getState?.();
        return parity?.liveParity === "LIVE_STATELESS_PARITY_PASS" && parity?.pass2K === true &&
            parity?.pass10K === true && parity?.overallStatus === "PASS_WITH_MTF_AND_TICK_PENDING" &&
            parity?.mismatchCount === 0 ? null : "PARITY_REQUIRED_FOR_100K";
    }
    function debug(reason, error) { lastEvaluation = { debug: { version: HND_HISTORICAL_REPLAY_VERSION,
        profileVersion: HND_HISTORICAL_REPLAY_PROFILE_VERSION, primaryReason: reason,
        requestId: state.activeRequestId, context: { symbol: state.symbol, interval: state.interval,
            selectedCandleCount: state.selectedCandleCount, warmupBars: state.warmupBars,
            evaluatedBars: state.evaluatedBars, mtfMode: "NOT_INCLUDED" }, dataset: clone(state.datasetMetadata),
        progress: { repetition: state.currentRepetition, processedBars: state.processedBars,
            totalBars: state.totalBars, percent: state.progressPercent }, result: lastResult ? {
            eventChecksum: lastResult.summary?.eventChecksum, deterministic: lastResult.summary?.deterministic,
            closedTrades: lastResult.summary?.closedTrades, tpCount: lastResult.summary?.tpCount,
            slCount: lastResult.summary?.slCount, openTradeAtEnd: lastResult.summary?.openTradeAtEnd,
            pendingPlanAtEnd: Boolean(lastResult.summary?.pendingPlanAtEnd) } : null,
        timing: { startedAt: state.startedAt, completedAt: state.completedAt,
            durationMs: state.startedAt ? (state.completedAt || Date.now()) - state.startedAt : null },
        error: { name: error ? String(error.name || "Error") : null,
            message: error ? String(error.message || error).slice(0, 300) : null }, evaluatedAt: Date.now() } };
        state.lastEvaluation = clone(lastEvaluation); }
    function transferList(columns) { return COLUMN_KEYS.map(key => columns[key].buffer); }
    function terminateWorker() { if (worker) { worker.terminate(); worker = null; } }
    function createWorker(requestId) { terminateWorker();
        try { worker = new Worker("js/historicalReplayWorker.js?v=4.6.3.3.1"); }
        catch (error) { debug("WORKER_UNAVAILABLE", error); throw error; }
        worker.onmessage = event => handleWorkerMessage(requestId, event.data || {});
        worker.onerror = event => { if (!isActive(requestId)) return; fail(requestId, "WORKER_IMPORT_FAILED",
            new Error(event.message || "Replay worker failed")); };
        return worker;
    }
    function handleWorkerMessage(requestId, message) { if (!isActive(requestId) || message.requestId !== requestId) return;
        if (message.type === "PREFLIGHT_PASSED") { state.phase = "PREFLIGHT_PASSED"; debug("PREFLIGHT_PASSED"); }
        if (message.type === "REPETITION_STARTED") { state.currentRepetition = message.repetition; state.phase = `REPETITION_${message.repetition}`; }
        if (message.type === "PROGRESS") { state.currentRepetition = message.repetition || state.currentRepetition;
            state.processedBars = message.processedBars || 0; state.totalBars = message.totalBars || state.totalBars;
            const perRun = state.totalBars || 1; state.progressPercent = message.progressPercent ??
                Math.min(100, (((state.currentRepetition - 1) * perRun + state.processedBars) /
                    (HND_REPLAY_REPETITIONS * perRun)) * 100); }
        if (message.type === "PAUSED") { state.status = "PAUSED"; state.phase = "PAUSED"; debug("REPLAY_PAUSED"); }
        if (message.type === "RESUMED") { state.status = "RUNNING"; state.phase = `REPETITION_${state.currentRepetition}`; debug("REPLAY_RESUMED"); }
        if (message.type === "REPETITION_COMPLETED") state.phase = `REPETITION_${message.repetition}_COMPLETED`;
        if (message.type === "COMPLETED") complete(requestId, message.result);
        if (message.type === "CANCELLED") cancelled(requestId);
        if (message.type === "ERROR") fail(requestId, message.reason || "REPLAY_ERROR",
            Object.assign(new Error(message.error?.message || "Replay worker error"), { name: message.error?.name || "Error" }));
        render();
    }
    function complete(requestId, result) { if (!isActive(requestId)) return;
        lastResult = clone(result); state.status = "COMPLETED_DIAGNOSTIC"; state.phase = "COMPLETED_DIAGNOSTIC";
        state.progressPercent = 100; state.processedBars = state.totalBars; state.completedAt = Date.now();
        state.lastResult = clone(lastResult); debug("REPLAY_COMPLETED"); storeSummary(lastResult);
        activeRequestId = null; state.activeRequestId = null; terminateWorker(); }
    function cancelled(requestId) { if (!isActive(requestId)) return;
        state.status = "CANCELLED"; state.phase = "CANCELLED"; state.completedAt = Date.now();
        debug("REPLAY_CANCELLED"); activeRequestId = null; state.activeRequestId = null; terminateWorker(); render(); }
    function fail(requestId, reason, error) { if (!isActive(requestId)) return;
        state.status = "ERROR"; state.phase = "ERROR"; state.completedAt = Date.now(); debug(reason, error);
        activeRequestId = null; state.activeRequestId = null; terminateWorker(); render(); }
    async function start(config = {}) { if (activeRequestId) return false;
        const requested = Number(config.candleCount ?? document.getElementById("historicalReplayCandleCount")?.value ?? HND_REPLAY_DEFAULT_COUNT);
        if (!HND_REPLAY_ALLOWED_COUNTS.includes(requested)) return false;
        const parityGateReason = validate100KParityGate(requested);
        if (parityGateReason) { state.status = "ERROR"; state.phase = parityGateReason;
            debug(parityGateReason, new Error("Run Live, 2K and 10K parity validation for this market before 100K replay"));
            render(); return false; }
        lastResult = null;
        state = createState(); state.lastResult = null; state.initialized = initialized;
        state.status = "PREFLIGHT"; state.phase = "PREFLIGHT";
        state.startedAt = Date.now(); state.selectedCandleCount = requested; state.evaluatedBars = requested - 499;
        state.totalBars = requested - 499; const context = options.getMarketContext() || {};
        state.symbol = String(context.symbol || ""); state.interval = String(context.interval || "");
        const requestId = `HND-REPLAY-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        activeRequestId = requestId; state.activeRequestId = requestId; debug("REPLAY_STARTED"); render();
        try { const dataset = await options.getHistoricalDataset({ symbol: state.symbol, interval: state.interval,
            requestedCandleCount: requested }); if (!isActive(requestId)) return false;
            const loaderState = options.getLoaderState(); const invalidReason = validateDataset(dataset, requested, context, loaderState);
            if (invalidReason) { const warning = invalidReason === "DATASET_STALE_BLOCKED"
                ? "Stale dataset is blocked for diagnostic replay" : "Prepare a valid dataset with Historical Data Loader first";
                throw Object.assign(new Error(warning), { replayReason: invalidReason }); }
            const selected = sliceDataset(dataset, requested); state.datasetMetadata = clone(selected.metadata);
            const profile = options.getReplayProfile(); if (!validateProfile(profile)) throw Object.assign(new Error("Invalid replay profile"), { replayReason: "DATASET_INVALID" });
            state.status = "RUNNING"; state.phase = "WORKER_START"; debug("PREFLIGHT_PASSED"); render();
            const replayWorker = createWorker(requestId); replayWorker.postMessage({ type: "START", requestId,
                timestamp: Date.now(), config: { selectedCandleCount: requested, repetitions: HND_REPLAY_REPETITIONS,
                    windowBars: HND_REPLAY_WINDOW_BARS, warmupBars: HND_REPLAY_MIN_WARMUP_BARS,
                    chunkBars: HND_REPLAY_CHUNK_BARS, progressIntervalMs: HND_REPLAY_PROGRESS_INTERVAL_MS,
                    maxTrades: HND_REPLAY_MAX_TRADES, maxSetupEvents: HND_REPLAY_MAX_SETUP_EVENTS,
                    maxPlanEvents: HND_REPLAY_MAX_PLAN_EVENTS, maxCheckpoints: HND_REPLAY_MAX_CHECKPOINTS,
                    checkpointIntervalBars: HND_REPLAY_CHECKPOINT_INTERVAL_BARS }, context: { symbol: state.symbol,
                    interval: state.interval }, datasetMetadata: selected.metadata, columns: selected.columns,
                replayProfile: clone(profile) }, transferList(selected.columns)); return true;
        } catch (error) { if (!isActive(requestId)) return false; fail(requestId, error.replayReason || "REPLAY_ERROR", error); return false; }
    }
    function pause() { if (!activeRequestId || state.status !== "RUNNING" || !worker) return false;
        worker.postMessage({ type: "PAUSE", requestId: activeRequestId, timestamp: Date.now() }); return true; }
    function resume() { if (!activeRequestId || state.status !== "PAUSED" || !worker) return false;
        worker.postMessage({ type: "RESUME", requestId: activeRequestId, timestamp: Date.now() }); return true; }
    function cancel() { if (!activeRequestId || !worker) return false; const requestId = activeRequestId;
        worker.postMessage({ type: "CANCEL", requestId, timestamp: Date.now() }); setTimeout(() => {
            if (isActive(requestId)) cancelled(requestId); }, 250); return true; }
    function reset() { activeRequestId = null; terminateWorker(); lastResult = null; state = createState();
        state.initialized = initialized; render(); return getState(); }
    function readHistory() { try { const parsed = JSON.parse(localStorage.getItem(HND_REPLAY_STORAGE_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.slice(0, HND_REPLAY_MAX_STORED_SUMMARIES) : []; } catch (_) { return []; } }
    function storeSummary(result) { try { const summary = { completedAt: Date.now(), symbol: state.symbol,
        interval: state.interval, datasetMetadata: clone(result.datasetMetadata), summary: clone(result.summary) };
        history = [summary, ...history].slice(0, HND_REPLAY_MAX_STORED_SUMMARIES);
        localStorage.setItem(HND_REPLAY_STORAGE_KEY, JSON.stringify(history)); state.history = clone(history); } catch (_) {} }
    function getState() { return clone({ ...state, lastResult, history, lastEvaluation }); }
    function getLastResult() { return clone(lastResult); }
    function getTrades() { return clone(lastResult?.trades || []); }
    function getSetupEvents() { return clone(lastResult?.setupEvents || []); }
    function getPlanEvents() { return clone(lastResult?.planEvents || []); }
    function getTradeEvents() { return clone(lastResult?.tradeEvents || []); }
    function getCheckpoints() { return clone(lastResult?.checkpoints || []); }
    function getLastDebug() { return clone(lastEvaluation?.debug || null); }
    function explainLastEvaluation() { return clone(lastEvaluation); }
    function exportDiagnosticJSON() { if (!lastResult) return false; try { const blob = new Blob([JSON.stringify({
        version: HND_HISTORICAL_REPLAY_VERSION, profileVersion: HND_HISTORICAL_REPLAY_PROFILE_VERSION,
        result: lastResult }, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob),
        anchor = document.createElement("a"); anchor.href = url; anchor.download = `HNDai-replay-${state.symbol}-${state.interval}.json`;
        anchor.hidden = true; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); return true;
        } catch (error) { debug("REPLAY_ERROR", error); return false; } }
    function text(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value ?? "-"); }
    function format(value, digits = 2) { return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-"; }
    function renderTrades() { const body = document.getElementById("historicalReplayTradeBody"); if (!body) return;
        while (body.firstChild) body.removeChild(body.firstChild); const trades = (lastResult?.trades || []).filter(trade =>
            trade.state === "CLOSED_TP" || trade.state === "CLOSED_SL").slice(-50);
        if (!trades.length) { const row = document.createElement("tr"), cell = document.createElement("td");
            cell.colSpan = 10; cell.textContent = "No terminal diagnostic trades"; row.appendChild(cell); body.appendChild(row); return; }
        trades.forEach(trade => { const row = document.createElement("tr"); [trade.openedAtCandleTime ? new Date(trade.openedAtCandleTime).toISOString() : "-",
            trade.closedAtCandleTime ? new Date(trade.closedAtCandleTime).toISOString() : "-", trade.direction,
            format(trade.entryPrice, 6), format(trade.stopLoss, 6), format(trade.takeProfit, 6), trade.state,
            format(trade.exitPrice, 6), format(trade.realizedR, 2), trade.durationBars ?? "-"].forEach(value => {
                const cell = document.createElement("td"); cell.textContent = String(value ?? "-"); row.appendChild(cell); }); body.appendChild(row); }); }
    function render() { const summary = lastResult?.summary; text("historicalReplayStatus", state.status);
        text("historicalReplayPhase", state.phase); text("historicalReplayDataset", state.datasetMetadata?.selectedChecksum || "-");
        text("historicalReplayProcessed", `${state.processedBars} / ${state.totalBars}`);
        text("historicalReplayRepetition", `${state.currentRepetition} / ${state.totalRepetitions}`);
        text("historicalReplayDuration", summary ? `${format(summary.durationMs, 2)} ms` : "-");
        text("historicalReplayThroughput", summary ? `${format(summary.candlesPerSecond, 0)} candles/s` : "-");
        text("historicalReplayDeterministic", summary ? String(summary.deterministic) : "-");
        text("historicalReplayEventChecksum", summary?.eventChecksum || "-"); text("historicalReplayClosedTrades", summary?.closedTrades ?? "-");
        text("historicalReplayTP", summary?.tpCount ?? "-"); text("historicalReplaySL", summary?.slCount ?? "-");
        text("historicalReplayOpenTrade", summary ? String(summary.openTradeAtEnd) : "-");
        text("historicalReplayPendingPlan", summary ? String(Boolean(summary.pendingPlanAtEnd)) : "-");
        text("historicalReplayWinRate", summary?.diagnosticWinRate == null ? "-" : `${format(summary.diagnosticWinRate, 2)}% DIAGNOSTIC`);
        text("historicalReplayNetR", summary ? `${format(summary.diagnosticNetR, 2)}R UNVALIDATED` : "-");
        let warning = "MTF historical context is not included yet • PARITY REQUIRED";
        if (state.lastEvaluation?.debug?.primaryReason === "DATASET_STALE_BLOCKED") warning = "STALE DATASET BLOCKED";
        if (state.lastEvaluation?.debug?.primaryReason === "DATASET_INVALID") warning = "Prepare a valid dataset with Historical Data Loader first";
        if (state.lastEvaluation?.debug?.primaryReason === "PARITY_REQUIRED_FOR_100K") warning = "Run Live, 2K and 10K parity validation for this market before 100K replay";
        text("historicalReplayWarning", warning); const progress = document.getElementById("historicalReplayProgress");
        if (progress) progress.value = state.progressPercent; const running = ["PREFLIGHT", "RUNNING", "PAUSED"].includes(state.status);
        [["historicalReplayStart", running], ["historicalReplayPause", state.status !== "RUNNING"],
            ["historicalReplayResume", state.status !== "PAUSED"], ["historicalReplayCancel", !running],
            ["historicalReplayExport", !lastResult]].forEach(([id, disabled]) => { const element = document.getElementById(id); if (element) element.disabled = disabled; });
        const panel = document.querySelector(".historical-replay-diagnostics");
        if (panel) {
            panel.dataset.debugReason = state.lastEvaluation?.debug?.primaryReason || "";
            panel.dataset.debugError = state.lastEvaluation?.debug?.error?.message || "";
        }
        if (panel && summary) {
            panel.dataset.summary = JSON.stringify({ setupsCreated: summary.setupsCreated,
                setupsTriggered: summary.setupsTriggered, plansCreated: summary.plansCreated,
                plansReady: summary.plansReady, totalTradesOpened: summary.totalTradesOpened,
                closedCandleFillCount: summary.closedCandleFillCount,
                tickerFillCount: summary.tickerFillCount,
                closedCandleExitCount: summary.closedCandleExitCount,
                tickerExitCount: summary.tickerExitCount,
                evaluatedBars: summary.evaluatedBars, repetitions: summary.repetitions,
                forbiddenNetworkCallCount: lastResult?.engine?.forbiddenNetworkCallCount,
                selectedFirstOpenTime: lastResult?.datasetMetadata?.selectedFirstOpenTime,
                selectedLastOpenTime: lastResult?.datasetMetadata?.selectedLastOpenTime,
                durationSamples: (lastResult?.trades || []).slice(0, 5).map(trade => ({
                    openedAtCandleIndex: trade.openedAtCandleIndex,
                    closedAtCandleIndex: trade.closedAtCandleIndex,
                    durationBars: trade.durationBars
                })) });
        }
        renderTrades(); }
    function setupListeners() { if (listenersInitialized) return; const bind = (id, handler) =>
        document.getElementById(id)?.addEventListener("click", handler); bind("historicalReplayStart", () => start());
        bind("historicalReplayPause", pause); bind("historicalReplayResume", resume);
        bind("historicalReplayCancel", cancel); bind("historicalReplayExport", exportDiagnosticJSON); listenersInitialized = true; }
    function init(initOptions = {}) { if (initialized) return getState(); options = { ...options, ...initOptions };
        initialized = true; state.initialized = true; setupListeners(); debug("REPLAY_INITIALIZED"); render(); return getState(); }
    window.HNDHistoricalReplay = { init, start, pause, resume, cancel, reset, getState, getLastResult,
        getTrades, getSetupEvents, getPlanEvents, getTradeEvents, getCheckpoints, exportDiagnosticJSON,
        getLastDebug, explainLastEvaluation };
    window.HNDHistoricalReplayTest = { sliceDataset, validateDataset, checksumColumns, validateProfile, validate100KParityGate };
})();
