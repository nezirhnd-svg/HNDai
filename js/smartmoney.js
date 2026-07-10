// ==========================
// HNDai Smart Money Engine v3
// ==========================

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
