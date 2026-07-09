// ==========================
// HNDai Smart Money Engine
// ==========================

// BOS (Break Of Structure)
function detectBOS() {

    if (candles.length < 30) {
        return "Scanning...";
    }

    const lastClose = candles[candles.length - 1].close;

    const highs = candles
        .slice(-21, -1)
        .map(c => c.high);

    const lows = candles
        .slice(-21, -1)
        .map(c => c.low);

    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);

    if (lastClose > highest)
        return "Bullish";

    if (lastClose < lowest)
        return "Bearish";

    return "No Break";
}
