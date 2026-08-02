// ==========================
// HNDai UI Engine
// ==========================

console.log("HNDai UI v4.5");

let tradeJournalExportControlsInitialized = false;

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

function updateSetupUI(setupState, tradePlanState = null, tradeState = null) {
    const setup = setupState?.currentSetup || null;
    const plan = tradePlanState?.currentPlan || null;
    const trade = tradeState?.activeTrade || activeTrade || null;
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
    setText("entry", formatMarketPrice(trade?.entryPrice ?? plan?.entryPrice ?? setup?.entryTarget));
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

function updateTradePlanUI(setupState, tradePlanState, tradeState = null) {
    const plan = tradePlanState?.currentPlan || null;
    const trade = tradeState?.activeTrade || activeTrade || null;
    const status = plan?.state || "NO_PLAN";
    const statusElement = document.getElementById("tradePlanStatus");
    setText("tradePlanStatus", formatTradePlanStatus(status));
    clearTradePlanStatusClasses(statusElement);
    statusElement?.classList.add(`trade-plan-status-${status.toLowerCase().replaceAll("_", "-")}`);
    setText("riskReward", Number.isFinite(plan?.riskReward) ? `${plan.riskReward.toFixed(2)}R` : "-");
    setText("stopSource", formatTradePlanSource(plan?.stopSource, plan));
    setText("targetSource", formatTradePlanSource(plan?.targetSource, plan));
    if (trade) {
        setText("sl", formatMarketPrice(trade.stopLoss));
        setText("tp", formatMarketPrice(trade.takeProfit));
    } else if (plan) {
        setText("sl", formatMarketPrice(plan.stopLoss));
        setText("tp", formatMarketPrice(plan.takeProfit));
    } else {
        setText("sl", "-");
        setText("tp", "-");
    }
}

function formatRMultiple(value) {
    if (!Number.isFinite(value)) return "-";
    const normalized = Math.abs(value) < 0.005 ? 0 : value;
    return `${normalized > 0 ? "+" : ""}${normalized.toFixed(2)}R`;
}

function formatTradeStatus(status) {
    const labels = { NO_TRADE: "NO TRADE", WAITING_ENTRY: "WAITING ENTRY", OPEN: "OPEN",
        CLOSED_TP: "TAKE PROFIT", CLOSED_SL: "STOP LOSS",
        CANCELLED_MARKET_CHANGE: "CANCELLED", CANCELLED_MANUAL: "CANCELLED" };
    return labels[status] || String(status || "NO_TRADE").replaceAll("_", " ");
}

function clearTradeStatusClasses(element) {
    if (!element) return;
    [...element.classList].filter(name => name.startsWith("trade-status-"))
        .forEach(name => element.classList.remove(name));
}

function clearStructureShadowClasses(element) {
    if (!element?.classList) return;
    [...element.classList].filter(name => name.startsWith("structure-shadow-state-"))
        .forEach(name => element.classList.remove(name));
}

function updateStructureShadowUI(diagnostic = null) {
    const enabled = diagnostic?.enabled === true;
    const shadow = diagnostic?.shadowResult || null;
    const status = diagnostic?.status || (enabled ? "-" : "DISABLED");
    const mode = enabled ? (shadow?.mode || "SHADOW") : "OFF";
    const mismatch = shadow?.wouldChangeDecision === true;
    const failed = status === "FAILED" || shadow?.status === "FAILED" ||
        shadow?.comparison === "PIPELINE_FAILED";
    const notApplicable = status === "NOT_APPLICABLE";
    const card = document.getElementById("structureShadowCard");
    clearStructureShadowClasses(card);
    const stateClass = failed ? "error" : notApplicable ? "not-applicable"
        : mismatch ? "mismatch" : enabled && shadow ? "match" : "off";
    card?.classList?.add(`structure-shadow-state-${stateClass}`);
    setText("structureShadowMode", mode);
    setText("structureShadowStatus", status);
    setText("structureShadowLegacyDecision",
        shadow?.legacyDecision ?? diagnostic?.legacyResult?.decision ?? "-");
    setText("structureShadowGateDecision", shadow?.gateDecision ?? "-");
    setText("structureShadowComparison", shadow?.comparison ?? "-");
    setText("structureShadowWouldChange", shadow
        ? `${mismatch ? "YES" : "NO"} — diagnostic only` : "-");
    setText("structureShadowGateReason", shadow?.gateReason ??
        (notApplicable ? diagnostic?.reason : null) ?? "-");
    setText("structureShadowError", shadow?.error ??
        (failed ? diagnostic?.reason : null) ?? "-");
    setText("structureShadowFailedStage",
        shadow?.diagnostics?.failedStage ?? shadow?.pipelineEvaluation?.failedStage ?? "-");
    setText("structureShadowCandidateKey", shadow?.candidateKey ??
        diagnostic?.legacyResult?.candidate?.key ?? "-");
}

function updateActiveTradeUI(price, tradeState = null) {
    const trade = tradeState?.activeTrade || activeTrade || null;
    const pending = tradeState?.pendingExecution || null;
    const last = tradeState?.lastClosedTrade || null;
    const rawStatus = trade ? "OPEN" : pending ? "WAITING_ENTRY" : (tradeState?.status || "NO_TRADE");
    const statusElement = document.getElementById("tradeStatus");
    setText("tradeStatus", formatTradeStatus(rawStatus));
    clearTradeStatusClasses(statusElement);
    statusElement?.classList.add(`trade-status-${rawStatus.toLowerCase().replaceAll("_", "-")}`);
    setText("tradeDirection", trade?.direction || pending?.direction || "-");
    setText("tradeEntry", formatMarketPrice(trade?.entryPrice ?? pending?.entryPrice));
    setText("tradeCurrentPrice", trade || pending ? formatMarketPrice(price) : "-");
    setText("tradeUnrealizedR", trade ? formatRMultiple(trade.unrealizedR) : "-");
    setText("tradeMfe", trade ? formatRMultiple(trade.maxFavorableR) : "-");
    setText("tradeMae", trade ? formatRMultiple(-Math.abs(trade.maxAdverseR || 0)) : "-");
    let lastResult = "-";
    if (last?.state === "CLOSED_TP") lastResult = `TAKE PROFIT ${formatRMultiple(last.realizedR)}`;
    else if (last?.state === "CLOSED_SL") lastResult = `STOP LOSS ${formatRMultiple(last.realizedR)}`;
    else if (String(last?.state || "").startsWith("CANCELLED")) lastResult = "CANCELLED";
    setText("lastTradeResult", lastResult);
    setText("lastExitReason", last?.exitReason ? String(last.exitReason).replaceAll("_", " ") : "-");
}

function formatJournalDate(value) {
    if (!Number.isFinite(value) || value <= 0) return "-";
    try { return new Date(value).toLocaleString(); }
    catch (error) { return "-"; }
}

function formatJournalOutcome(trade) {
    if (["WIN", "LOSS", "BREAKEVEN", "CANCELLED"].includes(trade?.journalOutcome)) {
        return trade.journalOutcome;
    }
    return String(trade?.state || "").startsWith("CANCELLED") ? "CANCELLED" : "-";
}

function formatJournalProfitFactor(metrics) {
    if (metrics?.profitFactorInfinite === true) return "∞";
    return Number.isFinite(metrics?.profitFactor) ? metrics.profitFactor.toFixed(2) : "-";
}

function updateJournalPerformanceUI(journalState) {
    const metrics = journalState?.metrics || {};
    const status = journalState?.initialized !== true ? "UNAVAILABLE"
        : journalState?.persistenceActive === true ? "LOCAL STORAGE"
            : journalState?.storageAvailable === false ? "MEMORY ONLY" : "MEMORY ONLY";
    setText("journalStatus", status);
    setText("completedTrades", Number.isFinite(metrics.completedTrades) ? metrics.completedTrades : 0);
    setText("winsLosses", `${Number.isFinite(metrics.wins) ? metrics.wins : 0} / ${Number.isFinite(metrics.losses) ? metrics.losses : 0}`);
    setText("winRate", Number.isFinite(metrics.winRate) ? `${metrics.winRate.toFixed(2)}%` : "-");
    setText("netR", formatRMultiple(Number.isFinite(metrics.netR) ? metrics.netR : 0));
    setText("expectancyR", formatRMultiple(metrics.expectancyR));
    setText("profitFactor", formatJournalProfitFactor(metrics));
    setText("maxDrawdownR", `${Math.max(0, Number.isFinite(metrics.maxDrawdownR)
        ? metrics.maxDrawdownR : 0).toFixed(2)}R`);
    const streakType = metrics.currentStreakType;
    const streakLength = Number.isFinite(metrics.currentStreakLength)
        ? metrics.currentStreakLength : 0;
    setText("currentStreak", streakType === "WIN" && streakLength > 0
        ? `${streakLength} ${streakLength === 1 ? "WIN" : "WINS"}`
        : streakType === "LOSS" && streakLength > 0
            ? `${streakLength} ${streakLength === 1 ? "LOSS" : "LOSSES"}` : "-");
    setText("cancelledTrades", Number.isFinite(metrics.cancelledTrades) ? metrics.cancelledTrades : 0);
}

function formatJournalExitReason(reason) {
    const value = String(reason || "");
    if (value === "TAKE_PROFIT") return "TAKE PROFIT";
    if (value === "STOP_LOSS") return "STOP LOSS";
    if (value === "BOTH_HIT_STOP_FIRST") return "BOTH HIT STOP FIRST";
    if (["SYMBOL_CHANGED", "TIMEFRAME_CHANGED", "MARKET_CHANGE"].includes(value)) return "MARKET CHANGE";
    if (["MANUAL_RESET", "MANUAL"].includes(value)) return "MANUAL";
    return value ? value.replaceAll("_", " ") : "-";
}

function updateTradeJournalTable(journalState) {
    const body = document.getElementById("tradeJournalBody");
    if (!body) return;
    body.replaceChildren();
    const trades = Array.isArray(journalState?.recentTrades)
        ? journalState.recentTrades.slice(0, 20) : [];
    if (!trades.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 9;
        cell.textContent = "No closed paper trades";
        row.appendChild(cell);
        body.appendChild(row);
        return;
    }
    trades.forEach(trade => {
        const outcome = formatJournalOutcome(trade);
        const row = document.createElement("tr");
        row.className = `trade-journal-row-${outcome.toLowerCase()}`;
        [
            formatJournalDate(trade.closedAt), trade.symbol || "-", trade.interval || "-",
            trade.direction || "-", outcome, formatRMultiple(trade.realizedR),
            formatMarketPrice(trade.entryPrice), formatMarketPrice(trade.exitPrice),
            formatJournalExitReason(trade.exitReason)
        ].forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
        });
        body.appendChild(row);
    });
}

function downloadTradeJournal(content, type, extension) {
    try {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `HNDai-paper-trade-journal-${new Date().toISOString().slice(0, 10)}.${extension}`;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
        console.warn("Trade Journal export could not be created.");
    }
}

function setupTradeJournalExportControls() {
    if (tradeJournalExportControlsInitialized) return;
    const csvButton = document.getElementById("exportJournalCsv");
    const jsonButton = document.getElementById("exportJournalJson");
    if (!csvButton || !jsonButton) return;
    csvButton.addEventListener("click", () => downloadTradeJournal(
        window.HNDTradeJournal?.toCSV?.() || "", "text/csv;charset=utf-8", "csv"
    ));
    jsonButton.addEventListener("click", () => downloadTradeJournal(
        window.HNDTradeJournal?.toJSON?.() || "{}", "application/json;charset=utf-8", "json"
    ));
    tradeJournalExportControlsInitialized = true;
}

function updateUI(
    result, price, setupState = null, tradePlanState = null,
    tradeState = null, journalState = null, structureShadow = null
) {
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

    updateSetupUI(setupState, tradePlanState, tradeState);
    updateTradePlanUI(setupState, tradePlanState, tradeState);
    updateActiveTradeUI(price, tradeState);
    updateJournalPerformanceUI(journalState);
    updateTradeJournalTable(journalState);
    updateStructureShadowUI(structureShadow);
    setupTradeJournalExportControls();

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

setupTradeJournalExportControls();
