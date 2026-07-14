// ==========================
// HNDai API Engine
// ==========================

let candles = [];
let currentPrice = 0;

// Binance mum verisi
async function fetchCandles(symbol, interval) {
    try {
        const res = await fetch(
            `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`
        );

        if (!res.ok) {
            throw new Error(`Candles request failed: ${res.status}`);
        }

        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) {
            throw new Error("Invalid candles response: expected a non-empty array");
        }

        if (!data.every(c => Array.isArray(c) && c.length >= 6)) {
            throw new Error("Invalid candles response: missing candle fields");
        }

        const parsedCandles = data.map(c => ({
            time: Number(c[0]),
            open: Number(c[1]),
            high: Number(c[2]),
            low: Number(c[3]),
            close: Number(c[4]),
            volume: Number(c[5])
        }));

        const candlesAreValid = parsedCandles.every(c =>
            Number.isFinite(c.time) &&
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close) &&
            Number.isFinite(c.volume)
        );

        if (!candlesAreValid) {
            throw new Error("Invalid candles response: non-finite numeric value");
        }

        candles = parsedCandles;

        return candles;

    } catch (err) {
        candles = [];
        console.error("Candles Error: candle data rejected; engine cycle stopped.", err);
        return null;
    }
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
