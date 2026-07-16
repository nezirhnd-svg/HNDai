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
let hndOverlayLastRenderStats = {
    structureEvents: 0,
    structureLabels: 0,
    liquidityZones: 0,
    orderBlocks: 0,
    fvgZones: 0,
    priceZoneLabels: 0
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
            ? zone.confirmationIndex : null
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

function compareHNDPriceZonePriority(first, second) {
    const firstDistance = Number.isFinite(first.distancePercent)
        ? first.distancePercent : Number.MAX_VALUE;
    const secondDistance = Number.isFinite(second.distancePercent)
        ? second.distancePercent : Number.MAX_VALUE;
    return getHNDPriceZoneStatusPriority(second.zone.status) -
        getHNDPriceZoneStatusPriority(first.zone.status) ||
        firstDistance - secondDistance ||
        first.zone.touches - second.zone.touches ||
        second.zone.startTime - first.zone.startTime ||
        (second.zone.confirmationTime ?? 0) - (first.zone.confirmationTime ?? 0) ||
        first.zone.id.localeCompare(second.zone.id);
}

function compareHNDPriceZoneLabelPriority(first, second) {
    const labelStatus = status => status === "ACTIVE" ? 2 : status === "TOUCHED" ? 1 : 0;
    const firstDistance = Number.isFinite(first.distancePercent)
        ? first.distancePercent : Number.MAX_VALUE;
    const secondDistance = Number.isFinite(second.distancePercent)
        ? second.distancePercent : Number.MAX_VALUE;
    return labelStatus(second.zone.status) - labelStatus(first.zone.status) ||
        firstDistance - secondDistance ||
        second.zone.startTime - first.zone.startTime ||
        first.zone.id.localeCompare(second.zone.id);
}

function selectHNDPriceZonesForDisplay(zones, kind, width, height, totalLimit) {
    if (!Array.isArray(zones) || !Number.isFinite(totalLimit) || totalLimit <= 0) return [];
    const candidates = zones
        .filter(zone => zone?.kind === kind)
        .map(zone => getHNDPriceZoneDisplayCandidate(zone, width, height))
        .filter(Boolean)
        .sort(compareHNDPriceZonePriority);
    const selected = [];
    const selectedIds = new Set();
    ["BULLISH", "BEARISH"].forEach(direction => {
        candidates.filter(candidate => candidate.zone.type === direction)
            .slice(0, HND_ZONE_DIRECTION_LIMIT)
            .forEach(candidate => {
                if (selected.length < totalLimit && !selectedIds.has(candidate.zone.id)) {
                    selected.push(candidate);
                    selectedIds.add(candidate.zone.id);
                }
            });
    });
    for (const candidate of candidates) {
        if (selected.length >= totalLimit) break;
        if (!selectedIds.has(candidate.zone.id)) {
            selected.push(candidate);
            selectedIds.add(candidate.zone.id);
        }
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

function renderHNDOverlays() {
    if (!hndChartInitialized || !hndChart || !hndCandleSeries ||
        !hndOverlayCanvas || !hndOverlayContext || !hndOverlayData) return false;
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
        hndOverlayData.fvgs, "FVG", width, height, HND_FVG_DISPLAY_LIMIT
    );
    const selectedOrderBlocks = selectHNDPriceZonesForDisplay(
        hndOverlayData.orderBlocks, "ORDER_BLOCK", width, height, HND_OB_DISPLAY_LIMIT
    );
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
    const strongest = hndOverlayData.strongestLiquidity || {};
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
        hndOverlayData.structureEvents,
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
    hndOverlayLastRenderStats = {
        structureEvents,
        structureLabels: labelStats.count,
        liquidityZones,
        orderBlocks,
        fvgZones,
        priceZoneLabels
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

function clearHNDOverlays() {
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
        priceZoneLabels: 0
    };
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
    clearOverlays: clearHNDOverlays,
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
                lastCandleTime: hndChartLastCandleTime
            }
        };
    }
};

console.log("HNDai Chart Engine v1 Ready");
