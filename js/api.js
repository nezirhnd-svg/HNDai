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
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = Date.now();
        try {
            const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
            if (!response.ok) throw new Error(`Public request failed: ${response.status}`);
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
            errors.push(error);
            if (!options.silent && error?.name !== "AbortError") {
                console.warn("Binance public data host was unavailable; trying the next host.");
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }

    const finalError = errors.at(-1) || new Error("Binance public data unavailable");
    lastBinancePublicRequestMeta = {
        host: null,
        fallbackHostUsed: HND_BINANCE_PUBLIC_BASE_URLS.length > 1,
        durationMs: null,
        errorName: String(finalError?.name || "Error"),
        errorMessage: String(finalError?.message || "Public data unavailable").slice(0, 300)
    };
    const error = new Error("Binance public market data is unavailable");
    error.name = finalError?.name === "AbortError" ? "AbortError" : "PublicMarketDataError";
    throw error;
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
    getLastPublicRequestMeta
};
