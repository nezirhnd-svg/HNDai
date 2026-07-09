// ==========================
// HNDai Strategy Engine
// ==========================

function analyzeMarket() {

    const { ema20, ema50, ema200 } = getEMAValues();

    const rsi = calculateRSI();

    let signal = "WAIT";
    let confidence = 50;
    let trend = "SIDEWAYS";

    if (ema20 > ema50 && ema50 > ema200) {
        trend = "BULLISH";
    } else if (ema20 < ema50 && ema50 < ema200) {
        trend = "BEARISH";
    }

    if (trend === "BULLISH" && rsi > 55 && rsi < 75) {
        signal = "LONG";
        confidence = 85;
    }

    if (trend === "BEARISH" && rsi < 45 && rsi > 25) {
        signal = "SHORT";
        confidence = 85;
    }

    return {
        signal,
        confidence,
        trend,
        ema20,
        ema50,
        ema200,
        rsi
    };
}
