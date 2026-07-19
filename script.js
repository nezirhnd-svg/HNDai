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

const HND_STRUCTURE_HISTORY_LIMIT = 100;
const HND_RAW_ZONE_HISTORY_LIMIT = 200;

const HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS = Object.freeze({
    maxEvents: HND_STRUCTURE_HISTORY_LIMIT,
    orderBlocksPerEvent: 2,
    fvgsPerEvent: 2,
    maxQualifiedOrderBlocks: 24,
    maxQualifiedFVGs: 24,
    nestedContainmentToleranceATR: 0.05,
    nearZoneMidpointATR: 0.18,
    nearZoneOverlapRatio: 0.70,
    zoneClusterMaxEventBars: 24,
    invalidatedMinSignificanceScore: 70,
    invalidatedMinZoneHeightATR: 0.18,
    mitigatedMinSignificanceScore: 55,
    mitigatedMinZoneHeightATR: 0.10,
    includeBOS: true,
    includeCHoCH: true,
    requireClosedConfirmation: true,
    atrPeriod: 14,
    minLegBars: 4,
    minLegRangeATR: 1.25,
    minBreakDistanceATR: 0.10,
    minConfirmationBodyATR: 0.22,
    minConfirmationBodyRatio: 0.45,
    minStructureAdvanceATR: 0.08,
    minOrderBlockHeightATR: 0.12,
    minFVGHeightATR: 0.06,
    requireExternalProgression: true
});

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
        window.HNDSetupEngine?.reset?.("SYMBOL_CHANGED");
        window.HNDMTFEngine?.setSymbol?.(currentCoin);
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
        window.HNDSetupEngine?.reset?.("TIMEFRAME_CHANGED");
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

if (
    window.HNDMTFEngine &&
    typeof window.HNDMTFEngine.init === "function"
) {
    window.HNDMTFEngine.init(currentCoin);
}

// Ana Motor
async function startEngine() {

    if (engineRunning) return;

    engineRunning = true;

    const cycleCoin = currentCoin;
    const cycleInterval = currentInterval;
    let cycleQualifiedPriceZones = {
        generatedAt: null,
        orderBlocks: [],
        fvgs: [],
        summary: {}
    };

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
            typeof detectOrderBlocks === "function" &&
            typeof detectFVGs === "function" &&
            window.HNDChartEngine &&
            typeof window.HNDChartEngine.updateOverlays === "function"
        ) {
            const structureEvents = detectStructureEvents({
                lookback: 3,
                limit: HND_STRUCTURE_HISTORY_LIMIT,
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
            const rawOrderBlocks = detectOrderBlocks({
                limit: HND_RAW_ZONE_HISTORY_LIMIT,
                includeInvalidated: true
            });
            const rawFVGs = detectFVGs({
                limit: HND_RAW_ZONE_HISTORY_LIMIT,
                includeInvalidated: true
            });
            try {
                if (typeof selectStructureConfirmedPriceZones !== "function") {
                    throw new Error("Structure zone qualifier is unavailable.");
                }
                cycleQualifiedPriceZones = selectStructureConfirmedPriceZones(
                    {
                        candles: loadedCandles,
                        structureEvents,
                        orderBlocks: rawOrderBlocks,
                        fvgs: rawFVGs
                    },
                    HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS
                );
            } catch (qualificationError) {
                console.warn(
                    "Structure-confirmed price zones could not be selected; raw zones were suppressed.",
                    qualificationError
                );
            }
            window.HNDLastStructureQualification = {
                symbol: cycleCoin,
                interval: cycleInterval,
                generatedAt: cycleQualifiedPriceZones.generatedAt,
                summary: { ...cycleQualifiedPriceZones.summary },
                thresholds: {
                    atrPeriod: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.atrPeriod,
                    minLegBars: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.minLegBars,
                    minLegRangeATR: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.minLegRangeATR,
                    minBreakDistanceATR: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.minBreakDistanceATR,
                    minConfirmationBodyATR: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.minConfirmationBodyATR,
                    minConfirmationBodyRatio: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.minConfirmationBodyRatio,
                    minStructureAdvanceATR: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.minStructureAdvanceATR,
                    minOrderBlockHeightATR: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.minOrderBlockHeightATR,
                    minFVGHeightATR: HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS.minFVGHeightATR
                }
            };

            window.HNDChartEngine.updateOverlays({
                structureEvents,
                strongestLiquidity,
                orderBlocks: cycleQualifiedPriceZones.orderBlocks,
                fvgs: cycleQualifiedPriceZones.fvgs
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

    let setupState = { status: "NO_SETUP", currentSetup: null };
    try {
        if (window.HNDSetupEngine && typeof window.HNDSetupEngine.evaluate === "function") {
            setupState = window.HNDSetupEngine.evaluate({
                symbol: cycleCoin,
                interval: cycleInterval,
                candles: loadedCandles,
                price,
                analysis: result,
                qualifiedPriceZones: cycleQualifiedPriceZones,
                mtfState: window.HNDMTFEngine?.getState?.() || null
            });
        }
    } catch (setupError) {
        console.warn("Setup Engine evaluation failed; no raw-price entry was created.", setupError);
        setupState = {
            status: "NO_SETUP",
            currentSetup: null,
            lastEvaluation: {
                debug: {
                    version: "4.1.1",
                    symbol: cycleCoin,
                    interval: cycleInterval,
                    price,
                    signal: result?.signal ?? null,
                    primaryReason: "SETUP_ENGINE_ERROR",
                    errorMessage: String(setupError?.message || setupError).slice(0, 300)
                }
            }
        };
    }

    window.HNDLastSetupEvaluation = {
        symbol: cycleCoin,
        interval: cycleInterval,
        price,
        status: setupState?.status ?? "NO_SETUP",
        currentSetup: setupState?.currentSetup
            ? JSON.parse(JSON.stringify(setupState.currentSetup)) : null,
        debug: setupState?.lastEvaluation?.debug
            ? JSON.parse(JSON.stringify(setupState.lastEvaluation.debug)) : null
    };

    // Trade varsa kontrol et
    if (activeTrade) checkTrade(price);

    // Arayüzü güncelle
    updateUI(result, price, setupState);

    } finally {
        engineRunning = false;
    }

}

// İlk çalıştır
startEngine();

// Her 5 saniyede güncelle
setInterval(startEngine, 5000);
