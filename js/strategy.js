// ==========================
// Strategy Module
// ==========================

function analyzeMarket() {

    const prices = getClosePrices();
    const volumes = getVolumes();

    if (prices.length < 200) {
        return {
            signal: "WAIT",
            confidence: 0
        };
    }

    const ema20 = EMA(prices, 20);
    const ema50 = EMA(prices, 50);
    const ema200 = EMA(prices, 200);

    const rsi = RSI(prices);

    const avgVolume = AverageVolume(volumes, 20);
    const lastVolume = volumes[volumes.length - 1];

    let score = 0;

    // Trend
    if (ema20 > ema50) score += 20;
    if (ema50 > ema200) score += 20;

    // RSI
    if (rsi > 55 && rsi < 70) score += 20;

    // Volume
    if (lastVolume > avgVolume) score += 20;

    // Price Above EMA20
    if (prices[prices.length - 1] > ema20) score += 20;

    let signal = "WAIT";

    if (score >= 80)
        signal = "LONG";

    if (
        ema20 < ema50 &&
        ema50 < ema200 &&
        rsi < 45 &&
        lastVolume > avgVolume &&
        prices[prices.length - 1] < ema20
    ) {

        signal = "SHORT";
        score = 100;

    }

    return {

        signal,

        confidence: score,

        ema20,

        ema50,

        ema200,

        rsi

    };

}
