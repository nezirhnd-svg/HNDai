// ==========================
// HNDai Smart Money Engine
// ==========================

// Swing High Bul
function findSwingHighs(lookback = 3) {

    const swings = [];

    for (let i = lookback; i < candles.length - lookback; i++) {

        let isSwing = true;

        for (let j = 1; j <= lookback; j++) {

            if (
                candles[i].high <= candles[i - j].high ||
                candles[i].high <= candles[i + j].high
            ) {
                isSwing = false;
                break;
            }

        }

        if (isSwing) {

            swings.push({
                index: i,
                price: candles[i].high
            });

        }

    }

    return swings;

}

// Swing Low Bul
function findSwingLows(lookback = 3) {

    const swings = [];

    for (let i = lookback; i < candles.length - lookback; i++) {

        let isSwing = true;

        for (let j = 1; j <= lookback; j++) {

            if (
                candles[i].low >= candles[i - j].low ||
                candles[i].low >= candles[i + j].low
            ) {
                isSwing = false;
                break;
            }

        }

        if (isSwing) {

            swings.push({
                index: i,
                price: candles[i].low
            });

        }

    }

    return swings;

}
// BOS Tespiti
function detectBOS() {

    const highs = findSwingHighs();

    const lows = findSwingLows();

    if (highs.length === 0 || lows.length === 0)
        return "Scanning...";

    const lastClose = candles.at(-1).close;

    const lastHigh = highs.at(-1).price;

    const lastLow = lows.at(-1).price;

    if (lastClose > lastHigh)
        return "Bullish";

    if (lastClose < lastLow)
        return "Bearish";

    return "No Break";

}
// ==========================
// Market Structure Engine
// ==========================

function detectMarketStructure() {

    const highs = findSwingHighs();
    const lows = findSwingLows();

    if (highs.length < 2 || lows.length < 2) {
        return {
            trend: "UNKNOWN",
            HH: false,
            HL: false,
            LH: false,
            LL: false
        };
    }

    const lastHigh = highs.at(-1).price;
    const prevHigh = highs.at(-2).price;

    const lastLow = lows.at(-1).price;
    const prevLow = lows.at(-2).price;

    const HH = lastHigh > prevHigh;
    const HL = lastLow > prevLow;

    const LH = lastHigh < prevHigh;
    const LL = lastLow < prevLow;

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
        LL

    };

}
