// ==========================
// HNDai UI Engine
// ==========================
console.log("HNDai UI v3 - TEST"); 

console.log("HNDai UI v2");

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

    // Confidence
    document.getElementById("confidence").innerText =
        result.confidence + "%";

    // Entry
    document.getElementById("entry").innerText =
        price.toFixed(2);

    // Stop Loss / Take Profit
    if (activeTrade) {

        document.getElementById("sl").innerText =
            activeTrade.stopLoss.toFixed(2);

        document.getElementById("tp").innerText =
            activeTrade.takeProfit.toFixed(2);

    } else {

        document.getElementById("sl").innerText = "-";
        document.getElementById("tp").innerText = "-";

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

    document.getElementById("bos").innerText = "-";

    document.getElementById("choch").innerText =
        "Scanning...";

    document.getElementById("ob").innerText =
        "Scanning...";

    document.getElementById("fvg").innerText =
        "Scanning...";

    document.getElementById("liq").innerText =
        "Scanning...";
}
