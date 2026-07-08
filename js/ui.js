// ==========================
// UI Module
// ==========================

function updateUI(result, price) {

    // Trade Bilgisi
    if (activeTrade) {

        document.getElementById("signal").innerText = activeTrade.side;

        document.getElementById("entry").innerText =
            activeTrade.entry.toFixed(2);

        document.getElementById("sl").innerText =
            activeTrade.sl.toFixed(2);

        document.getElementById("tp").innerText =
            activeTrade.tp1.toFixed(2);

    } else {

        document.getElementById("signal").innerText = result.signal;

        document.getElementById("entry").innerText =
            price.toFixed(2);

        document.getElementById("sl").innerText = "-";

        document.getElementById("tp").innerText = "-";

    }

    // Confidence
    document.getElementById("confidence").innerText =
        result.confidence + "%";

    // EMA
    document.getElementById("ema20").innerText =
        result.ema20.toFixed(2);

    document.getElementById("ema50").innerText =
        result.ema50.toFixed(2);

    document.getElementById("ema200").innerText =
        result.ema200.toFixed(2);

    // RSI
    document.getElementById("rsi").innerText =
        result.rsi.toFixed(2);

    // Renkler
    const signal = document.getElementById("signal");

    if (signal.innerText === "LONG") {

        signal.style.color = "#22c55e";

    } else if (signal.innerText === "SHORT") {

        signal.style.color = "#ef4444";

    } else {

        signal.style.color = "#facc15";

    }

}
