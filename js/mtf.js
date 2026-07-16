(function () {
    "use strict";

    const HND_MTF_TIMEFRAMES = Object.freeze([
        { key: "5m", label: "5m", interval: "5m" },
        { key: "15m", label: "15m", interval: "15m" },
        { key: "1h", label: "1H", interval: "1h" },
        { key: "4h", label: "4H", interval: "4h" }
    ]);
    const HND_MTF_CANDLE_LIMIT = 300;
    const HND_MTF_REFRESH_MS = 30000;
    const HND_MTF_SWING_LOOKBACK = 3;
    const HND_MTF_ATR_PERIOD = 14;
    const HND_MTF_POCKET_ATR_TOLERANCE = 0.15;
    const MTF_VALUE_CLASSES = [
        "mtf-trend-bull", "mtf-trend-bear", "mtf-trend-neutral",
        "mtf-pocket-in", "mtf-pocket-out", "mtf-loading", "mtf-error"
    ];

    let mtfInitialized = false;
    let mtfSymbol = null;
    let mtfRefreshTimer = null;
    let mtfAbortController = null;
    let mtfRequestGeneration = 0;
    let mtfRefreshRunning = false;
    let mtfRefreshPromise = null;
    let mtfLastUpdatedAt = null;
    let mtfRows = new Map();
    let mtfErrors = new Map();
    let mtfVisibilityHandler = null;

    function normalizeMTFCandles(source) {
        if (!Array.isArray(source)) return [];
        const byTime = new Map();
        source.forEach(candle => {
            if (!candle) return;
            const normalized = {
                time: Number(candle.time), open: Number(candle.open),
                high: Number(candle.high), low: Number(candle.low),
                close: Number(candle.close), volume: Number(candle.volume),
                closeTime: Number.isFinite(Number(candle.closeTime))
                    ? Number(candle.closeTime) : null
            };
            if (
                !Number.isFinite(normalized.time) || normalized.time <= 0 ||
                !Number.isFinite(normalized.open) || normalized.open <= 0 ||
                !Number.isFinite(normalized.high) || normalized.high <= 0 ||
                !Number.isFinite(normalized.low) || normalized.low <= 0 ||
                !Number.isFinite(normalized.close) || normalized.close <= 0 ||
                !Number.isFinite(normalized.volume) ||
                normalized.high < normalized.open || normalized.high < normalized.close ||
                normalized.high < normalized.low || normalized.low > normalized.open ||
                normalized.low > normalized.close
            ) return;
            byTime.set(normalized.time, normalized);
        });
        return [...byTime.values()].sort((a, b) => a.time - b.time);
    }

    function calculateMTFEMAValues(values, period) {
        if (!Array.isArray(values) || values.length < period) return [];
        const result = new Array(values.length).fill(null);
        let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
        result[period - 1] = ema;
        const multiplier = 2 / (period + 1);
        for (let index = period; index < values.length; index++) {
            ema = (values[index] - ema) * multiplier + ema;
            result[index] = ema;
        }
        return result;
    }

    function getLastMTFEMA(values, period) {
        const emaValues = calculateMTFEMAValues(values, period);
        return emaValues.length ? emaValues[emaValues.length - 1] : null;
    }

    function detectMTFStructure(source, lookback) {
        const swingHighs = [];
        const swingLows = [];
        for (let index = lookback; index < source.length - lookback; index++) {
            let isHigh = true;
            let isLow = true;
            for (let offset = 1; offset <= lookback; offset++) {
                if (source[index].high <= source[index - offset].high ||
                    source[index].high <= source[index + offset].high) isHigh = false;
                if (source[index].low >= source[index - offset].low ||
                    source[index].low >= source[index + offset].low) isLow = false;
            }
            if (isHigh) swingHighs.push(source[index].high);
            if (isLow) swingLows.push(source[index].low);
        }
        if (swingHighs.length < 2 || swingLows.length < 2) return "NEUTRAL";
        const previousHigh = swingHighs[swingHighs.length - 2];
        const latestHigh = swingHighs[swingHighs.length - 1];
        const previousLow = swingLows[swingLows.length - 2];
        const latestLow = swingLows[swingLows.length - 1];
        if (latestHigh > previousHigh && latestLow > previousLow) return "BULLISH";
        if (latestHigh < previousHigh && latestLow < previousLow) return "BEARISH";
        return "NEUTRAL";
    }

    function calculateMTFATR(source, period) {
        if (!Array.isArray(source) || source.length < period + 1) return null;
        const ranges = [];
        for (let index = 1; index < source.length; index++) {
            const candle = source[index];
            const previousClose = source[index - 1].close;
            ranges.push(Math.max(
                candle.high - candle.low,
                Math.abs(candle.high - previousClose),
                Math.abs(candle.low - previousClose)
            ));
        }
        const recent = ranges.slice(-period);
        return recent.reduce((sum, value) => sum + value, 0) / recent.length;
    }

    function noDataResult(timeframe) {
        return {
            timeframe, trend: "NEUTRAL", pocket: "OUT", status: "NO_DATA",
            bullVotes: 0, bearVotes: 0, structure: "NEUTRAL",
            ema20: null, ema50: null, ema200: null, atr: null,
            pocketLow: null, pocketHigh: null, lastClosedTime: null,
            latestCandleTime: null
        };
    }

    function analyzeCandles(source, timeframe) {
        const normalized = normalizeMTFCandles(source);
        if (!normalized.length) return noDataResult(timeframe);
        const now = Date.now();
        const closedCandles = normalized.filter((candle, index) =>
            candle.closeTime !== null ? candle.closeTime <= now : index < normalized.length - 1
        );
        if (closedCandles.length < 220) return noDataResult(timeframe);

        const closes = closedCandles.map(candle => candle.close);
        const ema20Values = calculateMTFEMAValues(closes, 20);
        const ema20 = ema20Values[ema20Values.length - 1];
        const previousEMA20 = ema20Values[ema20Values.length - 2];
        const ema50 = getLastMTFEMA(closes, 50);
        const ema200 = getLastMTFEMA(closes, 200);
        const atr = calculateMTFATR(closedCandles, HND_MTF_ATR_PERIOD);
        const structure = detectMTFStructure(closedCandles, HND_MTF_SWING_LOOKBACK);
        const lastClosed = closedCandles[closedCandles.length - 1];
        let bullVotes = 0;
        let bearVotes = 0;
        if (ema20 > ema50) bullVotes++; else if (ema20 < ema50) bearVotes++;
        if (ema50 > ema200) bullVotes++; else if (ema50 < ema200) bearVotes++;
        if (structure === "BULLISH") bullVotes++; else if (structure === "BEARISH") bearVotes++;
        if (lastClosed.close > ema20 && ema20 > previousEMA20) bullVotes++;
        else if (lastClosed.close < ema20 && ema20 < previousEMA20) bearVotes++;
        let trend = "NEUTRAL";
        if (bullVotes >= 3 && bullVotes > bearVotes) trend = "BULL";
        else if (bearVotes >= 3 && bearVotes > bullVotes) trend = "BEAR";

        const baseLow = Math.min(ema20, ema50);
        const baseHigh = Math.max(ema20, ema50);
        const pocketLow = baseLow - atr * HND_MTF_POCKET_ATR_TOLERANCE;
        const pocketHigh = baseHigh + atr * HND_MTF_POCKET_ATR_TOLERANCE;
        const latest = normalized[normalized.length - 1];
        const pocket = trend !== "NEUTRAL" && latest.high >= pocketLow && latest.low <= pocketHigh
            ? "IN" : "OUT";
        return {
            timeframe, trend, pocket, status: "OK", bullVotes, bearVotes,
            structure, ema20, ema50, ema200, atr, pocketLow, pocketHigh,
            lastClosedTime: lastClosed.time, latestCandleTime: latest.time
        };
    }

    function clearValueClasses(element) {
        if (element) element.classList.remove(...MTF_VALUE_CLASSES);
    }

    function renderMTFMatrix(rows = mtfRows) {
        if (typeof document === "undefined") return;
        HND_MTF_TIMEFRAMES.forEach(timeframe => {
            const trendCell = document.querySelector(`[data-mtf-trend="${timeframe.key}"]`);
            const pocketCell = document.querySelector(`[data-mtf-pocket="${timeframe.key}"]`);
            if (!trendCell || !pocketCell) return;
            clearValueClasses(trendCell);
            clearValueClasses(pocketCell);
            const row = rows.get(timeframe.key);
            if (!row) {
                trendCell.textContent = "—";
                pocketCell.textContent = "—";
                trendCell.classList.add(mtfLoadingState() ? "mtf-loading" : "mtf-error");
                pocketCell.classList.add(mtfLoadingState() ? "mtf-loading" : "mtf-error");
                return;
            }
            trendCell.textContent = row.trend;
            pocketCell.textContent = row.pocket;
            trendCell.classList.add(`mtf-trend-${row.trend.toLowerCase()}`);
            pocketCell.classList.add(`mtf-pocket-${row.pocket.toLowerCase()}`);
            trendCell.title = `EMA20 ${formatDebug(row.ema20)} | EMA50 ${formatDebug(row.ema50)} | ` +
                `EMA200 ${formatDebug(row.ema200)} | ${row.structure} | ${row.bullVotes}/${row.bearVotes}`;
        });
    }

    function mtfLoadingState() {
        return mtfRefreshRunning && mtfRows.size === 0;
    }

    function formatDebug(value) {
        return Number.isFinite(value) ? Number(value).toFixed(4) : "—";
    }

    function setLoadingRows() {
        mtfRows = new Map();
        mtfErrors = new Map();
        renderMTFMatrix();
    }

    async function refresh(options = {}) {
        const force = Boolean(options.force);
        if (!mtfSymbol) return false;
        if (mtfRefreshRunning && !force) return mtfRefreshPromise;
        if (mtfRefreshRunning && force) {
            mtfAbortController?.abort();
        }
        const fetchSnapshot = window.HNDAPI?.fetchCandlesSnapshot;
        if (typeof fetchSnapshot !== "function") return false;

        const symbol = mtfSymbol;
        const generation = ++mtfRequestGeneration;
        const controller = new AbortController();
        mtfAbortController = controller;
        mtfRefreshRunning = true;
        renderMTFMatrix();
        const requests = HND_MTF_TIMEFRAMES.map(timeframe =>
            fetchSnapshot(symbol, timeframe.interval, HND_MTF_CANDLE_LIMIT, {
                signal: controller.signal,
                silent: true
            }).then(candleData => {
                if (!Array.isArray(candleData)) throw new Error("Candle snapshot unavailable");
                return { timeframe, result: analyzeCandles(candleData, timeframe.key) };
            })
        );

        mtfRefreshPromise = Promise.allSettled(requests).then(settled => {
            if (generation !== mtfRequestGeneration || symbol !== mtfSymbol) return false;
            let successfulRows = 0;
            settled.forEach((item, index) => {
                const timeframe = HND_MTF_TIMEFRAMES[index];
                if (item.status === "fulfilled") {
                    mtfRows.set(timeframe.key, item.value.result);
                    mtfErrors.delete(timeframe.key);
                    successfulRows++;
                } else if (item.reason?.name !== "AbortError") {
                    mtfErrors.set(timeframe.key, String(item.reason?.message || item.reason));
                }
            });
            if (successfulRows) mtfLastUpdatedAt = Date.now();
            renderMTFMatrix();
            return successfulRows > 0;
        }).finally(() => {
            if (generation === mtfRequestGeneration) {
                mtfRefreshRunning = false;
                mtfAbortController = null;
                mtfRefreshPromise = null;
                renderMTFMatrix();
            }
        });
        return mtfRefreshPromise;
    }

    function setSymbol(symbol) {
        const normalized = String(symbol || "").trim().toUpperCase();
        if (!/^[A-Z0-9]+$/.test(normalized)) return false;
        if (normalized === mtfSymbol) return refresh();
        mtfAbortController?.abort();
        mtfRequestGeneration++;
        mtfRefreshRunning = false;
        mtfRefreshPromise = null;
        mtfSymbol = normalized;
        mtfLastUpdatedAt = null;
        setLoadingRows();
        return refresh({ force: true });
    }

    function handleVisibilityChange() {
        if (document.visibilityState === "visible" &&
            (!mtfLastUpdatedAt || Date.now() - mtfLastUpdatedAt > HND_MTF_REFRESH_MS)) {
            refresh();
        }
    }

    function init(symbol) {
        if (!mtfInitialized) {
            mtfInitialized = true;
            mtfRefreshTimer = setInterval(() => refresh(), HND_MTF_REFRESH_MS);
            mtfVisibilityHandler = handleVisibilityChange;
            document.addEventListener("visibilitychange", mtfVisibilityHandler);
        }
        return setSymbol(symbol || mtfSymbol);
    }

    function destroy() {
        mtfAbortController?.abort();
        mtfRequestGeneration++;
        if (mtfRefreshTimer !== null) clearInterval(mtfRefreshTimer);
        if (mtfVisibilityHandler && typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", mtfVisibilityHandler);
        }
        mtfRefreshTimer = null;
        mtfVisibilityHandler = null;
        mtfRefreshRunning = false;
        mtfRefreshPromise = null;
        mtfInitialized = false;
    }

    function getState() {
        return {
            initialized: mtfInitialized,
            symbol: mtfSymbol,
            refreshRunning: mtfRefreshRunning,
            lastUpdatedAt: mtfLastUpdatedAt,
            refreshIntervalMs: HND_MTF_REFRESH_MS,
            rows: Object.fromEntries([...mtfRows].map(([key, value]) => [key, { ...value }])),
            errors: Object.fromEntries(mtfErrors)
        };
    }

    window.HNDMTFEngine = {
        init,
        refresh,
        setSymbol,
        destroy,
        getState,
        analyzeCandles
    };
})();
