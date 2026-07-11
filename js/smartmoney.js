// ==========================
// HNDai Smart Money Engine v4
// Part 1 / 2
// ==========================

console.log("HNDai SmartMoney v4 Loaded");

// ==========================
// Swing Engine
// ==========================

function getSwings(lookback = 3) {

    const highs = [];
    const lows = [];

    if (!candles || candles.length < (lookback * 2 + 1)) {
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

        lastHigh:
            highs.length ? highs[highs.length - 1] : null,

        prevHigh:
            highs.length > 1 ? highs[highs.length - 2] : null,

        lastLow:
            lows.length ? lows[lows.length - 1] : null,

        prevLow:
            lows.length > 1 ? lows[lows.length - 2] : null

    };

}

// ==========================
// Market Structure
// ==========================

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

    const HH =
        swings.lastHigh.price >
        swings.prevHigh.price;

    const HL =
        swings.lastLow.price >
        swings.prevLow.price;

    const LH =
        swings.lastHigh.price <
        swings.prevHigh.price;

    const LL =
        swings.lastLow.price <
        swings.prevLow.price;

    let trend = "RANGE";

    if (HH && HL)
        trend = "BULLISH";

    if (LH && LL)
        trend = "BEARISH";

    return {

        trend,

        HH,
        HL,
        LH,
        LL,

        ...swings

    };

}

// ==========================
// Trend
// ==========================

function detectTrend() {

    const structure =
        detectMarketStructure();

    return {

        trend: structure.trend,

        bullish:
            structure.trend === "BULLISH",

        bearish:
            structure.trend === "BEARISH",

        ranging:
            structure.trend === "RANGE"

    };

}

// ==========================
// BOS
// ==========================

function detectBOS() {

    const structure =
        detectMarketStructure();

    if (
        !structure.lastHigh ||
        !structure.lastLow ||
        !candles ||
        candles.length === 0
    ) {

        return "NO DATA";

    }

    const lastClose =
        candles[candles.length - 1].close;

    if (
        lastClose >
        structure.lastHigh.price
    ) {

        return "BULLISH BOS";

    }

    if (
        lastClose <
        structure.lastLow.price
    ) {

        return "BEARISH BOS";

    }

    return "NO BOS";

}

// ==========================
// CHoCH
// ==========================

function detectCHoCH() {

    const structure =
        detectMarketStructure();

    const bos =
      // ==========================
// BOS Engine v2
// ==========================

function detectBOS() {

    const s = getLastSwings();

    if (
        !s.lastHigh ||
        !s.lastLow ||
        !candles ||
        candles.length < 2
    ) {
        return null;
    }

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    // Bullish BOS
    if (
        prevCandle.close <= s.lastHigh.price &&
        lastCandle.close > s.lastHigh.price
    ) {

        return {

            type: "BULLISH",

            level: s.lastHigh.price,

            index: s.lastHigh.index

        };

    }

    // Bearish BOS
    if (
        prevCandle.close >= s.lastLow.price &&
        lastCandle.close < s.lastLow.price
    ) {

        return {

            type: "BEARISH",

            level: s.lastLow.price,

            index: s.lastLow.index

        };

    }

    return null;

}

    if (
        structure.trend === "BEARISH" &&
        bos === "BULLISH BOS"
    ) {

        return "BULLISH CHOCH";

    }

    if (
        structure.trend === "BULLISH" &&
        bos === "BEARISH BOS"
    ) {

        return "BEARISH CHOCH";

    }

    return "NO CHOCH";

}

// ==========================
// Order Block Engine
// ==========================

function detectOrderBlock() {
    // ==========================
// Draw Order Block
// ==========================

let obBox = null;

function drawOrderBlock(chart) {

    const ob = detectOrderBlock();

    if (!ob) return;

    if (obBox) {

        chart.removeShape(obBox);

        obBox = null;

    }

    obBox = chart.createMultipointShape(
        [
            { time: candles[ob.index].time / 1000, price: ob.high },
            { time: candles[candles.length - 1].time / 1000, price: ob.low }
        ],
        {
            shape: "rectangle",
            lock: true,
            disableSelection: true,
            disableSave: true,

            overrides: {

                backgroundColor:
                    ob.type === "BULLISH"
                        ? "rgba(34,197,94,0.25)"
                        : "rgba(239,68,68,0.25)",

                borderColor:
                    ob.type === "BULLISH"
                        ? "#22c55e"
                        : "#ef4444"
            }
        }
    );

}

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
// Fair Value Gap (FVG)
// ==========================

function detectFVG() {

    if (!candles || candles.length < 3) {
        return null;
    }

    for (let i = candles.length - 2; i >= 1; i--) {

        const left = candles[i - 1];
        const right = candles[i + 1];

        // Bullish FVG
        if (left.high < right.low) {

            return {

                type: "BULLISH",

                top: right.low,
                bottom: left.high,

                index: i

            };

        }

        // Bearish FVG
        if (left.low > right.high) {

            return {

                type: "BEARISH",

                top: left.low,
                bottom: right.high,

                index: i

            };

        }

    }

    return null;

}

// ==========================
// Liquidity Engine
// ==========================

function detectLiquidity() {

    const structure = detectMarketStructure();

    if (
        !structure.lastHigh ||
        !structure.lastLow
    ) {

        return "NO DATA";

    }

    const price =
        candles[candles.length - 1].close;

    if (price > structure.lastHigh.price) {

        return "BUY SIDE";

    }

    if (price < structure.lastLow.price) {

        return "SELL SIDE";

    }

    return "INSIDE RANGE";

}

// ==========================
// Equal High / Equal Low
// ==========================

function detectEqualHighLow() {

    const swings = getLastSwings();

    if (
        !swings.lastHigh ||
        !swings.prevHigh ||
        !swings.lastLow ||
        !swings.prevLow
    ) {

        return "NONE";

    }

    const tolerance = 0.001;

    if (

        Math.abs(
            swings.lastHigh.price -
            swings.prevHigh.price
        ) / swings.prevHigh.price
        < tolerance

    ) {

        return "EQUAL HIGH";

    }

    if (

        Math.abs(
            swings.lastLow.price -
            swings.prevLow.price
        ) / swings.prevLow.price
        < tolerance

    ) {

        return "EQUAL LOW";

    }

    return "NONE";

}

console.log("HNDai SmartMoney v4 Ready");

// ==========================
// Liquidity Sweep v1
// ==========================

function detectLiquiditySweep() {

    const swings = getLastSwings();

    if (
        !swings.lastHigh ||
        !swings.lastLow ||
        candles.length < 2
    ) {
        return null;
    }

    const candle = candles[candles.length - 1];

    // Buy Side Sweep
    if (
        candle.high > swings.lastHigh.price &&
        candle.close < swings.lastHigh.price
    ) {

        return {

            type: "BUY SIDE",

            level: swings.lastHigh.price

        };

    }

    // Sell Side Sweep
    if (
        candle.low < swings.lastLow.price &&
        candle.close > swings.lastLow.price
    ) {

        return {

            type: "SELL SIDE",

            level: swings.lastLow.price

        };

    }

    return null;

}


// ==========================
// Liquidity Sweep v1
// ==========================

function detectLiquiditySweep() {

    const swings = getLastSwings();

    if (
        !swings.lastHigh ||
        !swings.lastLow ||
        !candles ||
        candles.length === 0
    ) {
        return null;
    }

    const candle = candles[candles.length - 1];

    // Buy Side Sweep
    if (
        candle.high > swings.lastHigh.price &&
        candle.close < swings.lastHigh.price
    ) {
        return {
            type: "BUY SIDE",
            level: swings.lastHigh.price
        };
    }

    // Sell Side Sweep
    if (
        candle.low < swings.lastLow.price &&
        candle.close > swings.lastLow.price
    ) {
        return {
            type: "SELL SIDE",
            level: swings.lastLow.price
        };
    }

    return null;
}
