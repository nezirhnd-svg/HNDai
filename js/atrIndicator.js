(function (root, factory) {
    "use strict";

    var normalizer;
    var api;

    if (typeof module === "object" && module.exports) {
        normalizer = require("./candleNormalizer.js");
        api = factory(normalizer);
        module.exports = api;
        return;
    }

    normalizer = root && root.HNDCandleNormalizer;
    api = factory(normalizer);
    root.HNDAtrIndicator = api;
}(typeof window !== "undefined" ? window : null, function (normalizer) {
    "use strict";

    if (
        !normalizer ||
        typeof normalizer.normalizeCandles !== "function" ||
        typeof normalizer.validateCandleSequence !== "function"
    ) {
        throw new Error("HND_CANDLE_NORMALIZER_MISSING");
    }

    function normalizePeriod(value) {
        return (
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 1
        ) ? value : null;
    }

    function invalidResult(error, period, rejected, duplicateOpenTimeCount) {
        return {
            valid: false,
            error: error,
            period: period,
            ready: false,
            seedIndex: null,
            openTimes: [],
            trueRanges: [],
            values: [],
            latest: null,
            rejected: rejected || [],
            duplicateOpenTimeCount: duplicateOpenTimeCount || 0
        };
    }

    function calculateATR(rawCandles, period, options) {
        var normalizedPeriod = normalizePeriod(period);
        var config = options && typeof options === "object" ? options : {};
        var normalized;
        var sequence;
        var candles;
        var openTimes;
        var trueRanges = [];
        var values;
        var seedSum = 0;
        var previousAtr;
        var range1;
        var range2;
        var range3;
        var current;
        var index;

        if (normalizedPeriod === null) {
            return invalidResult("INVALID_PERIOD", null, [], 0);
        }
        if (!Array.isArray(rawCandles)) {
            return invalidResult("INVALID_CANDLE_SERIES", normalizedPeriod, [], 0);
        }

        normalized = normalizer.normalizeCandles(
            rawCandles,
            { nowMs: config.nowMs }
        );
        if (normalized.rejected.length > 0) {
            return invalidResult(
                "INVALID_CANDLE_SERIES",
                normalizedPeriod,
                normalized.rejected.map(function (entry) {
                    return { inputIndex: entry.inputIndex, reason: entry.reason };
                }),
                normalized.duplicateOpenTimeCount
            );
        }

        candles = normalized.candles;
        sequence = normalizer.validateCandleSequence(candles);
        if (!sequence.valid) {
            return invalidResult(
                "INVALID_CANDLE_SEQUENCE",
                normalizedPeriod,
                [],
                normalized.duplicateOpenTimeCount
            );
        }

        openTimes = candles.map(function (candle) {
            return candle.openTime;
        });
        for (index = 0; index < candles.length; index += 1) {
            range1 = candles[index].high - candles[index].low;
            if (index === 0) {
                current = range1;
            } else {
                range2 = Math.abs(candles[index].high - candles[index - 1].close);
                range3 = Math.abs(candles[index].low - candles[index - 1].close);
                current = Math.max(range1, range2, range3);
            }
            if (
                !Number.isFinite(range1) ||
                (index > 0 && (!Number.isFinite(range2) || !Number.isFinite(range3))) ||
                !Number.isFinite(current)
            ) {
                return invalidResult(
                    "NON_FINITE_RESULT",
                    normalizedPeriod,
                    [],
                    normalized.duplicateOpenTimeCount
                );
            }
            trueRanges.push(current);
        }

        values = trueRanges.map(function () {
            return null;
        });
        if (candles.length < normalizedPeriod) {
            return {
                valid: true,
                error: null,
                period: normalizedPeriod,
                ready: false,
                seedIndex: null,
                openTimes: openTimes.slice(),
                trueRanges: trueRanges.slice(),
                values: values,
                latest: null,
                rejected: [],
                duplicateOpenTimeCount: normalized.duplicateOpenTimeCount
            };
        }

        for (index = 0; index < normalizedPeriod; index += 1) {
            seedSum += trueRanges[index];
            if (!Number.isFinite(seedSum)) {
                return invalidResult(
                    "NON_FINITE_RESULT",
                    normalizedPeriod,
                    [],
                    normalized.duplicateOpenTimeCount
                );
            }
        }
        previousAtr = seedSum / normalizedPeriod;
        if (!Number.isFinite(previousAtr)) {
            return invalidResult(
                "NON_FINITE_RESULT",
                normalizedPeriod,
                [],
                normalized.duplicateOpenTimeCount
            );
        }
        values[normalizedPeriod - 1] = previousAtr;

        for (index = normalizedPeriod; index < trueRanges.length; index += 1) {
            previousAtr = (
                (previousAtr * (normalizedPeriod - 1)) + trueRanges[index]
            ) / normalizedPeriod;
            if (!Number.isFinite(previousAtr)) {
                return invalidResult(
                    "NON_FINITE_RESULT",
                    normalizedPeriod,
                    [],
                    normalized.duplicateOpenTimeCount
                );
            }
            values[index] = previousAtr;
        }

        return {
            valid: true,
            error: null,
            period: normalizedPeriod,
            ready: true,
            seedIndex: normalizedPeriod - 1,
            openTimes: openTimes.slice(),
            trueRanges: trueRanges.slice(),
            values: values.slice(),
            latest: previousAtr,
            rejected: [],
            duplicateOpenTimeCount: normalized.duplicateOpenTimeCount
        };
    }

    return {
        normalizePeriod: normalizePeriod,
        calculateATR: calculateATR
    };
}));
