// ==========================
// HNDai Smart Money Engine v2
// ==========================

// Swing High / Swing Low Tespiti
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
// Last Swings
// ==========================

function getLastSwings() {

    const { highs, lows } = getSwings();

    return {

        highs,
        lows,

        lastHigh: highs.at(-1) || null,
        prevHigh: highs.at(-2) || null,

        lastLow: lows.at(-1) || null,
        prevLow: lows.at(-2) || null

    };

}

// ==========================
// Market Structure
// ==========================

function detectMarketStructure() {

    const {

        lastHigh,
        prevHigh,

        lastLow,
        prevLow

    } = getLastSwings();

    if (!lastHigh || !prevHigh || !lastLow || !prevLow) {

        return {

            trend: "UNKNOWN",

            HH: false,
            HL: false,
            LH: false,
            LL: false,

            lastHigh,
            prevHigh,
            lastLow,
            prevLow

        };

    }

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
        prevHigh,

        lastLow,
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
