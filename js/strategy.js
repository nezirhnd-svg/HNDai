// ==========================
// HNDai Strategy Engine
// ==========================
// ==========================
// Trend Score
// ==========================
console.log("STRATEGY V2 LOADED");

// ==========================
// Trend Score
// ==========================

function getTrendScore() {

    const { ema20, ema50, ema200 } = getEMAValues();

    if (ema20 > ema50 && ema50 > ema200) {

        return {
            direction: "BULLISH",
            score: 20
        };

    }

    if (ema20 < ema50 && ema50 < ema200) {

        return {
            direction: "BEARISH",
            score: 20
        };

    }

    return {
        direction: "SIDEWAYS",
        score: 0
    };

}

// ==========================
// Structure Score
// ==========================
function getStructureScore() {

    const bos = detectBOS();
    const choch = detectCHoCH();

    let direction = "NEUTRAL";
    let score = 0;

    if (bos === "BULLISH BOS") {
        direction = "BULLISH";
        score += 15;
    }

    if (bos === "BEARISH BOS") {
        direction = "BEARISH";
        score += 15;
    }

    if (choch === "BULLISH CHOCH") {
        direction = "BULLISH";
        score += 10;
    }

    if (choch === "BEARISH CHOCH") {
        direction = "BEARISH";
        score += 10;
    }

    return {
        direction,
        score
    };
}

    // ==========================
// Smart Money Score
// ==========================

function getSMCScore() {

    const ob = detectOrderBlock();
    const fvg = detectFVG();
    const sweep = detectLiquiditySweep();

    let bull = 0;
    let bear = 0;

    // Order Block
    if (ob) {
        if (ob.type === "BULLISH") bull += 10;
        if (ob.type === "BEARISH") bear += 10;
    }

    // Fair Value Gap
    if (fvg) {
        if (fvg.type === "BULLISH") bull += 10;
        if (fvg.type === "BEARISH") bear += 10;
    }

    // Liquidity Sweep
    if (sweep) {
        if (sweep.type === "SELL SIDE") bull += 10;
        if (sweep.type === "BUY SIDE") bear += 10;
    }

    if (bull > bear) {
        return {
            direction: "BULLISH",
            score: bull
        };
    }

    if (bear > bull) {
        return {
            direction: "BEARISH",
            score: bear
        };
    }

    return {
        direction: "NEUTRAL",
        score: 0
    };

}

    const bos = detectBOS();
    const choch = detectCHoCH();

    let direction = "NEUTRAL";
    let score = 0;

    if (bos === "BULLISH BOS") {
        direction = "BULLISH";
        score += 15;
    }

    if (bos === "BEARISH BOS") {
        direction = "BEARISH";
        score += 15;
    }

    if (choch === "BULLISH CHOCH") {
        direction = "BULLISH";
        score += 10;
    }

    if (choch === "BEARISH CHOCH") {
        direction = "BEARISH";
        score += 10;
    }

    return {
        direction,
        score
    };

}

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
console.log("STRUCTURE SCORE LOADED");
