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

function resizeHNDChartToContainer() {
    if (!hndChart || typeof document === "undefined") return;
    const container = document.getElementById("hndChart");
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
        hndChart.resize(width, height);
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

        if (typeof ResizeObserver === "function" && !hndChartResizeObserver) {
            hndChartResizeObserver = new ResizeObserver(entries => {
                const entry = entries[0];
                const observedWidth = entry?.contentRect?.width;
                const observedHeight = entry?.contentRect?.height;
                if (
                    Number.isFinite(observedWidth) && observedWidth > 0 &&
                    Number.isFinite(observedHeight) && observedHeight > 0
                ) hndChart.resize(observedWidth, observedHeight);
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
    if (mode === "hnd") resizeHNDChartToContainer();
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
    getState() {
        return {
            initialized: hndChartInitialized,
            mode: hndChartMode,
            needsFit: hndChartNeedsFit,
            dataCount: hndChartDataCount,
            lastError: hndChartLastError
        };
    }
};

console.log("HNDai Chart Engine v1 Ready");
