// ==========================
// HNDai UI Engine
// ==========================

console.log("HNDai UI v3");

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function formatNumber(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function setEvidence(id, evidence, emptyMessage) {
    const container = document.getElementById(id);
    if (!container) return;

    container.replaceChildren();

    if (!Array.isArray(evidence) || evidence.length === 0) {
        container.textContent = emptyMessage;
        return;
    }

    evidence.forEach(item => {
        const line = document.createElement("div");
        line.textContent = String(item);
        container.appendChild(line);
    });
}

function updateUI(result, price) {
    const signal = document.getElementById("signal");

    const signalValue = result?.signal ?? "WAIT";
    setText("signal", signalValue);

    if (signal) {
        signal.style.color = signalValue === "LONG"
            ? "#22c55e"
            : signalValue === "SHORT"
                ? "#ef4444"
                : "#facc15";
    }

    setText("confidence", Number.isFinite(result?.confidence) ? `${result.confidence}%` : "0%");
    setText("signalReason", result?.signalReason ?? "-");
    setText("marketBias", result?.marketBias ?? "-");
    setText("marketStrength", Number.isFinite(result?.marketStrength) ? `${result.marketStrength}%` : "0%");
    setText("conflictScore", Number.isFinite(result?.conflictScore) ? `${result.conflictScore}%` : "0%");
    setText("scoreDifference", Number.isFinite(result?.scoreDifference) ? result.scoreDifference : "-");

    setEvidence("bullishEvidence", result?.evidence?.bullish, "No bullish evidence");
    setEvidence("bearishEvidence", result?.evidence?.bearish, "No bearish evidence");

    setText("entry", formatNumber(price));

    if (activeTrade) {
        setText("sl", formatNumber(activeTrade.stopLoss));
        setText("tp", formatNumber(activeTrade.takeProfit));
    } else {
        setText("sl", "-");
        setText("tp", "-");
    }

    setText("trend", result?.trend ?? "-");
    setText("bullScore", result?.bullScore ?? "-");
    setText("bearScore", result?.bearScore ?? "-");
    setText("ema20", formatNumber(result?.ema20));
    setText("ema50", formatNumber(result?.ema50));
    setText("ema200", formatNumber(result?.ema200));
    setText("rsi", formatNumber(result?.rsi));
    setText("macd", "Coming Soon");

    const bos = detectBOS();
    setText("bos", bos || "NO BOS");
    setText("choch", detectCHoCH() || "NO CHOCH");

    const ob = detectOrderBlock();
    setText(
        "ob",
        ob
            ? `${ob.type} (${formatNumber(ob.low)} - ${formatNumber(ob.high)})`
            : "NO OB"
    );

    const fvg = detectFVG();
    setText(
        "fvg",
        fvg
            ? `${fvg.type} (${formatNumber(fvg.bottom)} - ${formatNumber(fvg.top)})`
            : "NO FVG"
    );

    setText("liq", detectLiquidity() || "-");
}
