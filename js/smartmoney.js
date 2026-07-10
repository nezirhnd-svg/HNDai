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
