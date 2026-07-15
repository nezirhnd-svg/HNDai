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
let hndChartDataCount = 0;
let hndChartLastError = null;
let hndChartControlsInitialized = false;
let hndChartResizeHandler = null;
let hndOverlayCanvas = null;
let hndOverlayContext = null;
let hndOverlayData = null;
let hndOverlayAnimationFrame = null;
let hndOverlaySubscriptionsInitialized = false;
let hndOverlayLastRenderStats = {
    structureEvents: 0,
    liquidityZones: 0
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

        return {
            id: zone.id,
            type: zone.type,
            price: zone.price,
            zoneHigh: zone.zoneHigh,
            zoneLow: zone.zoneLow,
            strength: Math.min(100, Math.max(0,
                Number.isFinite(zone.strength) ? zone.strength : 0
            )),
            status: zone.status
        };
    };

    const strongest = source?.strongestLiquidity || {};
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

function drawHNDStructureEvent(ctx, event, width, height) {
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
        ctx.font = "11px Arial";
        const text = event.label;
        const textWidth = ctx.measureText(text).width;
        const labelX = Math.max(2, Math.min(width - textWidth - 8, right - textWidth));
        const labelY = Math.max(14, Math.min(height - 4, y - 4));
        ctx.fillStyle = "rgba(15,23,42,.82)";
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

function drawHNDLiquidityZone(ctx, zone, isOverall, width, height) {
    try {
        const highRaw = hndCandleSeries.priceToCoordinate(zone.zoneHigh);
        const lowRaw = hndCandleSeries.priceToCoordinate(zone.zoneLow);
        if (![highRaw, lowRaw].every(Number.isFinite)) return false;
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
        ctx.fillRect(0, top, width, Math.max(1, bottom - top));
        ctx.strokeStyle = color;
        ctx.lineWidth = isOverall ? 2.5 : 1;
        ctx.setLineDash(swept ? [6, 4] : []);
        ctx.beginPath();
        ctx.moveTo(0, top); ctx.lineTo(width, top);
        ctx.moveTo(0, bottom); ctx.lineTo(width, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "11px Arial";
        const text = `${buySide ? "BUY" : "SELL"} LIQ • ${Math.round(zone.strength)}${swept ? " • SWEPT" : ""}`;
        const textWidth = ctx.measureText(text).width;
        const labelX = Math.max(2, width - textWidth - 8);
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
    let liquidityZones = 0;
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
    for (const event of hndOverlayData.structureEvents.slice(-20)) {
        if (drawHNDStructureEvent(hndOverlayContext, event, width, height)) structureEvents++;
    }
    hndOverlayLastRenderStats = { structureEvents, liquidityZones };
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
        strongestLiquidity: { overall: null, buySide: null, sellSide: null }
    };
    clearHNDOverlayCanvas();
    hndOverlayLastRenderStats = { structureEvents: 0, liquidityZones: 0 };
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
        const chart = library.createChart(container, {
            width,
            height,
            layout: { background: { type: "solid", color: "#0f172a" }, textColor: "#cbd5e1" },
            grid: {
                vertLines: { color: "rgba(71,85,105,.22)" },
                horzLines: { color: "rgba(71,85,105,.22)" }
            },
            rightPriceScale: { borderColor: "#334155" },
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

function updateHNDChart(sourceCandles) {
    const normalizedCandles = normalizeHNDChartCandles(sourceCandles);
    if (!normalizedCandles.length) {
        setHNDChartText("hndChartStatus", "No valid chart data");
        return false;
    }
    if (!initHNDChart()) return false;

    try {
        hndCandleSeries.setData(normalizedCandles);
        hndChartDataCount = normalizedCandles.length;
        if (hndChartNeedsFit) {
            hndChart.timeScale().fitContent();
            hndChartNeedsFit = false;
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
}

window.HNDChartEngine = {
    init: initHNDChart,
    update: updateHNDChart,
    setMode: setHNDChartMode,
    setupControls: setupHNDChartControls,
    requestFit: requestHNDChartFit,
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
            dataCount: hndChartDataCount,
            lastError: hndChartLastError,
            overlay: {
                canvasReady: Boolean(hndOverlayCanvas && hndOverlayContext),
                structureEventCount: hndOverlayData?.structureEvents?.length || 0,
                liquidityZoneCount: liquidityIds.size,
                lastRenderStats: { ...hndOverlayLastRenderStats }
            }
        };
    }
};

console.log("HNDai Chart Engine v1 Ready");
