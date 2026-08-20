(function () {
    "use strict";

    const HND_TRADE_PLAN_VERSION = "4.2";
    const HND_TRADE_PLAN_MIN_RR = 2;
    const HND_TRADE_PLAN_STOP_BUFFER_ATR = 0.15;
    const HND_TRADE_PLAN_MIN_RISK_ATR = 0.25;
    const HND_TRADE_PLAN_MAX_RISK_ATR = 4;
    const HND_TRADE_PLAN_MAX_HISTORY = 50;
    const HND_TRADE_PLAN_MAX_DEBUG_TARGETS = 10;
    const HND_TRADE_PLAN_STATES = Object.freeze({
        NO_PLAN: "NO_PLAN", PLANNED: "PLANNED", ARMED: "ARMED", READY: "READY",
        CANCELLED_INVALIDATED: "CANCELLED_INVALIDATED",
        CANCELLED_MISSED: "CANCELLED_MISSED",
        CANCELLED_ORPHANED: "CANCELLED_ORPHANED"
    });
    const HND_TRADE_PLAN_DEBUG_REASONS = Object.freeze({
        NO_SETUP: "NO_SETUP", INVALID_SETUP: "INVALID_SETUP",
        INVALID_STOP: "INVALID_STOP", INVALID_RISK_DISTANCE: "INVALID_RISK_DISTANCE",
        INVALID_TAKE_PROFIT: "INVALID_TAKE_PROFIT", PLAN_CREATED: "PLAN_CREATED",
        PLAN_LOCKED: "PLAN_LOCKED", PLAN_ARMED: "PLAN_ARMED", PLAN_READY: "PLAN_READY",
        PLAN_CANCELLED_INVALIDATED: "PLAN_CANCELLED_INVALIDATED",
        PLAN_CANCELLED_MISSED: "PLAN_CANCELLED_MISSED",
        PLAN_CANCELLED_ORPHANED: "PLAN_CANCELLED_ORPHANED",
        PLAN_ENGINE_ERROR: "PLAN_ENGINE_ERROR"
    });

    let currentPlan = null;
    let lastTerminalPlan = null;
    let planHistory = [];
    let lastEvaluation = null;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }
    function finitePositive(value) { return Number.isFinite(value) && value > 0; }

    function mapSetupStateToPlanState(setupState) {
        if (setupState === "PENDING") return HND_TRADE_PLAN_STATES.PLANNED;
        if (setupState === "ARMED") return HND_TRADE_PLAN_STATES.ARMED;
        if (setupState === "TRIGGERED") return HND_TRADE_PLAN_STATES.READY;
        return HND_TRADE_PLAN_STATES.NO_PLAN;
    }

    function normalizePlanSourceZones(sourceSnapshot) {
        return (Array.isArray(sourceSnapshot) ? sourceSnapshot : []).map(source => {
            if (!source || typeof source.id !== "string" || !source.id.trim() ||
                !["ORDER_BLOCK", "FVG"].includes(source.kind) ||
                !["BULLISH", "BEARISH"].includes(source.type) ||
                !finitePositive(source.top) || !finitePositive(source.bottom) ||
                source.top < source.bottom) return null;
            return {
                id: source.id, kind: source.kind, type: source.type,
                status: typeof source.status === "string" ? source.status : null,
                top: source.top, bottom: source.bottom,
                structureEventId: typeof source.structureEventId === "string"
                    ? source.structureEventId : null
            };
        }).filter(Boolean);
    }

    function validateSetup(setup) {
        return Boolean(setup && typeof setup.id === "string" && setup.id.trim() &&
            typeof setup.key === "string" && setup.key.trim() &&
            typeof setup.symbol === "string" && setup.symbol.trim() &&
            typeof setup.interval === "string" && setup.interval.trim() &&
            ["LONG", "SHORT"].includes(setup.direction) &&
            ["PENDING", "ARMED", "TRIGGERED"].includes(setup.state) &&
            finitePositive(setup.entryLow) && finitePositive(setup.entryHigh) &&
            finitePositive(setup.entryTarget) && setup.entryLow <= setup.entryTarget &&
            setup.entryTarget <= setup.entryHigh && finitePositive(setup.invalidationPrice) &&
            finitePositive(setup.atr) && Array.isArray(setup.zoneIds) &&
            Array.isArray(setup.sourceSnapshot));
    }

    function calculateStopLoss(setup) {
        if (!validateSetup(setup)) return { valid: false, reason: "INVALID_SETUP" };
        const expectedType = setup.direction === "LONG" ? "BULLISH" : "BEARISH";
        const sources = normalizePlanSourceZones(setup.sourceSnapshot)
            .filter(source => source.type === expectedType);
        const sourceBoundary = setup.direction === "LONG"
            ? Math.min(setup.entryLow, ...sources.map(source => source.bottom))
            : Math.max(setup.entryHigh, ...sources.map(source => source.top));
        const bufferATR = setup.atr * HND_TRADE_PLAN_STOP_BUFFER_ATR;
        let stopLoss;
        if (setup.direction === "LONG") {
            const rawSourceStop = sourceBoundary - bufferATR;
            stopLoss = Math.min(rawSourceStop, setup.invalidationPrice);
            stopLoss = Math.min(stopLoss,
                setup.entryTarget - setup.atr * HND_TRADE_PLAN_MIN_RISK_ATR);
        } else {
            const rawSourceStop = sourceBoundary + bufferATR;
            stopLoss = Math.max(rawSourceStop, setup.invalidationPrice);
            stopLoss = Math.max(stopLoss,
                setup.entryTarget + setup.atr * HND_TRADE_PLAN_MIN_RISK_ATR);
        }
        const risk = setup.direction === "LONG"
            ? setup.entryTarget - stopLoss : stopLoss - setup.entryTarget;
        const riskATR = risk / setup.atr;
        if (!finitePositive(risk) || !Number.isFinite(riskATR) ||
            riskATR < HND_TRADE_PLAN_MIN_RISK_ATR ||
            (setup.direction === "LONG" ? stopLoss >= setup.entryTarget : stopLoss <= setup.entryTarget)) {
            return { valid: false, reason: "INVALID_STOP" };
        }
        if (riskATR > HND_TRADE_PLAN_MAX_RISK_ATR) {
            return { valid: false, reason: "INVALID_RISK_DISTANCE" };
        }
        return {
            valid: true, stopLoss, risk, riskATR,
            stopSource: "SOURCE_ZONE_ATR_BUFFER", sourceBoundary,
            bufferATR: HND_TRADE_PLAN_STOP_BUFFER_ATR
        };
    }

    function normalizePlanLiquidityZones(liquidityZones, strongestLiquidity) {
        const source = (Array.isArray(liquidityZones) ? liquidityZones : []).slice();
        [strongestLiquidity?.overall, strongestLiquidity?.buySide, strongestLiquidity?.sellSide]
            .forEach(zone => { if (zone) source.push(zone); });
        const byId = new Map();
        source.forEach(zone => {
            if (!zone || typeof zone.id !== "string" || !zone.id.trim() ||
                zone.kind !== "LIQUIDITY" || !["BUY_SIDE", "SELL_SIDE"].includes(zone.type) ||
                zone.status !== "ACTIVE" || !finitePositive(zone.price) ||
                !finitePositive(zone.zoneLow) || !finitePositive(zone.zoneHigh) ||
                zone.zoneHigh < zone.zoneLow || !Number.isFinite(zone.strength) ||
                !Number.isFinite(zone.touchCount) || !Number.isFinite(zone.lastTouchIndex)) return;
            byId.set(zone.id, {
                id: zone.id, kind: "LIQUIDITY", type: zone.type, status: zone.status,
                price: zone.price, zoneLow: zone.zoneLow, zoneHigh: zone.zoneHigh,
                strength: zone.strength, touchCount: zone.touchCount,
                lastTouchIndex: zone.lastTouchIndex
            });
        });
        return [...byId.values()];
    }

    function selectTakeProfit(setup, stopResult, liquidityZones, strongestLiquidity) {
        if (!validateSetup(setup) || !stopResult?.valid || !finitePositive(stopResult.risk))
            return { valid: false, reason: "INVALID_STOP" };
        const normalized = normalizePlanLiquidityZones(liquidityZones, strongestLiquidity);
        const expectedType = setup.direction === "LONG" ? "BUY_SIDE" : "SELL_SIDE";
        const directionMatched = normalized.filter(zone => zone.type === expectedType);
        const samples = [];
        const candidates = [];
        directionMatched.forEach(zone => {
            const targetPrice = setup.direction === "LONG" ? zone.zoneLow : zone.zoneHigh;
            const reward = setup.direction === "LONG"
                ? targetPrice - setup.entryTarget : setup.entryTarget - targetPrice;
            const riskReward = reward / stopResult.risk;
            const correctSide = setup.direction === "LONG"
                ? targetPrice > setup.entryTarget : targetPrice < setup.entryTarget;
            const eligible = correctSide && finitePositive(reward) &&
                riskReward + Math.max(1e-12, setup.atr * 1e-9) >= HND_TRADE_PLAN_MIN_RR;
            if (samples.length < HND_TRADE_PLAN_MAX_DEBUG_TARGETS) samples.push({
                id: zone.id, type: zone.type, targetPrice, reward,
                riskReward: Number.isFinite(riskReward) ? riskReward : null,
                strength: zone.strength, touchCount: zone.touchCount,
                lastTouchIndex: zone.lastTouchIndex, eligible
            });
            if (eligible) candidates.push({ zone, targetPrice, reward, riskReward });
        });
        candidates.sort((first, second) =>
            first.reward - second.reward || second.zone.strength - first.zone.strength ||
            second.zone.touchCount - first.zone.touchCount ||
            second.zone.lastTouchIndex - first.zone.lastTouchIndex ||
            first.zone.id.localeCompare(second.zone.id)
        );
        if (candidates.length) {
            const selected = candidates[0];
            return {
                valid: true, takeProfit: selected.targetPrice, reward: selected.reward,
                riskReward: selected.riskReward, targetSource: "ACTIVE_LIQUIDITY",
                targetLiquidityId: selected.zone.id,
                targetLiquidityType: selected.zone.type,
                targetLiquidityStrength: selected.zone.strength,
                liquidityZonesReceived: (Array.isArray(liquidityZones) ? liquidityZones.length : 0) +
                    [strongestLiquidity?.overall, strongestLiquidity?.buySide,
                        strongestLiquidity?.sellSide].filter(Boolean).length,
                validLiquidityZones: normalized.length,
                directionMatched: directionMatched.length,
                eligibleTargets: candidates.length, candidateSamples: samples
            };
        }
        const takeProfit = setup.direction === "LONG"
            ? setup.entryTarget + stopResult.risk * HND_TRADE_PLAN_MIN_RR
            : setup.entryTarget - stopResult.risk * HND_TRADE_PLAN_MIN_RR;
        const reward = stopResult.risk * HND_TRADE_PLAN_MIN_RR;
        if (!finitePositive(takeProfit)) return { valid: false, reason: "INVALID_TAKE_PROFIT" };
        return {
            valid: true, takeProfit, reward, riskReward: HND_TRADE_PLAN_MIN_RR,
            targetSource: "RR_FALLBACK", targetLiquidityId: null,
            targetLiquidityType: null, targetLiquidityStrength: null,
            liquidityZonesReceived: (Array.isArray(liquidityZones) ? liquidityZones.length : 0) +
                [strongestLiquidity?.overall, strongestLiquidity?.buySide,
                    strongestLiquidity?.sellSide].filter(Boolean).length,
            validLiquidityZones: normalized.length,
            directionMatched: directionMatched.length,
            eligibleTargets: 0, candidateSamples: samples
        };
    }

    function snapshotSetup(setup) {
        return {
            id: setup.id, key: setup.key, direction: setup.direction, state: setup.state,
            entryLow: setup.entryLow, entryHigh: setup.entryHigh,
            entryTarget: setup.entryTarget, invalidationPrice: setup.invalidationPrice,
            atr: setup.atr, quality: Number.isFinite(setup.quality) ? setup.quality : null,
            sourceType: typeof setup.sourceType === "string" ? setup.sourceType : null,
            zoneIds: setup.zoneIds.filter(id => typeof id === "string").slice(),
            structureEventId: typeof setup.structureEventId === "string"
                ? setup.structureEventId : null
        };
    }

    function buildPlan(input = {}, pureOptions = null) {
        const setup = input.setupState?.currentSetup;
        if (!validateSetup(setup)) return { valid: false, reason: "INVALID_SETUP" };
        const stopResult = calculateStopLoss(setup);
        if (!stopResult.valid) return { valid: false, reason: stopResult.reason, stopResult };
        const targetResult = selectTakeProfit(
            setup, stopResult, input.liquidityZones, input.strongestLiquidity
        );
        if (!targetResult.valid) return {
            valid: false, reason: targetResult.reason, stopResult, targetResult
        };
        const epsilon = Math.max(1e-12, setup.atr * 1e-9);
        const ordered = setup.direction === "LONG"
            ? stopResult.stopLoss < setup.entryTarget && setup.entryTarget < targetResult.takeProfit
            : targetResult.takeProfit < setup.entryTarget && setup.entryTarget < stopResult.stopLoss;
        if (!ordered || targetResult.riskReward + epsilon < HND_TRADE_PLAN_MIN_RR)
            return { valid: false, reason: "INVALID_TAKE_PROFIT", stopResult, targetResult };
        const now = pureOptions && Number.isSafeInteger(pureOptions.evaluationTime) &&
            pureOptions.evaluationTime > 0 ? pureOptions.evaluationTime : Date.now();
        const state = mapSetupStateToPlanState(setup.state);
        const plan = {
            id: `PLAN-${setup.key}`, key: `${setup.key}|TRADE_PLAN_V4.2`,
            version: HND_TRADE_PLAN_VERSION, setupId: setup.id, setupKey: setup.key,
            symbol: setup.symbol, interval: setup.interval, direction: setup.direction, state,
            entryLow: setup.entryLow, entryHigh: setup.entryHigh, entryPrice: setup.entryTarget,
            stopLoss: stopResult.stopLoss, takeProfit: targetResult.takeProfit,
            risk: stopResult.risk, reward: targetResult.reward,
            riskATR: stopResult.riskATR, riskReward: targetResult.riskReward,
            stopSource: stopResult.stopSource, targetSource: targetResult.targetSource,
            targetLiquidityId: targetResult.targetLiquidityId,
            targetLiquidityType: targetResult.targetLiquidityType,
            targetLiquidityStrength: targetResult.targetLiquidityStrength,
            setupQuality: Number.isFinite(setup.quality) ? setup.quality : null,
            setupSourceType: typeof setup.sourceType === "string" ? setup.sourceType : null,
            zoneIds: setup.zoneIds.filter(id => typeof id === "string").slice(),
            structureEventId: typeof setup.structureEventId === "string"
                ? setup.structureEventId : null,
            createdAt: now, updatedAt: now, stateChangedAt: now,
            armedAt: state === HND_TRADE_PLAN_STATES.ARMED ? now : null,
            readyAt: state === HND_TRADE_PLAN_STATES.READY ? now : null,
            setupSnapshot: snapshotSetup(setup),
            stopSnapshot: clone(stopResult), targetSnapshot: clone(targetResult)
        };
        return { valid: true, plan, stopResult, targetResult };
    }

    function createDebug(input, setup, reason, stopResult = null, targetResult = null) {
        return {
            version: HND_TRADE_PLAN_VERSION,
            symbol: String(input.symbol || ""), interval: String(input.interval || ""),
            price: Number.isFinite(input.price) ? input.price : null,
            setupPresent: Boolean(setup), setupId: setup?.id ?? null,
            setupKey: setup?.key ?? null, setupState: setup?.state ?? null,
            primaryReason: reason,
            stop: {
                sourceBoundary: Number.isFinite(stopResult?.sourceBoundary)
                    ? stopResult.sourceBoundary : null,
                bufferATR: Number.isFinite(stopResult?.bufferATR) ? stopResult.bufferATR : null,
                stopLoss: Number.isFinite(stopResult?.stopLoss) ? stopResult.stopLoss : null,
                risk: Number.isFinite(stopResult?.risk) ? stopResult.risk : null,
                riskATR: Number.isFinite(stopResult?.riskATR) ? stopResult.riskATR : null
            },
            target: {
                source: targetResult?.targetSource ?? null,
                liquidityZonesReceived: targetResult?.liquidityZonesReceived ?? 0,
                validLiquidityZones: targetResult?.validLiquidityZones ?? 0,
                directionMatched: targetResult?.directionMatched ?? 0,
                minimumRR: HND_TRADE_PLAN_MIN_RR,
                eligibleTargets: targetResult?.eligibleTargets ?? 0,
                selectedLiquidityId: targetResult?.targetLiquidityId ?? null,
                takeProfit: Number.isFinite(targetResult?.takeProfit) ? targetResult.takeProfit : null,
                reward: Number.isFinite(targetResult?.reward) ? targetResult.reward : null,
                riskReward: Number.isFinite(targetResult?.riskReward) ? targetResult.riskReward : null,
                candidateSamples: clone(targetResult?.candidateSamples || [])
                    .slice(0, HND_TRADE_PLAN_MAX_DEBUG_TARGETS)
            },
            locked: { existingPlan: Boolean(currentPlan), immutableFieldsPreserved: false },
            evaluatedAt: Date.now()
        };
    }

    function terminalize(state, reason, input, terminalSetup) {
        const now = Date.now();
        const terminal = { ...currentPlan, state, updatedAt: now, stateChangedAt: now };
        planHistory.push(clone(terminal));
        planHistory = planHistory.slice(-HND_TRADE_PLAN_MAX_HISTORY);
        lastTerminalPlan = clone(terminal);
        const debug = createDebug(input, terminalSetup, reason,
            terminal.stopSnapshot, terminal.targetSnapshot);
        debug.locked = { existingPlan: true, immutableFieldsPreserved: true };
        currentPlan = null;
        return debug;
    }

    function evaluate(input = {}) {
        const setup = input.setupState?.currentSetup || null;
        let debug;
        if (currentPlan) {
            if (setup && setup.key === currentPlan.setupKey && validateSetup(setup)) {
                const nextState = mapSetupStateToPlanState(setup.state);
                const previousState = currentPlan.state;
                const now = Date.now();
                currentPlan.updatedAt = now;
                currentPlan.setupSnapshot.state = setup.state;
                if (nextState !== previousState) {
                    currentPlan.state = nextState;
                    currentPlan.stateChangedAt = now;
                }
                if (nextState === HND_TRADE_PLAN_STATES.ARMED && currentPlan.armedAt === null)
                    currentPlan.armedAt = now;
                if (nextState === HND_TRADE_PLAN_STATES.READY && currentPlan.readyAt === null)
                    currentPlan.readyAt = now;
                const reason = nextState === HND_TRADE_PLAN_STATES.ARMED && previousState !== nextState
                    ? HND_TRADE_PLAN_DEBUG_REASONS.PLAN_ARMED
                    : nextState === HND_TRADE_PLAN_STATES.READY && previousState !== nextState
                        ? HND_TRADE_PLAN_DEBUG_REASONS.PLAN_READY
                        : HND_TRADE_PLAN_DEBUG_REASONS.PLAN_LOCKED;
                debug = createDebug(input, setup, reason,
                    currentPlan.stopSnapshot, currentPlan.targetSnapshot);
                debug.locked = { existingPlan: true, immutableFieldsPreserved: true };
            } else {
                const terminalSetup = input.setupState?.lastTerminalSetup || null;
                if (terminalSetup?.key === currentPlan.setupKey && terminalSetup.state === "INVALIDATED") {
                    debug = terminalize(HND_TRADE_PLAN_STATES.CANCELLED_INVALIDATED,
                        HND_TRADE_PLAN_DEBUG_REASONS.PLAN_CANCELLED_INVALIDATED, input, terminalSetup);
                } else if (terminalSetup?.key === currentPlan.setupKey && terminalSetup.state === "MISSED") {
                    debug = terminalize(HND_TRADE_PLAN_STATES.CANCELLED_MISSED,
                        HND_TRADE_PLAN_DEBUG_REASONS.PLAN_CANCELLED_MISSED, input, terminalSetup);
                } else {
                    debug = terminalize(HND_TRADE_PLAN_STATES.CANCELLED_ORPHANED,
                        HND_TRADE_PLAN_DEBUG_REASONS.PLAN_CANCELLED_ORPHANED, input, setup);
                }
            }
        } else if (!setup) {
            debug = createDebug(input, null, HND_TRADE_PLAN_DEBUG_REASONS.NO_SETUP);
        } else if (!validateSetup(setup)) {
            debug = createDebug(input, setup, HND_TRADE_PLAN_DEBUG_REASONS.INVALID_SETUP);
        } else {
            const built = buildPlan(input);
            if (built.valid) {
                currentPlan = built.plan;
                debug = createDebug(input, setup, HND_TRADE_PLAN_DEBUG_REASONS.PLAN_CREATED,
                    built.stopResult, built.targetResult);
            } else {
                const reason = built.reason === "INVALID_RISK_DISTANCE"
                    ? HND_TRADE_PLAN_DEBUG_REASONS.INVALID_RISK_DISTANCE
                    : built.reason === "INVALID_TAKE_PROFIT"
                        ? HND_TRADE_PLAN_DEBUG_REASONS.INVALID_TAKE_PROFIT
                        : built.reason === "INVALID_SETUP"
                            ? HND_TRADE_PLAN_DEBUG_REASONS.INVALID_SETUP
                            : HND_TRADE_PLAN_DEBUG_REASONS.INVALID_STOP;
                debug = createDebug(input, setup, reason, built.stopResult, built.targetResult);
            }
        }
        lastEvaluation = {
            symbol: String(input.symbol || ""), interval: String(input.interval || ""),
            price: Number.isFinite(input.price) ? input.price : null,
            status: currentPlan?.state || HND_TRADE_PLAN_STATES.NO_PLAN,
            evaluatedAt: Date.now(), debug: clone(debug)
        };
        return getState();
    }

    function reset(reason = "MANUAL_RESET") {
        currentPlan = null; lastTerminalPlan = null; planHistory = []; lastEvaluation = null;
        return { status: HND_TRADE_PLAN_STATES.NO_PLAN, reason };
    }
    function getCurrentPlan() { return clone(currentPlan); }
    function getHistory() { return clone(planHistory); }
    function getLastDebug() { return clone(lastEvaluation?.debug ?? null); }
    function getState() {
        return {
            version: HND_TRADE_PLAN_VERSION,
            status: currentPlan?.state || HND_TRADE_PLAN_STATES.NO_PLAN,
            currentPlan: clone(currentPlan), lastTerminalPlan: clone(lastTerminalPlan),
            historyCount: planHistory.length, lastEvaluation: clone(lastEvaluation)
        };
    }
    function explainLastEvaluation() {
        const debug = getLastDebug();
        return {
            primaryReason: debug?.primaryReason ?? null,
            currentPlan: getCurrentPlan(),
            summary: debug ? {
                setupPresent: debug.setupPresent, setupState: debug.setupState,
                stopLoss: debug.stop.stopLoss, riskATR: debug.stop.riskATR,
                targetSource: debug.target.source, takeProfit: debug.target.takeProfit,
                riskReward: debug.target.riskReward,
                eligibleTargets: debug.target.eligibleTargets,
                immutableFieldsPreserved: debug.locked.immutableFieldsPreserved
            } : null,
            targetCandidates: clone(debug?.target?.candidateSamples || [])
        };
    }

    window.HNDTradePlanEngine = {
        evaluate, reset, getState, getCurrentPlan, getHistory, getLastDebug,
        explainLastEvaluation, buildPlan, calculateStopLoss, selectTakeProfit
    };
})();
