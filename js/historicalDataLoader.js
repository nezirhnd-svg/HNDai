(function () {
    "use strict";

    const VERSION = "4.6.1-integrity-fix";
    const SCHEMA = 1;
    const DEFAULT_COUNT = 50000;
    const ALLOWED_COUNTS = Object.freeze([2000, 10000, 50000]);
    const PAGE_LIMIT = 1000;
    const TIMEOUT_MS = 12000;
    const REQUEST_DELAY_MS = 100;
    const MAX_ATTEMPTS = 3;
    const RETRY_BASE_MS = 750;
    const MIN_VALID = 500;
    const INTERVALS = Object.freeze({
        "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000,
        "1h": 3600000, "4h": 14400000, "1d": 86400000
    });

    let initialized = false;
    let listenersInitialized = false;
    let getMarketContext = () => ({ symbol: "BTCUSDT", interval: "15m" });
    let activeRequest = null;
    let currentDataset = null;
    let lastEvaluation = null;
    let lastProgressAt = 0;
    let state = createState();

    function createState() {
        return {
            version: VERSION, schemaVersion: SCHEMA, initialized: false, status: "IDLE", phase: "IDLE",
            activeRequestId: null, symbol: null, interval: null, intervalMs: null,
            requestedCandleCount: DEFAULT_COUNT, progressPercent: 0, downloadedCandles: 0,
            validatedCandles: 0, currentPage: 0, estimatedPages: 0, startedAt: null,
            completedAt: null, paused: false, cancelRequested: false, datasetMetadata: null,
            cachedDatasets: [], persistenceAvailable: false, storageMode: "MEMORY", lastEvaluation: null
        };
    }

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function cacheKey(symbol, interval) {
        return `${symbol}|${interval}`;
    }

    function latestClosed(serverTime, intervalMs) {
        return Math.floor(serverTime / intervalMs) * intervalMs - intervalMs;
    }

    function isActiveRequest(requestId) {
        return Boolean(requestId) && state.activeRequestId === requestId && activeRequest?.id === requestId;
    }

    function assertActive(requestId) {
        if (!isActiveRequest(requestId)) {
            const error = new Error("Stale historical request");
            error.name = "StaleRequestError";
            throw error;
        }
    }

    function checksumDataset(dataset) {
        let hash = 2166136261;
        const keys = ["openTime", "open", "high", "low", "close", "volume", "closeTime"];
        for (let index = 0; index < dataset.columns.openTime.length; index++) {
            for (const key of keys) {
                const value = dataset.columns[key][index];
                const textValue = Number.isInteger(value) ? String(value) : value.toPrecision(15);
                for (let character = 0; character < textValue.length; character++) {
                    hash = Math.imul(hash ^ textValue.charCodeAt(character), 16777619) >>> 0;
                }
            }
        }
        return hash.toString(16).padStart(8, "0").toUpperCase();
    }

    function validateHistoricalDataset(dataset, options = {}) {
        const errors = [];
        const warnings = [];
        const columns = dataset?.columns || {};
        const keys = ["openTime", "open", "high", "low", "close", "volume", "closeTime"];
        if (keys.some(key => !(columns[key] instanceof Float64Array))) {
            return { valid: false, candleCount: 0, duplicateCount: 0, gapCount: 0, invalidCount: 1,
                openCandleExcludedCount: 0, firstOpenTime: null, lastOpenTime: null, lastCloseTime: null,
                chronological: false, closedOnly: false, errors: ["INVALID_COLUMNS"], warnings };
        }
        const length = columns.openTime.length;
        if (keys.some(key => columns[key].length !== length)) errors.push("COLUMN_LENGTH_MISMATCH");
        const intervalMs = Number(options.intervalMs);
        const serverTime = Number(options.serverTime);
        const latest = Number(options.latestClosedOpenTime);
        let duplicateCount = 0;
        let gapCount = 0;
        let invalidCount = 0;
        let openCandleExcludedCount = 0;
        let chronological = true;
        let closedOnly = true;
        for (let index = 0; index < length; index++) {
            const openTime = columns.openTime[index];
            const closeTime = columns.closeTime[index];
            const open = columns.open[index];
            const high = columns.high[index];
            const low = columns.low[index];
            const close = columns.close[index];
            const volume = columns.volume[index];
            if (!Number.isInteger(openTime) || openTime <= 0 || !Number.isInteger(closeTime) ||
                closeTime !== openTime + intervalMs - 1 || ![open, high, low, close, volume].every(Number.isFinite) ||
                open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0 ||
                high < Math.max(open, close) || low > Math.min(open, close) || high < low) invalidCount++;
            if (index && openTime <= columns.openTime[index - 1]) {
                chronological = false;
                if (openTime === columns.openTime[index - 1]) duplicateCount++;
            }
            if (index && openTime !== columns.openTime[index - 1] &&
                openTime - columns.openTime[index - 1] !== intervalMs) gapCount++;
            if ((Number.isFinite(serverTime) && closeTime >= serverTime) ||
                (Number.isFinite(latest) && openTime > latest)) {
                closedOnly = false;
                openCandleExcludedCount++;
            }
        }
        if (dataset?.metadata?.candleCount !== undefined && dataset.metadata.candleCount !== length) {
            errors.push("METADATA_COUNT_MISMATCH");
        }
        if (length < (Number(options.minimumCandles) || MIN_VALID)) errors.push("INSUFFICIENT_VALID_HISTORY");
        if (duplicateCount) errors.push("DUPLICATE_OPEN_TIME");
        if (gapCount) errors.push("GAP_DETECTED");
        if (invalidCount) errors.push("INVALID_CANDLE");
        if (!chronological) errors.push("NOT_CHRONOLOGICAL");
        if (!closedOnly) errors.push("OPEN_CANDLE_PRESENT");
        return {
            valid: errors.length === 0, candleCount: length, duplicateCount, gapCount, invalidCount,
            openCandleExcludedCount, firstOpenTime: length ? columns.openTime[0] : null,
            lastOpenTime: length ? columns.openTime[length - 1] : null,
            lastCloseTime: length ? columns.closeTime[length - 1] : null,
            chronological, closedOnly, errors: errors.slice(0, 20), warnings
        };
    }

    function estimateBytes(dataset) {
        return Object.values(dataset.columns).reduce((sum, column) => sum + column.byteLength, 0) +
            JSON.stringify(dataset.metadata).length * 2;
    }

    function finalizeDerivedDatasetMetadata(dataset, options = {}) {
        const count = dataset.columns.openTime.length;
        Object.assign(dataset.metadata, {
            requestedCandleCount: Number(options.requestedCandleCount ?? count), candleCount: count,
            partial: count < Number(options.requestedCandleCount ?? count),
            firstOpenTime: count ? dataset.columns.openTime[0] : null,
            lastOpenTime: count ? dataset.columns.openTime[count - 1] : null,
            lastCloseTime: count ? dataset.columns.closeTime[count - 1] : null,
            source: options.source || dataset.metadata.source || "CACHE",
            fetchMode: options.fetchMode || dataset.metadata.fetchMode || "CACHE_HIT",
            pageCount: Number(options.pageCount) || 0, retryCount: Number(options.retryCount) || 0,
            lastAccessedAt: Date.now(), deterministic: true
        });
        const validation = validateHistoricalDataset(dataset, {
            intervalMs: dataset.metadata.intervalMs,
            serverTime: options.serverTime ?? dataset.metadata.serverTime,
            latestClosedOpenTime: options.latestClosedOpenTime ?? dataset.metadata.latestClosedOpenTime,
            minimumCandles: MIN_VALID
        });
        Object.assign(dataset.metadata, {
            validatedAt: Date.now(), duplicateCount: validation.duplicateCount, gapCount: validation.gapCount,
            invalidCount: validation.invalidCount, openCandleExcludedCount: validation.openCandleExcludedCount,
            chronological: validation.chronological, closedOnly: validation.closedOnly
        });
        dataset.metadata.checksum = checksumDataset(dataset);
        dataset.metadata.datasetId = [dataset.metadata.symbol, dataset.metadata.interval,
            dataset.metadata.firstOpenTime, dataset.metadata.lastOpenTime, count,
            dataset.metadata.checksum].join("|");
        dataset.metadata.estimatedBytes = estimateBytes(dataset);
        return { dataset, validation };
    }

    function rowsToDataset(rows, context, extra = {}) {
        const columns = {};
        const keys = ["openTime", "open", "high", "low", "close", "volume", "closeTime"];
        for (const key of keys) columns[key] = new Float64Array(rows.length);
        rows.forEach((row, index) => keys.forEach(key => { columns[key][index] = row[key]; }));
        const dataset = {
            metadata: {
                version: VERSION, schemaVersion: SCHEMA, cacheKey: cacheKey(context.symbol, context.interval),
                symbol: context.symbol, interval: context.interval, intervalMs: context.intervalMs,
                latestClosedOpenTime: context.latestClosedOpenTime, serverTime: context.serverTime,
                fetchedAt: Date.now(), source: extra.source || "NETWORK",
                fetchMode: extra.fetchMode || "FULL_BACKFILL",
                pageCount: extra.pageCount || 0, retryCount: extra.retryCount || 0
            },
            columns
        };
        return finalizeDerivedDatasetMetadata(dataset, {
            requestedCandleCount: context.requestedCandleCount, source: dataset.metadata.source,
            fetchMode: dataset.metadata.fetchMode, pageCount: dataset.metadata.pageCount,
            retryCount: dataset.metadata.retryCount, serverTime: context.serverTime,
            latestClosedOpenTime: context.latestClosedOpenTime
        });
    }

    function sliceDataset(original, count, source = "CACHE", fetchMode = "CACHE_HIT", context = {}) {
        const start = Math.max(0, original.columns.openTime.length - count);
        const columns = {};
        for (const key of Object.keys(original.columns)) columns[key] = original.columns[key].slice(start);
        const dataset = { metadata: { ...original.metadata }, columns };
        return finalizeDerivedDatasetMetadata(dataset, {
            requestedCandleCount: count, source, fetchMode, pageCount: 0, retryCount: 0,
            serverTime: context.serverTime ?? original.metadata.serverTime,
            latestClosedOpenTime: context.latestClosedOpenTime ?? original.metadata.latestClosedOpenTime
        });
    }

    function cacheValid(dataset, context) {
        return Boolean(dataset && dataset.metadata?.symbol === context.symbol &&
            dataset.metadata?.interval === context.interval && dataset.metadata.candleCount >= MIN_VALID &&
            dataset.metadata.closedOnly === true && dataset.metadata.chronological === true &&
            dataset.metadata.duplicateCount === 0 && dataset.metadata.gapCount === 0 &&
            dataset.metadata.invalidCount === 0);
    }

    function isRetryableHistoricalRequestError(error) {
        if (!error || error.externallyAborted || error.name === "AbortError" ||
            error.name === "TypeError" || error.name === "StaleRequestError") return false;
        const status = Number(error.status);
        return error.timeout === true || error.name === "TimeoutError" ||
            !Number.isFinite(status) || status === 418 || status === 429 || status >= 500;
    }

    function debug(reason, error = null, validation = null, request = {}) {
        lastEvaluation = { debug: {
            version: VERSION, schemaVersion: SCHEMA, primaryReason: reason,
            requestId: state.activeRequestId, context: { symbol: state.symbol, interval: state.interval,
                intervalMs: state.intervalMs, requestedCandleCount: state.requestedCandleCount },
            request: { page: state.currentPage, attempt: request.attempt ?? null,
                retryCount: request.retryCount ?? 0, status: error?.status ?? request.status ?? null,
                retryAfterMs: error?.retryAfterMs ?? 0, timeout: error?.timeout === true,
                externallyAborted: error?.externallyAborted === true },
            validation: validation ? { ...validation, errors: undefined, warnings: undefined } : null,
            error: { name: error ? String(error.name || "Error") : null,
                message: error ? String(error.message || error).slice(0, 300) : null },
            evaluatedAt: Date.now()
        } };
        state.lastEvaluation = clone(lastEvaluation);
    }

    function abortError() {
        const error = new Error("Historical request cancelled");
        error.name = "AbortError";
        error.externallyAborted = true;
        error.timeout = false;
        return error;
    }

    function sleep(ms, requestId) {
        return new Promise((resolve, reject) => {
            assertActive(requestId);
            const request = activeRequest;
            const timer = setTimeout(() => {
                request.controller.signal.removeEventListener("abort", onAbort);
                try { assertActive(requestId); resolve(); } catch (error) { reject(error); }
            }, ms);
            const onAbort = () => { clearTimeout(timer); reject(abortError()); };
            request.controller.signal.addEventListener("abort", onAbort, { once: true });
        });
    }

    async function waitPaused(requestId) {
        assertActive(requestId);
        if (!state.paused) return;
        await new Promise(resolve => { activeRequest.resume = resolve; });
        assertActive(requestId);
        if (state.cancelRequested) throw abortError();
    }

    async function fetchPage(params, requestId) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            await waitPaused(requestId);
            assertActive(requestId);
            try {
                const page = await window.HNDAPI.fetchHistoricalKlinesPage(params, {
                    timeoutMs: TIMEOUT_MS, silent: true, signal: activeRequest.controller.signal
                });
                assertActive(requestId);
                state.currentPage++;
                debug("PAGE_LOADED", null, null, { attempt, retryCount: attempt - 1, status: 200 });
                return { page, retries: attempt - 1 };
            } catch (error) {
                assertActive(requestId);
                if (!isRetryableHistoricalRequestError(error) || attempt === MAX_ATTEMPTS) throw error;
                debug(error.status === 418 || error.status === 429 ? "RATE_LIMITED" : "PAGE_RETRY",
                    error, null, { attempt, retryCount: attempt });
                const delay = Math.max(RETRY_BASE_MS * 2 ** (attempt - 1), Number(error.retryAfterMs) || 0);
                await sleep(delay, requestId);
                assertActive(requestId);
            }
        }
        throw new Error("Historical page attempts exhausted");
    }

    async function backfill(context, requestId) {
        let pages = [];
        let count = 0;
        let cursor = context.latestClosedOpenTime + context.intervalMs - 1;
        let retries = 0;
        while (count < context.requestedCandleCount) {
            await waitPaused(requestId);
            const limit = Math.min(PAGE_LIMIT, context.requestedCandleCount - count);
            const result = await fetchPage({ symbol: context.symbol, interval: context.interval, limit,
                endTime: cursor }, requestId);
            assertActive(requestId);
            retries += result.retries;
            const page = result.page.filter(row => row.openTime <= context.latestClosedOpenTime &&
                row.closeTime < context.serverTime);
            if (!page.length) break;
            pages.unshift(page);
            count += page.length;
            state.downloadedCandles = Math.min(count, context.requestedCandleCount);
            state.progressPercent = state.downloadedCandles / context.requestedCandleCount * 100;
            renderThrottled();
            cursor = page[0].openTime - 1;
            if (page.length < limit) break;
            await sleep(REQUEST_DELAY_MS, requestId);
        }
        assertActive(requestId);
        return { rows: pages.flat().slice(-context.requestedCandleCount), retries,
            pageCount: state.currentPage, mode: "FULL_BACKFILL" };
    }

    async function incremental(context, cached, requestId) {
        let rows = [];
        let cursor = cached.metadata.lastOpenTime + context.intervalMs;
        let retries = 0;
        while (cursor <= context.latestClosedOpenTime) {
            const result = await fetchPage({ symbol: context.symbol, interval: context.interval,
                limit: PAGE_LIMIT, startTime: cursor,
                endTime: context.latestClosedOpenTime + context.intervalMs - 1 }, requestId);
            assertActive(requestId);
            retries += result.retries;
            const page = result.page.filter(row => row.openTime <= context.latestClosedOpenTime);
            if (!page.length) break;
            rows.push(...page);
            cursor = page[page.length - 1].openTime + context.intervalMs;
            if (page.length < PAGE_LIMIT) break;
            await sleep(REQUEST_DELAY_MS, requestId);
        }
        const oldRows = [];
        for (let index = 0; index < cached.columns.openTime.length; index++) {
            const row = {};
            for (const key of Object.keys(cached.columns)) row[key] = cached.columns[key][index];
            oldRows.push(row);
        }
        assertActive(requestId);
        return { rows: [...oldRows, ...rows].slice(-context.requestedCandleCount), retries,
            pageCount: state.currentPage, mode: "INCREMENTAL" };
    }

    async function refreshCacheState(requestId = null) {
        const storeState = await window.HNDHistoricalDataStore.getState();
        if (requestId) assertActive(requestId);
        state.persistenceAvailable = storeState.persistenceAvailable;
        state.storageMode = storeState.storageMode;
        state.cachedDatasets = storeState.datasets || [];
    }

    function ready(requestId, dataset, status, reason) {
        assertActive(requestId);
        currentDataset = window.HNDCloneHistoricalDataset(dataset);
        state.status = status;
        state.phase = status;
        state.downloadedCandles = dataset.metadata.candleCount;
        state.validatedCandles = dataset.metadata.candleCount;
        state.progressPercent = 100;
        state.datasetMetadata = { ...dataset.metadata };
        state.completedAt = Date.now();
        debug(reason);
        render();
        return getState();
    }

    function load(options = {}) {
        if (activeRequest) return Promise.resolve(false);
        const requested = Number(options.candleCount ??
            document.getElementById("historicalDataCandleCount")?.value ?? DEFAULT_COUNT);
        if (!ALLOWED_COUNTS.includes(requested)) return Promise.resolve(false);

        state = createState();
        state.initialized = initialized;
        state.status = "PREFLIGHT";
        state.phase = "PREFLIGHT";
        state.startedAt = Date.now();
        state.activeRequestId = `HND-HIST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const requestId = state.activeRequestId;
        const market = getMarketContext() || {};
        const symbol = String(market.symbol || "").toUpperCase();
        const interval = String(market.interval || "").toLowerCase();
        if (!/^[A-Z0-9]+$/.test(symbol) || !INTERVALS[interval]) return Promise.resolve(false);
        Object.assign(state, { symbol, interval, intervalMs: INTERVALS[interval],
            requestedCandleCount: requested, estimatedPages: Math.ceil(requested / PAGE_LIMIT) });
        activeRequest = { id: requestId, controller: new AbortController(), resume: null, promise: null };

        const promise = (async () => {
            let cached = null;
            let context = { symbol, interval, intervalMs: INTERVALS[interval], requestedCandleCount: requested };
            try {
                debug("PREFLIGHT_PASSED");
                render();
                state.status = "CHECKING_CACHE";
                cached = await window.HNDHistoricalDataStore.getDataset(cacheKey(symbol, interval));
                assertActive(requestId);
                await refreshCacheState(requestId);
                assertActive(requestId);
                let serverResponse;
                try {
                    serverResponse = await window.HNDAPI.fetchBinanceServerTime({ timeoutMs: TIMEOUT_MS,
                        silent: true, signal: activeRequest.controller.signal });
                    assertActive(requestId);
                } catch (error) {
                    assertActive(requestId);
                    if (error.externallyAborted || error.name === "AbortError") throw error;
                    if (cacheValid(cached, context)) {
                        const sliced = sliceDataset(cached, Math.min(requested, cached.metadata.candleCount),
                            "STALE_CACHE", "CACHE_FALLBACK", {});
                        if (!sliced.validation.valid) throw new Error("Invalid stale historical cache");
                        return ready(requestId, sliced.dataset, "READY_STALE", "READY_STALE");
                    }
                    throw error;
                }
                context.serverTime = serverResponse.serverTime;
                context.latestClosedOpenTime = latestClosed(context.serverTime, context.intervalMs);
                debug("SERVER_TIME_LOADED");

                if (cacheValid(cached, context) && cached.metadata.lastOpenTime === context.latestClosedOpenTime &&
                    cached.metadata.candleCount >= requested) {
                    const sliced = sliceDataset(cached, requested, "CACHE", "CACHE_HIT", context);
                    if (!sliced.validation.valid) throw new Error("Invalid cache slice");
                    return ready(requestId, sliced.dataset, "READY", "CACHE_HIT");
                }

                state.status = "FETCHING";
                state.phase = "FETCHING";
                render();
                let result;
                if (cacheValid(cached, context) && cached.metadata.candleCount >= requested &&
                    cached.metadata.lastOpenTime < context.latestClosedOpenTime) {
                    try {
                        result = await incremental(context, cached, requestId);
                        assertActive(requestId);
                    } catch (error) {
                        assertActive(requestId);
                        if (error.externallyAborted || error.name === "AbortError") throw error;
                        debug("INCREMENTAL_FAILED", error);
                        state.currentPage = 0;
                        result = await backfill(context, requestId);
                    }
                } else {
                    result = await backfill(context, requestId);
                }
                assertActive(requestId);
                state.status = "VALIDATING";
                state.phase = "VALIDATING";
                let built = rowsToDataset(result.rows, context, { fetchMode: result.mode,
                    pageCount: result.pageCount, retryCount: result.retries });
                assertActive(requestId);
                if (!built.validation.valid && result.mode === "INCREMENTAL") {
                    state.currentPage = 0;
                    const full = await backfill(context, requestId);
                    assertActive(requestId);
                    built = rowsToDataset(full.rows, context, { fetchMode: "FULL_BACKFILL",
                        pageCount: full.pageCount, retryCount: full.retries });
                }
                if (!built.validation.valid) throw new Error(built.dataset.metadata.candleCount < MIN_VALID
                    ? "INSUFFICIENT_VALID_HISTORY" : "Historical dataset validation failed");
                assertActive(requestId);
                state.status = "CACHING";
                await window.HNDHistoricalDataStore.putDataset(built.dataset);
                assertActive(requestId);
                await refreshCacheState(requestId);
                assertActive(requestId);
                const partial = built.dataset.metadata.candleCount < requested;
                return ready(requestId, built.dataset, partial ? "READY_PARTIAL" : "READY",
                    partial ? "READY_PARTIAL" : "READY");
            } catch (error) {
                if (!isActiveRequest(requestId) || error.name === "StaleRequestError") return false;
                if (error.externallyAborted || error.name === "AbortError" || state.cancelRequested) {
                    state.status = "CANCELLED";
                    state.phase = "CANCELLED";
                    state.completedAt = Date.now();
                    debug("LOADER_CANCELLED", error);
                    render();
                    return getState();
                }
                state.status = "ERROR";
                state.phase = "ERROR";
                state.completedAt = Date.now();
                debug("LOADER_ERROR", error);
                render();
                return getState();
            } finally {
                if (isActiveRequest(requestId)) activeRequest = null;
            }
        })();
        activeRequest.promise = promise;
        return promise;
    }

    function pause() {
        if (!activeRequest || state.status !== "FETCHING") return false;
        state.paused = true;
        state.status = "PAUSED";
        debug("LOADER_PAUSED");
        render();
        return true;
    }

    function resume() {
        if (!activeRequest || !state.paused) return false;
        state.paused = false;
        state.status = "FETCHING";
        const resolver = activeRequest.resume;
        activeRequest.resume = null;
        resolver?.();
        debug("LOADER_RESUMED");
        render();
        return true;
    }

    function cancel() {
        if (!activeRequest) return false;
        state.cancelRequested = true;
        state.paused = false;
        activeRequest.resume?.();
        activeRequest.resume = null;
        activeRequest.controller.abort();
        return true;
    }

    function reset() {
        const request = activeRequest;
        activeRequest = null;
        if (request) {
            request.resume?.();
            request.controller.abort();
        }
        state = createState();
        state.initialized = initialized;
        currentDataset = null;
        render();
        return getState();
    }

    async function clearCurrentCache() {
        const market = getMarketContext() || {};
        await window.HNDHistoricalDataStore.deleteDataset(cacheKey(String(market.symbol || "").toUpperCase(),
            String(market.interval || "").toLowerCase()));
        currentDataset = null;
        state.datasetMetadata = null;
        await refreshCacheState();
        debug("CACHE_CLEARED");
        render();
        return true;
    }

    async function clearAllCache() {
        await window.HNDHistoricalDataStore.clearAll();
        currentDataset = null;
        await refreshCacheState();
        render();
        return true;
    }

    function getState() { return clone({ ...state, lastEvaluation }); }
    function getDataset() { return window.HNDCloneHistoricalDataset(currentDataset); }
    function getDatasetMetadata() { return currentDataset ? { ...currentDataset.metadata } : null; }
    function listCachedDatasets() { return window.HNDHistoricalDataStore.listDatasets(); }
    function getLastDebug() { return clone(lastEvaluation?.debug || null); }
    function explainLastEvaluation() { return clone(lastEvaluation); }

    function exportMetadataJSON() {
        if (!currentDataset) return false;
        try {
            const payload = { metadata: { ...currentDataset.metadata }, validation:
                validateHistoricalDataset(currentDataset, { intervalMs: currentDataset.metadata.intervalMs,
                    serverTime: currentDataset.metadata.serverTime,
                    latestClosedOpenTime: currentDataset.metadata.latestClosedOpenTime,
                    minimumCandles: MIN_VALID }), loader: { status: state.status, completedAt: state.completedAt } };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `HNDai-historical-${currentDataset.metadata.symbol}-${currentDataset.metadata.interval}.json`;
            anchor.hidden = true;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 0);
            return true;
        } catch (error) {
            debug("LOADER_ERROR", error);
            return false;
        }
    }

    function formatUtcTimestamp(value) {
        if (!Number.isFinite(value)) return "-";
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return "-";
        return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
    }

    function formatBytes(value) {
        return Number.isFinite(value) ? `${(value / 1048576).toFixed(2)} MB` : "-";
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value ?? "-");
    }

    function renderThrottled() {
        const now = Date.now();
        if (now - lastProgressAt >= 150) { lastProgressAt = now; render(); }
    }

    function render() {
        setText("historicalDataStatus", state.status);
        setText("historicalDataPhase", state.phase);
        setText("historicalDataMarket", state.symbol || getMarketContext()?.symbol || "-");
        setText("historicalDataInterval", state.interval || getMarketContext()?.interval || "-");
        setText("historicalDataDownloaded", `${state.downloadedCandles} / ${state.requestedCandleCount}`);
        setText("historicalDataPages", `${state.currentPage} / ${state.estimatedPages}`);
        const metadata = state.datasetMetadata;
        setText("historicalDataSource", metadata?.source || "-");
        setText("historicalDataFirstCandle", formatUtcTimestamp(metadata?.firstOpenTime));
        setText("historicalDataLastCandle", formatUtcTimestamp(metadata?.lastOpenTime));
        setText("historicalDataGapCount", metadata?.gapCount ?? "-");
        setText("historicalDataDuplicateCount", metadata?.duplicateCount ?? "-");
        setText("historicalDataClosedOnly", metadata ? String(metadata.closedOnly) : "-");
        setText("historicalDataChecksum", metadata?.checksum || "-");
        setText("historicalDataBytes", formatBytes(metadata?.estimatedBytes));
        setText("historicalDataPersistence", state.persistenceAvailable ? "IndexedDB" : "session cache");
        setText("historicalDataWarning", state.status === "READY_PARTIAL" ? "INSUFFICIENT_HISTORY" :
            state.status === "READY_STALE" ? "STALE CACHE — network unavailable" : "");
        const progress = document.getElementById("historicalDataProgress");
        if (progress) progress.value = state.progressPercent;
        const active = ["PREFLIGHT", "CHECKING_CACHE", "FETCHING", "PAUSED", "VALIDATING", "CACHING"].includes(state.status);
        for (const [id, disabled] of [["historicalDataStart", active],
            ["historicalDataPause", state.status !== "FETCHING"],
            ["historicalDataResume", state.status !== "PAUSED"], ["historicalDataCancel", !active],
            ["historicalDataExport", !["READY", "READY_PARTIAL", "READY_STALE"].includes(state.status)]]) {
            const element = document.getElementById(id);
            if (element) element.disabled = disabled;
        }
        const panel = document.querySelector(".historical-data-loader");
        if (panel) {
            for (const [key, value] of Object.entries({ status: state.status,
                candleCount: metadata?.candleCount, pageCount: metadata?.pageCount,
                retryCount: metadata?.retryCount, checksum: metadata?.checksum,
                firstOpenTime: metadata?.firstOpenTime, lastOpenTime: metadata?.lastOpenTime,
                source: metadata?.source, storageMode: state.storageMode })) panel.dataset[key] = value ?? "";
        }
    }

    function setupListeners() {
        if (listenersInitialized) return;
        const bind = (id, handler) => document.getElementById(id)?.addEventListener("click", handler);
        bind("historicalDataStart", () => load());
        bind("historicalDataPause", pause);
        bind("historicalDataResume", resume);
        bind("historicalDataCancel", cancel);
        bind("historicalDataClear", clearCurrentCache);
        bind("historicalDataExport", exportMetadataJSON);
        listenersInitialized = true;
    }

    async function init(options = {}) {
        if (initialized) return getState();
        if (typeof options.getMarketContext === "function") getMarketContext = options.getMarketContext;
        initialized = true;
        state.initialized = true;
        setupListeners();
        await window.HNDHistoricalDataStore.init();
        await refreshCacheState();
        debug("HISTORICAL_LOADER_INITIALIZED");
        render();
        return getState();
    }

    window.HNDHistoricalDataLoader = { init, load, pause, resume, cancel, reset, clearCurrentCache,
        clearAllCache, getState, getDataset, getDatasetMetadata, listCachedDatasets,
        exportMetadataJSON, getLastDebug, explainLastEvaluation };
    window.HNDHistoricalDataTest = { INTERVALS, latestClosed, validateHistoricalDataset,
        checksumDataset, rowsToDataset, sliceDataset, finalizeDerivedDatasetMetadata,
        cacheKey, isRetryableHistoricalRequestError, isActiveRequest, formatUtcTimestamp };
})();
