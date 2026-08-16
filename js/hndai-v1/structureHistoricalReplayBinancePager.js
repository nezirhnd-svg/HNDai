(function (root, factory) {
    "use strict";
    var api = factory(root && root.HNDAPI);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalReplayBinancePager = api;
}(typeof window !== "undefined" ? window : null, function (binanceApi) {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_REPLAY_BINANCE_PAGER_V1";
    var MAX_RATE_LIMIT_RETRIES = 2;
    function getSchemaVersion() { return SCHEMA; }
    function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
    function valid(options) { return options && typeof options === "object" && !Array.isArray(options) &&
        Object.keys(options).sort().join("|") === ["candleCount", "evaluationCutoffTime", "interval", "pageSize", "requestDelayMs", "symbol"].sort().join("|") &&
        ["BTCUSDT", "ETHUSDT", "SOLUSDT"].includes(options.symbol) && ["15m", "4h"].includes(options.interval) &&
        Number.isSafeInteger(options.candleCount) && options.candleCount >= 251 && options.candleCount <= 10000 &&
        Number.isSafeInteger(options.evaluationCutoffTime) && options.evaluationCutoffTime > 0 &&
        Number.isSafeInteger(options.pageSize) && options.pageSize >= 1 && options.pageSize <= 1000 &&
        Number.isSafeInteger(options.requestDelayMs) && options.requestDelayMs >= 100 && options.requestDelayMs <= 2000; }
    function validCandle(candle) {
        if (!candle || typeof candle !== "object" || Array.isArray(candle) ||
            Object.keys(candle).sort().join("|") !== ["openTime", "closeTime", "open", "high", "low", "close", "volume"].sort().join("|")) return false;
        return Number.isSafeInteger(candle.openTime) && candle.openTime > 0 &&
            Number.isSafeInteger(candle.closeTime) && candle.closeTime > candle.openTime &&
            [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) &&
            candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 && candle.volume >= 0 &&
            candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close) &&
            candle.high >= candle.low;
    }
    async function fetchClosedCandles(options) {
        if (!valid(options)) return { valid: false, error: "INVALID_PAGER_OPTIONS", schemaVersion: SCHEMA,
            candles: [], pageCount: 0, duplicateCount: 0 };
        if (!binanceApi || typeof binanceApi.fetchHistoricalKlinesPage !== "function")
            return { valid: false, error: "BINANCE_DEPENDENCY_UNAVAILABLE", schemaVersion: SCHEMA,
                candles: [], pageCount: 0, duplicateCount: 0 };
        var byCloseTime = new Map(), endTime = options.evaluationCutoffTime, pages = 0, duplicates = 0;
        var maximumPages = Math.ceil(options.candleCount / options.pageSize) + 2, rateLimitRetries = 0;
        try {
            while (byCloseTime.size < options.candleCount && pages < maximumPages) {
                var requestedEndTime = endTime, page;
                try {
                    page = await binanceApi.fetchHistoricalKlinesPage({ symbol: options.symbol,
                        interval: options.interval, limit: Math.min(options.pageSize, options.candleCount - byCloseTime.size),
                        endTime: requestedEndTime }, { timeoutMs: 12000, silent: true });
                } catch (error) {
                    if (error && error.status === 429 && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
                        rateLimitRetries += 1;
                        await sleep(Math.max(options.requestDelayMs,
                            Math.min(2000, Number.isFinite(error.retryAfterMs) ? Math.trunc(error.retryAfterMs) : 1000)));
                        continue;
                    }
                    throw error;
                }
                pages += 1;
                if (!Array.isArray(page) || !page.length) break;
                if (!page.every(validCandle)) throw new Error("MALFORMED_BINANCE_CANDLE");
                var uniqueBefore = byCloseTime.size;
                page.forEach(function (candle) {
                    if (candle.closeTime <= options.evaluationCutoffTime) {
                        if (byCloseTime.has(candle.closeTime)) duplicates += 1;
                        byCloseTime.set(candle.closeTime, JSON.parse(JSON.stringify(candle)));
                    }
                });
                if (byCloseTime.size === uniqueBefore) break;
                var oldest = Math.min.apply(null, page.map(function (candle) { return candle.openTime; }));
                if (!Number.isSafeInteger(oldest) || oldest <= 1 || page.length < Math.min(options.pageSize, options.candleCount)) break;
                var nextEndTime = oldest - 1;
                if (!Number.isSafeInteger(nextEndTime) || nextEndTime >= requestedEndTime) break;
                endTime = nextEndTime;
                if (byCloseTime.size < options.candleCount) await sleep(options.requestDelayMs);
            }
        } catch (error) {
            return { valid: false, error: "BINANCE_PAGINATION_FAILED", schemaVersion: SCHEMA,
                candles: [], pageCount: pages, duplicateCount: duplicates };
        }
        var candles = Array.from(byCloseTime.values()).sort(function (a, b) { return a.closeTime - b.closeTime; });
        if (candles.length > options.candleCount) candles = candles.slice(-options.candleCount);
        return { valid: true, error: null, schemaVersion: SCHEMA, candles: candles,
            pageCount: pages, duplicateCount: duplicates, maximumPages: maximumPages,
            rateLimitRetryCount: rateLimitRetries };
    }
    return { getSchemaVersion: getSchemaVersion, fetchClosedCandles: fetchClosedCandles };
}));
