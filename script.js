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
        window.HNDTradeEngine?.reset?.("SYMBOL_CHANGED");
        window.HNDTradePlanEngine?.reset?.("SYMBOL_CHANGED");
        window.HNDSetupEngine?.reset?.("SYMBOL_CHANGED");
        window.HNDMTFEngine?.setSymbol?.(currentCoin);
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
        window.HNDTradeEngine?.reset?.("TIMEFRAME_CHANGED");
        window.HNDTradePlanEngine?.reset?.("TIMEFRAME_CHANGED");
        window.HNDSetupEngine?.reset?.("TIMEFRAME_CHANGED");
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

let initialJournalState = { initialized: false, tradeCount: 0, metrics: {} };
try {
    if (window.HNDTradeJournal && typeof window.HNDTradeJournal.init === "function") {
        initialJournalState = window.HNDTradeJournal.init();
    }
} catch (journalInitError) {
    console.warn("Trade Journal initialization failed.", journalInitError);
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
    let cycleStructureEvents = [];
    let cycleLiquidityZones = [];
    let cycleStrongestLiquidity = { overall: null, buySide: null, sellSide: null };

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
            typeof detectFVGs === "function"
        ) {
            cycleStructureEvents = detectStructureEvents({
                lookback: 3,
                limit: HND_STRUCTURE_HISTORY_LIMIT,
                includeBOS: true,
                includeCHoCH: true
            });
            cycleLiquidityZones = detectLiquidityZones({
                lookback: 3,
                tolerance: 0.0015,
                minTouches: 2,
                limit: 20,
                includeSwept: true,
                includeBroken: false
            });
            cycleStrongestLiquidity = getStrongestLiquidityZones(cycleLiquidityZones);
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
                        structureEvents: cycleStructureEvents,
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

            if (window.HNDChartEngine &&
                typeof window.HNDChartEngine.updateOverlays === "function") {
                window.HNDChartEngine.updateOverlays({
                    structureEvents: cycleStructureEvents,
                    strongestLiquidity: cycleStrongestLiquidity,
                    orderBlocks: cycleQualifiedPriceZones.orderBlocks,
                    fvgs: cycleQualifiedPriceZones.fvgs
                });
            }
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

    let tradePlanState = { status: "NO_PLAN", currentPlan: null };
    try {
        if (window.HNDTradePlanEngine &&
            typeof window.HNDTradePlanEngine.evaluate === "function") {
            tradePlanState = window.HNDTradePlanEngine.evaluate({
                symbol: cycleCoin,
                interval: cycleInterval,
                price,
                candles: loadedCandles,
                setupState,
                liquidityZones: cycleLiquidityZones,
                strongestLiquidity: cycleStrongestLiquidity
            });
        }
    } catch (planError) {
        console.warn("Trade Plan Engine evaluation failed; no trade was opened.", planError);
        tradePlanState = {
            status: "NO_PLAN",
            currentPlan: null,
            lastEvaluation: {
                debug: {
                    version: "4.2", symbol: cycleCoin, interval: cycleInterval, price,
                    primaryReason: "PLAN_ENGINE_ERROR",
                    errorMessage: String(planError?.message || planError).slice(0, 300)
                }
            }
        };
    }

    window.HNDLastTradePlanEvaluation = {
        symbol: cycleCoin,
        interval: cycleInterval,
        price,
        status: tradePlanState?.status ?? "NO_PLAN",
        currentPlan: tradePlanState?.currentPlan
            ? JSON.parse(JSON.stringify(tradePlanState.currentPlan)) : null,
        debug: tradePlanState?.lastEvaluation?.debug
            ? JSON.parse(JSON.stringify(tradePlanState.lastEvaluation.debug)) : null
    };

    // Trade varsa kontrol et
    let tradeState = { status: "NO_TRADE", activeTrade: null };
    try {
        if (window.HNDTradeEngine?.evaluate) {
            tradeState = window.HNDTradeEngine.evaluate({
                symbol: cycleCoin, interval: cycleInterval, price,
                candles: loadedCandles, setupState, tradePlanState
            });
        }
    } catch (tradeError) {
        console.warn("Paper trade engine evaluation failed; analysis will continue.", tradeError);
        tradeState = {
            status: "NO_TRADE", activeTrade: null,
            debug: {
                version: "4.3", symbol: cycleCoin, interval: cycleInterval, price,
                primaryReason: "TRADE_ENGINE_ERROR",
                errorMessage: String(tradeError?.message || tradeError).slice(0, 300)
            }
        };
    }

    window.HNDLastTradeEvaluation = {
        symbol: cycleCoin, interval: cycleInterval, price,
        status: tradeState?.status ?? "NO_TRADE",
        activeTrade: tradeState?.activeTrade
            ? JSON.parse(JSON.stringify(tradeState.activeTrade)) : null,
        lastClosedTrade: tradeState?.lastClosedTrade
            ? JSON.parse(JSON.stringify(tradeState.lastClosedTrade)) : null,
        debug: tradeState?.lastEvaluation?.debug
            ? JSON.parse(JSON.stringify(tradeState.lastEvaluation.debug))
            : tradeState?.debug ? JSON.parse(JSON.stringify(tradeState.debug)) : null
    };

    // Arayüzü güncelle
    let tradeHistoryForChart = [];
    try {
        tradeHistoryForChart = window.HNDTradeEngine &&
            typeof window.HNDTradeEngine.getHistory === "function"
            ? window.HNDTradeEngine.getHistory() : [];
    } catch (historyError) {
        console.warn("Paper trade history could not be read for chart.", historyError);
        tradeHistoryForChart = [];
    }

    let journalState = initialJournalState;
    try {
        if (window.HNDTradeJournal && typeof window.HNDTradeJournal.sync === "function") {
            journalState = window.HNDTradeJournal.sync({
                tradeHistory: tradeHistoryForChart,
                lastClosedTrade: tradeState?.lastClosedTrade ?? null
            });
        }
    } catch (journalError) {
        console.warn("Trade Journal synchronization failed; engine will continue.", journalError);
    }

    window.HNDLastTradeJournalEvaluation = {
        symbol: cycleCoin,
        interval: cycleInterval,
        tradeCount: journalState?.tradeCount ?? 0,
        completedTrades: journalState?.metrics?.completedTrades ?? 0,
        netR: journalState?.metrics?.netR ?? 0,
        persistenceActive: journalState?.persistenceActive === true,
        primaryReason: journalState?.lastEvaluation?.debug?.primaryReason ?? null,
        updatedAt: Date.now()
    };

    try {
        if (window.HNDChartEngine &&
            typeof window.HNDChartEngine.updateTradeOverlays === "function") {
            window.HNDChartEngine.updateTradeOverlays({
                symbol: cycleCoin,
                interval: cycleInterval,
                price,
                tradePlanState,
                tradeState,
                tradeHistory: tradeHistoryForChart
            });
        }
    } catch (tradeChartError) {
        console.warn("Paper trade chart overlay failed; the engine will continue.", tradeChartError);
    }

    window.HNDLastTradeChartOverlay = {
        symbol: cycleCoin,
        interval: cycleInterval,
        status: tradeState?.status ?? "NO_TRADE",
        pendingPlanKey: tradeState?.pendingExecution?.planKey ?? null,
        activeTradeId: tradeState?.activeTrade?.id ?? null,
        lastClosedTradeId: tradeState?.lastClosedTrade?.id ?? null,
        historyCount: Array.isArray(tradeHistoryForChart) ? tradeHistoryForChart.length : 0,
        updatedAt: Date.now()
    };

    updateUI(result, price, setupState, tradePlanState, tradeState, journalState);

    } finally {
        engineRunning = false;
    }

}

// İlk çalıştır
startEngine();

// Her 5 saniyede güncelle
setInterval(startEngine, 5000);
