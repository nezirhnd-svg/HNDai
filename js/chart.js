// ==========================
// HNDai Chart Engine v1
// ==========================

console.log("HNDai Chart Engine v1 Loaded");

let hndChart = null;
let hndCandleSeries = null;
let hndChartResizeObserver = null;
let hndChartInitialized = false;
let hndChartMode = "tradingview";
let hndChartNeedsFit = true;
let hndChartNeedsPriceScaleReset = true;
let hndChartDataCount = 0;
let hndChartLastError = null;
let hndChartControlsInitialized = false;
let hndChartResizeHandler = null;
let hndChartLastCandleTime = null;
let hndChartLastCandleClose = null;
let hndOverlayCanvas = null;
let hndOverlayContext = null;
let hndOverlayData = null;
let hndTradeOverlayData = {
    symbol: null,
    interval: null,
    currentPrice: null,
    pendingPlan: null,
    activeTrade: null,
    history: []
};
let hndTradeOverlayLastUpdate = null;
let hndOverlayAnimationFrame = null;
let hndOverlaySubscriptionsInitialized = false;
const HND_STRUCTURE_DISPLAY_LIMIT = 10;
const HND_STRUCTURE_LABEL_LIMIT = 8;
const HND_STRUCTURE_CLUSTER_X = 56;
const HND_STRUCTURE_CLUSTER_Y = 10;
const HND_STRUCTURE_LABEL_GAP = 6;
const HND_OB_DISPLAY_LIMIT = 6;
const HND_FVG_DISPLAY_LIMIT = 6;
const HND_ZONE_DIRECTION_LIMIT = 3;
const HND_ZONE_LABEL_LIMIT = 6;
const HND_ZONE_MIN_PIXEL_HEIGHT = 2;
const HND_ZONE_LABEL_GAP = 5;
const HND_MAJOR_HISTORY_MIN_SCORE = 85;
const HND_MAJOR_HISTORY_MIN_HEIGHT_ATR = 0.75;
const HND_MICRO_INVALIDATED_MIN_SCORE = 85;
const HND_MICRO_INVALIDATED_MIN_HEIGHT_ATR = 0.75;
const HND_MICRO_MITIGATED_MIN_SCORE = 70;
const HND_MICRO_MITIGATED_MIN_HEIGHT_ATR = 0.35;
const HND_TRADE_HISTORY_DISPLAY_LIMIT = 5;
const HND_TRADE_RIGHT_GUTTER = 76;
const HND_TRADE_LINE_MIN_WIDTH = 20;
const HND_TRADE_LABEL_PADDING_X = 6;
const HND_TRADE_LABEL_PADDING_Y = 4;
const HND_TRADE_LABEL_GAP = 5;
const HND_TRADE_OFFSCREEN_MARGIN = 8;
const HND_TRADE_PRICE_EPSILON = 1e-12;
let hndOverlayLastRenderStats = {
    structureEvents: 0,
    structureLabels: 0,
    liquidityZones: 0,
    orderBlocks: 0,
    fvgZones: 0,
    priceZoneLabels: 0,
    tradePendingPlans: 0,
    tradeActiveTrades: 0,
    tradeHistoryTrades: 0,
    tradeEntryLines: 0,
    tradeStopLines: 0,
    tradeTargetLines: 0,
    tradeExitMarkers: 0,
    tradeCurrentPriceMarkers: 0,
    tradeOffscreenIndicators: 0,
    tradeLabels: 0
};
let hndOverlayLastSelectedPriceZones = {
    orderBlocks: [],
    fvgs: []
};

function setHNDChartText(id, value) {
    if (typeof document === "undefined") return;
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function showHNDChartError(message) {
    hndChartLastError = String(message);
    setHNDChartText("hndChartStatus", "HNDai Chart unavailable");
    if (typeof document === "undefined") return;
    const errorElement = document.getElementById("hndChartError");
    if (errorElement) {
        errorElement.textContent = hndChartLastError;
        errorElement.hidden = false;
    }
}

function hideHNDChartError() {
    if (typeof document === "undefined") return;
    const errorElement = document.getElementById("hndChartError");
    if (errorElement) {
        errorElement.textContent = "";
        errorElement.hidden = true;
    }
}

function normalizeHNDChartCandles(sourceCandles) {
    if (!Array.isArray(sourceCandles)) return [];
    const candlesByTime = new Map();

    sourceCandles.forEach(candle => {
        if (!candle) return;
        const { time, open, high, low, close } = candle;
        if (
            !Number.isFinite(time) || !Number.isFinite(open) ||
            !Number.isFinite(high) || !Number.isFinite(low) ||
            !Number.isFinite(close) || time <= 0 || open <= 0 ||
            high <= 0 || low <= 0 || close <= 0 || high < open ||
            high < close || high < low || low > open ||
            low > close || low > high
        ) return;

        const normalizedTime = Math.floor(time / 1000);
        if (!Number.isFinite(normalizedTime) || normalizedTime <= 0) return;
        candlesByTime.set(normalizedTime, { time: normalizedTime, open, high, low, close });
    });

    return [...candlesByTime.values()].sort((a, b) => a.time - b.time);
}

function normalizeHNDOverlayTime(value) {
    return Number.isFinite(value) && value > 0
        ? Math.floor(value / 1000)
        : null;
}

function normalizeHNDTradeTime(value) {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value >= 1e12 ? value / 1000 : value);
}

function formatHNDTradePrice(value) {
    if (!Number.isFinite(value) || value <= 0) return "-";
    if (value >= 1000) return value.toFixed(2);
    if (value >= 1) return value.toFixed(4);
    if (value >= 0.01) return value.toFixed(6);
    return value.toFixed(8);
}

function formatHNDTradeR(value) {
    if (!Number.isFinite(value)) return "-";
    const normalized = Math.abs(value) < HND_TRADE_PRICE_EPSILON ? 0 : value;
    return `${normalized > 0 ? "+" : ""}${normalized.toFixed(2)}R`;
}

function hasValidHNDTradeLevels(direction, entryPrice, stopLoss, takeProfit) {
    if (![entryPrice, stopLoss, takeProfit].every(value => Number.isFinite(value) && value > 0) ||
        !["LONG", "SHORT"].includes(direction)) return false;
    return direction === "LONG"
        ? stopLoss < entryPrice && entryPrice < takeProfit
        : takeProfit < entryPrice && entryPrice < stopLoss;
}

function normalizeHNDPendingTradeOverlay(symbol, interval, tradePlanState, tradeState) {
    const pending = tradeState?.pendingExecution;
    const plan = tradePlanState?.currentPlan;
    if (!pending || !plan || plan.state !== "READY" ||
        typeof plan.key !== "string" || !plan.key || pending.planKey !== plan.key ||
        plan.symbol !== symbol || plan.interval !== interval ||
        !hasValidHNDTradeLevels(plan.direction, plan.entryPrice, plan.stopLoss, plan.takeProfit)) {
        return null;
    }
    const startTime = normalizeHNDTradeTime(pending.observedCandleTime) ??
        normalizeHNDTradeTime(pending.observedAt) ?? hndChartLastCandleTime;
    return {
        id: typeof plan.id === "string" && plan.id ? plan.id : plan.key,
        planKey: plan.key,
        setupKey: typeof plan.setupKey === "string" ? plan.setupKey : null,
        symbol, interval, direction: plan.direction, state: "WAITING_ENTRY",
        entryPrice: plan.entryPrice, stopLoss: plan.stopLoss, takeProfit: plan.takeProfit,
        startTime, observedAt: Number.isFinite(pending.observedAt) ? pending.observedAt : null
    };
}

function normalizeHNDActiveTradeOverlay(symbol, interval, trade) {
    if (!trade || trade.state !== "OPEN" ||
        !(typeof trade.id === "string" && trade.id || typeof trade.key === "string" && trade.key) ||
        trade.symbol !== symbol || trade.interval !== interval ||
        !hasValidHNDTradeLevels(trade.direction, trade.entryPrice, trade.stopLoss, trade.takeProfit)) {
        return null;
    }
    return {
        id: typeof trade.id === "string" && trade.id ? trade.id : trade.key,
        key: typeof trade.key === "string" ? trade.key : null,
        planKey: typeof trade.planKey === "string" ? trade.planKey : null,
        symbol, interval, direction: trade.direction, state: "OPEN",
        entryPrice: trade.entryPrice, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit,
        lastPrice: Number.isFinite(trade.lastPrice) && trade.lastPrice > 0 ? trade.lastPrice : null,
        unrealizedR: Number.isFinite(trade.unrealizedR) ? trade.unrealizedR : null,
        maxFavorableR: Number.isFinite(trade.maxFavorableR) ? trade.maxFavorableR : null,
        maxAdverseR: Number.isFinite(trade.maxAdverseR) ? trade.maxAdverseR : null,
        startTime: normalizeHNDTradeTime(trade.openedAtCandleTime) ??
            normalizeHNDTradeTime(trade.openedAt) ?? hndChartLastCandleTime,
        openedAt: Number.isFinite(trade.openedAt) ? trade.openedAt : null
    };
}

function normalizeHNDTradeHistory(symbol, interval, source) {
    const acceptedStates = new Set([
        "CLOSED_TP", "CLOSED_SL", "CANCELLED_MARKET_CHANGE", "CANCELLED_MANUAL"
    ]);
    const byIdentity = new Map();
    (Array.isArray(source) ? source : []).forEach(trade => {
        const identity = typeof trade?.id === "string" && trade.id
            ? `ID:${trade.id}` : typeof trade?.key === "string" && trade.key ? `KEY:${trade.key}` : null;
        if (!identity || trade.symbol !== symbol || trade.interval !== interval ||
            !acceptedStates.has(trade.state) ||
            !hasValidHNDTradeLevels(trade.direction, trade.entryPrice, trade.stopLoss, trade.takeProfit) ||
            !Number.isFinite(trade.exitPrice) || trade.exitPrice <= 0) return;
        const startTime = normalizeHNDTradeTime(trade.openedAtCandleTime) ??
            normalizeHNDTradeTime(trade.openedAt);
        const endTime = normalizeHNDTradeTime(trade.closedAtCandleTime) ??
            normalizeHNDTradeTime(trade.closedAt);
        if (startTime === null || endTime === null || endTime < startTime) return;
        const normalized = {
            id: typeof trade.id === "string" && trade.id ? trade.id : trade.key,
            key: typeof trade.key === "string" ? trade.key : null,
            symbol, interval, direction: trade.direction, state: trade.state,
            entryPrice: trade.entryPrice, stopLoss: trade.stopLoss, takeProfit: trade.takeProfit,
            startTime, endTime, exitPrice: trade.exitPrice,
            realizedR: Number.isFinite(trade.realizedR) ? trade.realizedR : null,
            exitReason: typeof trade.exitReason === "string" ? trade.exitReason : null
        };
        const existing = byIdentity.get(identity);
        if (!existing || normalized.endTime > existing.endTime) byIdentity.set(identity, normalized);
    });
    return [...byIdentity.values()].sort((first, second) =>
        second.endTime - first.endTime || second.startTime - first.startTime ||
        first.id.localeCompare(second.id)
    ).slice(0, HND_TRADE_HISTORY_DISPLAY_LIMIT);
}

function normalizeHNDTradeOverlayData(source = {}) {
    const symbol = typeof source.symbol === "string" ? source.symbol : null;
    const interval = typeof source.interval === "string" ? source.interval : null;
    const combinedHistory = [
        ...(Array.isArray(source.tradeHistory) ? source.tradeHistory : []),
        ...(source.tradeState?.lastClosedTrade ? [source.tradeState.lastClosedTrade] : [])
    ];
    return {
        symbol,
        interval,
        currentPrice: Number.isFinite(source.price) && source.price > 0 ? source.price : null,
        pendingPlan: symbol && interval ? normalizeHNDPendingTradeOverlay(
            symbol, interval, source.tradePlanState, source.tradeState
        ) : null,
        activeTrade: symbol && interval ? normalizeHNDActiveTradeOverlay(
            symbol, interval, source.tradeState?.activeTrade
        ) : null,
        history: symbol && interval ? normalizeHNDTradeHistory(symbol, interval, combinedHistory) : []
    };
}

function normalizeHNDPriceZone(zone, expectedKind) {
    if (
        !zone || typeof zone.id !== "string" || !zone.id ||
        zone.kind !== expectedKind ||
        !["ORDER_BLOCK", "FVG"].includes(expectedKind) ||
        !["BULLISH", "BEARISH"].includes(zone.type) ||
        !["ACTIVE", "TOUCHED", "MITIGATED", "INVALIDATED"].includes(zone.status) ||
        !Number.isFinite(zone.touches) || zone.touches < 0
    ) return null;
    const top = expectedKind === "ORDER_BLOCK" ? zone.high : zone.top;
    const bottom = expectedKind === "ORDER_BLOCK" ? zone.low : zone.bottom;
    if (!Number.isFinite(top) || top <= 0 || !Number.isFinite(bottom) ||
        bottom <= 0 || top < bottom) return null;
    const startTime = normalizeHNDOverlayTime(zone.startTime);
    const confirmationTime = normalizeHNDOverlayTime(zone.confirmationTime);
    if (startTime === null || (zone.confirmationTime != null && confirmationTime === null)) return null;
    const normalizeOptionalTime = value => value == null
        ? null
        : normalizeHNDOverlayTime(value);
    const firstTouchTime = normalizeOptionalTime(zone.firstTouchTime);
    const mitigationTime = normalizeOptionalTime(zone.mitigationTime);
    const invalidationTime = normalizeOptionalTime(zone.invalidationTime);
    const endTime = normalizeOptionalTime(zone.endTime);
    if (
        (zone.firstTouchTime != null && firstTouchTime === null) ||
        (zone.mitigationTime != null && mitigationTime === null) ||
        (zone.invalidationTime != null && invalidationTime === null) ||
        (zone.endTime != null && endTime === null)
    ) return null;
    const midpoint = Number.isFinite(zone.midpoint) && zone.midpoint > 0
        ? zone.midpoint
        : (top + bottom) / 2;
    return {
        id: zone.id, kind: expectedKind, type: zone.type, status: zone.status,
        top, bottom, midpoint, startTime, confirmationTime, firstTouchTime,
        mitigationTime, invalidationTime, endTime, touches: zone.touches,
        index: Number.isFinite(zone.index) ? zone.index : null,
        confirmationIndex: Number.isFinite(zone.confirmationIndex)
            ? zone.confirmationIndex : null,
        structureQualified: zone.structureQualified === true,
        structureSignificant: zone.structureSignificant === true,
        structureSignificanceScore: Math.min(100, Math.max(0,
            Number.isFinite(zone.structureSignificanceScore)
                ? zone.structureSignificanceScore : 0
        )),
        structureATR: Number.isFinite(zone.structureATR) && zone.structureATR > 0
            ? zone.structureATR : null,
        zoneHeightATR: Number.isFinite(zone.zoneHeightATR) && zone.zoneHeightATR >= 0
            ? zone.zoneHeightATR : 0,
        structureEventId: typeof zone.structureEventId === "string" && zone.structureEventId
            ? zone.structureEventId : null,
        structureConfirmationIndex: Number.isInteger(zone.structureConfirmationIndex)
            ? zone.structureConfirmationIndex : null,
        qualificationVersion: typeof zone.qualificationVersion === "string"
            ? zone.qualificationVersion : null,
        dominantQualifiedZone: zone.dominantQualifiedZone === true,
        zoneDominanceRank: Number.isFinite(zone.zoneDominanceRank) && zone.zoneDominanceRank > 0
            ? zone.zoneDominanceRank : null
    };
}

function normalizeHNDOverlayData(source) {
    const eventMap = new Map();
    const events = Array.isArray(source?.structureEvents)
        ? source.structureEvents
        : [];

    events.forEach(event => {
        if (
            !event ||
            typeof event.id !== "string" ||
            !event.id ||
            !["BOS", "CHOCH"].includes(event.eventType) ||
            !["BULLISH", "BEARISH"].includes(event.direction) ||
            typeof event.label !== "string" ||
            !Number.isFinite(event.level) ||
            event.level <= 0
        ) return;

        const startTime = normalizeHNDOverlayTime(event.startTime);
        const endTime = normalizeHNDOverlayTime(event.endTime);
        if (startTime === null || endTime === null) return;

        eventMap.set(event.id, {
            id: event.id,
            eventType: event.eventType,
            direction: event.direction,
            label: event.label,
            level: event.level,
            startTime,
            endTime
        });
    });

    const normalizeZone = zone => {
        if (
            !zone ||
            typeof zone.id !== "string" ||
            !zone.id ||
            !["BUY_SIDE", "SELL_SIDE"].includes(zone.type) ||
            !["ACTIVE", "SWEPT"].includes(zone.status) ||
            !Number.isFinite(zone.price) || zone.price <= 0 ||
            !Number.isFinite(zone.zoneHigh) || zone.zoneHigh <= 0 ||
            !Number.isFinite(zone.zoneLow) || zone.zoneLow <= 0 ||
            zone.zoneHigh < zone.zoneLow
        ) return null;

        const startTime = normalizeHNDOverlayTime(zone.startTime);
        const confirmedTime = normalizeHNDOverlayTime(zone.confirmedTime);
        const sweepTime = normalizeHNDOverlayTime(zone.sweepTime);
        const endTime = normalizeHNDOverlayTime(zone.endTime);
        if (startTime === null) return null;
        if (zone.status === "SWEPT" && endTime === null && sweepTime === null) return null;

        return {
            id: zone.id,
            type: zone.type,
            price: zone.price,
            zoneHigh: zone.zoneHigh,
            zoneLow: zone.zoneLow,
            strength: Math.min(100, Math.max(0,
                Number.isFinite(zone.strength) ? zone.strength : 0
            )),
            status: zone.status,
            startTime,
            confirmedTime,
            sweepTime,
            endTime: zone.status === "SWEPT" ? (endTime ?? sweepTime) : null
        };
    };

    const strongest = source?.strongestLiquidity || {};
    const normalizePriceZones = (zones, expectedKind) => {
        const zoneMap = new Map();
        (Array.isArray(zones) ? zones : []).forEach(zone => {
            const normalized = normalizeHNDPriceZone(zone, expectedKind);
            if (normalized) zoneMap.set(normalized.id, normalized);
        });
        return [...zoneMap.values()].sort((a, b) =>
            a.startTime - b.startTime ||
            (a.confirmationTime ?? 0) - (b.confirmationTime ?? 0) ||
            a.id.localeCompare(b.id)
        );
    };
    const seenZones = new Set();
    const uniqueZone = zone => {
        const normalized = normalizeZone(zone);
        if (!normalized || seenZones.has(normalized.id)) return null;
        seenZones.add(normalized.id);
        return normalized;
    };

    return {
        structureEvents: [...eventMap.values()].sort((a, b) =>
            a.endTime - b.endTime || a.startTime - b.startTime ||
            a.id.localeCompare(b.id)
        ),
        orderBlocks: normalizePriceZones(source?.orderBlocks, "ORDER_BLOCK"),
        fvgs: normalizePriceZones(source?.fvgs, "FVG"),
        strongestLiquidity: {
            overall: uniqueZone(strongest.overall),
            buySide: uniqueZone(strongest.buySide),
            sellSide: uniqueZone(strongest.sellSide)
        }
    };
}

function initHNDOverlayCanvas() {
    if (hndOverlayCanvas && hndOverlayContext) return true;
    if (typeof document === "undefined") return false;

    try {
        const container = document.getElementById("hndChart");
        if (!container || typeof document.createElement !== "function") return false;
        const canvas = document.createElement("canvas");
        canvas.className = "hnd-chart-overlay";
        canvas.setAttribute("aria-hidden", "true");
        const context = canvas.getContext("2d");
        if (!context) return false;
        container.appendChild(canvas);
        hndOverlayCanvas = canvas;
        hndOverlayContext = context;
        return true;
    } catch (error) {
        return false;
    }
}

function resizeHNDOverlayCanvas() {
    if (!hndOverlayCanvas || !hndOverlayContext || typeof document === "undefined") return false;
    const container = document.getElementById("hndChart");
    if (!container) return false;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return false;
    const ratio = Math.max(1,
        typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
            ? window.devicePixelRatio
            : 1
    );
    hndOverlayCanvas.width = Math.round(width * ratio);
    hndOverlayCanvas.height = Math.round(height * ratio);
    hndOverlayCanvas.style.width = `${width}px`;
    hndOverlayCanvas.style.height = `${height}px`;
    hndOverlayContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    scheduleHNDOverlayRender();
    return true;
}

function scheduleHNDOverlayRender() {
    if (hndOverlayAnimationFrame !== null) return;
    const callback = () => {
        hndOverlayAnimationFrame = null;
        renderHNDOverlays();
    };
    if (typeof requestAnimationFrame === "function") {
        hndOverlayAnimationFrame = requestAnimationFrame(callback);
    } else {
        hndOverlayAnimationFrame = setTimeout(callback, 16);
    }
}

function clearHNDOverlayCanvas() {
    if (!hndOverlayCanvas || !hndOverlayContext) return;
    const width = parseFloat(hndOverlayCanvas.style.width) || hndOverlayCanvas.clientWidth || 0;
    const height = parseFloat(hndOverlayCanvas.style.height) || hndOverlayCanvas.clientHeight || 0;
    hndOverlayContext.clearRect(0, 0, width, height);
}

function getHNDOverlayCoordinate(value, maximum) {
    return Number.isFinite(value)
        ? Math.min(maximum, Math.max(0, value))
        : null;
}

function getHNDStructureDisplayCandidate(event, width, height) {
    try {
        const x1 = hndChart.timeScale().timeToCoordinate(event.startTime);
        const x2 = hndChart.timeScale().timeToCoordinate(event.endTime);
        const y = hndCandleSeries.priceToCoordinate(event.level);
        if (![x1, x2, y].every(Number.isFinite)) return null;
        if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > width) return null;
        if (y < 0 || y > height) return null;
        return { event, x1, x2, y };
    } catch (error) {
        return null;
    }
}

function getHNDStructurePriority(candidate) {
    return {
        type: candidate.event.eventType === "CHOCH" ? 1 : 0,
        endTime: candidate.event.endTime,
        startTime: candidate.event.startTime,
        id: candidate.event.id
    };
}

function compareHNDStructurePriority(first, second) {
    const firstPriority = getHNDStructurePriority(first);
    const secondPriority = getHNDStructurePriority(second);
    return secondPriority.type - firstPriority.type ||
        secondPriority.endTime - firstPriority.endTime ||
        secondPriority.startTime - firstPriority.startTime ||
        firstPriority.id.localeCompare(secondPriority.id);
}

function areHNDStructureEventsNear(first, second) {
    return first.event.direction === second.event.direction &&
        Math.abs(first.x2 - second.x2) < HND_STRUCTURE_CLUSTER_X &&
        Math.abs(first.y - second.y) < HND_STRUCTURE_CLUSTER_Y;
}

function selectHNDStructureEventsForDisplay(events, width, height) {
    if (!Array.isArray(events)) return [];
    const candidates = events
        .map(event => getHNDStructureDisplayCandidate(event, width, height))
        .filter(Boolean)
        .sort(compareHNDStructurePriority);
    const selected = [];

    for (const candidate of candidates) {
        if (selected.some(existing => areHNDStructureEventsNear(existing, candidate))) {
            continue;
        }
        selected.push(candidate);
        if (selected.length >= HND_STRUCTURE_DISPLAY_LIMIT) break;
    }

    return selected.sort((first, second) =>
        first.event.endTime - second.event.endTime ||
        first.event.startTime - second.event.startTime ||
        first.event.id.localeCompare(second.event.id)
    );
}

function drawHNDStructureEvent(
    ctx,
    event,
    width,
    height,
    labelRects = [],
    labelStats = null,
    shouldDrawLabel = true
) {
    try {
        const x1Raw = hndChart.timeScale().timeToCoordinate(event.startTime);
        const x2Raw = hndChart.timeScale().timeToCoordinate(event.endTime);
        const yRaw = hndCandleSeries.priceToCoordinate(event.level);
        if (![x1Raw, x2Raw, yRaw].every(Number.isFinite)) return false;
        let left = Math.min(x1Raw, x2Raw);
        let right = Math.max(x1Raw, x2Raw);
        if (right < 0 || left > width || yRaw < 0 || yRaw > height) return false;
        left = getHNDOverlayCoordinate(left, width);
        right = getHNDOverlayCoordinate(right, width);
        const y = getHNDOverlayCoordinate(yRaw, height);
        if (left === null || right === null || y === null) return false;

        ctx.save();
        const color = event.direction === "BULLISH" ? "#4ade80" : "#f87171";
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = event.eventType === "CHOCH" ? 2 : 1;
        ctx.setLineDash(event.eventType === "CHOCH" ? [8, 4] : [5, 4]);
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
        ctx.setLineDash([]);
        if (!shouldDrawLabel) {
            ctx.restore();
            return true;
        }
        ctx.font = "11px Arial";
        const text = event.label;
        const textWidth = ctx.measureText(text).width;
        const rightLabelX = x2Raw + 8;
        const leftLabelX = x2Raw - textWidth - 8;
        const labelX = Math.max(3, Math.min(
            width - textWidth - 5,
            rightLabelX + textWidth + 5 <= width ? rightLabelX : leftLabelX
        ));
        const offsets = event.direction === "BULLISH"
            ? [-18, -34, -50, 18, 34, 50]
            : [20, 36, 52, -18, -34, -50];
        let labelRect = null;

        for (const offset of offsets) {
            const labelY = y - 4 + offset;
            const candidate = {
                left: labelX - 3,
                top: labelY - 12,
                right: labelX + textWidth + 3,
                bottom: labelY + 3,
                labelY
            };
            const inside = candidate.left >= 0 && candidate.right <= width &&
                candidate.top >= 0 && candidate.bottom <= height;
            const overlaps = labelRects.some(rect =>
                candidate.left < rect.right + HND_STRUCTURE_LABEL_GAP &&
                candidate.right + HND_STRUCTURE_LABEL_GAP > rect.left &&
                candidate.top < rect.bottom + HND_STRUCTURE_LABEL_GAP &&
                candidate.bottom + HND_STRUCTURE_LABEL_GAP > rect.top
            );
            if (inside && !overlaps) {
                labelRect = candidate;
                break;
            }
        }

        if (labelRect) {
            labelRects.push(labelRect);
            ctx.fillStyle = "rgba(15,23,42,.82)";
            ctx.fillRect(labelRect.left, labelRect.top,
                labelRect.right - labelRect.left, labelRect.bottom - labelRect.top);
            ctx.fillStyle = color;
            ctx.fillText(text, labelX, labelRect.labelY);
            if (labelStats) labelStats.count++;
        }
        ctx.restore();
        return true;
    } catch (error) {
        try { ctx.restore(); } catch (restoreError) { /* noop */ }
        return false;
    }
}

function getHNDPriceZoneEndTime(zone) {
    let endTime = null;
    if (zone?.status === "INVALIDATED") {
        endTime = zone.invalidationTime ?? zone.endTime ?? hndChartLastCandleTime;
    } else if (zone?.status === "MITIGATED") {
        endTime = zone.mitigationTime ?? zone.endTime ?? hndChartLastCandleTime;
    } else if (zone?.status === "ACTIVE" || zone?.status === "TOUCHED") {
        endTime = hndChartLastCandleTime ?? zone.endTime;
    }
    return Number.isFinite(endTime) && endTime > 0 ? endTime : null;
}

function getHNDPriceZoneDisplayCandidate(zone, width, height) {
    try {
        if (!hndChart || !hndCandleSeries || !zone ||
            typeof hndChart.timeScale !== "function" ||
            typeof hndCandleSeries.priceToCoordinate !== "function" ||
            !Number.isFinite(zone.top) || !Number.isFinite(zone.bottom) ||
            zone.top <= 0 || zone.bottom <= 0 || zone.top < zone.bottom) return null;
        const endTime = getHNDPriceZoneEndTime(zone);
        if (!Number.isFinite(zone.startTime) || endTime === null || endTime < zone.startTime) return null;
        const timeScale = hndChart.timeScale();
        const x1 = timeScale.timeToCoordinate(zone.startTime);
        const x2 = timeScale.timeToCoordinate(endTime);
        const yTop = hndCandleSeries.priceToCoordinate(zone.top);
        const yBottom = hndCandleSeries.priceToCoordinate(zone.bottom);
        if (![x1, x2, yTop, yBottom].every(Number.isFinite)) return null;
        if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > width) return null;
        if (Math.max(yTop, yBottom) < 0 || Math.min(yTop, yBottom) > height) return null;
        const midpointY = (yTop + yBottom) / 2;
        const calculatedDistance = Number.isFinite(hndChartLastCandleClose) &&
            hndChartLastCandleClose > 0
            ? Math.abs(zone.midpoint - hndChartLastCandleClose) /
                hndChartLastCandleClose * 100
            : Infinity;
        return {
            zone, x1, x2, top: Math.min(yTop, yBottom),
            bottom: Math.max(yTop, yBottom), midpointY,
            distancePercent: Number.isFinite(calculatedDistance)
                ? calculatedDistance : Infinity
        };
    } catch (error) {
        return null;
    }
}

function getHNDPriceZoneStatusPriority(status) {
    return { ACTIVE: 4, TOUCHED: 3, MITIGATED: 2, INVALIDATED: 1 }[status] || 0;
}

function getHNDPriceZoneActionabilityPriority(status) {
    return status === "ACTIVE" ? 2 : status === "TOUCHED" ? 1 : 0;
}

function isHNDMajorHistoricalPriceZone(candidate) {
    const zone = candidate?.zone || candidate;
    return Boolean(
        zone && ["MITIGATED", "INVALIDATED"].includes(zone.status) &&
        Number.isFinite(zone.structureSignificanceScore) &&
        zone.structureSignificanceScore >= HND_MAJOR_HISTORY_MIN_SCORE &&
        Number.isFinite(zone.zoneHeightATR) &&
        zone.zoneHeightATR >= HND_MAJOR_HISTORY_MIN_HEIGHT_ATR
    );
}

function compareHNDMajorHistoricalPriceZonePriority(first, second) {
    return second.zone.zoneHeightATR - first.zone.zoneHeightATR ||
        second.zone.structureSignificanceScore - first.zone.structureSignificanceScore ||
        Number(second.zone.dominantQualifiedZone) - Number(first.zone.dominantQualifiedZone) ||
        first.zone.startTime - second.zone.startTime ||
        first.zone.id.localeCompare(second.zone.id);
}

function compareHNDPriceZonePriority(first, second) {
    const firstDistance = Number.isFinite(first.distancePercent)
        ? first.distancePercent : Number.MAX_VALUE;
    const secondDistance = Number.isFinite(second.distancePercent)
        ? second.distancePercent : Number.MAX_VALUE;
    return Number(second.zone.dominantQualifiedZone) - Number(first.zone.dominantQualifiedZone) ||
        Number(second.zone.structureQualified) - Number(first.zone.structureQualified) ||
        getHNDPriceZoneActionabilityPriority(second.zone.status) -
            getHNDPriceZoneActionabilityPriority(first.zone.status) ||
        Number(isHNDMajorHistoricalPriceZone(second)) -
            Number(isHNDMajorHistoricalPriceZone(first)) ||
        second.zone.zoneHeightATR - first.zone.zoneHeightATR ||
        second.zone.structureSignificanceScore - first.zone.structureSignificanceScore ||
        getHNDPriceZoneStatusPriority(second.zone.status) -
        getHNDPriceZoneStatusPriority(first.zone.status) ||
        firstDistance - secondDistance ||
        first.zone.touches - second.zone.touches ||
        first.zone.startTime - second.zone.startTime ||
        (second.zone.structureConfirmationIndex ?? -1) -
            (first.zone.structureConfirmationIndex ?? -1) ||
        first.zone.id.localeCompare(second.zone.id);
}

function compareHNDPriceZoneLabelPriority(first, second) {
    const labelStatus = status => status === "ACTIVE" ? 2 : status === "TOUCHED" ? 1 : 0;
    const firstDistance = Number.isFinite(first.distancePercent)
        ? first.distancePercent : Number.MAX_VALUE;
    const secondDistance = Number.isFinite(second.distancePercent)
        ? second.distancePercent : Number.MAX_VALUE;
    return Number(second.zone.dominantQualifiedZone) - Number(first.zone.dominantQualifiedZone) ||
        second.zone.structureSignificanceScore - first.zone.structureSignificanceScore ||
        second.zone.zoneHeightATR - first.zone.zoneHeightATR ||
        labelStatus(second.zone.status) - labelStatus(first.zone.status) ||
        firstDistance - secondDistance ||
        first.zone.startTime - second.zone.startTime ||
        first.zone.id.localeCompare(second.zone.id);
}

function passesHNDPriceZoneDisplayHistoryQuality(zone) {
    const hasMetadata = zone?.structureQualified === true ||
        typeof zone?.qualificationVersion === "string";
    if (!hasMetadata) return true;
    if (zone.status === "ACTIVE" || zone.status === "TOUCHED") return true;
    if (zone.status === "INVALIDATED") {
        return zone.structureSignificanceScore >= HND_MICRO_INVALIDATED_MIN_SCORE &&
            zone.zoneHeightATR >= HND_MICRO_INVALIDATED_MIN_HEIGHT_ATR;
    }
    if (zone.status === "MITIGATED") {
        return zone.structureSignificanceScore >= HND_MICRO_MITIGATED_MIN_SCORE &&
            zone.zoneHeightATR >= HND_MICRO_MITIGATED_MIN_HEIGHT_ATR;
    }
    return true;
}

function areHNDPriceZoneCandidatesRedundant(first, second) {
    if (!first?.zone || !second?.zone || first.zone.kind !== second.zone.kind ||
        first.zone.type !== second.zone.type) return false;
    const priceIntersection = Math.max(0,
        Math.min(first.zone.top, second.zone.top) - Math.max(first.zone.bottom, second.zone.bottom)
    );
    const firstHeight = first.zone.top - first.zone.bottom;
    const secondHeight = second.zone.top - second.zone.bottom;
    if (firstHeight <= 0 || secondHeight <= 0) return false;
    const contains = (first.zone.bottom <= second.zone.bottom && first.zone.top >= second.zone.top) ||
        (second.zone.bottom <= first.zone.bottom && second.zone.top >= first.zone.top);
    const overlapRatio = priceIntersection / Math.min(firstHeight, secondHeight);
    const xIntersection = Math.max(0,
        Math.min(Math.max(first.x1, first.x2), Math.max(second.x1, second.x2)) -
        Math.max(Math.min(first.x1, first.x2), Math.min(second.x1, second.x2))
    );
    const minXWidth = Math.min(Math.abs(first.x2 - first.x1), Math.abs(second.x2 - second.x1));
    const xOverlapsMeaningfully = minXWidth > 0 && xIntersection / minXWidth >= 0.25;
    return xOverlapsMeaningfully && (contains || overlapRatio >= 0.75);
}

function selectHNDPriceZonesForDisplay(zones, kind, width, height, totalLimit) {
    if (!Array.isArray(zones) || !Number.isFinite(totalLimit) || totalLimit <= 0) return [];
    const candidates = zones
        .filter(zone => zone?.kind === kind)
        .filter(passesHNDPriceZoneDisplayHistoryQuality)
        .map(zone => getHNDPriceZoneDisplayCandidate(zone, width, height))
        .filter(Boolean)
        .sort(compareHNDPriceZonePriority);
    const selected = [];
    const selectedIds = new Set();
    const directionCounts = { BULLISH: 0, BEARISH: 0 };
    const addCandidate = (candidate, selectionReason) => {
        const direction = candidate.zone.type;
        if (selected.length >= totalLimit || selectedIds.has(candidate.zone.id) ||
            directionCounts[direction] >= HND_ZONE_DIRECTION_LIMIT ||
            selected.some(existing => areHNDPriceZoneCandidatesRedundant(existing, candidate))) {
            return false;
        }
        selected.push({ ...candidate, selectionReason });
        selectedIds.add(candidate.zone.id);
        directionCounts[direction]++;
        return true;
    };
    const reservedMajorZones = ["BULLISH", "BEARISH"]
        .map(direction => candidates
            .filter(candidate => candidate.zone.type === direction &&
                isHNDMajorHistoricalPriceZone(candidate))
            .sort(compareHNDMajorHistoricalPriceZonePriority)[0]
        )
        .filter(Boolean)
        .sort(compareHNDMajorHistoricalPriceZonePriority);
    for (const candidate of reservedMajorZones) {
        if (selected.length >= totalLimit) break;
        addCandidate(candidate, "MAJOR_HISTORY_RESERVED");
    }
    for (const candidate of candidates) {
        if (selected.length >= totalLimit) break;
        const selectionReason = candidate.zone.status === "ACTIVE"
            ? "ACTIVE_PRIORITY"
            : candidate.zone.status === "TOUCHED"
                ? "TOUCHED_PRIORITY"
                : "GLOBAL_QUALITY";
        addCandidate(candidate, selectionReason);
    }
    return selected.sort((a, b) =>
        a.zone.startTime - b.zone.startTime ||
        (a.zone.confirmationTime ?? 0) - (b.zone.confirmationTime ?? 0) ||
        a.zone.id.localeCompare(b.zone.id)
    );
}

function getHNDPriceZoneStyle(zone) {
    const colors = zone.kind === "ORDER_BLOCK"
        ? (zone.type === "BULLISH"
            ? { border: "#22c55e", rgb: "34, 197, 94" }
            : { border: "#ef4444", rgb: "239, 68, 68" })
        : (zone.type === "BULLISH"
            ? { border: "#38bdf8", rgb: "56, 189, 248" }
            : { border: "#fb923c", rgb: "251, 146, 60" });
    const alpha = { ACTIVE: 0.18, TOUCHED: 0.13, MITIGATED: 0.08, INVALIDATED: 0.04 }[zone.status] || 0.04;
    return {
        border: colors.border,
        fill: `rgba(${colors.rgb}, ${alpha})`,
        dashed: zone.status === "MITIGATED" || zone.status === "INVALIDATED"
    };
}

function drawHNDPriceZone(ctx, candidate, width, height, labelRects = [], shouldDrawLabel = true) {
    try {
        const { zone } = candidate;
        const left = Math.max(0, Math.min(width, Math.min(candidate.x1, candidate.x2)));
        const right = Math.max(0, Math.min(width, Math.max(candidate.x1, candidate.x2)));
        const top = Math.max(0, Math.min(height, candidate.top));
        const rawBottom = Math.max(0, Math.min(height, candidate.bottom));
        const bottom = Math.min(height, Math.max(rawBottom, top + HND_ZONE_MIN_PIXEL_HEIGHT));
        if (right <= left || bottom <= top) return false;
        const style = getHNDPriceZoneStyle(zone);
        ctx.save();
        ctx.fillStyle = style.fill;
        ctx.fillRect(left, top, right - left, bottom - top);
        ctx.strokeStyle = style.border;
        ctx.lineWidth = 1;
        ctx.setLineDash(style.dashed ? [5, 4] : []);
        ctx.beginPath();
        ctx.moveTo(left, top); ctx.lineTo(right, top);
        ctx.moveTo(left, bottom); ctx.lineTo(right, bottom);
        ctx.moveTo(right, top); ctx.lineTo(right, bottom);
        ctx.stroke();
        if (zone.kind === "ORDER_BLOCK") {
            ctx.globalAlpha = 0.45;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(left, candidate.midpointY);
            ctx.lineTo(right, candidate.midpointY); ctx.stroke();
            ctx.globalAlpha = 1;
        }
        ctx.setLineDash([]);
        if (shouldDrawLabel) {
            const label = `${zone.type === "BULLISH" ? "BULL" : "BEAR"} ` +
                `${zone.kind === "ORDER_BLOCK" ? "OB" : "FVG"} • ${zone.status}`;
            ctx.font = "10px Arial";
            const textWidth = ctx.measureText(label).width;
            const positions = [
                { x: left + 4, y: top + 13 },
                { x: right - textWidth - 4, y: top + 13 }
            ];
            for (const position of positions) {
                const rect = {
                    left: position.x - 3, top: position.y - 11,
                    right: position.x + textWidth + 3, bottom: position.y + 3
                };
                const inside = rect.left >= 0 && rect.right <= width &&
                    rect.top >= 0 && rect.bottom <= height;
                const overlaps = labelRects.some(existing =>
                    rect.left < existing.right + HND_ZONE_LABEL_GAP &&
                    rect.right + HND_ZONE_LABEL_GAP > existing.left &&
                    rect.top < existing.bottom + HND_ZONE_LABEL_GAP &&
                    rect.bottom + HND_ZONE_LABEL_GAP > existing.top
                );
                if (!inside || overlaps) continue;
                labelRects.push(rect);
                ctx.fillStyle = "rgba(15, 23, 42, 0.86)";
                ctx.fillRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
                ctx.fillStyle = style.border;
                ctx.fillText(label, position.x, position.y);
                break;
            }
        }
        ctx.restore();
        return true;
    } catch (error) {
        try { ctx.restore(); } catch (restoreError) { /* noop */ }
        return false;
    }
}

function drawHNDLiquidityZone(ctx, zone, isOverall, width, height) {
    try {
        const endTime = zone.status === "SWEPT"
            ? (zone.endTime ?? zone.sweepTime)
            : hndChartLastCandleTime;
        if (!Number.isFinite(zone.startTime) || !Number.isFinite(endTime)) return false;
        const x1Raw = hndChart.timeScale().timeToCoordinate(zone.startTime);
        const x2Raw = hndChart.timeScale().timeToCoordinate(endTime);
        const highRaw = hndCandleSeries.priceToCoordinate(zone.zoneHigh);
        const lowRaw = hndCandleSeries.priceToCoordinate(zone.zoneLow);
        if (![x1Raw, x2Raw, highRaw, lowRaw].every(Number.isFinite)) return false;
        let left = Math.min(x1Raw, x2Raw);
        let right = Math.max(x1Raw, x2Raw);
        if (right < 0 || left > width) return false;
        left = getHNDOverlayCoordinate(left, width);
        right = getHNDOverlayCoordinate(right, width);
        if (left === null || right === null || right <= left) return false;
        let top = Math.min(highRaw, lowRaw);
        let bottom = Math.max(highRaw, lowRaw);
        if (bottom < 0 || top > height) return false;
        top = getHNDOverlayCoordinate(top, height);
        bottom = getHNDOverlayCoordinate(bottom, height);
        if (top === null || bottom === null) return false;
        const buySide = zone.type === "BUY_SIDE";
        const swept = zone.status === "SWEPT";
        const fill = buySide
            ? `rgba(34,211,238,${swept ? .08 : isOverall ? .20 : .13})`
            : `rgba(251,191,36,${swept ? .08 : isOverall ? .20 : .13})`;
        const color = buySide ? "#22d3ee" : "#fbbf24";

        ctx.save();
        ctx.fillStyle = fill;
        ctx.fillRect(left, top, right - left, Math.max(1, bottom - top));
        ctx.strokeStyle = color;
        ctx.lineWidth = isOverall ? 2.5 : 1;
        ctx.setLineDash(swept ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(left, top); ctx.lineTo(right, top);
        ctx.moveTo(left, bottom); ctx.lineTo(right, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "11px Arial";
        const text = `${buySide ? "BUY" : "SELL"} LIQ • ${Math.round(zone.strength)}${swept ? " • SWEPT" : ""}`;
        const textWidth = ctx.measureText(text).width;
        const labelX = Math.max(2, Math.min(width - textWidth - 5, right - textWidth - 3));
        const labelY = Math.max(14, Math.min(height - 4, top + 14));
        ctx.fillStyle = "rgba(15,23,42,.84)";
        ctx.fillRect(labelX - 3, labelY - 12, textWidth + 6, 15);
        ctx.fillStyle = color;
        ctx.fillText(text, labelX, labelY);
        ctx.restore();
        return true;
    } catch (error) {
        try { ctx.restore(); } catch (restoreError) { /* noop */ }
        return false;
    }
}

function placeHNDTradeLabel(
    preferredX, preferredY, width, height, labelWidth, labelHeight, existingRects
) {
    const maxX = Math.max(0, width - labelWidth);
    const x = Math.max(0, Math.min(maxX, preferredX));
    const baseY = Math.max(0, Math.min(Math.max(0, height - labelHeight), preferredY));
    const overlaps = rect => existingRects.some(existing =>
        rect.left < existing.right + HND_TRADE_LABEL_GAP &&
        rect.right + HND_TRADE_LABEL_GAP > existing.left &&
        rect.top < existing.bottom + HND_TRADE_LABEL_GAP &&
        rect.bottom + HND_TRADE_LABEL_GAP > existing.top
    );
    const candidates = [0];
    for (let step = 1; step <= 8; step++) {
        candidates.push(step * (labelHeight + HND_TRADE_LABEL_GAP));
    }
    for (let step = 1; step <= 8; step++) {
        candidates.push(-step * (labelHeight + HND_TRADE_LABEL_GAP));
    }
    for (const offset of candidates) {
        const top = baseY + offset;
        const rect = { left: x, top, right: x + labelWidth, bottom: top + labelHeight };
        if (top < 0 || rect.bottom > height || overlaps(rect)) continue;
        existingRects.push(rect);
        return rect;
    }
    return null;
}

function drawHNDTradeLabel(ctx, text, preferredX, preferredY, color, width, height, pass) {
    ctx.font = "11px Arial";
    const textWidth = ctx.measureText(text).width;
    const labelWidth = textWidth + HND_TRADE_LABEL_PADDING_X * 2;
    const labelHeight = 11 + HND_TRADE_LABEL_PADDING_Y * 2;
    const rect = placeHNDTradeLabel(
        preferredX, preferredY, width, height, labelWidth, labelHeight, pass.labelRects
    );
    if (!rect) return false;
    ctx.fillStyle = "rgba(15,23,42,.90)";
    ctx.fillRect(rect.left, rect.top, labelWidth, labelHeight);
    ctx.fillStyle = color;
    ctx.fillText(text, rect.left + HND_TRADE_LABEL_PADDING_X,
        rect.top + HND_TRADE_LABEL_PADDING_Y + 10);
    pass.stats.tradeLabels++;
    pass.labels.push(text);
    return true;
}

function getHNDTradeOpenRange(startTime, width) {
    const right = Math.max(HND_TRADE_LINE_MIN_WIDTH, width - HND_TRADE_RIGHT_GUTTER);
    let start = null;
    try { start = hndChart.timeScale().timeToCoordinate(startTime); } catch (error) { start = null; }
    if (!Number.isFinite(start)) {
        try {
            const lastX = hndChart.timeScale().timeToCoordinate(hndChartLastCandleTime);
            if (!Number.isFinite(lastX) || lastX < 0 || lastX > width) return null;
            start = 0;
        } catch (error) { return null; }
    }
    if (start > right) return null;
    start = Math.max(0, start);
    return { start, end: Math.max(start + HND_TRADE_LINE_MIN_WIDTH, right) };
}

function getHNDTradeHistoryRange(startTime, endTime, width) {
    const rightEdge = Math.max(0, width - HND_TRADE_RIGHT_GUTTER);
    let start = null;
    let end = null;
    try {
        start = hndChart.timeScale().timeToCoordinate(startTime);
        end = hndChart.timeScale().timeToCoordinate(endTime);
    } catch (error) { return null; }
    if (!Number.isFinite(start) && !Number.isFinite(end)) return null;
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = rightEdge;
    if (Math.max(start, end) < 0 || Math.min(start, end) > rightEdge) return null;
    return { start: Math.max(0, Math.min(rightEdge, start)),
        end: Math.max(0, Math.min(rightEdge, end)) };
}

function drawHNDTradeLevel(ctx, range, price, kind, color, dashed, lineWidth, width, height, pass) {
    let y = null;
    try { y = hndCandleSeries.priceToCoordinate(price); } catch (error) { y = null; }
    if (!Number.isFinite(y)) return false;
    const label = `${kind} ${formatHNDTradePrice(price)}`;
    if (y < 0 || y > height) {
        const top = y < 0;
        const edgeY = top ? HND_TRADE_OFFSCREEN_MARGIN : height - HND_TRADE_OFFSCREEN_MARGIN;
        ctx.save();
        drawHNDTradeLabel(ctx, `${top ? "↑" : "↓"} ${label}`,
            Math.max(0, width - HND_TRADE_RIGHT_GUTTER - 72),
            top ? 1 : Math.max(0, height - 24), color, width, height, pass);
        ctx.restore();
        pass.stats.tradeOffscreenIndicators++;
        return false;
    }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashed);
    ctx.beginPath(); ctx.moveTo(range.start, y); ctx.lineTo(range.end, y); ctx.stroke();
    ctx.setLineDash([]);
    drawHNDTradeLabel(ctx, label, Math.max(0, range.end - 72), y - 10,
        color, width, height, pass);
    ctx.restore();
    if (kind === "ENTRY") pass.stats.tradeEntryLines++;
    if (kind === "SL") pass.stats.tradeStopLines++;
    if (kind === "TP") pass.stats.tradeTargetLines++;
    return true;
}

function drawHNDPendingTradeOverlay(ctx, pending, width, height, pass) {
    const range = getHNDTradeOpenRange(pending.startTime, width);
    if (!range) return false;
    ctx.save();
    drawHNDTradeLevel(ctx, range, pending.entryPrice, "ENTRY", "#facc15", [7, 5], 2,
        width, height, pass);
    drawHNDTradeLevel(ctx, range, pending.stopLoss, "SL", "rgba(239,68,68,.65)", [6, 5], 1,
        width, height, pass);
    drawHNDTradeLevel(ctx, range, pending.takeProfit, "TP", "rgba(34,197,94,.65)", [6, 5], 1,
        width, height, pass);
    drawHNDTradeLabel(ctx, `WAITING ${pending.direction}`, Math.max(0, range.end - 90), 8,
        "#facc15", width, height, pass);
    ctx.restore();
    pass.stats.tradePendingPlans++;
    return true;
}

function drawHNDActiveTradeOverlay(ctx, trade, width, height, pass) {
    const range = getHNDTradeOpenRange(trade.startTime, width);
    if (!range) return false;
    ctx.save();
    drawHNDTradeLevel(ctx, range, trade.entryPrice, "ENTRY", "#22d3ee", [], 2,
        width, height, pass);
    drawHNDTradeLevel(ctx, range, trade.stopLoss, "SL", "#ef4444", [7, 5], 2,
        width, height, pass);
    drawHNDTradeLevel(ctx, range, trade.takeProfit, "TP", "#22c55e", [7, 5], 2,
        width, height, pass);
    drawHNDTradeLabel(ctx, `${trade.direction} ${formatHNDTradeR(trade.unrealizedR)}`,
        Math.max(0, range.end - 90), 8, "#ffffff", width, height, pass);
    if (Number.isFinite(trade.lastPrice) && trade.lastPrice > 0) {
        let y = null;
        try { y = hndCandleSeries.priceToCoordinate(trade.lastPrice); } catch (error) { y = null; }
        if (Number.isFinite(y) && y >= 0 && y <= height) {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(range.end - 5, y, 3, 0, Math.PI * 2); ctx.fill();
            pass.stats.tradeCurrentPriceMarkers++;
            drawHNDTradeLabel(ctx, `PRICE ${formatHNDTradePrice(trade.lastPrice)}`,
                Math.max(0, range.end - 88), y + 7, "#ffffff", width, height, pass);
        }
    }
    ctx.restore();
    pass.stats.tradeActiveTrades++;
    return true;
}

function drawHNDHistoricalTradeOverlay(ctx, trade, width, height, pass) {
    const range = getHNDTradeHistoryRange(trade.startTime, trade.endTime, width);
    if (!range || range.end < range.start) return false;
    ctx.save();
    drawHNDTradeLevel(ctx, range, trade.entryPrice, "ENTRY", "rgba(148,163,184,.65)", [], 1,
        width, height, pass);
    drawHNDTradeLevel(ctx, range, trade.stopLoss, "SL", "rgba(239,68,68,.35)", [4, 4], 1,
        width, height, pass);
    drawHNDTradeLevel(ctx, range, trade.takeProfit, "TP", "rgba(34,197,94,.35)", [4, 4], 1,
        width, height, pass);
    const isTP = trade.state === "CLOSED_TP";
    const isSL = trade.state === "CLOSED_SL";
    const color = isTP ? "#22c55e" : isSL ? "#ef4444" : "#94a3b8";
    const prefix = isTP ? "TP" : isSL ? "SL" : "CANCELLED";
    let exitY = null;
    try { exitY = hndCandleSeries.priceToCoordinate(trade.exitPrice); } catch (error) { exitY = null; }
    if (Number.isFinite(exitY) && exitY >= 0 && exitY <= height) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(range.end, exitY, 4, 0, Math.PI * 2); ctx.fill();
        pass.stats.tradeExitMarkers++;
        const rText = formatHNDTradeR(trade.realizedR);
        drawHNDTradeLabel(ctx, rText === "-" ? prefix : `${prefix} ${rText}`,
            range.end + 5, exitY - 10, color, width, height, pass);
    }
    ctx.restore();
    pass.stats.tradeHistoryTrades++;
    return true;
}

function renderHNDOverlays() {
    if (!hndChartInitialized || !hndChart || !hndCandleSeries ||
        !hndOverlayCanvas || !hndOverlayContext) return false;
    const overlayData = hndOverlayData || {
        structureEvents: [], orderBlocks: [], fvgs: [],
        strongestLiquidity: { overall: null, buySide: null, sellSide: null }
    };
    clearHNDOverlayCanvas();
    const width = parseFloat(hndOverlayCanvas.style.width) || hndOverlayCanvas.clientWidth || 0;
    const height = parseFloat(hndOverlayCanvas.style.height) || hndOverlayCanvas.clientHeight || 0;
    let structureEvents = 0;
    const labelStats = { count: 0 };
    let liquidityZones = 0;
    let orderBlocks = 0;
    let fvgZones = 0;
    let priceZoneLabels = 0;
    const labelRects = [];
    const selectedFVGs = selectHNDPriceZonesForDisplay(
        overlayData.fvgs, "FVG", width, height, HND_FVG_DISPLAY_LIMIT
    );
    const selectedOrderBlocks = selectHNDPriceZonesForDisplay(
        overlayData.orderBlocks, "ORDER_BLOCK", width, height, HND_OB_DISPLAY_LIMIT
    );
    const summarizeSelectedZone = candidate => ({
        id: candidate.zone.id,
        kind: candidate.zone.kind,
        type: candidate.zone.type,
        status: candidate.zone.status,
        top: candidate.zone.top,
        bottom: candidate.zone.bottom,
        structureSignificanceScore: candidate.zone.structureSignificanceScore,
        zoneHeightATR: candidate.zone.zoneHeightATR,
        distancePercent: candidate.distancePercent,
        dominantQualifiedZone: candidate.zone.dominantQualifiedZone,
        majorHistoricalZone: isHNDMajorHistoricalPriceZone(candidate),
        selectionReason: candidate.selectionReason
    });
    hndOverlayLastSelectedPriceZones = {
        orderBlocks: selectedOrderBlocks.map(summarizeSelectedZone),
        fvgs: selectedFVGs.map(summarizeSelectedZone)
    };
    const zoneLabelIds = new Set(
        [...selectedFVGs, ...selectedOrderBlocks]
            .sort(compareHNDPriceZoneLabelPriority)
            .slice(0, HND_ZONE_LABEL_LIMIT)
            .map(candidate => `${candidate.zone.kind}:${candidate.zone.id}`)
    );
    const drawPriceZones = (candidates, counter) => {
        for (const candidate of candidates) {
            const beforeLabels = labelRects.length;
            if (drawHNDPriceZone(
                hndOverlayContext, candidate, width, height, labelRects,
                zoneLabelIds.has(`${candidate.zone.kind}:${candidate.zone.id}`)
            )) counter.count++;
            if (labelRects.length > beforeLabels) priceZoneLabels++;
        }
    };
    const fvgCounter = { count: 0 };
    const orderBlockCounter = { count: 0 };
    drawPriceZones(selectedFVGs, fvgCounter);
    drawPriceZones(selectedOrderBlocks, orderBlockCounter);
    fvgZones = fvgCounter.count;
    orderBlocks = orderBlockCounter.count;
    const strongest = overlayData.strongestLiquidity || {};
    const drawnZones = new Set();
    const zoneEntries = [
        [strongest.overall, true],
        [strongest.buySide, false],
        [strongest.sellSide, false]
    ];

    for (const [zone, isOverall] of zoneEntries) {
        if (!zone || drawnZones.has(zone.id)) continue;
        drawnZones.add(zone.id);
        if (drawHNDLiquidityZone(hndOverlayContext, zone, isOverall, width, height)) liquidityZones++;
    }
    const displayEvents = selectHNDStructureEventsForDisplay(
        overlayData.structureEvents,
        width,
        height
    );
    const labelEventIds = new Set(
        [...displayEvents]
            .sort(compareHNDStructurePriority)
            .slice(0, HND_STRUCTURE_LABEL_LIMIT)
            .map(candidate => candidate.event.id)
    );
    for (const { event } of displayEvents) {
        if (drawHNDStructureEvent(
            hndOverlayContext,
            event,
            width,
            height,
            labelRects,
            labelStats,
            labelEventIds.has(event.id)
        )) structureEvents++;
    }
    const tradeStats = {
        tradePendingPlans: 0, tradeActiveTrades: 0, tradeHistoryTrades: 0,
        tradeEntryLines: 0, tradeStopLines: 0, tradeTargetLines: 0,
        tradeExitMarkers: 0, tradeCurrentPriceMarkers: 0,
        tradeOffscreenIndicators: 0, tradeLabels: 0
    };
    const tradePass = { stats: tradeStats, labelRects: [], labels: [] };
    [...(hndTradeOverlayData.history || [])]
        .sort((first, second) => first.startTime - second.startTime ||
            first.endTime - second.endTime || first.id.localeCompare(second.id))
        .forEach(trade => drawHNDHistoricalTradeOverlay(
            hndOverlayContext, trade, width, height, tradePass
        ));
    if (hndTradeOverlayData.pendingPlan) {
        drawHNDPendingTradeOverlay(
            hndOverlayContext, hndTradeOverlayData.pendingPlan, width, height, tradePass
        );
    }
    if (hndTradeOverlayData.activeTrade) {
        drawHNDActiveTradeOverlay(
            hndOverlayContext, hndTradeOverlayData.activeTrade, width, height, tradePass
        );
    }
    hndOverlayLastRenderStats = {
        structureEvents,
        structureLabels: labelStats.count,
        liquidityZones,
        orderBlocks,
        fvgZones,
        priceZoneLabels,
        ...tradeStats
    };
    return true;
}

function setupHNDOverlaySubscriptions() {
    if (hndOverlaySubscriptionsInitialized) return true;
    if (!hndChart || typeof hndChart.timeScale !== "function") return false;
    try {
        const timeScale = hndChart.timeScale();
        if (typeof timeScale.subscribeVisibleLogicalRangeChange === "function") {
            timeScale.subscribeVisibleLogicalRangeChange(scheduleHNDOverlayRender);
        }
        if (typeof timeScale.subscribeVisibleTimeRangeChange === "function") {
            timeScale.subscribeVisibleTimeRangeChange(scheduleHNDOverlayRender);
        }
        hndOverlaySubscriptionsInitialized = true;
        return true;
    } catch (error) {
        return false;
    }
}

function updateHNDOverlays(source) {
    hndOverlayData = normalizeHNDOverlayData(source);
    if (!initHNDOverlayCanvas()) return false;
    resizeHNDOverlayCanvas();
    setupHNDOverlaySubscriptions();
    scheduleHNDOverlayRender();
    return true;
}

function updateHNDTradeOverlays(source = {}) {
    hndTradeOverlayData = normalizeHNDTradeOverlayData(source);
    hndTradeOverlayLastUpdate = {
        symbol: hndTradeOverlayData.symbol,
        interval: hndTradeOverlayData.interval,
        pendingPlanKey: hndTradeOverlayData.pendingPlan?.planKey ?? null,
        activeTradeId: hndTradeOverlayData.activeTrade?.id ?? null,
        historyCount: hndTradeOverlayData.history.length,
        updatedAt: Date.now()
    };
    if (!initHNDOverlayCanvas()) return false;
    resizeHNDOverlayCanvas();
    setupHNDOverlaySubscriptions();
    scheduleHNDOverlayRender();
    return true;
}

function clearHNDTradeOverlays() {
    hndTradeOverlayData = {
        symbol: null, interval: null, currentPrice: null,
        pendingPlan: null, activeTrade: null, history: []
    };
    hndTradeOverlayLastUpdate = null;
    hndOverlayLastRenderStats = {
        ...hndOverlayLastRenderStats,
        tradePendingPlans: 0, tradeActiveTrades: 0, tradeHistoryTrades: 0,
        tradeEntryLines: 0, tradeStopLines: 0, tradeTargetLines: 0,
        tradeExitMarkers: 0, tradeCurrentPriceMarkers: 0,
        tradeOffscreenIndicators: 0, tradeLabels: 0
    };
    scheduleHNDOverlayRender();
}

function clearHNDOverlays() {
    clearHNDTradeOverlays();
    hndOverlayData = {
        structureEvents: [],
        orderBlocks: [],
        fvgs: [],
        strongestLiquidity: { overall: null, buySide: null, sellSide: null }
    };
    clearHNDOverlayCanvas();
    hndChartLastCandleTime = null;
    hndOverlayLastRenderStats = {
        structureEvents: 0,
        structureLabels: 0,
        liquidityZones: 0,
        orderBlocks: 0,
        fvgZones: 0,
        priceZoneLabels: 0,
        tradePendingPlans: 0,
        tradeActiveTrades: 0,
        tradeHistoryTrades: 0,
        tradeEntryLines: 0,
        tradeStopLines: 0,
        tradeTargetLines: 0,
        tradeExitMarkers: 0,
        tradeCurrentPriceMarkers: 0,
        tradeOffscreenIndicators: 0,
        tradeLabels: 0
    };
    hndOverlayLastSelectedPriceZones = { orderBlocks: [], fvgs: [] };
    scheduleHNDOverlayRender();
}

function resizeHNDChartToContainer() {
    if (!hndChart || typeof document === "undefined") return;
    const container = document.getElementById("hndChart");
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        hndChart.resize(width, height);
        resizeHNDOverlayCanvas();
        scheduleHNDOverlayRender();
    }
}

function initHNDChart() {
    if (hndChartInitialized && hndChart && hndCandleSeries) return true;
    if (typeof document === "undefined") {
        showHNDChartError("Document is unavailable.");
        return false;
    }

    const container = document.getElementById("hndChart");
    const library = typeof window !== "undefined" ? window.LightweightCharts : null;
    if (!container) {
        showHNDChartError("HNDai Chart container is unavailable.");
        return false;
    }
    if (!library || typeof library.createChart !== "function" || !library.CandlestickSeries) {
        showHNDChartError("Lightweight Charts 5.2.0 could not be loaded.");
        return false;
    }

    try {
        const width = Math.max(320, container.clientWidth || 0);
        const height = Math.max(300, container.clientHeight || 0);
        const normalCrosshairMode = library.CrosshairMode &&
            Number.isFinite(library.CrosshairMode.Normal)
            ? library.CrosshairMode.Normal
            : 0;
        const chart = library.createChart(container, {
            width,
            height,
            layout: { background: { type: "solid", color: "#0f172a" }, textColor: "#cbd5e1" },
            grid: {
                vertLines: { color: "rgba(71,85,105,.22)" },
                horzLines: { color: "rgba(71,85,105,.22)" }
            },
            rightPriceScale: { borderColor: "#334155" },
            crosshair: { mode: normalCrosshairMode },
            timeScale: { borderColor: "#334155", timeVisible: true, secondsVisible: false }
        });
        const series = chart.addSeries(library.CandlestickSeries, {
            upColor: "#22c55e",
            downColor: "#ef4444",
            borderVisible: false,
            wickUpColor: "#4ade80",
            wickDownColor: "#f87171"
        });
        if (!chart || !series || typeof series.setData !== "function") {
            throw new Error("Chart or candlestick series could not be created.");
        }

        hndChart = chart;
        hndCandleSeries = series;
        hndChartInitialized = true;
        hndChartLastError = null;
        setHNDChartText("hndChartStatus", "HNDai Chart ready");
        const errorElement = document.getElementById("hndChartError");
        if (errorElement) {
            errorElement.textContent = "";
            errorElement.hidden = true;
        }

        initHNDOverlayCanvas();
        setupHNDOverlaySubscriptions();
        resizeHNDOverlayCanvas();

        if (typeof ResizeObserver === "function" && !hndChartResizeObserver) {
            hndChartResizeObserver = new ResizeObserver(entries => {
                const entry = entries[0];
                const observedWidth = entry?.contentRect?.width;
                const observedHeight = entry?.contentRect?.height;
                if (
                    Number.isFinite(observedWidth) && observedWidth > 0 &&
                    Number.isFinite(observedHeight) && observedHeight > 0
                ) {
                    hndChart.resize(observedWidth, observedHeight);
                    resizeHNDOverlayCanvas();
                    scheduleHNDOverlayRender();
                }
            });
            hndChartResizeObserver.observe(container);
        }
        else if (
            typeof window !== "undefined" &&
            typeof window.addEventListener === "function" &&
            !hndChartResizeHandler
        ) {
            hndChartResizeHandler = resizeHNDChartToContainer;
            window.addEventListener("resize", hndChartResizeHandler);
        }
        return true;
    } catch (error) {
        hndChart = null;
        hndCandleSeries = null;
        hndChartInitialized = false;
        showHNDChartError(error instanceof Error ? error.message : "HNDai Chart initialization failed.");
        return false;
    }
}

function getHNDRightPriceScale() {
    try {
        if (
            hndCandleSeries &&
            typeof hndCandleSeries.priceScale === "function"
        ) {
            const seriesPriceScale = hndCandleSeries.priceScale();

            if (seriesPriceScale) {
                return seriesPriceScale;
            }
        }

        if (
            hndChart &&
            typeof hndChart.priceScale === "function"
        ) {
            return hndChart.priceScale("right");
        }
    } catch (error) {
        return null;
    }

    return null;
}

function resetHNDChartView() {
    if (!hndChart || !hndCandleSeries) {
        return false;
    }

    let priceScaleReset = false;
    let timeScaleReset = false;

    try {
        const priceScale = getHNDRightPriceScale();

        if (
            priceScale &&
            typeof priceScale.setAutoScale === "function"
        ) {
            priceScale.setAutoScale(true);
            priceScaleReset = true;
        }
        else if (
            priceScale &&
            typeof priceScale.applyOptions === "function"
        ) {
            priceScale.applyOptions({
                autoScale: true
            });
            priceScaleReset = true;
        }
    } catch (error) {
        console.warn(
            "HNDai Chart price scale could not be reset.",
            error
        );
    }

    try {
        const timeScale = hndChart.timeScale();

        if (
            timeScale &&
            typeof timeScale.fitContent === "function"
        ) {
            timeScale.fitContent();
            timeScaleReset = true;
        }
    } catch (error) {
        console.warn(
            "HNDai Chart time scale could not be reset.",
            error
        );
    }

    scheduleHNDOverlayRender();

    return priceScaleReset || timeScaleReset;
}

function updateHNDChart(sourceCandles) {
    const normalizedCandles = normalizeHNDChartCandles(sourceCandles);
    if (!normalizedCandles.length) {
        hndChartLastCandleTime = null;
        hndChartLastCandleClose = null;
        setHNDChartText("hndChartStatus", "No valid chart data");
        return false;
    }
    if (!initHNDChart()) return false;

    try {
        hndCandleSeries.setData(normalizedCandles);
        hndChartLastCandleTime = normalizedCandles[normalizedCandles.length - 1].time;
        hndChartLastCandleClose = normalizedCandles[normalizedCandles.length - 1].close;
        hndChartDataCount = normalizedCandles.length;
        if (
            hndChartNeedsFit ||
            hndChartNeedsPriceScaleReset
        ) {
            resetHNDChartView();
            hndChartNeedsFit = false;
            hndChartNeedsPriceScaleReset = false;
        }
        hndChartLastError = null;
        hideHNDChartError();
        scheduleHNDOverlayRender();
        setHNDChartText("hndChartStatus", `HNDai Chart • ${hndChartDataCount} candles`);
        return true;
    } catch (error) {
        showHNDChartError(error instanceof Error ? error.message : "HNDai Chart update failed.");
        return false;
    }
}

function applyHNDChartMode(mode) {
    const tradingViewPanel = document.getElementById("tvchart");
    const hndPanel = document.getElementById("hndChart");
    const tradingViewButton = document.getElementById("chartModeTradingView");
    const hndButton = document.getElementById("chartModeHND");
    const isHND = mode === "hnd";
    tradingViewPanel?.classList.toggle("active", !isHND);
    tradingViewPanel?.classList.toggle("inactive", isHND);
    hndPanel?.classList.toggle("active", isHND);
    hndPanel?.classList.toggle("inactive", !isHND);
    tradingViewButton?.classList.toggle("active", !isHND);
    hndButton?.classList.toggle("active", isHND);
    tradingViewButton?.setAttribute("aria-pressed", String(!isHND));
    hndButton?.setAttribute("aria-pressed", String(isHND));
    hndPanel?.setAttribute("aria-hidden", String(!isHND));
    hndChartMode = mode;
}

function setHNDChartMode(mode) {
    if (mode !== "tradingview" && mode !== "hnd") return false;
    if (typeof document === "undefined") return false;
    if (mode === "hnd" && !initHNDChart()) {
        applyHNDChartMode("tradingview");
        return false;
    }
    applyHNDChartMode(mode);
    if (mode === "hnd") {
        resizeHNDChartToContainer();
        resizeHNDOverlayCanvas();
        scheduleHNDOverlayRender();
    }
    return true;
}

function setupHNDChartControls() {
    if (hndChartControlsInitialized || typeof document === "undefined") return;
    const tradingViewButton = document.getElementById("chartModeTradingView");
    const hndButton = document.getElementById("chartModeHND");
    if (!tradingViewButton || !hndButton) return;
    tradingViewButton.addEventListener("click", () => setHNDChartMode("tradingview"));
    hndButton.addEventListener("click", () => setHNDChartMode("hnd"));
    hndChartControlsInitialized = true;
}

function requestHNDChartFit() {
    hndChartNeedsFit = true;
    hndChartNeedsPriceScaleReset = true;
}

window.HNDChartEngine = {
    init: initHNDChart,
    update: updateHNDChart,
    setMode: setHNDChartMode,
    setupControls: setupHNDChartControls,
    requestFit: requestHNDChartFit,
    resetView: resetHNDChartView,
    normalizeCandles: normalizeHNDChartCandles,
    updateOverlays: updateHNDOverlays,
    updateTradeOverlays: updateHNDTradeOverlays,
    clearOverlays: clearHNDOverlays,
    clearTradeOverlays: clearHNDTradeOverlays,
    normalizeTradeOverlayData: normalizeHNDTradeOverlayData,
    normalizeTradeTime: normalizeHNDTradeTime,
    formatTradePrice: formatHNDTradePrice,
    formatTradeR: formatHNDTradeR,
    renderOverlays: scheduleHNDOverlayRender,
    getState() {
        const liquidityIds = new Set([
            hndOverlayData?.strongestLiquidity?.overall?.id,
            hndOverlayData?.strongestLiquidity?.buySide?.id,
            hndOverlayData?.strongestLiquidity?.sellSide?.id
        ].filter(Boolean));
        return {
            initialized: hndChartInitialized,
            mode: hndChartMode,
            needsFit: hndChartNeedsFit,
            priceScaleResetPending: hndChartNeedsPriceScaleReset,
            dataCount: hndChartDataCount,
            lastError: hndChartLastError,
            overlay: {
                canvasReady: Boolean(hndOverlayCanvas && hndOverlayContext),
                structureEventCount: hndOverlayData?.structureEvents?.length || 0,
                liquidityZoneCount: liquidityIds.size,
                orderBlockCount: hndOverlayData?.orderBlocks?.length || 0,
                fvgCount: hndOverlayData?.fvgs?.length || 0,
                lastRenderStats: { ...hndOverlayLastRenderStats },
                selectedPriceZones: {
                    orderBlocks: hndOverlayLastSelectedPriceZones.orderBlocks.map(zone => ({ ...zone })),
                    fvgs: hndOverlayLastSelectedPriceZones.fvgs.map(zone => ({ ...zone }))
                },
                lastCandleTime: hndChartLastCandleTime
            },
            tradeOverlay: {
                pendingVisible: Boolean(hndTradeOverlayData.pendingPlan),
                activeVisible: Boolean(hndTradeOverlayData.activeTrade),
                historyVisibleCount: hndTradeOverlayData.history.length,
                lastUpdate: hndTradeOverlayLastUpdate ? { ...hndTradeOverlayLastUpdate } : null,
                lastRenderStats: {
                    tradePendingPlans: hndOverlayLastRenderStats.tradePendingPlans,
                    tradeActiveTrades: hndOverlayLastRenderStats.tradeActiveTrades,
                    tradeHistoryTrades: hndOverlayLastRenderStats.tradeHistoryTrades,
                    tradeEntryLines: hndOverlayLastRenderStats.tradeEntryLines,
                    tradeStopLines: hndOverlayLastRenderStats.tradeStopLines,
                    tradeTargetLines: hndOverlayLastRenderStats.tradeTargetLines,
                    tradeExitMarkers: hndOverlayLastRenderStats.tradeExitMarkers,
                    tradeCurrentPriceMarkers: hndOverlayLastRenderStats.tradeCurrentPriceMarkers,
                    tradeOffscreenIndicators: hndOverlayLastRenderStats.tradeOffscreenIndicators,
                    tradeLabels: hndOverlayLastRenderStats.tradeLabels
                }
            }
        };
    }
};

console.log("HNDai Chart Engine v1 Ready");
