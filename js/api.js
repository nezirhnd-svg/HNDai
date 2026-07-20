// ==========================
// HNDai API Engine
// ==========================

let candles = [];
let currentPrice = 0;

const HND_BINANCE_PUBLIC_BASE_URLS = Object.freeze([
    "https://data-api.binance.vision",
    "https://api.binance.com"
]);
const HND_BINANCE_PUBLIC_DEFAULT_TIMEOUT_MS = 12000;
let lastBinancePublicRequestMeta = null;

async function fetchBinancePublicJSON(path, options = {}) {
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
        ? Math.max(1, Math.trunc(Number(options.timeoutMs)))
        : HND_BINANCE_PUBLIC_DEFAULT_TIMEOUT_MS;
    const errors = [];

    for (let index = 0; index < HND_BINANCE_PUBLIC_BASE_URLS.length; index++) {
        const baseUrl = HND_BINANCE_PUBLIC_BASE_URLS[index];
        const controller = new AbortController();
        let timedOut = false;
        const abortFromExternal = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted) {
            const error = new Error("Request cancelled");
            error.name = "AbortError";
            error.externallyAborted = true;
            error.timeout = false;
            error.fallbackHostUsed = false;
            throw error;
        }
        options.signal?.addEventListener("abort", abortFromExternal, { once: true });
        const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        const startedAt = Date.now();
        try {
            const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
            if (!response.ok) {
                const httpError = new Error(`Public request failed: ${response.status}`);
                httpError.status = response.status;
                httpError.host = baseUrl;
                const retryAfterValue = response.headers?.get?.("retry-after");
                const retryAfterSeconds = Number(retryAfterValue);
                const retryAfterDate = Date.parse(retryAfterValue || "");
                httpError.retryAfterMs = Number.isFinite(retryAfterSeconds)
                    ? Math.max(0, retryAfterSeconds * 1000)
                    : Number.isFinite(retryAfterDate) ? Math.max(0, retryAfterDate - Date.now()) : 0;
                httpError.timeout = false;
                httpError.externallyAborted = false;
                httpError.fallbackHostUsed = index > 0;
                throw httpError;
            }
            const data = await response.json();
            lastBinancePublicRequestMeta = {
                host: baseUrl,
                fallbackHostUsed: index > 0,
                durationMs: Date.now() - startedAt,
                errorName: null,
                errorMessage: null
            };
            return data;
        } catch (error) {
            const externallyAborted = options.signal?.aborted === true;
            const normalizedError = timedOut
                ? Object.assign(new Error(`Public request timed out after ${timeoutMs} ms`), {
                    name: "TimeoutError", timeout: true, externallyAborted: false
                })
                : error;
            normalizedError.timeout = timedOut === true;
            normalizedError.externallyAborted = externallyAborted;
            normalizedError.host = normalizedError.host || baseUrl;
            normalizedError.fallbackHostUsed = index > 0;
            normalizedError.retryAfterMs = Number(normalizedError.retryAfterMs) || 0;
            errors.push(normalizedError);
            if (externallyAborted) {
                normalizedError.name = "AbortError";
                normalizedError.timeout = false;
                throw normalizedError;
            }
            if (!options.silent && normalizedError?.name !== "AbortError") {
                console.warn("Binance public data host was unavailable; trying the next host.");
            }
        } finally {
            clearTimeout(timeoutId);
            options.signal?.removeEventListener("abort", abortFromExternal);
        }
    }

    const finalError = errors.at(-1) || new Error("Binance public data unavailable");
    lastBinancePublicRequestMeta = {
        host: finalError.host || null,
        fallbackHostUsed: finalError.fallbackHostUsed === true,
        durationMs: null,
        errorName: String(finalError?.name || "Error"),
        errorMessage: String(finalError?.message || "Public data unavailable").slice(0, 300)
    };
    const error = new Error(String(finalError?.message || "Binance public market data is unavailable").slice(0, 300));
    error.name = finalError?.externallyAborted
        ? "AbortError"
        : finalError?.timeout ? "TimeoutError" : "PublicMarketDataError";
    error.status = Number.isInteger(finalError?.status) ? finalError.status : null;
    error.retryAfterMs = Number(finalError?.retryAfterMs) || 0;
    error.host = finalError?.host || null;
    error.timeout = finalError?.timeout === true;
    error.externallyAborted = finalError?.externallyAborted === true;
    error.fallbackHostUsed = finalError?.fallbackHostUsed === true;
    throw error;
}

async function fetchBinanceServerTime(options = {}) {
    const response = await fetchBinancePublicJSON("/api/v3/time", options);
    const serverTime = Number(response?.serverTime);
    if (!response || typeof response !== "object" || !Number.isInteger(serverTime) || serverTime <= 0) {
        throw new TypeError("Invalid server time response");
    }
    return { serverTime };
}

async function fetchHistoricalKlinesPage(params, options = {}) {
    const symbol = String(params?.symbol || "").trim().toUpperCase();
    const interval = String(params?.interval || "").trim();
    const supported = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);
    const limit = Number(params?.limit);
    const startTime = params?.startTime === undefined ? null : Number(params.startTime);
    const endTime = params?.endTime === undefined ? null : Number(params.endTime);
    if (!/^[A-Z0-9]+$/.test(symbol) || !supported.has(interval) ||
        !Number.isInteger(limit) || limit < 1 || limit > 1000 ||
        (startTime !== null && (!Number.isInteger(startTime) || startTime <= 0)) ||
        (endTime !== null && (!Number.isInteger(endTime) || endTime <= 0)) ||
        (startTime !== null && endTime !== null && startTime > endTime)) {
        throw new TypeError("Invalid historical kline parameters");
    }
    const query = new URLSearchParams({ symbol, interval, limit: String(limit) });
    if (startTime !== null) query.set("startTime", String(startTime));
    if (endTime !== null) query.set("endTime", String(endTime));
    const response = await fetchBinancePublicJSON(`/api/v3/klines?${query}`, options);
    if (!Array.isArray(response)) throw new TypeError("Invalid historical kline response");
    return response.map(row => {
        if (!Array.isArray(row) || row.length < 7) throw new TypeError("Invalid historical kline row");
        const candle = { openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
            low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), closeTime: Number(row[6]) };
        if (!Number.isInteger(candle.openTime) || candle.openTime <= 0 ||
            !Number.isInteger(candle.closeTime) || candle.closeTime < candle.openTime ||
            ![candle.open,candle.high,candle.low,candle.close,candle.volume].every(Number.isFinite) ||
            candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
            candle.volume < 0 || candle.high < Math.max(candle.open,candle.close) ||
            candle.low > Math.min(candle.open,candle.close)) throw new TypeError("Invalid historical kline row");
        return candle;
    });
}

async function fetchSpotExchangeInfo(options = {}) {
    const response = await fetchBinancePublicJSON("/api/v3/exchangeInfo", options);
    if (!response || typeof response !== "object" || !Array.isArray(response.symbols)) {
        throw new TypeError("Invalid exchange info response");
    }
    return response.symbols.filter(row => row &&
        typeof row.symbol === "string" && typeof row.baseAsset === "string" &&
        typeof row.quoteAsset === "string" && typeof row.status === "string"
    ).map(row => ({
        symbol: row.symbol,
        baseAsset: row.baseAsset,
        quoteAsset: row.quoteAsset,
        status: row.status,
        isSpotTradingAllowed: row.isSpotTradingAllowed === true
            ? true : row.isSpotTradingAllowed === false ? false : null,
        permissions: Array.isArray(row.permissions)
            ? row.permissions.filter(value => typeof value === "string") : [],
        permissionSets: Array.isArray(row.permissionSets)
            ? row.permissionSets.map(set => Array.isArray(set)
                ? set.filter(value => typeof value === "string") : []) : []
    }));
}

async function fetchSpot24hrTickers(options = {}) {
    const response = await fetchBinancePublicJSON("/api/v3/ticker/24hr", options);
    if (!Array.isArray(response)) throw new TypeError("Invalid ticker response");
    return response.map(row => ({
        symbol: typeof row?.symbol === "string" ? row.symbol : "",
        quoteVolume: Number(row?.quoteVolume),
        lastPrice: Number(row?.lastPrice),
        priceChangePercent: row?.priceChangePercent === undefined
            ? null : Number(row.priceChangePercent)
    })).filter(row => /^[A-Z0-9]+$/.test(row.symbol) &&
        Number.isFinite(row.quoteVolume) && row.quoteVolume >= 0 &&
        Number.isFinite(row.lastPrice) && row.lastPrice > 0 &&
        (row.priceChangePercent === null || Number.isFinite(row.priceChangePercent))
    );
}

function getLastPublicRequestMeta() {
    return lastBinancePublicRequestMeta ? { ...lastBinancePublicRequestMeta } : null;
}

async function fetchCandlesSnapshot(symbol, interval, limit = 500, options = {}) {
    const safeLimit = Math.min(1000, Math.max(1,
        Number.isFinite(Number(limit)) ? Math.trunc(Number(limit)) : 500
    ));
    const requestOptions = options.signal ? { signal: options.signal } : {};

    try {
        const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}` +
            `&interval=${encodeURIComponent(interval)}&limit=${safeLimit}`,
            requestOptions
        );

        if (!res.ok) {
            throw new Error(`Candles request failed: ${res.status}`);
        }

        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error("Invalid candles response: expected a non-empty array");
        }
        if (!data.every(c => Array.isArray(c) && c.length >= 7)) {
            throw new Error("Invalid candles response: missing candle fields");
        }

        const parsedCandles = data.map(c => ({
            time: Number(c[0]),
            open: Number(c[1]),
            high: Number(c[2]),
            low: Number(c[3]),
            close: Number(c[4]),
            volume: Number(c[5]),
            closeTime: Number(c[6])
        }));
        const candlesAreValid = parsedCandles.every(c =>
            Number.isFinite(c.time) && Number.isFinite(c.open) &&
            Number.isFinite(c.high) && Number.isFinite(c.low) &&
            Number.isFinite(c.close) && Number.isFinite(c.volume) &&
            Number.isFinite(c.closeTime)
        );
        if (!candlesAreValid) {
            throw new Error("Invalid candles response: non-finite numeric value");
        }

        return parsedCandles;
    } catch (err) {
        if (err?.name !== "AbortError" && !options.silent) {
            console.error("Candles Snapshot Error: candle data rejected.", err);
        }
        return null;
    }
}

// Binance mum verisi
async function fetchCandles(symbol, interval) {
    const parsedCandles = await fetchCandlesSnapshot(symbol, interval, 500, { silent: true });
    if (!Array.isArray(parsedCandles)) {
        candles = [];
        console.error(
            "Candles Error: candle data rejected; engine cycle stopped.",
            new Error("Invalid candles response")
        );
        return null;
    }
    candles = parsedCandles;
    return candles;
}

// Canlı fiyat
async function fetchPrice(symbol) {
    try {

        const res = await fetch(
            `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
        );

        if (!res.ok) {
            throw new Error(`Price request failed: ${res.status}`);
        }

        const data = await res.json();
        const price = Number(data.price);

        if (!Number.isFinite(price) || price <= 0) {
            throw new Error("Invalid price data");
        }

        currentPrice = price;

        return currentPrice;

    } catch (err) {
        console.error("Price Error:", err);
        return null;
    }
}
// Close fiyatlarını döndür
function getClosePrices() {
    return candles.map(candle => candle.close);
}

// High fiyatlarını döndür
function getHighPrices() {
    return candles.map(candle => candle.high);
}

// Low fiyatlarını döndür
function getLowPrices() {
    return candles.map(candle => candle.low);
}

// Volume verilerini döndür
function getVolumes() {
    return candles.map(candle => candle.volume);
}

window.HNDAPI = {
    ...(window.HNDAPI || {}),
    fetchCandlesSnapshot,
    fetchSpotExchangeInfo,
    fetchSpot24hrTickers,
    getLastPublicRequestMeta,
    fetchBinanceServerTime,
    fetchHistoricalKlinesPage
};
