(function () {
    "use strict";

    const HND_SETUP_VERSION = "4.1";
    const HND_SETUP_MIN_QUALITY = 60;
    const HND_SETUP_MAX_AGE_BARS = 24;
    const HND_SETUP_APPROACH_ATR = 0.25;
    const HND_SETUP_MAX_DISTANCE_ATR = 3;
    const HND_SETUP_INVALIDATION_BUFFER_ATR = 0.05;
    const HND_SETUP_MAX_HISTORY = 50;
    const HND_SETUP_STATES = Object.freeze({
        NO_SETUP: "NO_SETUP", PENDING: "PENDING", ARMED: "ARMED",
        TRIGGERED: "TRIGGERED", INVALIDATED: "INVALIDATED", MISSED: "MISSED"
    });

    let currentSetup = null;
    let lastTerminalSetup = null;
    let setupHistory = [];
    let consumedSetupKeys = new Set();
    let lastEvaluation = null;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }
    function finitePositive(value) { return Number.isFinite(value) && value > 0; }
    function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }

    function normalizeSetupCandles(source) {
        const byTime = new Map();
        (Array.isArray(source) ? source : []).forEach(item => {
            if (!item || !finitePositive(item.time) || !finitePositive(item.open) ||
                !finitePositive(item.high) || !finitePositive(item.low) ||
                !finitePositive(item.close) || item.high < item.open ||
                item.high < item.close || item.high < item.low || item.low > item.open ||
                item.low > item.close || (item.volume !== undefined && !Number.isFinite(item.volume)) ||
                (item.closeTime !== undefined && !finitePositive(item.closeTime))) return;
            byTime.set(item.time, {
                time: item.time, open: item.open, high: item.high, low: item.low, close: item.close,
                ...(item.volume !== undefined ? { volume: item.volume } : {}),
                ...(item.closeTime !== undefined ? { closeTime: item.closeTime } : {})
            });
        });
        return [...byTime.values()].sort((a, b) => a.time - b.time);
    }

    function getLastClosedSetupCandle(candles, now = Date.now()) {
        const data = normalizeSetupCandles(candles);
        if (!data.length) return null;
        const closed = data.filter(candle => Number.isFinite(candle.closeTime) && candle.closeTime <= now);
        if (closed.length) return clone(closed[closed.length - 1]);
        if (data.some(candle => Number.isFinite(candle.closeTime))) return null;
        return data.length > 1 ? clone(data[data.length - 2]) : null;
    }

    function calculateSetupTrueRange(candle, previousCandle) {
        if (!candle) return null;
        const range = candle.high - candle.low;
        return previousCandle ? Math.max(range,
            Math.abs(candle.high - previousCandle.close),
            Math.abs(candle.low - previousCandle.close)) : range;
    }

    function calculateSetupATR(candles, period = 14) {
        const data = normalizeSetupCandles(candles);
        const ranges = data.map((candle, index) =>
            calculateSetupTrueRange(candle, index ? data[index - 1] : null)
        ).filter(finitePositive).slice(-Math.max(1, period));
        if (!ranges.length) return null;
        const atr = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
        return finitePositive(atr) ? atr : null;
    }

    function normalizeSetupZone(zone, expectedKind, fallbackATR) {
        if (!zone || zone.kind !== expectedKind || !["ORDER_BLOCK", "FVG"].includes(zone.kind) ||
            !["BULLISH", "BEARISH"].includes(zone.type) ||
            !["ACTIVE", "TOUCHED"].includes(zone.status) || zone.structureQualified !== true ||
            zone.structureSignificant !== true || typeof zone.structureEventId !== "string" ||
            !zone.structureEventId.trim() || typeof zone.id !== "string" || !zone.id.trim() ||
            !finitePositive(zone.startTime) || !finitePositive(zone.confirmationTime) ||
            !Number.isFinite(zone.structureSignificanceScore) ||
            !Number.isFinite(zone.zoneHeightATR) || zone.zoneHeightATR < 0) return null;
        const top = expectedKind === "ORDER_BLOCK" ? zone.high : zone.top;
        const bottom = expectedKind === "ORDER_BLOCK" ? zone.low : zone.bottom;
        const atr = finitePositive(zone.structureATR) ? zone.structureATR : fallbackATR;
        if (!finitePositive(top) || !finitePositive(bottom) || top < bottom || !finitePositive(atr)) return null;
        return {
            id: zone.id, kind: zone.kind, type: zone.type, status: zone.status, top, bottom,
            midpoint: (top + bottom) / 2,
            touches: Number.isFinite(zone.touches) && zone.touches >= 0 ? zone.touches : 0,
            structureEventId: zone.structureEventId,
            structureEventType: typeof zone.structureEventType === "string" ? zone.structureEventType : null,
            structureConfirmationIndex: Number.isInteger(zone.structureConfirmationIndex)
                ? zone.structureConfirmationIndex : -1,
            structureConfirmationTime: finitePositive(zone.structureConfirmationTime)
                ? zone.structureConfirmationTime : zone.confirmationTime,
            structureSignificanceScore: zone.structureSignificanceScore,
            structureATR: atr, zoneHeightATR: zone.zoneHeightATR,
            dominantQualifiedZone: zone.dominantQualifiedZone === true,
            qualificationVersion: typeof zone.qualificationVersion === "string" ? zone.qualificationVersion : null,
            startTime: zone.startTime, confirmationTime: zone.confirmationTime
        };
    }

    function getSetupZoneDistance(price, zone) {
        if (price > zone.top) return price - zone.top;
        if (price < zone.bottom) return zone.bottom - price;
        return 0;
    }

    function getSetupMTFAlignment(mtfState, direction) {
        const sourceRows = Array.isArray(mtfState?.rows)
            ? mtfState.rows
            : mtfState?.rows && typeof mtfState.rows === "object"
                ? Object.values(mtfState.rows) : [];
        const rows = sourceRows.filter(row => row?.status === "OK");
        let matching = 0, opposing = 0, neutral = 0;
        rows.forEach(row => {
            const trend = String(row.trend || "").toUpperCase();
            if (trend === (direction === "LONG" ? "BULL" : "BEAR")) matching += 1;
            else if (trend === (direction === "LONG" ? "BEAR" : "BULL")) opposing += 1;
            else neutral += 1;
        });
        let status = "NO_DATA";
        if (rows.length && matching > 0 && opposing === 0) status = "ALIGNED";
        else if (rows.length && opposing > 0 && matching === 0) status = "OPPOSED";
        else if (rows.length) status = "MIXED";
        return { status, matching, opposing, neutral,
            score: status === "ALIGNED" ? 5 : status === "MIXED" ? 2 : 0 };
    }

    function makeCandidate(zones, sourceType, direction, price, fallbackATR) {
        const atrValues = zones.map(zone => zone.structureATR).filter(finitePositive);
        const atr = atrValues.length ? Math.max(...atrValues) : fallbackATR;
        const entryLow = sourceType === "OB_FVG_CONFLUENCE"
            ? Math.max(...zones.map(zone => zone.bottom)) : zones[0].bottom;
        const entryHigh = sourceType === "OB_FVG_CONFLUENCE"
            ? Math.min(...zones.map(zone => zone.top)) : zones[0].top;
        if (!finitePositive(atr) || entryLow > entryHigh) return null;
        const distanceATR = getSetupZoneDistance(price, { bottom: entryLow, top: entryHigh }) / atr;
        return {
            sourceType, direction, zoneIds: zones.map(zone => zone.id).sort(),
            orderBlockId: zones.find(zone => zone.kind === "ORDER_BLOCK")?.id || null,
            fvgId: zones.find(zone => zone.kind === "FVG")?.id || null,
            structureEventId: zones[0].structureEventId, entryLow, entryHigh,
            entryTarget: (entryLow + entryHigh) / 2, atr, distanceATR,
            structureSignificanceScore: Math.max(...zones.map(zone => zone.structureSignificanceScore)),
            zoneHeightATR: Math.max(...zones.map(zone => zone.zoneHeightATR)),
            dominantQualifiedZone: zones.some(zone => zone.dominantQualifiedZone),
            status: zones.every(zone => zone.status === "ACTIVE") ? "ACTIVE" : "TOUCHED",
            totalTouches: zones.reduce((sum, zone) => sum + zone.touches, 0),
            structureConfirmationIndex: Math.max(...zones.map(zone => zone.structureConfirmationIndex)),
            zones: zones.map(clone)
        };
    }

    function buildConfluenceCandidates(orderBlocks, fvgs, direction, price, atr) {
        const candidates = [];
        orderBlocks.forEach(ob => fvgs.forEach(fvg => {
            if (ob.type !== fvg.type || ob.structureEventId !== fvg.structureEventId ||
                Math.max(ob.bottom, fvg.bottom) > Math.min(ob.top, fvg.top)) return;
            const candidate = makeCandidate([ob, fvg], "OB_FVG_CONFLUENCE", direction, price, atr);
            if (candidate) candidates.push(candidate);
        }));
        return candidates;
    }

    function calculateSetupQuality(candidate, context) {
        const directionBias = candidate.direction === "LONG" ? "BULLISH" : "BEARISH";
        const marketBias = String(context.analysis?.marketBias || "NEUTRAL").toUpperCase();
        const score = clamp(candidate.structureSignificanceScore, 0, 100) * 0.30 +
            (candidate.dominantQualifiedZone ? 10 : 0) + (candidate.status === "ACTIVE" ? 10 : 6) +
            clamp(candidate.zoneHeightATR * 10, 0, 10) +
            clamp(15 * (1 - candidate.distanceATR / HND_SETUP_MAX_DISTANCE_ATR), 0, 15) +
            (candidate.sourceType === "OB_FVG_CONFLUENCE" ? 15 : 0) +
            (marketBias === directionBias ? 5 : marketBias === "NEUTRAL" ? 2 : 0) +
            context.mtfAlignment.score - Math.min(10, candidate.totalTouches * 2);
        return clamp(Math.round(score), 0, 100);
    }

    function createSetupKey(candidate, symbol, interval) {
        return [String(symbol || "").toUpperCase(), String(interval || ""), candidate.direction,
            candidate.structureEventId, candidate.zoneIds.slice().sort().join(",")].join("|");
    }

    function compareSetupCandidates(first, second) {
        return second.quality - first.quality ||
            Number(second.sourceType === "OB_FVG_CONFLUENCE") - Number(first.sourceType === "OB_FVG_CONFLUENCE") ||
            second.structureSignificanceScore - first.structureSignificanceScore ||
            second.zoneHeightATR - first.zoneHeightATR || first.distanceATR - second.distanceATR ||
            Number(second.status === "ACTIVE") - Number(first.status === "ACTIVE") ||
            second.structureConfirmationIndex - first.structureConfirmationIndex || first.key.localeCompare(second.key);
    }

    function buildCandidates(input = {}) {
        const price = input.price;
        const direction = input.analysis?.signal === "LONG" ? "LONG"
            : input.analysis?.signal === "SHORT" ? "SHORT" : null;
        if (!direction || !finitePositive(price)) return [];
        const fallbackATR = calculateSetupATR(input.candles);
        const expectedType = direction === "LONG" ? "BULLISH" : "BEARISH";
        const zones = input.qualifiedPriceZones || {};
        const normalizeList = (list, kind) => (Array.isArray(list) ? list : [])
            .map(zone => normalizeSetupZone(zone, kind, fallbackATR)).filter(Boolean)
            .filter(zone => zone.type === expectedType)
            .filter(zone => direction === "LONG"
                ? price >= zone.bottom - zone.structureATR * HND_SETUP_INVALIDATION_BUFFER_ATR
                : price <= zone.top + zone.structureATR * HND_SETUP_INVALIDATION_BUFFER_ATR);
        const orderBlocks = normalizeList(zones.orderBlocks, "ORDER_BLOCK");
        const fvgs = normalizeList(zones.fvgs, "FVG");
        const raw = buildConfluenceCandidates(orderBlocks, fvgs, direction, price, fallbackATR)
            .concat(orderBlocks.map(zone => makeCandidate([zone], "ORDER_BLOCK", direction, price, fallbackATR)))
            .concat(fvgs.map(zone => makeCandidate([zone], "FVG", direction, price, fallbackATR)))
            .filter(Boolean).filter(candidate => candidate.distanceATR <= HND_SETUP_MAX_DISTANCE_ATR);
        const mtfAlignment = getSetupMTFAlignment(input.mtfState, direction);
        return raw.map(candidate => {
            candidate.mtfAlignment = mtfAlignment;
            candidate.quality = calculateSetupQuality(candidate, { analysis: input.analysis, mtfAlignment });
            candidate.key = createSetupKey(candidate, input.symbol, input.interval);
            return candidate;
        }).filter(candidate => candidate.quality >= HND_SETUP_MIN_QUALITY &&
            !consumedSetupKeys.has(candidate.key)).sort(compareSetupCandidates).map(clone);
    }

    function snapshotAnalysis(analysis) {
        return {
            signal: analysis?.signal ?? "WAIT", signalReason: analysis?.signalReason ?? null,
            confidence: Number.isFinite(analysis?.confidence) ? analysis.confidence : null,
            marketBias: analysis?.marketBias ?? null, trend: analysis?.trend ?? null,
            bullScore: Number.isFinite(analysis?.bullScore) ? analysis.bullScore : null,
            bearScore: Number.isFinite(analysis?.bearScore) ? analysis.bearScore : null,
            scoreDifference: Number.isFinite(analysis?.scoreDifference) ? analysis.scoreDifference : null
        };
    }

    function setupReason(candidate) {
        const side = candidate.direction === "LONG" ? "BULLISH" : "BEARISH";
        if (candidate.sourceType === "OB_FVG_CONFLUENCE") return `${side} OB + FVG RETEST SETUP`;
        return `${side} ${candidate.sourceType === "ORDER_BLOCK" ? "ORDER BLOCK" : "FVG"} RETEST`;
    }

    function createSetup(candidate, input, candles) {
        const latest = candles[candles.length - 1] || null;
        const now = Date.now();
        const inZone = input.price >= candidate.entryLow && input.price <= candidate.entryHigh;
        const state = inZone ? HND_SETUP_STATES.TRIGGERED
            : candidate.distanceATR <= HND_SETUP_APPROACH_ATR ? HND_SETUP_STATES.ARMED : HND_SETUP_STATES.PENDING;
        return {
            id: `SETUP-${candidate.key}`, key: candidate.key, version: HND_SETUP_VERSION,
            symbol: String(input.symbol || "").toUpperCase(), interval: String(input.interval || ""),
            direction: candidate.direction, state, sourceType: candidate.sourceType,
            zoneIds: candidate.zoneIds.slice(), orderBlockId: candidate.orderBlockId,
            fvgId: candidate.fvgId, structureEventId: candidate.structureEventId,
            entryLow: candidate.entryLow, entryHigh: candidate.entryHigh, entryTarget: candidate.entryTarget,
            invalidationPrice: candidate.direction === "LONG"
                ? candidate.entryLow - candidate.atr * HND_SETUP_INVALIDATION_BUFFER_ATR
                : candidate.entryHigh + candidate.atr * HND_SETUP_INVALIDATION_BUFFER_ATR,
            atr: candidate.atr, quality: candidate.quality, distanceATR: candidate.distanceATR,
            mtfAlignment: clone(candidate.mtfAlignment), setupReason: setupReason(candidate),
            createdAt: now, createdAtCandleTime: latest?.time ?? null,
            createdAtCandleIndex: latest ? candles.length - 1 : -1, updatedAt: now, stateChangedAt: now,
            armedAt: state === HND_SETUP_STATES.ARMED ? now : null,
            triggeredAt: state === HND_SETUP_STATES.TRIGGERED ? now : null,
            triggerPrice: state === HND_SETUP_STATES.TRIGGERED ? input.price : null,
            ageBars: 0, analysisSnapshot: snapshotAnalysis(input.analysis),
            sourceSnapshot: candidate.zones.map(clone)
        };
    }

    function sourceInvalidated(setup, qualifiedPriceZones) {
        const all = [].concat(qualifiedPriceZones?.orderBlocks || [], qualifiedPriceZones?.fvgs || []);
        return all.some(zone => setup.zoneIds.includes(zone?.id) && zone?.status === "INVALIDATED");
    }

    function terminalize(setup, state, now) {
        const terminal = { ...setup, state, updatedAt: now, stateChangedAt: now };
        consumedSetupKeys.add(terminal.key);
        setupHistory.push(clone(terminal));
        setupHistory = setupHistory.slice(-HND_SETUP_MAX_HISTORY);
        lastTerminalSetup = clone(terminal);
        return terminal;
    }

    function updateExistingSetup(setup, input = {}) {
        const next = clone(setup);
        const candles = normalizeSetupCandles(input.candles);
        const latest = candles[candles.length - 1] || null;
        const latestIndex = candles.length - 1;
        const createdIndex = candles.findIndex(candle => candle.time === next.createdAtCandleTime);
        next.ageBars = createdIndex >= 0 ? Math.max(0, latestIndex - createdIndex)
            : Math.max(0, latestIndex - next.createdAtCandleIndex);
        const now = Date.now();
        const price = input.price;
        next.distanceATR = finitePositive(price) ? getSetupZoneDistance(price,
            { bottom: next.entryLow, top: next.entryHigh }) / next.atr : next.distanceATR;
        next.updatedAt = now;
        const closed = getLastClosedSetupCandle(candles, now);
        const priceInvalidated = closed && (next.direction === "LONG"
            ? closed.close < next.invalidationPrice : closed.close > next.invalidationPrice);
        if (priceInvalidated || sourceInvalidated(next, input.qualifiedPriceZones))
            return terminalize(next, HND_SETUP_STATES.INVALIDATED, now);
        if (next.state !== HND_SETUP_STATES.TRIGGERED &&
            (next.ageBars > HND_SETUP_MAX_AGE_BARS ||
                (next.ageBars >= 2 && next.distanceATR > HND_SETUP_MAX_DISTANCE_ATR)))
            return terminalize(next, HND_SETUP_STATES.MISSED, now);
        const tickerTrigger = finitePositive(price) && price >= next.entryLow && price <= next.entryHigh;
        const candleTrigger = latest && latest.time > next.createdAtCandleTime &&
            latest.high >= next.entryLow && latest.low <= next.entryHigh;
        let state = next.state;
        if (state !== HND_SETUP_STATES.TRIGGERED && (tickerTrigger || candleTrigger)) {
            state = HND_SETUP_STATES.TRIGGERED;
            next.triggeredAt = now;
            next.triggerPrice = tickerTrigger ? price : next.entryTarget;
        } else if (state !== HND_SETUP_STATES.TRIGGERED) {
            state = next.distanceATR <= HND_SETUP_APPROACH_ATR
                ? HND_SETUP_STATES.ARMED : HND_SETUP_STATES.PENDING;
            if (state === HND_SETUP_STATES.ARMED && next.armedAt === null) next.armedAt = now;
        }
        if (state !== next.state) next.stateChangedAt = now;
        next.state = state;
        return next;
    }

    function evaluate(input = {}) {
        const candles = normalizeSetupCandles(input.candles);
        if (currentSetup) {
            const updated = updateExistingSetup(currentSetup, { ...input, candles });
            if ([HND_SETUP_STATES.INVALIDATED, HND_SETUP_STATES.MISSED].includes(updated.state)) currentSetup = null;
            else currentSetup = updated;
        } else {
            const candidates = buildCandidates({ ...input, candles });
            if (candidates.length) currentSetup = createSetup(candidates[0], input, candles);
        }
        lastEvaluation = {
            symbol: String(input.symbol || ""), interval: String(input.interval || ""),
            price: Number.isFinite(input.price) ? input.price : null,
            status: currentSetup?.state || HND_SETUP_STATES.NO_SETUP, evaluatedAt: Date.now()
        };
        return getState();
    }

    function reset(reason = "MANUAL_RESET") {
        currentSetup = null; lastTerminalSetup = null; setupHistory = [];
        consumedSetupKeys = new Set(); lastEvaluation = null;
        return { status: HND_SETUP_STATES.NO_SETUP, reason };
    }
    function getCurrentSetup() { return clone(currentSetup); }
    function getHistory() { return clone(setupHistory); }
    function getState() {
        return {
            version: HND_SETUP_VERSION, status: currentSetup?.state || HND_SETUP_STATES.NO_SETUP,
            currentSetup: clone(currentSetup), lastTerminalSetup: clone(lastTerminalSetup),
            historyCount: setupHistory.length, consumedSetupCount: consumedSetupKeys.size,
            lastEvaluation: clone(lastEvaluation)
        };
    }

    window.HNDSetupEngine = {
        evaluate, reset, getState, getCurrentSetup, getHistory, buildCandidates, updateExistingSetup
    };
})();
