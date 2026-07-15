// ==========================
// HNDai Strategy Engine
// ==========================
// ==========================
// Trend Score
// ==========================
console.log("STRATEGY V2 LOADED");

const MAX_MARKET_SCORE = 75;
const MIN_SIGNAL_SCORE = 40;
const MIN_COUNTER_TREND_SCORE = 60;
const MIN_DIRECTIONAL_EDGE = 15;

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
    const liquidity = detectLiquidity();
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
        liquidity,
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
    const dominantScore = Math.max(bullScore, bearScore);
    const opposingScore = Math.min(bullScore, bearScore);
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
    let signalReason = "SIGNAL CONDITIONS NOT MET";
const rawConfidence = dominantScore;
const marketStrength = Math.min(
    100,
    Math.max(0, Math.round((dominantScore / MAX_MARKET_SCORE) * 100))
);
const confidence = Math.min(
    100,
    Math.max(0, Math.round((scoreDifference / MAX_MARKET_SCORE) * 100))
);
const conflictScore = Math.min(
    100,
    Math.max(0, Math.round((opposingScore / MAX_MARKET_SCORE) * 100))
);

if (marketBias === "NEUTRAL") {
    signalReason = "NEUTRAL MARKET BIAS";
}
else if (scoreDifference < MIN_DIRECTIONAL_EDGE) {
    signalReason = "INSUFFICIENT DIRECTIONAL EDGE";
}
// Counter-trend SHORT
else if (
    trend.direction === "BULLISH" &&
    marketBias === "BEARISH" &&
    bearScore >= MIN_COUNTER_TREND_SCORE &&
    scoreDifference >= MIN_DIRECTIONAL_EDGE
) {
    signal = "SHORT";
    signalReason = "COUNTER-TREND BEARISH REVERSAL";
}
// Counter-trend LONG
else if (
    trend.direction === "BEARISH" &&
    marketBias === "BULLISH" &&
    bullScore >= MIN_COUNTER_TREND_SCORE &&
    scoreDifference >= MIN_DIRECTIONAL_EDGE
) {
    signal = "LONG";
    signalReason = "COUNTER-TREND BULLISH REVERSAL";
}
// Trend-following LONG
else if (
    trend.direction === "BULLISH" &&
    marketBias === "BULLISH" &&
    bullScore >= MIN_SIGNAL_SCORE &&
    scoreDifference >= MIN_DIRECTIONAL_EDGE
) {
    signal = "LONG";
    signalReason = "BULLISH TREND CONFIRMED";
}
// Trend-following SHORT
else if (
    trend.direction === "BEARISH" &&
    marketBias === "BEARISH" &&
    bearScore >= MIN_SIGNAL_SCORE &&
    scoreDifference >= MIN_DIRECTIONAL_EDGE
) {
    signal = "SHORT";
    signalReason = "BEARISH TREND CONFIRMED";
}
else if (
    trend.direction === "BULLISH" &&
    marketBias === "BEARISH" &&
    bearScore < MIN_COUNTER_TREND_SCORE
) {
    signalReason = "BEARISH BIAS BELOW COUNTER-TREND THRESHOLD";
}
else if (
    trend.direction === "BEARISH" &&
    marketBias === "BULLISH" &&
    bullScore < MIN_COUNTER_TREND_SCORE
) {
    signalReason = "BULLISH BIAS BELOW COUNTER-TREND THRESHOLD";
}
else if (
    trend.direction === "BULLISH" &&
    marketBias === "BULLISH" &&
    bullScore < MIN_SIGNAL_SCORE
) {
    signalReason = "BULLISH SCORE BELOW SIGNAL THRESHOLD";
}
else if (
    trend.direction === "BEARISH" &&
    marketBias === "BEARISH" &&
    bearScore < MIN_SIGNAL_SCORE
) {
    signalReason = "BEARISH SCORE BELOW SIGNAL THRESHOLD";
}
else if (trend.direction === "SIDEWAYS") {
    signalReason = "SIDEWAYS TREND — NO CONFIRMATION";
}

    return {
        signal,
        signalReason,
        confidence,
        rawConfidence,
        trend: trend.direction,
        bullScore,
        bearScore,
        dominantScore,
        opposingScore,
        marketStrength,
        conflictScore,
        scoreDifference,
        marketBias,
        minimumSignalScore: MIN_SIGNAL_SCORE,
        minimumCounterTrendScore: MIN_COUNTER_TREND_SCORE,
        minimumDirectionalEdge: MIN_DIRECTIONAL_EDGE,
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
