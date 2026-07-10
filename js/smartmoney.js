// ==========================
// HNDai Smart Money Engine v3
// ==========================

console.log("HNDai SmartMoney v3 Loaded");
// Swing Tespiti
function getSwings(lookback = 3) {

    const highs = [];
    const lows = [];

    if (!candles || candles.length < lookback * 2 + 1) {
        return { highs, lows };
    }

    for (let i = lookback; i < candles.length - lookback; i++) {

        let swingHigh = true;
        let swingLow = true;

        for (let j = 1; j <= lookback; j++) {

            if (
                candles[i].high <= candles[i - j].high ||
                candles[i].high <= candles[i + j].high
            ) {
                swingHigh = false;
            }

            if (
                candles[i].low >= candles[i - j].low ||
                candles[i].low >= candles[i + j].low
            ) {
                swingLow = false;
            }

        }

        if (swingHigh) {
            highs.push({
                index: i,
                price: candles[i].high
            });
        }

        if (swingLow) {
            lows.push({
                index: i,
                price: candles[i].low
            });
        }

    }

    return { highs, lows };

}

// Son Swingler
function getLastSwings() {

    const { highs, lows } = getSwings();

    return {

        highs,
        lows,

        lastHigh: highs.length ? highs[highs.length - 1] : null,
        prevHigh: highs.length > 1 ? highs[highs.length - 2] : null,

        lastLow: lows.length ? lows[lows.length - 1] : null,
        prevLow: lows.length > 1 ? lows[lows.length - 2] : null

    };

}

// Market Structure
function detectMarketStructure() {

    const swings = getLastSwings();

    if (
        !swings.lastHigh ||
        !swings.prevHigh ||
        !swings.lastLow ||
        !swings.prevLow
    ) {

        return {

            trend: "UNKNOWN",

            HH: false,
            HL: false,
            LH: false,
            LL: false,

            ...swings

        };

    }

    const HH = swings.lastHigh.price > swings.prevHigh.price;
    const HL = swings.lastLow.price > swings.prevLow.price;

    const LH = swings.lastHigh.price < swings.prevHigh.price;
    const LL = swings.lastLow.price < swings.prevLow.price;

    let trend = "RANGE";

    if (HH && HL) trend = "BULLISH";

    if (LH && LL) trend = "BEARISH";

    return {

        trend,

        HH,
        HL,

        LH,
        LL,

        ...swings

    };

}

// Trend
function detectTrend() {

    const structure = detectMarketStructure();

    return {

        trend: structure.trend,

        bullish: structure.trend === "BULLISH",

        bearish: structure.trend === "BEARISH",

        ranging: structure.trend === "RANGE"

    };

}
// ==========================
// BOS Engine v3
// ==========================

function detectBOS() {

    const structure = detectMarketStructure();

    if (
        !structure.lastHigh ||
        !structure.lastLow ||
        candles.length === 0
    ) {
        return "NO DATA";
    }

    const lastClose = candles[candles.length - 1].close;

    if (lastClose > structure.lastHigh.price) {
        return "BULLISH BOS";
    }

    if (lastClose < structure.lastLow.price) {
        return "BEARISH BOS";
    }

    return "NO BOS";

}
// ==========================
// BOS Engine v3
// ==========================

function detectBOS() {

    const structure = detectMarketStructure();

    if (
        !structure.lastHigh ||
        !structure.lastLow ||
        !candles ||
        candles.length === 0
    ) {
        return "NO DATA";
    }

    const lastClose = candles[candles.length - 1].close;

    if (lastClose > structure.lastHigh.price) {
        return "BULLISH BOS";
    }

    if (lastClose < structure.lastLow.price) {
        return "BEARISH BOS";
    }

    return "NO BOS";

}
// ==========================
// CHoCH Engine
// ==========================

function detectCHoCH() {
    // ==========================
// Order Block Engine v1
// ==========================

function detectOrderBlock() {

    if (!candles || candles.length < 10) {
        return null;
    }

    // Son güçlü yükselişten önceki son kırmızı mum
    for (let i = candles.length - 3; i >= 3; i--) {

        const current = candles[i];
        const next = candles[i + 1];

        // Bullish Order Block
        if (
            current.close < current.open &&
            next.close > current.high
        ) {

            return {

                type: "BULLISH",

                high: current.high,
                low: current.low,

                index: i

            };

        }

        // Bearish Order Block
        if (
            current.close > current.open &&
            next.close < current.low
        ) {

            return {

                type: "BEARISH",

                high: current.high,
                low: current.low,

                index: i

            };

        }

    }

    return null;

}

    const structure = detectMarketStructure();
    const bos = detectBOS();

    if (structure.trend === "BEARISH" && bos === "BULLISH BOS") {
        return "BULLISH CHOCH";
    }

    if (structure.trend === "BULLISH" && bos === "BEARISH BOS") {
        return "BEARISH CHOCH";
    }

    return "NO CHOCH";

}
// ==========================
// Order Block Engine v1
// ==========================

function detectOrderBlock() {

    if (!candles || candles.length < 5) {
        return null;
    }

    for (let i = candles.length - 2; i >= 1; i--) {

        const candle = candles[i];
        const next = candles[i + 1];

        // Bullish Order Block
        if (
            candle.close < candle.open &&
            next.close > candle.high
        ) {

            return {
                type: "BULLISH",
                high: candle.high,
                low: candle.low,
                index: i
            };

        }

        // Bearish Order Block
        if (
            candle.close > candle.open &&
            next.close < candle.low
        ) {

            return {
                type: "BEARISH",
                high: candle.high,
                low: candle.low,
                index: i
            };

        }

    }

    return null;

}
// ==========================
// Fair Value Gap Engine v1
// ==========================

function detectFVG() {

    if (!candles || candles.length < 3) {
        return null;
    }

    for (let i = candles.length - 3; i >= 2; i--) {

        const c1 = candles[i - 1];
        const c2 = candles[i];
        const c3 = candles[i + 1];

        // Bullish FVG
        if (c1.high < c3.low) {

            return {

                type: "BULLISH",

                top: c3.low,

                bottom: c1.high,

                index: i

            };

        }

        // Bearish FVG
        if (c1.low > c3.high) {

            return {

                type: "BEARISH",

                top: c1.low,

                bottom: c3.high,

                index: i

            };

        }

    }

    return null;

}
