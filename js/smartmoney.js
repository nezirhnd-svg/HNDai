// ==========================
// HNDai Smart Money Engine v2
// ==========================

function getSwings(lookback = 3) {

    const highs = [];
    const lows = [];

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

    return {
        highs,
        lows
    };

}
// ==========================
// Market Structure
// ==========================

function detectMarketStructure() {

    const { highs, lows } = getSwings();

    if (highs.length < 2 || lows.length < 2) {

        return {

            trend: "UNKNOWN",

            HH: false,
            HL: false,
            LH: false,
            LL: false

        };

    }

    const lastHigh = highs.at(-1);
    const prevHigh = highs.at(-2);

    const lastLow = lows.at(-1);
    const prevLow = lows.at(-2);

    const HH = lastHigh.price > prevHigh.price;
    const HL = lastLow.price > prevLow.price;

    const LH = lastHigh.price < prevHigh.price;
    const LL = lastLow.price < prevLow.price;

    let trend = "RANGE";

    if (HH && HL)
        trend = "BULLISH";

    else if (LH && LL)
        trend = "BEARISH";

    return {

        trend,

        HH,
        HL,

        LH,
        LL,

        lastHigh,
        lastLow,
        prevHigh,
        prevLow

    };

}
// ==========================
// Trend Engine
// ==========================

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
// Last Swing Engine
// ==========================

function getLastSwings() {

    const highs = findSwingHighs();
    const lows = findSwingLows();

    return {

        highs,
        lows,

        lastHigh: highs.at(-1) || null,
        prevHigh: highs.at(-2) || null,

        lastLow: lows.at(-1) || null,
        prevLow: lows.at(-2) || null

    };

}
