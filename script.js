// ==========================
// TradeAI Main Engine
// ==========================

let currentCoin = "BTCUSDT";
let currentInterval = "15m";
let currentTradingViewInterval = "15";
let engineRunning = false;
let marketControlsInitialized = false;

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
const HND_STRUCTURE_SHADOW_LEFT_BARS = 2;
const HND_STRUCTURE_SHADOW_RIGHT_BARS = 2;
let structureShadowEnabled = false;

function normalizeStructureShadowCandles(source) {
    if (!Array.isArray(source) || !source.length) return null;
    const normalized = source.map(candle => ({
        openTime: Number(candle?.time),
        closeTime: Number(candle?.closeTime),
        open: Number(candle?.open),
        high: Number(candle?.high),
        low: Number(candle?.low),
        close: Number(candle?.close),
        volume: Number(candle?.volume)
    }));
    const valid = normalized.every(candle =>
        Number.isSafeInteger(candle.openTime) && candle.openTime >= 0 &&
        Number.isSafeInteger(candle.closeTime) && candle.closeTime >= candle.openTime &&
        [candle.open, candle.high, candle.low, candle.close, candle.volume]
            .every(Number.isFinite) &&
        candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 &&
        candle.volume >= 0 && candle.high >= Math.max(candle.open, candle.close) &&
        candle.low <= Math.min(candle.open, candle.close)
    );
    return valid ? normalized : null;
}

function buildStructureShadowContext(source, symbol, interval, nowMs) {
    const rawCandles = normalizeStructureShadowCandles(source);
    if (!rawCandles || !Number.isSafeInteger(nowMs) || nowMs < 0 ||
        typeof symbol !== "string" || !symbol || symbol !== symbol.trim().toUpperCase() ||
        typeof interval !== "string" || !interval || interval !== interval.trim()) return null;
    let evaluationAtIndex = -1;
    for (let index = rawCandles.length - 1; index >= 0; index -= 1) {
        if (rawCandles[index].closeTime <= nowMs) {
            evaluationAtIndex = index;
            break;
        }
    }
    if (evaluationAtIndex < 0) return null;
    const evaluationCandle = rawCandles[evaluationAtIndex];
    return {
        rawCandles,
        analysisContext: {
            symbol, interval, nowMs,
            leftBars: HND_STRUCTURE_SHADOW_LEFT_BARS,
            rightBars: HND_STRUCTURE_SHADOW_RIGHT_BARS
        },
        evaluationContext: {
            symbol, interval, evaluationAtIndex,
            evaluationOpenTime: evaluationCandle.openTime,
            evaluationCloseTime: evaluationCandle.closeTime
        }
    };
}

function buildStructureShadowSetupFields(source, symbol, interval, nowMs, enabled) {
    const structureShadowEnabledValue = enabled === true;
    return {
        featureFlags: { structureShadowEnabled: structureShadowEnabledValue },
        structureShadowContext: structureShadowEnabledValue
            ? buildStructureShadowContext(source, symbol, interval, nowMs) : null
    };
}

function initializeStructureShadowToggle() {
    const toggle = document.getElementById("structureShadowToggle");
    structureShadowEnabled = false;
    if (!toggle) return;
    toggle.checked = false;
    toggle.addEventListener("change", () => {
        structureShadowEnabled = toggle.checked === true;
        const state = document.getElementById("structureShadowToggleState");
        if (state) state.textContent = structureShadowEnabled ? "SHADOW" : "OFF";
    });
}

window.HNDStructureShadowRuntimeTestAPI = Object.freeze({
    normalizeStructureShadowCandles,
    buildStructureShadowContext,
    buildStructureShadowSetupFields,
    isEnabled: () => structureShadowEnabled
});

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
    if (marketControlsInitialized) return;
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

        if (window.HNDMarketCatalog &&
            typeof window.HNDMarketCatalog.isSupportedSymbol === "function" &&
            !window.HNDMarketCatalog.isSupportedSymbol(selectedCoin)) {
            coinSelect.value = currentCoin;
            console.warn("Unsupported coin selection; the previous market was preserved.");
            return;
        }

        window.HNDMarketCatalog?.setSelectedSymbol?.(selectedCoin);
        currentCoin = selectedCoin;
        window.HNDHistoricalReplay?.reset?.();
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
        window.HNDHistoricalReplay?.reset?.();
        window.HNDTradeEngine?.reset?.("TIMEFRAME_CHANGED");
        window.HNDTradePlanEngine?.reset?.("TIMEFRAME_CHANGED");
        window.HNDSetupEngine?.reset?.("TIMEFRAME_CHANGED");
        window.HNDChartEngine?.clearOverlays?.();
        window.HNDChartEngine?.requestFit?.();
        initTradingView();
        startEngine();
    });
    marketControlsInitialized = true;
}

initTradingView();
setupMarketControls();
initializeStructureShadowToggle();

let marketCatalogInitPromise = Promise.resolve(null);
try {
    if (window.HNDMarketCatalog &&
        typeof window.HNDMarketCatalog.init === "function") {
        marketCatalogInitPromise = window.HNDMarketCatalog.init({
            selectedSymbol: currentCoin
        });
    }
} catch (marketCatalogInitError) {
    console.warn(
        "Market catalog initialization failed; core markets remain available.",
        marketCatalogInitError
    );
}

marketCatalogInitPromise.then(state => {
    window.HNDLastMarketCatalogEvaluation = {
        source: state?.source ?? "CORE_ONLY",
        stale: state?.stale === true,
        selectedSymbol: state?.selectedSymbol ?? currentCoin,
        coreCount: state?.coreCount ?? 5,
        topMarketCount: state?.topMarketCount ?? 0,
        favoriteCount: state?.favoriteCount ?? 0,
        totalMarketCount: state?.totalMarketCount ?? 5,
        cacheUpdatedAt: state?.cacheUpdatedAt ?? null,
        primaryReason: state?.lastEvaluation?.debug?.primaryReason ?? null,
        updatedAt: Date.now()
    };
}).catch(marketCatalogInitError => {
    console.warn(
        "Market catalog initialization failed; core markets remain available.",
        marketCatalogInitError
    );
});

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

try {
    window.HNDBacktestBenchmark?.init?.({
        getSeedCandles() {
            if (!Array.isArray(candles)) return [];
            return candles.slice(-500).map(candle => ({
                time: Number(candle.time), open: Number(candle.open),
                high: Number(candle.high), low: Number(candle.low),
                close: Number(candle.close), volume: Number(candle.volume)
            }));
        },
        getMarketContext() {
            return { symbol: currentCoin, interval: currentInterval };
        }
    });
} catch (benchmarkInitError) {
    console.warn("Backtest benchmark initialization failed.", benchmarkInitError);
}

try {
    window.HNDHistoricalDataLoader?.init?.({
        getMarketContext() {
            return { symbol: currentCoin, interval: currentInterval };
        }
    });
} catch (historicalDataInitError) {
    console.warn("Historical Data Loader initialization failed.", historicalDataInitError);
}

try {
    window.HNDHistoricalReplay?.init?.({
        async getHistoricalDataset(request = {}) {
            const symbol = String(request.symbol ?? currentCoin);
            const interval = String(request.interval ?? currentInterval);
            const requested = Number(request.requestedCandleCount);
            const current = window.HNDHistoricalDataLoader?.getDataset?.();
            const currentUsable = current?.metadata?.symbol === symbol &&
                current?.metadata?.interval === interval &&
                current?.metadata?.source !== "STALE_CACHE" &&
                current?.columns?.openTime instanceof Float64Array &&
                current.columns.openTime.length >= requested;
            if (currentUsable) return current;
            return window.HNDHistoricalDataStore?.getDataset?.(
                `${symbol}|${interval}`
            ) ?? null;
        },
        getLoaderState() {
            return window.HNDHistoricalDataLoader?.getState?.() ?? null;
        },
        getMarketContext() {
            return { symbol: currentCoin, interval: currentInterval };
        },
        getReplayProfile() {
            return {
                structureHistoryLimit: HND_STRUCTURE_HISTORY_LIMIT,
                rawZoneHistoryLimit: HND_RAW_ZONE_HISTORY_LIMIT,
                structureQualificationOptions: JSON.parse(JSON.stringify(
                    HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS
                )),
                replayWindowBars: 500,
                mtfMode: "NOT_INCLUDED"
            };
        }
    });
} catch (historicalReplayInitError) {
    console.warn("Historical Replay initialization failed.", historicalReplayInitError);
}

try {
    window.HNDParityEngine?.init?.({
        async getHistoricalDataset(request = {}) {
            const symbol = String(request.symbol ?? currentCoin);
            const interval = String(request.interval ?? currentInterval);
            const requested = Number(request.requestedCandleCount);
            const current = window.HNDHistoricalDataLoader?.getDataset?.();
            const currentUsable = current?.metadata?.symbol === symbol &&
                current?.metadata?.interval === interval &&
                current?.metadata?.source !== "STALE_CACHE" &&
                current?.columns?.openTime instanceof Float64Array &&
                current.columns.openTime.length >= requested;
            if (currentUsable) return current;
            return window.HNDHistoricalDataStore?.getDataset?.(`${symbol}|${interval}`) ?? null;
        },
        getReplayResult() {
            return window.HNDHistoricalReplay?.getLastResult?.() ?? null;
        },
        getReplayState() {
            return window.HNDHistoricalReplay?.getState?.() ?? null;
        },
        getMarketContext() {
            return { symbol: currentCoin, interval: currentInterval };
        },
        getReplayProfile() {
            return {
                structureHistoryLimit: HND_STRUCTURE_HISTORY_LIMIT,
                rawZoneHistoryLimit: HND_RAW_ZONE_HISTORY_LIMIT,
                structureQualificationOptions: JSON.parse(JSON.stringify(
                    HND_STRUCTURE_ZONE_QUALIFICATION_OPTIONS
                )),
                replayWindowBars: 500,
                mtfMode: "NOT_INCLUDED"
            };
        }
    });
} catch (parityInitError) {
    console.warn("Parity Engine initialization failed.", parityInitError);
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
    const structureShadowSetupFields = buildStructureShadowSetupFields(
        loadedCandles, cycleCoin, cycleInterval, Date.now(), structureShadowEnabled);

    let setupState = { status: "NO_SETUP", currentSetup: null };
    let setupEvaluationSucceeded = false;
    try {
        if (window.HNDSetupEngine && typeof window.HNDSetupEngine.evaluate === "function") {
            setupState = window.HNDSetupEngine.evaluate({
                symbol: cycleCoin,
                interval: cycleInterval,
                candles: loadedCandles,
                price,
                analysis: result,
                qualifiedPriceZones: cycleQualifiedPriceZones,
                mtfState: window.HNDMTFEngine?.getState?.() || null,
                featureFlags: structureShadowSetupFields.featureFlags,
                structureShadowContext: structureShadowSetupFields.structureShadowContext
            });
            setupEvaluationSucceeded = true;
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

    let structureShadow = null;
    try {
        if (window.HNDSetupEngine &&
            typeof window.HNDSetupEngine.getLastStructureShadow === "function") {
            const latestShadow = window.HNDSetupEngine.getLastStructureShadow();
            structureShadow = latestShadow === null || latestShadow === undefined
                ? null : JSON.parse(JSON.stringify(latestShadow));
        }
    } catch (shadowReadError) {
        console.warn("Structure Shadow diagnostics could not be read; legacy flow will continue.",
            shadowReadError);
    }

    let structureShadowTelemetry = null;
    try {
        const telemetry = window.HNDStructureShadowTelemetry;
        const evaluationCloseTime =
            structureShadowSetupFields.structureShadowContext?.evaluationContext?.evaluationCloseTime;
        if (setupEvaluationSucceeded && structureShadowEnabled && structureShadow &&
            structureShadow.status !== "DISABLED" &&
            Number.isSafeInteger(evaluationCloseTime) && evaluationCloseTime > 0 &&
            telemetry && typeof telemetry.record === "function") {
            telemetry.record({
                symbol: cycleCoin,
                interval: cycleInterval,
                evaluationCloseTime,
                observedAt: Date.now(),
                shadow: JSON.parse(JSON.stringify(structureShadow))
            });
        }
        if (telemetry && typeof telemetry.getSummary === "function") {
            structureShadowTelemetry = JSON.parse(JSON.stringify(telemetry.getSummary()));
        }
    } catch (telemetryError) {
        console.warn("Structure Shadow telemetry failed; legacy flow will continue.", telemetryError);
    }

    window.HNDLastSetupEvaluation = {
        symbol: cycleCoin,
        interval: cycleInterval,
        price,
        status: setupState?.status ?? "NO_SETUP",
        currentSetup: setupState?.currentSetup
            ? JSON.parse(JSON.stringify(setupState.currentSetup)) : null,
        debug: setupState?.lastEvaluation?.debug
            ? JSON.parse(JSON.stringify(setupState.lastEvaluation.debug)) : null,
        structureShadow: structureShadow === null
            ? null : JSON.parse(JSON.stringify(structureShadow)),
        structureShadowTelemetry: structureShadowTelemetry === null
            ? null : JSON.parse(JSON.stringify(structureShadowTelemetry))
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

    if (cycleCoin === currentCoin && cycleInterval === currentInterval) {
        try {
            window.HNDParityEngine?.captureLiveCycle?.({
                symbol: cycleCoin,
                interval: cycleInterval,
                candles: loadedCandles,
                price,
                structureEvents: cycleStructureEvents,
                liquidityZones: cycleLiquidityZones,
                strongestLiquidity: cycleStrongestLiquidity,
                qualifiedPriceZones: cycleQualifiedPriceZones,
                analysis: result,
                setupState,
                tradePlanState,
                tradeState,
                mtfState: window.HNDMTFEngine?.getState?.() ?? null,
                capturedAt: Date.now()
            });
        } catch (parityCaptureError) {
            console.warn("Parity live capture failed.", parityCaptureError);
        }
    }

    updateUI(result, price, setupState, tradePlanState, tradeState, journalState,
        structureShadow, structureShadowTelemetry);

    } finally {
        engineRunning = false;
    }

}

// İlk çalıştır
startEngine();

// Her 5 saniyede güncelle
setInterval(startEngine, 5000);
