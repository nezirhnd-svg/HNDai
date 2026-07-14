// ==========================
// HNDai Strategy Engine
// ==========================
// ==========================
// Trend Score
// ==========================
console.log("STRATEGY V2 LOADED");

const MAX_MARKET_SCORE = 75;

// ==========================
// Trend Score
// ==========================

function getTrendScore(emaValues = getEMAValues()) {

    const { ema20, ema50, ema200 } = emaValues;
    const evidence = {
        bullish: [],
        bearish: []
    };

    if (ema20 > ema50 && ema50 > ema200) {

        evidence.bullish.push("EMA20 > EMA50 > EMA200");

        return {
            direction: "BULLISH",
            score: 20,
            bullScore: 20,
            bearScore: 0,
            evidence
        };

    }

    if (ema20 < ema50 && ema50 < ema200) {

        evidence.bearish.push("EMA20 < EMA50 < EMA200");

        return {
            direction: "BEARISH",
            score: 20,
            bullScore: 0,
            bearScore: 20,
            evidence
        };

    }

    return {
        direction: "SIDEWAYS",
        score: 0,
        bullScore: 0,
        bearScore: 0,
        evidence
    };

}

// ==========================
// Structure Score
// ==========================
function getStructureScore() {

    const bos = detectBOS();
    const choch = detectCHoCH();

    let bullScore = 0;
    let bearScore = 0;
    const evidence = {
        bullish: [],
        bearish: []
    };

    if (bos === "BULLISH BOS") {
        bullScore += 15;
        evidence.bullish.push(bos);
    }

    if (bos === "BEARISH BOS") {
        bearScore += 15;
        evidence.bearish.push(bos);
    }

    if (choch === "BULLISH CHOCH") {
        bullScore += 10;
        evidence.bullish.push(choch);
    }

    if (choch === "BEARISH CHOCH") {
        bearScore += 10;
        evidence.bearish.push(choch);
    }

    const direction = bullScore > bearScore
        ? "BULLISH"
        : bearScore > bullScore
            ? "BEARISH"
            : "NEUTRAL";

    const score = Math.max(bullScore, bearScore);

    return {
        direction,
        score,
        bullScore,
        bearScore,
        evidence,
        bos,
        choch
    };
}

    // ==========================
// Smart Money Score
// ==========================

function getSMCScore() {

    const orderBlock = detectOrderBlock();
    const fvg = detectFVG();
    const liquiditySweep = detectLiquiditySweep();

    let bullScore = 0;
    let bearScore = 0;
    const evidence = {
        bullish: [],
        bearish: []
    };

    // Order Block
    if (orderBlock) {
        if (orderBlock.type === "BULLISH") {
            bullScore += 10;
            evidence.bullish.push("BULLISH ORDER BLOCK");
        }
        if (orderBlock.type === "BEARISH") {
            bearScore += 10;
            evidence.bearish.push("BEARISH ORDER BLOCK");
        }
    }

    // Fair Value Gap
    if (fvg) {
        if (fvg.type === "BULLISH") {
            bullScore += 10;
            evidence.bullish.push("BULLISH FVG");
        }
        if (fvg.type === "BEARISH") {
            bearScore += 10;
            evidence.bearish.push("BEARISH FVG");
        }
    }

    // Liquidity Sweep
    if (liquiditySweep) {
        if (liquiditySweep.type === "SELL SIDE") {
            bullScore += 10;
            evidence.bullish.push("SELL SIDE LIQUIDITY SWEEP");
        }
        if (liquiditySweep.type === "BUY SIDE") {
            bearScore += 10;
            evidence.bearish.push("BUY SIDE LIQUIDITY SWEEP");
        }
    }

    const direction = bullScore > bearScore
        ? "BULLISH"
        : bearScore > bullScore
            ? "BEARISH"
            : "NEUTRAL";

    const score = Math.max(bullScore, bearScore);

    return {
        direction,
        score,
        bullScore,
        bearScore,
        evidence,
        orderBlock,
        fvg,
        liquiditySweep
    };

}


function analyzeMarket() {

    const { ema20, ema50, ema200 } = getEMAValues();
    const rsi = calculateRSI();
    const trend = getTrendScore({ ema20, ema50, ema200 });
    const structure = getStructureScore();
    const smc = getSMCScore();

    const bullScore = trend.bullScore + structure.bullScore + smc.bullScore;
    const bearScore = trend.bearScore + structure.bearScore + smc.bearScore;
    const scoreDifference = Math.abs(bullScore - bearScore);
    const marketBias = bullScore > bearScore
        ? "BULLISH"
        : bearScore > bullScore
            ? "BEARISH"
            : "NEUTRAL";

    const evidence = {
        bullish: [
            ...trend.evidence.bullish,
            ...structure.evidence.bullish,
            ...smc.evidence.bullish
        ],
        bearish: [
            ...trend.evidence.bearish,
            ...structure.evidence.bearish,
            ...smc.evidence.bearish
        ]
    };

    let signal = "WAIT";
const rawConfidence = Math.max(bullScore, bearScore);
const confidence = Math.min(
    100,
    Math.max(0, Math.round((rawConfidence / MAX_MARKET_SCORE) * 100))
);

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
        rawConfidence,
        trend: trend.direction,
        bullScore,
        bearScore,
        scoreDifference,
        marketBias,
        breakdown: {
            trend,
            structure,
            smc
        },
        evidence,
        ema20,
        ema50,
        ema200,
        rsi
    };
}
