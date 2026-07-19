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

function formatMarketPrice(value) {
    if (!Number.isFinite(value) || value <= 0) return "-";
    if (value >= 1000) return value.toFixed(2);
    if (value >= 1) return value.toFixed(4);
    if (value >= 0.01) return value.toFixed(6);
    return value.toFixed(8);
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

function formatSetupStatus(status) {
    return status === "NO_SETUP" ? "NO SETUP" : String(status || "NO SETUP");
}

function formatSetupSource(sourceType) {
    if (sourceType === "OB_FVG_CONFLUENCE") return "OB + FVG";
    if (sourceType === "ORDER_BLOCK") return "ORDER BLOCK";
    if (sourceType === "FVG") return "FVG";
    return "-";
}

function clearSetupStatusClasses(element) {
    if (!element) return;
    [...element.classList].filter(name => name.startsWith("setup-status-"))
        .forEach(name => element.classList.remove(name));
}

function updateSetupUI(setupState, tradePlanState = null) {
    const setup = setupState?.currentSetup || null;
    const plan = tradePlanState?.currentPlan || null;
    const status = setup?.state || "NO_SETUP";
    const statusElement = document.getElementById("setupStatus");
    setText("setupStatus", formatSetupStatus(status));
    clearSetupStatusClasses(statusElement);
    statusElement?.classList.add(`setup-status-${status.toLowerCase().replaceAll("_", "-")}`);
    setText("setupDirection", setup?.direction || "-");
    setText("setupSource", formatSetupSource(setup?.sourceType));
    const entryLow = setup?.entryLow ?? plan?.entryLow;
    const entryHigh = setup?.entryHigh ?? plan?.entryHigh;
    setText("entryZone", finiteSetupBounds(entryLow, entryHigh)
        ? `${formatMarketPrice(entryLow)} - ${formatMarketPrice(entryHigh)}` : "-");
    setText("entry", formatMarketPrice(plan?.entryPrice ?? setup?.entryTarget));
    setText("setupQuality", Number.isFinite(setup?.quality) ? `${setup.quality}%` : "-");
}

function finiteSetupBounds(low, high) {
    return Number.isFinite(low) && low > 0 && Number.isFinite(high) && high >= low;
}

function formatTradePlanStatus(status) {
    if (status === "NO_PLAN") return "NO PLAN";
    if (["CANCELLED_INVALIDATED", "CANCELLED_ORPHANED"].includes(status)) return "CANCELLED";
    if (status === "CANCELLED_MISSED") return "MISSED";
    return String(status || "NO PLAN");
}

function formatTradePlanSource(source, plan = null) {
    if (source === "SOURCE_ZONE_ATR_BUFFER") return "SOURCE ZONE + ATR BUFFER";
    if (source === "RR_FALLBACK") return "2R FALLBACK";
    if (source === "ACTIVE_LIQUIDITY") {
        return plan?.targetLiquidityType === "BUY_SIDE"
            ? "BUY-SIDE LIQUIDITY" : plan?.targetLiquidityType === "SELL_SIDE"
                ? "SELL-SIDE LIQUIDITY" : "ACTIVE LIQUIDITY";
    }
    return "-";
}

function clearTradePlanStatusClasses(element) {
    if (!element) return;
    [...element.classList].filter(name => name.startsWith("trade-plan-status-"))
        .forEach(name => element.classList.remove(name));
}

function updateTradePlanUI(setupState, tradePlanState) {
    const plan = tradePlanState?.currentPlan || null;
    const status = plan?.state || "NO_PLAN";
    const statusElement = document.getElementById("tradePlanStatus");
    setText("tradePlanStatus", formatTradePlanStatus(status));
    clearTradePlanStatusClasses(statusElement);
    statusElement?.classList.add(`trade-plan-status-${status.toLowerCase().replaceAll("_", "-")}`);
    setText("riskReward", Number.isFinite(plan?.riskReward) ? `${plan.riskReward.toFixed(2)}R` : "-");
    setText("stopSource", formatTradePlanSource(plan?.stopSource, plan));
    setText("targetSource", formatTradePlanSource(plan?.targetSource, plan));
    if (activeTrade) {
        setText("sl", formatMarketPrice(activeTrade.stopLoss));
        setText("tp", formatMarketPrice(activeTrade.takeProfit));
    } else if (plan) {
        setText("sl", formatMarketPrice(plan.stopLoss));
        setText("tp", formatMarketPrice(plan.takeProfit));
    } else {
        setText("sl", "-");
        setText("tp", "-");
    }
}

function updateUI(result, price, setupState = null, tradePlanState = null) {
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

    updateSetupUI(setupState, tradePlanState);
    updateTradePlanUI(setupState, tradePlanState);

    setText("trend", result?.trend ?? "-");
    setText("bullScore", result?.bullScore ?? "-");
    setText("bearScore", result?.bearScore ?? "-");
    setText("ema20", formatNumber(result?.ema20));
    setText("ema50", formatNumber(result?.ema50));
    setText("ema200", formatNumber(result?.ema200));
    setText("rsi", formatNumber(result?.rsi));
    setText("macd", "Coming Soon");

    const structure = result?.breakdown?.structure;
    const smc = result?.breakdown?.smc;

    setText("bos", structure?.bos || "NO BOS");
    setText("choch", structure?.choch || "NO CHOCH");

    const ob = smc?.orderBlock;
    setText(
        "ob",
        ob
            ? `${ob.type} (${formatNumber(ob.low)} - ${formatNumber(ob.high)})`
            : "NO OB"
    );

    const fvg = smc?.fvg;
    setText(
        "fvg",
        fvg
            ? `${fvg.type} (${formatNumber(fvg.bottom)} - ${formatNumber(fvg.top)})`
            : "NO FVG"
    );

    setText("liq", smc?.liquidity || "-");
}
