(function (root, factory) {
    "use strict";
    var core;
    var api;
    if (typeof module === "object" && module.exports) {
        core = require("./coreIndicatorSnapshot.js");
        api = factory(core);
        module.exports = api;
        return;
    }
    core = root && root.HNDCoreIndicatorSnapshot;
    api = factory(core);
    root.HNDTrendRegime = api;
}(typeof window !== "undefined" ? window : null, function (core) {
    "use strict";

    if (!core || typeof core.buildSnapshot !== "function") {
        throw new Error("HND_CORE_SNAPSHOT_DEPENDENCY_MISSING");
    }

    function getVocabulary() {
        return {
            directions: ["BULLISH", "BEARISH", "NEUTRAL"],
            alignments: ["BULLISH", "BEARISH", "MIXED"],
            pricePositions: ["ABOVE_EMA200", "BELOW_EMA200", "AT_EMA200"]
        };
    }

    function safeCount(value) {
        return typeof value === "number" && Number.isFinite(value) && value >= 0
            ? value : 0;
    }

    function failure(error, coreError, result) {
        return {
            valid: false, error: error,
            coreError: coreError === undefined ? null : coreError, ready: false,
            sourceCandleCount: safeCount(result && result.sourceCandleCount),
            closedCandleCount: safeCount(result && result.closedCandleCount),
            excludedOpenCandleCount: safeCount(result && result.excludedOpenCandleCount),
            openTimes: [], regimes: [], latest: null,
            duplicateOpenTimeCount: safeCount(result && result.duplicateOpenTimeCount)
        };
    }

    function analyzeTrend(rawCandles, options) {
        var result = core.buildSnapshot(rawCandles, options);
        var previous = null;
        var regimes = [];
        var latest;

        if (!result || result.valid !== true) {
            return failure("CORE_SNAPSHOT_FAILED", result && result.error, result);
        }
        if (
            !Array.isArray(result.openTimes) ||
            !Array.isArray(result.snapshots) ||
            result.openTimes.length !== result.snapshots.length
        ) {
            return failure("CORE_ALIGNMENT_ERROR", null, result);
        }
        for (var index = 0; index < result.snapshots.length; index += 1) {
            var snapshot = result.snapshots[index];
            if (
                !snapshot || typeof snapshot !== "object" ||
                snapshot.openTime !== result.openTimes[index] ||
                (previous !== null && snapshot.openTime <= previous)
            ) {
                return failure("CORE_ALIGNMENT_ERROR", null, result);
            }
            previous = snapshot.openTime;
            var regime = {
                openTime: snapshot.openTime, closeTime: snapshot.closeTime, close: snapshot.close,
                ema20: snapshot.ema20, ema50: snapshot.ema50, ema200: snapshot.ema200,
                atr14: snapshot.atr14, alignment: null, pricePosition: null,
                direction: null, ema20To50Atr: null, ema50To200Atr: null, isReady: false
            };
            if (snapshot.isReady === true) {
                var numeric = [
                    snapshot.openTime, snapshot.closeTime, snapshot.close,
                    snapshot.ema20, snapshot.ema50, snapshot.ema200, snapshot.atr14
                ];
                if (
                    !numeric.every(function (value) {
                        return typeof value === "number" && Number.isFinite(value);
                    }) ||
                    !Number.isSafeInteger(snapshot.openTime) ||
                    !Number.isSafeInteger(snapshot.closeTime) ||
                    snapshot.openTime < 0 || snapshot.closeTime < snapshot.openTime ||
                    snapshot.atr14 < 0
                ) {
                    return failure("INVALID_READY_SNAPSHOT", null, result);
                }
                regime.alignment = snapshot.ema20 > snapshot.ema50 && snapshot.ema50 > snapshot.ema200
                    ? "BULLISH"
                    : snapshot.ema20 < snapshot.ema50 && snapshot.ema50 < snapshot.ema200
                        ? "BEARISH" : "MIXED";
                regime.pricePosition = snapshot.close > snapshot.ema200
                    ? "ABOVE_EMA200"
                    : snapshot.close < snapshot.ema200 ? "BELOW_EMA200" : "AT_EMA200";
                regime.direction = regime.alignment === "BULLISH" && regime.pricePosition === "ABOVE_EMA200"
                    ? "BULLISH"
                    : regime.alignment === "BEARISH" && regime.pricePosition === "BELOW_EMA200"
                        ? "BEARISH" : "NEUTRAL";
                if (snapshot.atr14 > 0) {
                    regime.ema20To50Atr = (snapshot.ema20 - snapshot.ema50) / snapshot.atr14;
                    regime.ema50To200Atr = (snapshot.ema50 - snapshot.ema200) / snapshot.atr14;
                    if (
                        !Number.isFinite(regime.ema20To50Atr) ||
                        !Number.isFinite(regime.ema50To200Atr)
                    ) {
                        return failure("NON_FINITE_TREND_METRIC", null, result);
                    }
                }
                regime.isReady = true;
            }
            regimes.push(regime);
        }
        latest = regimes.length ? Object.assign({}, regimes[regimes.length - 1]) : null;
        return {
            valid: true, error: null, coreError: null,
            ready: latest !== null && latest.isReady === true,
            sourceCandleCount: safeCount(result.sourceCandleCount),
            closedCandleCount: safeCount(result.closedCandleCount),
            excludedOpenCandleCount: safeCount(result.excludedOpenCandleCount),
            openTimes: result.openTimes.slice(),
            regimes: regimes.map(function (item) { return Object.assign({}, item); }),
            latest: latest,
            duplicateOpenTimeCount: safeCount(result.duplicateOpenTimeCount)
        };
    }

    return { getVocabulary: getVocabulary, analyzeTrend: analyzeTrend };
}));
