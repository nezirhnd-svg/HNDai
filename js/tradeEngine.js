// ==========================
// HNDai Paper Trade Engine
// ==========================

let activeTrade = null;

(function () {
    "use strict";

    const HND_TRADE_ENGINE_VERSION = "4.3";
    const HND_TRADE_MAX_HISTORY = 100;
    const HND_TRADE_MAX_PROCESSED_CANDLES = 100;
    const HND_TRADE_PRICE_EPSILON_FACTOR = 1e-9;
    const HND_TRADE_ENGINE_STATES = Object.freeze({
        NO_TRADE: "NO_TRADE", WAITING_ENTRY: "WAITING_ENTRY", OPEN: "OPEN",
        CLOSED_TP: "CLOSED_TP", CLOSED_SL: "CLOSED_SL",
        CANCELLED_MARKET_CHANGE: "CANCELLED_MARKET_CHANGE",
        CANCELLED_MANUAL: "CANCELLED_MANUAL"
    });
    const HND_TRADE_DEBUG_REASONS = Object.freeze({
        NO_READY_PLAN: "NO_READY_PLAN", INVALID_PLAN: "INVALID_PLAN",
        PLAN_SETUP_MISMATCH: "PLAN_SETUP_MISMATCH", WAITING_ENTRY: "WAITING_ENTRY",
        PLAN_ALREADY_CONSUMED: "PLAN_ALREADY_CONSUMED",
        ENTRY_ALREADY_BEYOND_STOP: "ENTRY_ALREADY_BEYOND_STOP",
        AMBIGUOUS_ENTRY_AND_STOP_SAME_CANDLE: "AMBIGUOUS_ENTRY_AND_STOP_SAME_CANDLE",
        AMBIGUOUS_ENTRY_AND_TARGET_SAME_CANDLE: "AMBIGUOUS_ENTRY_AND_TARGET_SAME_CANDLE",
        TRADE_OPENED: "TRADE_OPENED", TRADE_OPEN_LOCKED: "TRADE_OPEN_LOCKED",
        TAKE_PROFIT_HIT: "TAKE_PROFIT_HIT", STOP_LOSS_HIT: "STOP_LOSS_HIT",
        BOTH_HIT_STOP_FIRST: "BOTH_HIT_STOP_FIRST",
        TRADE_CANCELLED_MARKET_CHANGE: "TRADE_CANCELLED_MARKET_CHANGE",
        TRADE_CANCELLED_MANUAL: "TRADE_CANCELLED_MANUAL",
        TRADE_ENGINE_ERROR: "TRADE_ENGINE_ERROR"
    });

    let pendingExecution = null;
    let lastClosedTrade = null;
    let tradeHistory = [];
    let consumedPlanKeys = new Set();
    let lastEvaluation = null;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }
    function finitePositive(value) { return Number.isFinite(value) && value > 0; }

    function normalizeTradeCandles(source) {
        const byTime = new Map();
        (Array.isArray(source) ? source : []).forEach(candle => {
            if (!candle || !finitePositive(candle.time) || !finitePositive(candle.open) ||
                !finitePositive(candle.high) || !finitePositive(candle.low) ||
                !finitePositive(candle.close) || candle.high < candle.open ||
                candle.high < candle.close || candle.high < candle.low ||
                candle.low > candle.open || candle.low > candle.close ||
                (candle.closeTime !== undefined && !finitePositive(candle.closeTime))) return;
            byTime.set(candle.time, {
                time: candle.time, open: candle.open, high: candle.high,
                low: candle.low, close: candle.close,
                ...(candle.closeTime !== undefined ? { closeTime: candle.closeTime } : {})
            });
        });
        return [...byTime.values()].sort((first, second) => first.time - second.time);
    }

    function getClosedTradeCandles(candles, now = Date.now()) {
        const normalized = normalizeTradeCandles(candles);
        if (!normalized.length) return [];
        if (normalized.some(candle => Number.isFinite(candle.closeTime))) {
            return normalized.filter(candle => Number.isFinite(candle.closeTime) && candle.closeTime <= now);
        }
        return normalized.slice(0, -1);
    }

    function validateReadyPlan(plan) {
        if (!plan || typeof plan.id !== "string" || !plan.id.trim() ||
            typeof plan.key !== "string" || !plan.key.trim() ||
            typeof plan.setupId !== "string" || !plan.setupId.trim() ||
            typeof plan.setupKey !== "string" || !plan.setupKey.trim() ||
            typeof plan.symbol !== "string" || !plan.symbol.trim() ||
            typeof plan.interval !== "string" || !plan.interval.trim() ||
            !["LONG", "SHORT"].includes(plan.direction) || plan.state !== "READY" ||
            !finitePositive(plan.entryPrice) || !finitePositive(plan.stopLoss) ||
            !finitePositive(plan.takeProfit) || !finitePositive(plan.risk) ||
            !Number.isFinite(plan.riskReward) || plan.riskReward < 2) return false;
        return plan.direction === "LONG"
            ? plan.stopLoss < plan.entryPrice && plan.entryPrice < plan.takeProfit
            : plan.takeProfit < plan.entryPrice && plan.entryPrice < plan.stopLoss;
    }

    function validateTriggeredSetup(setup, plan) {
        return Boolean(setup && typeof setup.id === "string" && setup.state === "TRIGGERED" &&
            setup.key === plan.setupKey && setup.direction === plan.direction &&
            setup.symbol === plan.symbol && setup.interval === plan.interval);
    }

    function snapshotPlan(plan) {
        return {
            id: plan.id, key: plan.key, setupId: plan.setupId, setupKey: plan.setupKey,
            symbol: plan.symbol, interval: plan.interval, direction: plan.direction,
            state: plan.state, entryPrice: plan.entryPrice, stopLoss: plan.stopLoss,
            takeProfit: plan.takeProfit, risk: plan.risk,
            reward: Number.isFinite(plan.reward) ? plan.reward : null,
            riskATR: Number.isFinite(plan.riskATR) ? plan.riskATR : null,
            riskReward: plan.riskReward
        };
    }

    function snapshotSetup(setup) {
        return {
            id: setup.id, key: setup.key, symbol: setup.symbol, interval: setup.interval,
            direction: setup.direction, state: setup.state,
            entryLow: Number.isFinite(setup.entryLow) ? setup.entryLow : null,
            entryHigh: Number.isFinite(setup.entryHigh) ? setup.entryHigh : null,
            entryTarget: Number.isFinite(setup.entryTarget) ? setup.entryTarget : null
        };
    }

    function createDebug(input, reason, context = {}) {
        const plan = input.tradePlanState?.currentPlan || null;
        const setup = input.setupState?.currentSetup || null;
        return {
            version: HND_TRADE_ENGINE_VERSION,
            symbol: String(input.symbol || ""), interval: String(input.interval || ""),
            price: Number.isFinite(input.price) ? input.price : null,
            primaryReason: reason,
            plan: {
                present: Boolean(plan), id: plan?.id ?? null, key: plan?.key ?? null,
                state: plan?.state ?? null, direction: plan?.direction ?? null,
                entryPrice: Number.isFinite(plan?.entryPrice) ? plan.entryPrice : null,
                stopLoss: Number.isFinite(plan?.stopLoss) ? plan.stopLoss : null,
                takeProfit: Number.isFinite(plan?.takeProfit) ? plan.takeProfit : null,
                consumed: typeof plan?.key === "string" && consumedPlanKeys.has(plan.key)
            },
            setup: {
                present: Boolean(setup), id: setup?.id ?? null, key: setup?.key ?? null,
                state: setup?.state ?? null
            },
            execution: {
                pending: Boolean(pendingExecution),
                observedAt: pendingExecution?.observedAt ?? null,
                observedCandleTime: pendingExecution?.observedCandleTime ?? null,
                tickerEntryCondition: context.tickerEntryCondition === true,
                closedCandleEntryCondition: context.closedCandleEntryCondition === true,
                fillSource: context.fillSource ?? activeTrade?.fillSource ?? null
            },
            trade: {
                active: Boolean(activeTrade), id: activeTrade?.id ?? null,
                state: activeTrade?.state ?? null, direction: activeTrade?.direction ?? null,
                entryPrice: activeTrade?.entryPrice ?? null, stopLoss: activeTrade?.stopLoss ?? null,
                takeProfit: activeTrade?.takeProfit ?? null, lastPrice: activeTrade?.lastPrice ?? null,
                unrealizedR: activeTrade?.unrealizedR ?? null,
                maxFavorableR: activeTrade?.maxFavorableR ?? null,
                maxAdverseR: activeTrade?.maxAdverseR ?? null
            },
            exit: {
                tickerStopHit: context.tickerStopHit === true,
                tickerTargetHit: context.tickerTargetHit === true,
                closedCandlesProcessed: context.closedCandlesProcessed ?? 0,
                stopHit: context.stopHit === true, targetHit: context.targetHit === true,
                bothHit: context.bothHit === true,
                exitPrice: Number.isFinite(context.exitPrice) ? context.exitPrice : null,
                exitReason: context.exitReason ?? null
            },
            evaluatedAt: Date.now()
        };
    }

    function openFromPlan(plan, setup, context = {}) {
        if (!validateReadyPlan(plan) || !validateTriggeredSetup(setup, plan) ||
            consumedPlanKeys.has(plan.key) || activeTrade) return null;
        const now = Number.isFinite(context.openedAt) ? context.openedAt : Date.now();
        const openedAtCandleTime = Number.isFinite(context.openedAtCandleTime)
            ? context.openedAtCandleTime : null;
        const openedAtCandleIndex = Number.isInteger(context.openedAtCandleIndex)
            ? context.openedAtCandleIndex : -1;
        activeTrade = {
            id: `TRADE-${plan.key}`, key: `${plan.key}|PAPER_TRADE_V4.3`,
            version: HND_TRADE_ENGINE_VERSION,
            planId: plan.id, planKey: plan.key, setupId: plan.setupId, setupKey: plan.setupKey,
            symbol: plan.symbol, interval: plan.interval, direction: plan.direction,
            state: HND_TRADE_ENGINE_STATES.OPEN,
            entryPrice: plan.entryPrice, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit,
            risk: plan.risk,
            reward: Number.isFinite(plan.reward) ? plan.reward :
                Math.abs(plan.takeProfit - plan.entryPrice),
            riskATR: Number.isFinite(plan.riskATR) ? plan.riskATR : null,
            plannedRiskReward: plan.riskReward,
            fillSource: context.fillSource,
            fillObservedPrice: Number.isFinite(context.fillObservedPrice)
                ? context.fillObservedPrice : plan.entryPrice,
            openedAt: now, openedAtCandleTime, openedAtCandleIndex,
            updatedAt: now, lastPrice: plan.entryPrice,
            unrealizedPricePnL: 0, unrealizedR: 0,
            maxFavorablePriceMove: 0, maxAdversePriceMove: 0,
            maxFavorableR: 0, maxAdverseR: 0,
            lastProcessedClosedCandleTime: openedAtCandleTime,
            closedAt: null, closedAtCandleTime: null, exitPrice: null,
            exitReason: null, exitSource: null,
            realizedPricePnL: null, realizedR: null,
            durationMs: null, durationBars: null,
            planSnapshot: snapshotPlan(plan), setupSnapshot: snapshotSetup(setup)
        };
        consumedPlanKeys.add(plan.key);
        pendingExecution = null;
        return clone(activeTrade);
    }

    function updateTradeMetrics(price) {
        if (!activeTrade || !finitePositive(price)) return;
        const pnl = activeTrade.direction === "LONG"
            ? price - activeTrade.entryPrice : activeTrade.entryPrice - price;
        const favorable = Math.max(0, pnl);
        const adverse = Math.max(0, -pnl);
        activeTrade.lastPrice = price;
        activeTrade.unrealizedPricePnL = pnl;
        activeTrade.unrealizedR = pnl / activeTrade.risk;
        activeTrade.maxFavorablePriceMove = Math.max(activeTrade.maxFavorablePriceMove, favorable);
        activeTrade.maxAdversePriceMove = Math.max(activeTrade.maxAdversePriceMove, adverse);
        activeTrade.maxFavorableR = activeTrade.maxFavorablePriceMove / activeTrade.risk;
        activeTrade.maxAdverseR = activeTrade.maxAdversePriceMove / activeTrade.risk;
        activeTrade.updatedAt = Date.now();
    }

    function closeActiveTrade(state, exitPrice, exitReason, context = {}) {
        if (!activeTrade || ![HND_TRADE_ENGINE_STATES.CLOSED_TP,
            HND_TRADE_ENGINE_STATES.CLOSED_SL,
            HND_TRADE_ENGINE_STATES.CANCELLED_MARKET_CHANGE,
            HND_TRADE_ENGINE_STATES.CANCELLED_MANUAL].includes(state) ||
            !finitePositive(exitPrice)) return null;
        const now = Number.isFinite(context.closedAt) ? context.closedAt : Date.now();
        const pnl = activeTrade.direction === "LONG"
            ? exitPrice - activeTrade.entryPrice : activeTrade.entryPrice - exitPrice;
        const closed = {
            ...activeTrade, state, updatedAt: now, lastPrice: exitPrice,
            unrealizedPricePnL: pnl, unrealizedR: pnl / activeTrade.risk,
            closedAt: now,
            closedAtCandleTime: Number.isFinite(context.closedAtCandleTime)
                ? context.closedAtCandleTime : null,
            exitPrice, exitReason,
            exitSource: typeof context.exitSource === "string" ? context.exitSource : null,
            realizedPricePnL: pnl, realizedR: pnl / activeTrade.risk,
            durationMs: Math.max(0, now - activeTrade.openedAt),
            durationBars: Number.isInteger(context.closedAtCandleIndex) &&
                Number.isInteger(activeTrade.openedAtCandleIndex) &&
                activeTrade.openedAtCandleIndex >= 0
                ? Math.max(0, context.closedAtCandleIndex - activeTrade.openedAtCandleIndex) : null
        };
        tradeHistory.push(clone(closed));
        tradeHistory = tradeHistory.slice(-HND_TRADE_MAX_HISTORY);
        lastClosedTrade = clone(closed);
        activeTrade = null;
        pendingExecution = null;
        return clone(closed);
    }

    function updateActiveTrade(input = {}) {
        if (!activeTrade) return { reason: HND_TRADE_DEBUG_REASONS.NO_READY_PLAN, context: {} };
        const price = input.price;
        updateTradeMetrics(price);
        const tickerStopHit = finitePositive(price) && (activeTrade.direction === "LONG"
            ? price <= activeTrade.stopLoss : price >= activeTrade.stopLoss);
        const tickerTargetHit = finitePositive(price) && (activeTrade.direction === "LONG"
            ? price >= activeTrade.takeProfit : price <= activeTrade.takeProfit);
        const normalized = normalizeTradeCandles(input.candles);
        const latestIndex = normalized.length - 1;
        if (tickerStopHit) {
            const exitPrice = activeTrade.stopLoss;
            closeActiveTrade(HND_TRADE_ENGINE_STATES.CLOSED_SL, exitPrice, "STOP_LOSS", {
                exitSource: "TICKER", closedAtCandleIndex: latestIndex
            });
            return { reason: HND_TRADE_DEBUG_REASONS.STOP_LOSS_HIT,
                context: { tickerStopHit, exitPrice, exitReason: "STOP_LOSS" } };
        }
        if (tickerTargetHit) {
            const exitPrice = activeTrade.takeProfit;
            closeActiveTrade(HND_TRADE_ENGINE_STATES.CLOSED_TP, exitPrice, "TAKE_PROFIT", {
                exitSource: "TICKER", closedAtCandleIndex: latestIndex
            });
            return { reason: HND_TRADE_DEBUG_REASONS.TAKE_PROFIT_HIT,
                context: { tickerTargetHit, exitPrice, exitReason: "TAKE_PROFIT" } };
        }
        const closed = getClosedTradeCandles(input.candles).filter(candle =>
            (!Number.isFinite(activeTrade.openedAtCandleTime) ||
                candle.time > activeTrade.openedAtCandleTime) &&
            (!Number.isFinite(activeTrade.lastProcessedClosedCandleTime) ||
                candle.time > activeTrade.lastProcessedClosedCandleTime)
        ).slice(-HND_TRADE_MAX_PROCESSED_CANDLES);
        let processed = 0;
        for (const candle of closed) {
            processed += 1;
            const stopHit = activeTrade.direction === "LONG"
                ? candle.low <= activeTrade.stopLoss : candle.high >= activeTrade.stopLoss;
            const targetHit = activeTrade.direction === "LONG"
                ? candle.high >= activeTrade.takeProfit : candle.low <= activeTrade.takeProfit;
            activeTrade.lastProcessedClosedCandleTime = candle.time;
            if (stopHit) {
                const bothHit = targetHit;
                const reason = bothHit ? "BOTH_HIT_STOP_FIRST" : "STOP_LOSS";
                const debugReason = bothHit ? HND_TRADE_DEBUG_REASONS.BOTH_HIT_STOP_FIRST
                    : HND_TRADE_DEBUG_REASONS.STOP_LOSS_HIT;
                const exitPrice = activeTrade.stopLoss;
                closeActiveTrade(HND_TRADE_ENGINE_STATES.CLOSED_SL, exitPrice, reason, {
                    exitSource: "CLOSED_CANDLE", closedAt: candle.closeTime,
                    closedAtCandleTime: candle.time,
                    closedAtCandleIndex: normalized.findIndex(item => item.time === candle.time)
                });
                return { reason: debugReason, context: { closedCandlesProcessed: processed,
                    stopHit, targetHit, bothHit, exitPrice, exitReason: reason } };
            }
            if (targetHit) {
                const exitPrice = activeTrade.takeProfit;
                closeActiveTrade(HND_TRADE_ENGINE_STATES.CLOSED_TP, exitPrice, "TAKE_PROFIT", {
                    exitSource: "CLOSED_CANDLE", closedAt: candle.closeTime,
                    closedAtCandleTime: candle.time,
                    closedAtCandleIndex: normalized.findIndex(item => item.time === candle.time)
                });
                return { reason: HND_TRADE_DEBUG_REASONS.TAKE_PROFIT_HIT,
                    context: { closedCandlesProcessed: processed, targetHit,
                        exitPrice, exitReason: "TAKE_PROFIT" } };
            }
        }
        return { reason: HND_TRADE_DEBUG_REASONS.TRADE_OPEN_LOCKED,
            context: { closedCandlesProcessed: processed } };
    }

    function evaluate(input = {}) {
        let reason;
        let debugContext = {};
        let cycleStatus = HND_TRADE_ENGINE_STATES.NO_TRADE;
        if (activeTrade) {
            const updated = updateActiveTrade(input);
            reason = updated.reason;
            debugContext = updated.context;
            cycleStatus = activeTrade ? HND_TRADE_ENGINE_STATES.OPEN
                : lastClosedTrade?.state || HND_TRADE_ENGINE_STATES.NO_TRADE;
        } else {
            const plan = input.tradePlanState?.currentPlan || null;
            const setup = input.setupState?.currentSetup || null;
            if (!plan || plan.state !== "READY") {
                pendingExecution = null;
                reason = HND_TRADE_DEBUG_REASONS.NO_READY_PLAN;
            } else if (!validateReadyPlan(plan)) {
                pendingExecution = null;
                reason = HND_TRADE_DEBUG_REASONS.INVALID_PLAN;
            } else if (!validateTriggeredSetup(setup, plan)) {
                pendingExecution = null;
                reason = HND_TRADE_DEBUG_REASONS.PLAN_SETUP_MISMATCH;
            } else if (consumedPlanKeys.has(plan.key)) {
                pendingExecution = null;
                reason = HND_TRADE_DEBUG_REASONS.PLAN_ALREADY_CONSUMED;
            } else {
                const candles = normalizeTradeCandles(input.candles);
                const latest = candles[candles.length - 1] || null;
                if (!pendingExecution || pendingExecution.planKey !== plan.key) {
                    pendingExecution = {
                        planKey: plan.key, setupKey: plan.setupKey,
                        symbol: plan.symbol, interval: plan.interval,
                        direction: plan.direction, entryPrice: plan.entryPrice,
                        observedAt: Date.now(), observedCandleTime: latest?.time ?? null,
                        lastProcessedClosedCandleTime: latest?.time ?? null,
                        lastCheckedAt: Date.now()
                    };
                }
                pendingExecution.lastCheckedAt = Date.now();
                const epsilon = Math.max(1e-12,
                    Math.abs(plan.entryPrice) * HND_TRADE_PRICE_EPSILON_FACTOR);
                const tickerEntryCondition = finitePositive(input.price) &&
                    (plan.direction === "LONG"
                        ? input.price <= plan.entryPrice + epsilon
                        : input.price >= plan.entryPrice - epsilon);
                debugContext.tickerEntryCondition = tickerEntryCondition;
                const beyondStop = tickerEntryCondition && (plan.direction === "LONG"
                    ? input.price <= plan.stopLoss : input.price >= plan.stopLoss);
                if (beyondStop) {
                    reason = HND_TRADE_DEBUG_REASONS.ENTRY_ALREADY_BEYOND_STOP;
                    cycleStatus = HND_TRADE_ENGINE_STATES.WAITING_ENTRY;
                } else if (tickerEntryCondition) {
                    openFromPlan(plan, setup, {
                        fillSource: "TICKER_LIMIT_CROSS", fillObservedPrice: input.price,
                        openedAt: Date.now(), openedAtCandleTime: latest?.time ?? null,
                        openedAtCandleIndex: latest ? candles.length - 1 : -1
                    });
                    reason = HND_TRADE_DEBUG_REASONS.TRADE_OPENED;
                    debugContext.fillSource = "TICKER_LIMIT_CROSS";
                    cycleStatus = HND_TRADE_ENGINE_STATES.OPEN;
                } else {
                    const newClosed = getClosedTradeCandles(input.candles).filter(candle =>
                        (!Number.isFinite(pendingExecution.observedCandleTime) ||
                            candle.time > pendingExecution.observedCandleTime) &&
                        (!Number.isFinite(pendingExecution.lastProcessedClosedCandleTime) ||
                            candle.time > pendingExecution.lastProcessedClosedCandleTime)
                    ).slice(-HND_TRADE_MAX_PROCESSED_CANDLES);
                    reason = HND_TRADE_DEBUG_REASONS.WAITING_ENTRY;
                    for (const candle of newClosed) {
                        pendingExecution.lastProcessedClosedCandleTime = candle.time;
                        const crossed = candle.low <= plan.entryPrice && candle.high >= plan.entryPrice;
                        if (!crossed) continue;
                        debugContext.closedCandleEntryCondition = true;
                        const stopTouched = plan.direction === "LONG"
                            ? candle.low <= plan.stopLoss : candle.high >= plan.stopLoss;
                        const targetTouched = plan.direction === "LONG"
                            ? candle.high >= plan.takeProfit : candle.low <= plan.takeProfit;
                        if (stopTouched) {
                            reason = HND_TRADE_DEBUG_REASONS.AMBIGUOUS_ENTRY_AND_STOP_SAME_CANDLE;
                            continue;
                        }
                        if (targetTouched) {
                            reason = HND_TRADE_DEBUG_REASONS.AMBIGUOUS_ENTRY_AND_TARGET_SAME_CANDLE;
                            continue;
                        }
                        openFromPlan(plan, setup, {
                            fillSource: "CLOSED_CANDLE_ENTRY_CROSS",
                            fillObservedPrice: plan.entryPrice,
                            openedAt: Number.isFinite(candle.closeTime) ? candle.closeTime : Date.now(),
                            openedAtCandleTime: candle.time,
                            openedAtCandleIndex: candles.findIndex(item => item.time === candle.time)
                        });
                        reason = HND_TRADE_DEBUG_REASONS.TRADE_OPENED;
                        debugContext.fillSource = "CLOSED_CANDLE_ENTRY_CROSS";
                        cycleStatus = HND_TRADE_ENGINE_STATES.OPEN;
                        break;
                    }
                    if (!activeTrade) cycleStatus = HND_TRADE_ENGINE_STATES.WAITING_ENTRY;
                }
            }
        }
        const debug = createDebug(input, reason, debugContext);
        lastEvaluation = {
            symbol: String(input.symbol || ""), interval: String(input.interval || ""),
            price: Number.isFinite(input.price) ? input.price : null,
            status: cycleStatus, evaluatedAt: Date.now(), debug: clone(debug)
        };
        return getState();
    }

    function reset(reason = "MANUAL_RESET") {
        let cancelled = null;
        if (activeTrade) {
            const marketChange = ["SYMBOL_CHANGED", "TIMEFRAME_CHANGED"].includes(reason);
            const state = marketChange ? HND_TRADE_ENGINE_STATES.CANCELLED_MARKET_CHANGE
                : HND_TRADE_ENGINE_STATES.CANCELLED_MANUAL;
            const debugReason = marketChange
                ? HND_TRADE_DEBUG_REASONS.TRADE_CANCELLED_MARKET_CHANGE
                : HND_TRADE_DEBUG_REASONS.TRADE_CANCELLED_MANUAL;
            cancelled = closeActiveTrade(state,
                finitePositive(activeTrade.lastPrice) ? activeTrade.lastPrice : activeTrade.entryPrice,
                reason, { exitSource: "RESET" });
            lastEvaluation = { status: state, evaluatedAt: Date.now(),
                debug: { version: HND_TRADE_ENGINE_VERSION, primaryReason: debugReason } };
        }
        activeTrade = null;
        pendingExecution = null;
        lastEvaluation = null;
        return { status: HND_TRADE_ENGINE_STATES.NO_TRADE, reason, cancelledTrade: clone(cancelled) };
    }

    function clearHistory() {
        tradeHistory = []; lastClosedTrade = null; consumedPlanKeys = new Set();
        return { historyCount: 0, consumedPlanCount: 0 };
    }
    function getActiveTrade() { return clone(activeTrade); }
    function getLastClosedTrade() { return clone(lastClosedTrade); }
    function getHistory() { return clone(tradeHistory); }
    function getLastDebug() { return clone(lastEvaluation?.debug ?? null); }
    function getState() {
        const status = activeTrade ? HND_TRADE_ENGINE_STATES.OPEN
            : pendingExecution ? HND_TRADE_ENGINE_STATES.WAITING_ENTRY
                : lastEvaluation?.status || HND_TRADE_ENGINE_STATES.NO_TRADE;
        return {
            version: HND_TRADE_ENGINE_VERSION, status,
            activeTrade: clone(activeTrade), pendingExecution: clone(pendingExecution),
            lastClosedTrade: clone(lastClosedTrade), historyCount: tradeHistory.length,
            consumedPlanCount: consumedPlanKeys.size, lastEvaluation: clone(lastEvaluation)
        };
    }
    function explainLastEvaluation() {
        const debug = getLastDebug();
        return {
            primaryReason: debug?.primaryReason ?? null, status: getState().status,
            activeTrade: getActiveTrade(), lastClosedTrade: getLastClosedTrade(),
            summary: debug ? {
                planReady: debug.plan.state === "READY", planConsumed: debug.plan.consumed,
                pending: debug.execution.pending, fillSource: debug.execution.fillSource,
                unrealizedR: debug.trade.unrealizedR, exitReason: debug.exit.exitReason
            } : null
        };
    }

    window.HNDTradeEngine = {
        evaluate, reset, clearHistory, getState, getActiveTrade, getLastClosedTrade,
        getHistory, getLastDebug, explainLastEvaluation, openFromPlan,
        updateActiveTrade, closeActiveTrade
    };
})();

function openTrade(planOrSignal, setupOrPrice, context = {}) {
    if (!planOrSignal || typeof planOrSignal !== "object" ||
        !setupOrPrice || typeof setupOrPrice !== "object") {
        console.warn("Raw signal/price trade opening is disabled. A READY locked trade plan is required.");
        return null;
    }
    return window.HNDTradeEngine?.openFromPlan?.(planOrSignal, setupOrPrice, context) || null;
}

function checkTrade(price, candles = []) {
    console.warn("Legacy checkTrade is disabled in the main cycle; use HNDTradeEngine.evaluate().");
    return window.HNDTradeEngine?.updateActiveTrade?.({ price, candles }) || null;
}
