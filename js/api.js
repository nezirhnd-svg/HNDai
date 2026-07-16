// ==========================
// HNDai API Engine
// ==========================

let candles = [];
let currentPrice = 0;

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
    fetchCandlesSnapshot
};
