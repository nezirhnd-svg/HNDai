"use strict";
self.window = self;
var candles = [];
var currentPrice = 0;
var forbiddenNetworkCallCount = 0;
var replayClockMs = 0;
var replayControl = { requestId: null, paused: false, cancelled: false, resume: null };

self.fetch = function () {
    forbiddenNetworkCallCount++;
    throw new Error("Network access is forbidden in historical replay worker");
};
try { Object.defineProperty(self, "localStorage", { configurable: false, get: function () {
    throw new Error("Storage access is forbidden in historical replay worker");
} }); } catch (_) {}

importScripts("indicators.js", "smartmoney.js", "strategy.js", "setupEngine.js", "tradePlanEngine.js", "tradeEngine.js");

var HND_REPLAY_WINDOW_BARS = 500;
var HND_REPLAY_MIN_WARMUP_BARS = 500;
var HND_REPLAY_CHUNK_BARS = 20;
var HND_REPLAY_MAX_TRADES = 1000;
var HND_REPLAY_MAX_SETUP_EVENTS = 2000;
var HND_REPLAY_MAX_PLAN_EVENTS = 2000;
var HND_REPLAY_MAX_CHECKPOINTS = 250;
var HND_REPLAY_CHECKPOINT_INTERVAL_BARS = 100;

function post(type, requestId, payload) {
    self.postMessage(Object.assign({ type: type, requestId: requestId, timestamp: Date.now() }, payload || {}));
}
function copy(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value === "number") return Number.isFinite(value) ? value.toPrecision(15) : "null";
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    return "{" + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ":" + canonical(value[key]); }).join(",") + "}";
}
function checksum(value) {
    var text = canonical(value), hash = 2166136261;
    for (var index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
    return hash.toString(16).padStart(8, "0").toUpperCase();
}
function seededRandom(seedText) {
    var seed = parseInt(checksum(seedText), 16) >>> 0;
    return function () { seed += 0x6D2B79F5; var t = seed; t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function stateName(state, fallback) { return String(state?.status || state?.state || fallback); }
function entity(state, key) { return state?.[key] || null; }
function transitionEvent(kind, index, candle, previousState, nextState, data) {
    var candleTime = ArrayBuffer.isView(candle.openTime) ? candle.openTime[index] : candle.openTime;
    return Object.assign({ kind: kind, candleIndex: index, candleTime: candleTime,
        previousState: previousState, nextState: nextState }, data || {});
}
function pushLimited(list, event, max, totals) {
    totals.total++;
    list.push(event);
    if (list.length > max) { list.shift(); totals.truncated = true; }
}
function safeNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }
function normalizeTrade(trade, globalIndexByOpenTime) {
    var openedAtCandleIndex = globalIndexByOpenTime.get(trade.openedAtCandleTime);
    var closedAtCandleIndex = globalIndexByOpenTime.get(trade.closedAtCandleTime);
    return {
        id: trade.id ?? null, planKey: trade.planKey ?? null, setupKey: trade.setupKey ?? null,
        symbol: trade.symbol ?? null, interval: trade.interval ?? null, direction: trade.direction ?? null,
        entryPrice: safeNumber(trade.entryPrice), stopLoss: safeNumber(trade.stopLoss),
        takeProfit: safeNumber(trade.takeProfit), openedAt: safeNumber(trade.openedAt),
        fillSource: trade.fillSource ?? null,
        openedAtCandleTime: safeNumber(trade.openedAtCandleTime),
        openedAtCandleIndex: Number.isInteger(openedAtCandleIndex) ? openedAtCandleIndex : null,
        closedAt: safeNumber(trade.closedAt), closedAtCandleTime: safeNumber(trade.closedAtCandleTime),
        closedAtCandleIndex: Number.isInteger(closedAtCandleIndex) ? closedAtCandleIndex : null,
        exitPrice: safeNumber(trade.exitPrice), exitReason: trade.exitReason ?? null,
        exitSource: trade.exitSource ?? null, state: trade.state ?? null,
        realizedPricePnL: safeNumber(trade.realizedPricePnL), realizedR: safeNumber(trade.realizedR),
        maximumFavorableR: safeNumber(trade.maxFavorableR), maximumAdverseR: safeNumber(trade.maxAdverseR),
        durationBars: Number.isInteger(openedAtCandleIndex) && Number.isInteger(closedAtCandleIndex)
            ? Math.max(0, closedAtCandleIndex - openedAtCandleIndex) : null
    };
}
function terminalTradeIdentity(trade) {
    return [trade?.id, trade?.closedAt, trade?.state, trade?.exitPrice].join("|");
}
function collectTerminalTrade(tradeState, collector) {
    var trade = tradeState?.lastClosedTrade;
    if (!trade || !["CLOSED_TP", "CLOSED_SL", "CANCELLED_MARKET_CHANGE", "CANCELLED_MANUAL"].includes(trade.state)) return;
    var identity = terminalTradeIdentity(trade);
    if (collector.seen.has(identity)) return;
    collector.seen.add(identity); collector.total++;
    if (trade.state === "CLOSED_TP") collector.tpCount++;
    if (trade.state === "CLOSED_SL") collector.slCount++;
    if (String(trade.state).startsWith("CANCELLED")) collector.cancelledCount++;
    if (["CLOSED_TP", "CLOSED_SL"].includes(trade.state)) {
        collector.netR += Number(trade.realizedR) || 0;
        if (trade.direction === "LONG") collector.longClosed++;
        if (trade.direction === "SHORT") collector.shortClosed++;
    }
    collector.trades.push(copy(trade));
    if (collector.trades.length > HND_REPLAY_MAX_TRADES) { collector.trades.shift(); collector.truncated = true; }
}
function validateApis() {
    var functions = [getEMAValues, calculateRSI, detectStructureEvents, detectLiquidityZones,
        getStrongestLiquidityZones, detectOrderBlocks, detectFVGs, selectStructureConfirmedPriceZones, analyzeMarket];
    if (functions.some(function (fn) { return typeof fn !== "function"; })) throw new Error("ENGINE_API_MISSING");
    [window.HNDSetupEngine, window.HNDTradePlanEngine, window.HNDTradeEngine].forEach(function (engine) {
        if (!engine || ["evaluate", "reset", "getState"].some(function (key) { return typeof engine[key] !== "function"; })) {
            throw new Error("ENGINE_API_MISSING");
        }
    });
    if (typeof window.HNDTradeEngine.getHistory !== "function") throw new Error("ENGINE_API_MISSING");
}
function validateStart(message) {
    var config = message.config || {}, profile = message.replayProfile || {}, columns = message.columns || {};
    if (![2000, 10000, 50000, 100000].includes(config.selectedCandleCount)) throw new Error("INVALID_REPLAY_COUNT");
    if (!Number.isInteger(profile.structureHistoryLimit) || !Number.isInteger(profile.rawZoneHistoryLimit) ||
        !profile.structureQualificationOptions || profile.replayWindowBars !== 500 || profile.mtfMode !== "NOT_INCLUDED") {
        throw new Error("INVALID_REPLAY_PROFILE");
    }
    var keys = ["openTime", "open", "high", "low", "close", "volume", "closeTime"];
    if (keys.some(function (key) { return !(columns[key] instanceof Float64Array) ||
        columns[key].length !== config.selectedCandleCount; })) throw new Error("INVALID_REPLAY_COLUMNS");
    validateApis();
}
function resetEngines() {
    candles = []; currentPrice = 0;
    window.HNDSetupEngine.reset("HISTORICAL_REPLAY_START");
    window.HNDTradePlanEngine.reset("HISTORICAL_REPLAY_START");
    window.HNDTradeEngine.reset("HISTORICAL_REPLAY_START");
    window.HNDTradeEngine.clearHistory?.();
    var setup = window.HNDSetupEngine.getState(), plan = window.HNDTradePlanEngine.getState(),
        trade = window.HNDTradeEngine.getState();
    if (setup.status !== "NO_SETUP" || plan.status !== "NO_PLAN" || trade.status !== "NO_TRADE" ||
        window.HNDTradeEngine.getHistory().length !== 0) throw new Error("ENGINE_RESET_FAILED");
}
function runNoLookaheadAcceptance() {
    var setup = { id: "FIXTURE-SETUP", key: "FIXTURE-SETUP-KEY", symbol: "BTCUSDT",
        interval: "15m", direction: "LONG", state: "TRIGGERED" };
    var plan = { id: "FIXTURE-PLAN", key: "FIXTURE-PLAN-KEY", setupId: setup.id,
        setupKey: setup.key, symbol: setup.symbol, interval: setup.interval, direction: "LONG",
        state: "READY", entryPrice: 100, stopLoss: 90, takeProfit: 120, risk: 10,
        reward: 20, riskReward: 2 };
    var first = { time: 1000, open: 105, high: 108, low: 101, close: 105, closeTime: 1999 };
    function register() {
        resetEngines(); replayClockMs = first.closeTime;
        var registered = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval,
            price: null, candles: [first], setupState: { status: "TRIGGERED", currentSetup: setup },
            tradePlanState: { status: "READY", currentPlan: plan } });
        if (registered.status !== "WAITING_ENTRY" || registered.activeTrade ||
            window.HNDTradeEngine.getHistory().length) throw new Error("LOOKAHEAD_GUARD_FAILED_REGISTRATION");
        return registered;
    }
    register();
    var clean = { time: 2000, open: 105, high: 108, low: 95, close: 95, closeTime: 2999 };
    replayClockMs = clean.closeTime;
    var cleanState = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval,
        price: null, candles: [first, clean], setupState: { status: "TRIGGERED", currentSetup: setup },
        tradePlanState: { status: "READY", currentPlan: plan } });
    if (cleanState.status !== "OPEN" || cleanState.activeTrade?.fillSource !== "CLOSED_CANDLE_ENTRY_CROSS" ||
        cleanState.activeTrade?.openedAtCandleTime !== clean.time) throw new Error("LOOKAHEAD_GUARD_FAILED_CLEAN_ENTRY:" +
            JSON.stringify({ status: cleanState.status, fillSource: cleanState.activeTrade?.fillSource,
                openedAtCandleTime: cleanState.activeTrade?.openedAtCandleTime,
                reason: cleanState.lastEvaluation?.debug?.primaryReason }));

    register();
    var entryAndStop = { time: 2000, open: 105, high: 108, low: 89, close: 95, closeTime: 2999 };
    replayClockMs = entryAndStop.closeTime;
    var ambiguousStop = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval,
        price: null, candles: [first, entryAndStop], setupState: { status: "TRIGGERED", currentSetup: setup },
        tradePlanState: { status: "READY", currentPlan: plan } });
    if (ambiguousStop.status !== "WAITING_ENTRY" || ambiguousStop.activeTrade ||
        ambiguousStop.lastEvaluation?.debug?.primaryReason !== "AMBIGUOUS_ENTRY_AND_STOP_SAME_CANDLE" ||
        window.HNDTradeEngine.getHistory().length) throw new Error("LOOKAHEAD_GUARD_FAILED_STOP_AMBIGUITY");

    register();
    var entryAndTarget = { time: 2000, open: 105, high: 121, low: 95, close: 95, closeTime: 2999 };
    replayClockMs = entryAndTarget.closeTime;
    var ambiguousTarget = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval,
        price: null, candles: [first, entryAndTarget], setupState: { status: "TRIGGERED", currentSetup: setup },
        tradePlanState: { status: "READY", currentPlan: plan } });
    if (ambiguousTarget.status !== "WAITING_ENTRY" || ambiguousTarget.activeTrade ||
        ambiguousTarget.lastEvaluation?.debug?.primaryReason !== "AMBIGUOUS_ENTRY_AND_TARGET_SAME_CANDLE" ||
        window.HNDTradeEngine.getHistory().length) throw new Error("LOOKAHEAD_GUARD_FAILED_TARGET_AMBIGUITY");

    register();
    var entryStopTarget = { time: 2000, open: 105, high: 121, low: 89, close: 95, closeTime: 2999 };
    replayClockMs = entryStopTarget.closeTime;
    var ambiguousBoth = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval,
        price: null, candles: [first, entryStopTarget], setupState: { status: "TRIGGERED", currentSetup: setup },
        tradePlanState: { status: "READY", currentPlan: plan } });
    if (ambiguousBoth.status !== "WAITING_ENTRY" || ambiguousBoth.activeTrade ||
        ambiguousBoth.lastEvaluation?.debug?.primaryReason !== "AMBIGUOUS_ENTRY_AND_STOP_SAME_CANDLE" ||
        window.HNDTradeEngine.getHistory().length) throw new Error("LOOKAHEAD_GUARD_FAILED_BOTH_AMBIGUITY");

    register(); replayClockMs = clean.closeTime;
    var openedState = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval,
        price: null, candles: [first, clean], setupState: { status: "TRIGGERED", currentSetup: setup },
        tradePlanState: { status: "READY", currentPlan: plan } });
    if (openedState.status !== "OPEN") throw new Error("LOOKAHEAD_GUARD_FAILED_OPEN_FOR_STOP_FIRST");
    var bothHit = { time: 3000, open: 105, high: 121, low: 89, close: 105, closeTime: 3999 };
    replayClockMs = bothHit.closeTime;
    var terminalState = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval, price: null,
        candles: [first, clean, bothHit], setupState: { status: "TRIGGERED", currentSetup: setup },
        tradePlanState: { status: "READY", currentPlan: plan } });
    var terminal = window.HNDTradeEngine.getHistory().at(-1);
    if (terminal?.state !== "CLOSED_SL" || terminal?.exitReason !== "BOTH_HIT_STOP_FIRST" ||
        terminal?.exitSource !== "CLOSED_CANDLE") throw new Error("LOOKAHEAD_GUARD_FAILED_STOP_FIRST");
    var duplicateState = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval, price: null,
        candles: [first, clean, bothHit], setupState: { status: "TRIGGERED", currentSetup: setup },
        tradePlanState: { status: "READY", currentPlan: plan } });
    if (window.HNDTradeEngine.getHistory().length !== 1 || duplicateState.activeTrade) throw new Error("LOOKAHEAD_GUARD_FAILED_DUPLICATE");

    register();
    var cleared = window.HNDTradeEngine.evaluate({ symbol: setup.symbol, interval: setup.interval, price: null,
        candles: [first], setupState: { status: "NO_SETUP", currentSetup: null },
        tradePlanState: { status: "NO_PLAN", currentPlan: null } });
    if (cleared.status !== "NO_TRADE" || cleared.pendingExecution) throw new Error("LOOKAHEAD_GUARD_FAILED_PENDING_CLEAR");
    resetEngines();
    return true;
}
function waitForResume(requestId) {
    if (!replayControl.paused) return Promise.resolve();
    post("PAUSED", requestId);
    return new Promise(function (resolve) { replayControl.resume = resolve; }).then(function () {
        if (replayControl.cancelled) throw Object.assign(new Error("Replay cancelled"), { name: "AbortError" });
        post("RESUMED", requestId);
    });
}
function yieldEventLoop() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }
function summarizeEvents(events, trades, finalStates, datasetChecksum, collector) {
    var closedTrades = collector.tpCount + collector.slCount;
    var setupEvents = events.setup, planEvents = events.plan, tradeEvents = events.trade;
    return {
        totalSetupTransitions: events.setupTotal, setupsCreated: setupEvents.filter(function (e) { return e.previousState === "NO_SETUP" && e.nextState !== "NO_SETUP"; }).length,
        setupsTriggered: setupEvents.filter(function (e) { return e.nextState === "TRIGGERED"; }).length,
        setupsInvalidated: setupEvents.filter(function (e) { return e.nextState === "INVALIDATED"; }).length,
        setupsMissed: setupEvents.filter(function (e) { return e.nextState === "MISSED"; }).length,
        totalPlanTransitions: events.planTotal, plansCreated: planEvents.filter(function (e) { return e.previousState === "NO_PLAN" && e.nextState !== "NO_PLAN"; }).length,
        plansReady: planEvents.filter(function (e) { return e.nextState === "READY"; }).length,
        plansCancelled: planEvents.filter(function (e) { return String(e.nextState).includes("CANCELLED"); }).length,
        totalTradesOpened: tradeEvents.filter(function (e) { return e.nextState === "OPEN"; }).length,
        closedTrades: closedTrades, tpCount: collector.tpCount, slCount: collector.slCount,
        cancelledTradeCount: collector.cancelledCount, totalTerminalTrades: collector.total,
        openTradeAtEnd: Boolean(finalStates.trade.activeTrade),
        pendingPlanAtEnd: finalStates.plan.status === "READY" ? copy(finalStates.plan.currentPlan) : null,
        diagnosticWinRate: closedTrades ? collector.tpCount / closedTrades * 100 : null,
        diagnosticNetR: collector.netR, diagnosticAverageR: closedTrades ? collector.netR / closedTrades : null,
        longClosedTrades: collector.longClosed, shortClosedTrades: collector.shortClosed,
        closedCandleFillCount: trades.filter(function (trade) { return trade.fillSource === "CLOSED_CANDLE_ENTRY_CROSS"; }).length,
        tickerFillCount: trades.filter(function (trade) { return trade.fillSource === "TICKER_LIMIT_CROSS"; }).length,
        closedCandleExitCount: trades.filter(function (trade) { return ["CLOSED_TP", "CLOSED_SL"].includes(trade.state) && trade.exitSource === "CLOSED_CANDLE"; }).length,
        tickerExitCount: trades.filter(function (trade) { return ["CLOSED_TP", "CLOSED_SL"].includes(trade.state) && trade.exitSource === "TICKER"; }).length,
        datasetChecksum: datasetChecksum
    };
}
async function runRepetition(message, repetition) {
    var requestId = message.requestId, columns = message.columns, profile = message.replayProfile,
        selectedCount = message.config.selectedCandleCount;
    resetEngines();
    replayClockMs = columns.closeTime[0];
    Date.now = function () { return replayClockMs; };
    Math.random = seededRandom(message.datasetMetadata.selectedChecksum + "|DETERMINISTIC");
    var setupEvents = [], planEvents = [], tradeEvents = [], checkpoints = [];
    var setupTotals = { total: 0, truncated: false }, planTotals = { total: 0, truncated: false }, tradeTotals = { total: 0, truncated: false };
    var terminalCollector = { trades: [], seen: new Set(), total: 0, truncated: false,
        tpCount: 0, slCount: 0, cancelledCount: 0, netR: 0, longClosed: 0, shortClosed: 0 };
    var globalIndexByOpenTime = new Map();
    for (var globalIndex = 0; globalIndex < selectedCount; globalIndex++) {
        globalIndexByOpenTime.set(columns.openTime[globalIndex], globalIndex);
    }
    var previousSetupState = window.HNDSetupEngine.getState();
    var previousTradePlanState = window.HNDTradePlanEngine.getState();
    var previousTradeState = window.HNDTradeEngine.getState();
    var startReal = performance.now(), evaluated = 0, lastProgressAt = startReal;
    post("REPETITION_STARTED", requestId, { repetition: repetition });
    for (var currentIndex = HND_REPLAY_MIN_WARMUP_BARS - 1; currentIndex < selectedCount; currentIndex++) {
        if (replayControl.cancelled) throw Object.assign(new Error("Replay cancelled"), { name: "AbortError" });
        if (evaluated && evaluated % HND_REPLAY_CHUNK_BARS === 0) { await yieldEventLoop(); await waitForResume(requestId); }
        replayClockMs = columns.closeTime[currentIndex];
        var windowStart = Math.max(0, currentIndex - HND_REPLAY_WINDOW_BARS + 1);
        candles = [];
        for (var row = windowStart; row <= currentIndex; row++) candles.push({ time: columns.openTime[row],
            open: columns.open[row], high: columns.high[row], low: columns.low[row], close: columns.close[row],
            volume: columns.volume[row], closeTime: columns.closeTime[row] });
        var currentCandle = candles[candles.length - 1]; currentPrice = currentCandle.close;

        var tradeState = window.HNDTradeEngine.evaluate({ symbol: message.context.symbol,
            interval: message.context.interval, price: null, candles: candles,
            setupState: previousSetupState, tradePlanState: previousTradePlanState });
        collectTerminalTrade(tradeState, terminalCollector);
        var nextTradeName = stateName(tradeState, "NO_TRADE"), previousTradeName = stateName(previousTradeState, "NO_TRADE");
        if (nextTradeName !== previousTradeName) {
            var activeTrade = tradeState.activeTrade || tradeState.lastClosedTrade || {};
            pushLimited(tradeEvents, transitionEvent("TRADE", currentIndex, columns, previousTradeName, nextTradeName, {
                phase: "EXECUTION",
                tradeId: activeTrade.id ?? null, planKey: activeTrade.planKey ?? null, direction: activeTrade.direction ?? null,
                entryPrice: safeNumber(activeTrade.entryPrice), stopLoss: safeNumber(activeTrade.stopLoss),
                takeProfit: safeNumber(activeTrade.takeProfit), exitPrice: safeNumber(activeTrade.exitPrice),
                realizedR: safeNumber(activeTrade.realizedR), reason: activeTrade.exitReason ?? tradeState.lastEvaluation?.debug?.primaryReason ?? null
            }), HND_REPLAY_MAX_TRADES, tradeTotals);
        }

        var structureEvents = detectStructureEvents({ lookback: 3, limit: profile.structureHistoryLimit, includeBOS: true, includeCHoCH: true });
        var liquidityZones = detectLiquidityZones({ lookback: 3, tolerance: 0.0015, minTouches: 2, limit: 20, includeSwept: true, includeBroken: false });
        var strongestLiquidity = getStrongestLiquidityZones(liquidityZones);
        var rawOrderBlocks = detectOrderBlocks({ limit: profile.rawZoneHistoryLimit, includeInvalidated: true });
        var rawFVGs = detectFVGs({ limit: profile.rawZoneHistoryLimit, includeInvalidated: true });
        var qualifiedPriceZones = selectStructureConfirmedPriceZones({ candles: candles, structureEvents: structureEvents,
            orderBlocks: rawOrderBlocks, fvgs: rawFVGs }, copy(profile.structureQualificationOptions));
        var analysis = analyzeMarket();
        var setupState = window.HNDSetupEngine.evaluate({ symbol: message.context.symbol, interval: message.context.interval,
            candles: candles, price: currentCandle.close, analysis: analysis,
            qualifiedPriceZones: qualifiedPriceZones, mtfState: null });
        var previousSetupName = stateName(previousSetupState, "NO_SETUP"), nextSetupName = stateName(setupState, "NO_SETUP");
        if (nextSetupName !== previousSetupName || entity(previousSetupState, "currentSetup")?.key !== entity(setupState, "currentSetup")?.key) {
            var setup = setupState.currentSetup || setupState.lastTerminalSetup || {};
            pushLimited(setupEvents, transitionEvent("SETUP", currentIndex, columns, previousSetupName, nextSetupName, {
                key: setup.key ?? null, direction: setup.direction ?? null, sourceType: setup.sourceType ?? null,
                entryTarget: safeNumber(setup.entryTarget), quality: safeNumber(setup.quality), reason: setup.reason ?? setupState.lastEvaluation?.debug?.primaryReason ?? null
            }), HND_REPLAY_MAX_SETUP_EVENTS, setupTotals);
        }
        var tradePlanState = window.HNDTradePlanEngine.evaluate({ symbol: message.context.symbol,
            interval: message.context.interval, price: currentCandle.close, candles: candles,
            setupState: setupState, liquidityZones: liquidityZones, strongestLiquidity: strongestLiquidity });
        var previousPlanName = stateName(previousTradePlanState, "NO_PLAN"), nextPlanName = stateName(tradePlanState, "NO_PLAN");
        if (nextPlanName !== previousPlanName || entity(previousTradePlanState, "currentPlan")?.key !== entity(tradePlanState, "currentPlan")?.key) {
            var plan = tradePlanState.currentPlan || tradePlanState.lastTerminalPlan || {};
            pushLimited(planEvents, transitionEvent("PLAN", currentIndex, columns, previousPlanName, nextPlanName, {
                planKey: plan.key ?? null, setupKey: plan.setupKey ?? null, direction: plan.direction ?? null,
                entryPrice: safeNumber(plan.entryPrice), stopLoss: safeNumber(plan.stopLoss), takeProfit: safeNumber(plan.takeProfit),
                riskReward: safeNumber(plan.riskReward), targetSource: plan.targetSource ?? null,
                reason: plan.reason ?? tradePlanState.lastEvaluation?.debug?.primaryReason ?? null
            }), HND_REPLAY_MAX_PLAN_EVENTS, planTotals);
        }
        var synchronizedTradeState = window.HNDTradeEngine.evaluate({ symbol: message.context.symbol,
            interval: message.context.interval, price: null, candles: candles,
            setupState: setupState, tradePlanState: tradePlanState });
        collectTerminalTrade(synchronizedTradeState, terminalCollector);
        var synchronizedStateName = stateName(synchronizedTradeState, "NO_TRADE");
        var executionPendingKey = tradeState.pendingExecution?.planKey ?? null;
        var synchronizedPendingKey = synchronizedTradeState.pendingExecution?.planKey ?? null;
        if (synchronizedStateName !== nextTradeName || executionPendingKey !== synchronizedPendingKey) {
            var synchronizedTrade = synchronizedTradeState.activeTrade || synchronizedTradeState.lastClosedTrade || {};
            var synchronizedPlan = tradePlanState.currentPlan || {};
            pushLimited(tradeEvents, transitionEvent("TRADE", currentIndex, columns, nextTradeName, synchronizedStateName, {
                phase: "END_OF_CANDLE_SYNC", tradeId: synchronizedTrade.id ?? null,
                planKey: synchronizedPendingKey ?? synchronizedPlan.key ?? null,
                direction: synchronizedTrade.direction ?? synchronizedPlan.direction ?? null,
                entryPrice: safeNumber(synchronizedTrade.entryPrice ?? synchronizedPlan.entryPrice),
                stopLoss: safeNumber(synchronizedTrade.stopLoss ?? synchronizedPlan.stopLoss),
                takeProfit: safeNumber(synchronizedTrade.takeProfit ?? synchronizedPlan.takeProfit),
                exitPrice: safeNumber(synchronizedTrade.exitPrice), realizedR: safeNumber(synchronizedTrade.realizedR),
                reason: synchronizedTradeState.lastEvaluation?.debug?.primaryReason ?? null
            }), HND_REPLAY_MAX_TRADES, tradeTotals);
        }
        var endOfCandleTradeState = synchronizedTradeState;
        var endTradeName = stateName(endOfCandleTradeState, "NO_TRADE");
        previousSetupState = copy(setupState); previousTradePlanState = copy(tradePlanState);
        previousTradeState = copy(endOfCandleTradeState);
        evaluated++;
        if (evaluated % HND_REPLAY_CHECKPOINT_INTERVAL_BARS === 0 && checkpoints.length < HND_REPLAY_MAX_CHECKPOINTS) {
            var checkpoint = { candleIndex: currentIndex, candleTime: currentCandle.time,
                signal: analysis?.signal ?? null, bullScore: safeNumber(analysis?.bullScore), bearScore: safeNumber(analysis?.bearScore),
                confidence: safeNumber(analysis?.confidence), structureEventCount: structureEvents.length,
                liquidityZoneCount: liquidityZones.length, qualifiedOBCount: qualifiedPriceZones?.orderBlocks?.length || 0,
                qualifiedFVGCount: qualifiedPriceZones?.fvgs?.length || 0, setupState: nextSetupName,
                setupKey: setupState.currentSetup?.key ?? null, planState: nextPlanName,
                planKey: tradePlanState.currentPlan?.key ?? null, tradeState: endTradeName,
                activeTradeId: endOfCandleTradeState.activeTrade?.id ?? null,
                closedTradeCount: terminalCollector.total };
            checkpoint.checkpointChecksum = checksum(checkpoint); checkpoints.push(checkpoint);
        }
        if (evaluated % HND_REPLAY_CHUNK_BARS === 0) {
            var progressNow = performance.now();
            if (progressNow - lastProgressAt >= Number(message.config.progressIntervalMs || 200)) {
                lastProgressAt = progressNow;
                post("PROGRESS", requestId, { repetition: repetition,
                    processedBars: evaluated, totalBars: selectedCount - 499 });
            }
        }
    }
    post("PROGRESS", requestId, { repetition: repetition, processedBars: evaluated,
        totalBars: selectedCount - 499, repetitionComplete: true });
    var finalStates = { setup: window.HNDSetupEngine.getState(), plan: window.HNDTradePlanEngine.getState(), trade: window.HNDTradeEngine.getState() };
    collectTerminalTrade(finalStates.trade, terminalCollector);
    var trades = terminalCollector.trades.map(function (trade) { return normalizeTrade(trade, globalIndexByOpenTime); });
    var events = { setup: setupEvents, plan: planEvents, trade: tradeEvents, setupTotal: setupTotals.total,
        planTotal: planTotals.total, tradeTotal: tradeTotals.total };
    var summary = summarizeEvents(events, trades, finalStates, message.datasetMetadata.selectedChecksum, terminalCollector);
    var checksumInput = { setupEvents: setupEvents, planEvents: planEvents, tradeEvents: tradeEvents,
        trades: trades, finalStates: finalStates, summary: summary };
    summary.eventChecksum = checksum(checksumInput);
    summary.durationMs = performance.now() - startReal;
    summary.candlesPerSecond = evaluated / Math.max(summary.durationMs / 1000, 0.001);
    var warnings = ["MTF historical context is not included in Stage 4.6.2"];
    if (setupTotals.truncated || planTotals.truncated || tradeTotals.truncated) warnings.push("EVENT_LOG_TRUNCATED");
    if (terminalCollector.truncated) warnings.push("TRADE_LOG_TRUNCATED");
    if (forbiddenNetworkCallCount) warnings.push("FORBIDDEN_NETWORK_CALL");
    post("REPETITION_COMPLETED", requestId, { repetition: repetition, eventChecksum: summary.eventChecksum,
        durationMs: summary.durationMs });
    return { repetition: repetition, summary: summary, trades: trades, setupEvents: setupEvents,
        planEvents: planEvents, tradeEvents: tradeEvents, checkpoints: checkpoints, warnings: warnings,
        finalStates: finalStates };
}

async function startReplay(message) {
    var requestId = message.requestId;
    replayControl = { requestId: requestId, paused: false, cancelled: false, resume: null };
    forbiddenNetworkCallCount = 0;
    try {
        validateStart(message); runNoLookaheadAcceptance(); post("PREFLIGHT_PASSED", requestId);
        var repetitions = [];
        for (var repetition = 1; repetition <= 2; repetition++) repetitions.push(await runRepetition(message, repetition));
        if (replayControl.cancelled) throw Object.assign(new Error("Replay cancelled"), { name: "AbortError" });
        var first = repetitions[0], second = repetitions[1];
        var deterministic = first.summary.eventChecksum === second.summary.eventChecksum &&
            checksum(first.trades) === checksum(second.trades) &&
            first.summary.tpCount === second.summary.tpCount && first.summary.slCount === second.summary.slCount &&
            first.summary.diagnosticNetR === second.summary.diagnosticNetR;
        if (!deterministic) throw new Error("REPLAY_NONDETERMINISTIC");
        var result = copy(first);
        result.summary = Object.assign({}, first.summary, { status: "UNVALIDATED_DIAGNOSTIC",
            symbol: message.context.symbol, interval: message.context.interval,
            selectedCandleCount: message.config.selectedCandleCount, warmupBars: 500,
            evaluatedBars: message.config.selectedCandleCount - 499, deterministic: true,
            repetitions: repetitions.map(function (item) { return { repetition: item.repetition,
                eventChecksum: item.summary.eventChecksum, durationMs: item.summary.durationMs }; }),
            durationMs: first.summary.durationMs + second.summary.durationMs,
            mtfMode: "NOT_INCLUDED", parityStatus: "PARITY_REQUIRED",
            warnings: Array.from(new Set(first.warnings.concat(second.warnings))) });
        result.datasetMetadata = copy(message.datasetMetadata);
        result.engine = { indicatorsLoaded: true, smartMoneyLoaded: true, strategyLoaded: true,
            setupLoaded: true, planLoaded: true, tradeLoaded: true, forbiddenNetworkCallCount: forbiddenNetworkCallCount };
        post("PROGRESS", requestId, { repetition: 2, processedBars: result.summary.evaluatedBars,
            totalBars: result.summary.evaluatedBars, progressPercent: 100 });
        post("COMPLETED", requestId, { result: result });
    } catch (error) {
        if (error.name === "AbortError") post("CANCELLED", requestId);
        else post("ERROR", requestId, { error: { name: error.name || "Error", message: String(error.message || error).slice(0, 300) },
            reason: String(error.message || error) });
    }
}

self.onmessage = function (event) {
    var message = event.data || {};
    if (message.type === "START") { startReplay(message); return; }
    if (message.requestId !== replayControl.requestId) return;
    if (message.type === "PAUSE") replayControl.paused = true;
    if (message.type === "RESUME") { replayControl.paused = false; var resolver = replayControl.resume; replayControl.resume = null; resolver?.(); }
    if (message.type === "CANCEL") { replayControl.cancelled = true; replayControl.paused = false;
        var resume = replayControl.resume; replayControl.resume = null; resume?.(); }
};
