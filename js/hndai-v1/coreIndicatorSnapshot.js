(function (root, factory) {
    "use strict";
    var deps;
    var api;
    if (typeof module === "object" && module.exports) {
        deps = [
            require("./candleNormalizer.js"),
            require("./emaIndicator.js"),
            require("./rsiIndicator.js"),
            require("./atrIndicator.js"),
            require("./volumeIndicator.js")
        ];
        api = factory.apply(null, deps);
        module.exports = api;
        return;
    }
    api = factory(
        root && root.HNDCandleNormalizer,
        root && root.HNDEmaIndicator,
        root && root.HNDRsiIndicator,
        root && root.HNDAtrIndicator,
        root && root.HNDVolumeIndicator
    );
    root.HNDCoreIndicatorSnapshot = api;
}(typeof window !== "undefined" ? window : null, function (
    normalizer, ema, rsi, atr, volume
) {
    "use strict";

    if (
        !normalizer || typeof normalizer.normalizeCandles !== "function" ||
        typeof normalizer.validateCandleSequence !== "function" ||
        !ema || typeof ema.calculateEMA !== "function" ||
        !rsi || typeof rsi.calculateRSI !== "function" ||
        !atr || typeof atr.calculateATR !== "function" ||
        !volume || typeof volume.calculateVolumeMetrics !== "function"
    ) {
        throw new Error("HND_CORE_INDICATOR_DEPENDENCY_MISSING");
    }

    function getPeriods() {
        return { ema20: 20, ema50: 50, ema200: 200, rsi14: 14, atr14: 14, volume20: 20 };
    }

    function failure(error, componentError, periods, rejected, duplicateCount) {
        return {
            valid: false, error: error, componentError: componentError || null,
            ready: false, periods: Object.assign({}, periods), sourceCandleCount: 0,
            closedCandleCount: 0, excludedOpenCandleCount: 0, openTimes: [],
            snapshots: [], latest: null, rejected: rejected || [],
            duplicateOpenTimeCount: duplicateCount || 0
        };
    }

    function sameTimes(left, right) {
        return left.length === right.length && left.every(function (value, index) {
            return value === right[index];
        });
    }

    function buildSnapshot(rawCandles, options) {
        var periods = getPeriods();
        var nowMs = options && options.nowMs;
        var normalized;
        var source;
        var closed;
        var openTimes;
        var closes;
        var results;
        var requiredLengths;
        var snapshots;
        var latest;

        if (typeof nowMs !== "number" || !Number.isFinite(nowMs) || nowMs < 0) {
            return failure("INVALID_NOW_MS", null, periods, [], 0);
        }
        if (!Array.isArray(rawCandles)) {
            return failure("INVALID_CANDLE_SERIES", null, periods, [], 0);
        }
        normalized = normalizer.normalizeCandles(rawCandles, { nowMs: nowMs });
        if (normalized.rejected.length > 0) {
            return failure(
                "INVALID_CANDLE_SERIES", null, periods,
                normalized.rejected.map(function (item) {
                    return { inputIndex: item.inputIndex, reason: item.reason };
                }),
                normalized.duplicateOpenTimeCount
            );
        }
        source = normalized.candles;
        if (!normalizer.validateCandleSequence(source).valid) {
            return failure(
                "INVALID_CANDLE_SEQUENCE", null, periods, [],
                normalized.duplicateOpenTimeCount
            );
        }
        closed = source.filter(function (candle) { return candle.isClosed === true; });
        openTimes = closed.map(function (candle) { return candle.openTime; });
        closes = closed.map(function (candle) { return candle.close; });
        results = [
            { name: "EMA20", data: ema.calculateEMA(closes, periods.ema20) },
            { name: "EMA50", data: ema.calculateEMA(closes, periods.ema50) },
            { name: "EMA200", data: ema.calculateEMA(closes, periods.ema200) },
            { name: "RSI14", data: rsi.calculateRSI(closes, periods.rsi14) },
            { name: "ATR14", data: atr.calculateATR(closed, periods.atr14, { nowMs: nowMs }) },
            { name: "VOLUME20", data: volume.calculateVolumeMetrics(closed, periods.volume20, { nowMs: nowMs }) }
        ];
        for (var resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
            if (results[resultIndex].data.valid !== true) {
                return failure(
                    "INDICATOR_CALCULATION_FAILED", results[resultIndex].name,
                    periods, [], normalized.duplicateOpenTimeCount
                );
            }
        }
        requiredLengths = [
            results[0].data.values, results[1].data.values, results[2].data.values,
            results[3].data.values, results[4].data.values,
            results[5].data.averageVolumes, results[5].data.ratios,
            results[4].data.openTimes, results[5].data.openTimes
        ];
        if (
            requiredLengths.some(function (list) { return list.length !== closed.length; }) ||
            !sameTimes(results[4].data.openTimes, openTimes) ||
            !sameTimes(results[5].data.openTimes, openTimes)
        ) {
            return failure(
                "INTERNAL_ALIGNMENT_ERROR", null, periods, [],
                normalized.duplicateOpenTimeCount
            );
        }
        snapshots = closed.map(function (candle, index) {
            var item = {
                openTime: candle.openTime, closeTime: candle.closeTime, close: candle.close,
                ema20: results[0].data.values[index], ema50: results[1].data.values[index],
                ema200: results[2].data.values[index], rsi14: results[3].data.values[index],
                atr14: results[4].data.values[index],
                averageVolume20: results[5].data.averageVolumes[index],
                volumeRatio20: results[5].data.ratios[index],
                isReady: false
            };
            item.isReady = [
                item.ema20, item.ema50, item.ema200, item.rsi14,
                item.atr14, item.averageVolume20
            ].every(function (value) { return typeof value === "number"; });
            return item;
        });
        latest = snapshots.length ? Object.assign({}, snapshots[snapshots.length - 1]) : null;
        return {
            valid: true, error: null, componentError: null,
            ready: latest !== null && latest.isReady === true,
            periods: Object.assign({}, periods), sourceCandleCount: source.length,
            closedCandleCount: closed.length,
            excludedOpenCandleCount: source.length - closed.length,
            openTimes: openTimes.slice(),
            snapshots: snapshots.map(function (item) { return Object.assign({}, item); }),
            latest: latest, rejected: [],
            duplicateOpenTimeCount: normalized.duplicateOpenTimeCount
        };
    }

    return { getPeriods: getPeriods, buildSnapshot: buildSnapshot };
}));
