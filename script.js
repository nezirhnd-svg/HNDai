// ==========================
// TradeAI Main Engine
// ==========================

let currentCoin = "BTCUSDT";
let currentInterval = "15m";
let currentTradingViewInterval = "15";
let engineRunning = false;

const TIMEFRAME_MAP = {
    "1": { binance: "1m", tradingView: "1" },
    "1m": { binance: "1m", tradingView: "1" },
    "5": { binance: "5m", tradingView: "5" },
    "5m": { binance: "5m", tradingView: "5" },
    "15": { binance: "15m", tradingView: "15" },
    "15m": { binance: "15m", tradingView: "15" },
    "30": { binance: "30m", tradingView: "30" },
    "30m": { binance: "30m", tradingView: "30" },
    "60": { binance: "1h", tradingView: "60" },
    "60m": { binance: "1h", tradingView: "60" },
    "1h": { binance: "1h", tradingView: "60" },
    "240": { binance: "4h", tradingView: "240" },
    "240m": { binance: "4h", tradingView: "240" },
    "4h": { binance: "4h", tradingView: "240" },
    "1d": { binance: "1d", tradingView: "D" }
};

// TradingView
function initTradingView() {
    if (
        !window.TradingView ||
        typeof window.TradingView.widget !== "function"
    ) {
        console.warn("TradingView is unavailable; the data engine will continue without the chart.");
        return;
    }

    try {
        const chartContainer = document.getElementById("tvchart");

        if (chartContainer) {
            chartContainer.replaceChildren();
        }

        new window.TradingView.widget({
            autosize: true,
            symbol: "BINANCE:" + currentCoin,
            interval: currentTradingViewInterval,
            timezone: "Etc/UTC",
            theme: "dark",
            style: "1",
            locale: "tr",
            container_id: "tvchart",
            hide_side_toolbar: false,
            allow_symbol_change: true
        });
    } catch (err) {
        console.warn("TradingView chart could not be initialized; the data engine will continue.", err);
    }
}

function setupMarketControls() {
    const coinSelect = document.getElementById("coinSelect");
    const timeframeSelect = document.getElementById("timeframe");

    if (!coinSelect || !timeframeSelect) {
        console.warn("Market controls are unavailable; the data engine will continue with current settings.");
        return;
    }

    coinSelect.addEventListener("change", () => {
        const selectedCoin = String(coinSelect.value).trim().toUpperCase();

        if (!/^[A-Z0-9]+$/.test(selectedCoin)) {
            console.warn("Unsupported coin selection; the previous market was preserved.");
            return;
        }

        currentCoin = selectedCoin;
        activeTrade = null;
        window.HNDChartEngine?.clearOverlays?.();
        window.HNDChartEngine?.requestFit?.();
        initTradingView();
        startEngine();
    });

    timeframeSelect.addEventListener("change", () => {
        const selectedTimeframe = String(timeframeSelect.value).trim().toLowerCase();
        const timeframeConfig = TIMEFRAME_MAP[selectedTimeframe];

        if (!timeframeConfig) {
            console.warn("Unsupported timeframe selection; the previous timeframe was preserved.");
            return;
        }

        currentInterval = timeframeConfig.binance;
        currentTradingViewInterval = timeframeConfig.tradingView;
        activeTrade = null;
        window.HNDChartEngine?.clearOverlays?.();
        window.HNDChartEngine?.requestFit?.();
        initTradingView();
        startEngine();
    });
}

initTradingView();
setupMarketControls();

if (
    window.HNDChartEngine &&
    typeof window.HNDChartEngine.setupControls === "function"
) {
    window.HNDChartEngine.setupControls();
}

// Ana Motor
async function startEngine() {

    if (engineRunning) return;

    engineRunning = true;

    const cycleCoin = currentCoin;
    const cycleInterval = currentInterval;

    try {

    // Binance verilerini çek
    const loadedCandles = await fetchCandles(cycleCoin, cycleInterval);

    if (cycleCoin !== currentCoin || cycleInterval !== currentInterval) return;

    if (!Array.isArray(loadedCandles) || loadedCandles.length < 200) {
        console.error("Engine stopped: at least 200 valid candles are required");
        return;
    }

    try {
        if (
            window.HNDChartEngine &&
            typeof window.HNDChartEngine.update === "function"
        ) {
            window.HNDChartEngine.update(loadedCandles);
        }
    } catch (chartError) {
        console.warn("HNDai Chart update failed; the analysis engine will continue.", chartError);
    }

    try {
        if (
            typeof detectStructureEvents === "function" &&
            typeof detectLiquidityZones === "function" &&
            typeof getStrongestLiquidityZones === "function" &&
            window.HNDChartEngine &&
            typeof window.HNDChartEngine.updateOverlays === "function"
        ) {
            const structureEvents = detectStructureEvents({
                lookback: 3,
                limit: 20,
                includeBOS: true,
                includeCHoCH: true
            });
            const liquidityZones = detectLiquidityZones({
                lookback: 3,
                tolerance: 0.0015,
                minTouches: 2,
                limit: 20,
                includeSwept: true,
                includeBroken: false
            });
            const strongestLiquidity = getStrongestLiquidityZones(liquidityZones);

            window.HNDChartEngine.updateOverlays({
                structureEvents,
                strongestLiquidity
            });
        }
    } catch (overlayError) {
        console.warn("HNDai Chart overlays could not be updated; the analysis engine will continue.", overlayError);
    }

    // Canlı fiyat
    const price = await fetchPrice(cycleCoin);

    if (cycleCoin !== currentCoin || cycleInterval !== currentInterval) return;

    if (!Number.isFinite(price) || price <= 0) {
        console.error("Engine stopped: invalid price", price);
        return;
    }

    // Analiz yap
    const result = analyzeMarket();

    // Trade yoksa aç
    if (!activeTrade && result.signal !== "WAIT") {

        openTrade(result.signal, price);

    }

    // Trade varsa kontrol et
    checkTrade(price);

    // Arayüzü güncelle
    updateUI(result, price);

    } finally {
        engineRunning = false;
    }

}

// İlk çalıştır
startEngine();

// Her 5 saniyede güncelle
setInterval(startEngine, 5000);
