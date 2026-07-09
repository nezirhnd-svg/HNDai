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
