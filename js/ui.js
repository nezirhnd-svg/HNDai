// ==========================
// HNDai UI Engine
// ==========================

console.log("HNDai UI v3");

function updateUI(result, price) {

    // ==========================
    // AI SIGNAL
    // ==========================

    const signal = document.getElementById("signal");

    signal.innerText = result.signal;

    if (result.signal === "LONG") {
        signal.style.color = "#22c55e";
    } else if (result.signal === "SHORT") {
        signal.style.color = "#ef4444";
    } else {
        signal.style.color = "#facc15";
    }

    // ==========================
    // Confidence
    // ==========================

    document.getElementById("confidence").innerText =
        result.confidence + "%";

    // ==========================
    // Entry
    // ==========================

    document.getElementById("entry").innerText =
        price.toFixed(2);

    // ==========================
    // Trade
    // ==========================

    if (activeTrade) {

        document.getElementById("sl").innerText =
            activeTrade.stopLoss.toFixed(2);

        document.getElementById("tp").innerText =
            activeTrade.takeProfit.toFixed(2);

    } else {

        document.getElementById("sl").innerText = "-";
        document.getElementById("tp").innerText = "-";

    }
const confidence = document.getElementById("confidence");
if (confidence) {
    confidence.innerText = result.confidence + "%";
}

const trend = document.getElementById("trend");
if (trend) {
    trend.innerText = result.trend;
}

const bullScore = document.getElementById("bullScore");
if (bullScore) {
    bullScore.innerText = result.bullScore ?? "-";
}

const bearScore = document.getElementById("bearScore");
if (bearScore) {
    bearScore.innerText = result.bearScore ?? "-";
}
    // ==========================
    // Indicators
    // ==========================

    document.getElementById("ema20").innerText =
        result.ema20 ? result.ema20.toFixed(2) : "-";

    document.getElementById("ema50").innerText =
        result.ema50 ? result.ema50.toFixed(2) : "-";

    document.getElementById("ema200").innerText =
        result.ema200 ? result.ema200.toFixed(2) : "-";

    document.getElementById("rsi").innerText =
        result.rsi ? result.rsi.toFixed(2) : "-";

    document.getElementById("macd").innerText =
        "Coming Soon";

    // ==========================
    // Smart Money
    // ==========================

  const bos = detectBOS();

document.getElementById("bos").innerText =
    bos || "NO BOS";
    document.getElementById("choch").innerText =
        detectCHoCH();

    const ob = detectOrderBlock();

if (ob) {

    document.getElementById("ob").innerText =
        `${ob.type} (${ob.low.toFixed(2)} - ${ob.high.toFixed(2)})`;

} else {

    document.getElementById("ob").innerText =
        "NO OB";

}

   const fvg = detectFVG();

if (fvg) {

    document.getElementById("fvg").innerText =
        `${fvg.type} (${fvg.bottom.toFixed(2)} - ${fvg.top.toFixed(2)})`;

} else {

    document.getElementById("fvg").innerText =
        "NO FVG";

}

 document.getElementById("liq").innerText =
    detectLiquidity();


}
