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


function analyzeMarket() {

    const trend = getTrendScore();
    const structure = getStructureScore();
    const smc = getSMCScore();

    let bullScore = 0;
    let bearScore = 0;

    if (trend.direction === "BULLISH") bullScore += trend.score;
    if (trend.direction === "BEARISH") bearScore += trend.score;

    if (structure.direction === "BULLISH") bullScore += structure.score;
    if (structure.direction === "BEARISH") bearScore += structure.score;

    if (smc.direction === "BULLISH") bullScore += smc.score;
    if (smc.direction === "BEARISH") bearScore += smc.score;

    let signal = "WAIT";
let confidence = Math.max(bullScore, bearScore);

// LONG
if (
    trend.direction === "BULLISH" &&
    bullScore >= 40
) {
    signal = "LONG";
}

// SHORT
else if (
    trend.direction === "BEARISH" &&
    bearScore >= 40
) {
    signal = "SHORT";
}

// Counter Trend SHORT
else if (
    trend.direction === "BULLISH" &&
    bearScore >= 60
) {
    signal = "SHORT";
}

// Counter Trend LONG
else if (
    trend.direction === "BEARISH" &&
    bullScore >= 60
) {
    signal = "LONG";
}

    return {
        signal,
        confidence,
        trend: trend.direction,
        bullScore,
        bearScore
    };
}
