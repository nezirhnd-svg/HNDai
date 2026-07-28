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
    root.HNDVolumeIndicator = api;
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

    function invalidResult(error, period, rejected, duplicateCount) {
        return {
            valid: false,
            error: error,
            period: period,
            ready: false,
            seedIndex: null,
            openTimes: [],
            volumes: [],
            averageVolumes: [],
            ratios: [],
            latest: null,
            rejected: rejected || [],
            duplicateOpenTimeCount: duplicateCount || 0
        };
    }

    function calculateVolumeMetrics(rawCandles, period, options) {
        var normalizedPeriod = normalizePeriod(period);
        var config = options && typeof options === "object" ? options : {};
        var normalized;
        var candles;
        var openTimes;
        var volumes;
        var averageVolumes;
        var ratios;
        var rollingSum = 0;
        var average;
        var ratio;
        var latest = null;
        var index;

        if (normalizedPeriod === null) {
            return invalidResult("INVALID_PERIOD", null, [], 0);
        }
        if (!Array.isArray(rawCandles)) {
            return invalidResult("INVALID_CANDLE_SERIES", normalizedPeriod, [], 0);
        }

        normalized = normalizer.normalizeCandles(rawCandles, { nowMs: config.nowMs });
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
        if (!normalizer.validateCandleSequence(candles).valid) {
            return invalidResult(
                "INVALID_CANDLE_SEQUENCE",
                normalizedPeriod,
                [],
                normalized.duplicateOpenTimeCount
            );
        }

        openTimes = candles.map(function (candle) { return candle.openTime; });
        volumes = candles.map(function (candle) { return candle.volume; });
        averageVolumes = volumes.map(function () { return null; });
        ratios = volumes.map(function () { return null; });

        if (volumes.length < normalizedPeriod + 1) {
            return {
                valid: true, error: null, period: normalizedPeriod, ready: false,
                seedIndex: null, openTimes: openTimes.slice(), volumes: volumes.slice(),
                averageVolumes: averageVolumes, ratios: ratios, latest: null,
                rejected: [], duplicateOpenTimeCount: normalized.duplicateOpenTimeCount
            };
        }

        for (index = 0; index < normalizedPeriod; index += 1) {
            rollingSum += volumes[index];
            if (!Number.isFinite(rollingSum)) {
                return invalidResult(
                    "NON_FINITE_RESULT", normalizedPeriod, [],
                    normalized.duplicateOpenTimeCount
                );
            }
        }

        for (index = normalizedPeriod; index < volumes.length; index += 1) {
            average = rollingSum / normalizedPeriod;
            if (!Number.isFinite(average)) {
                return invalidResult(
                    "NON_FINITE_RESULT", normalizedPeriod, [],
                    normalized.duplicateOpenTimeCount
                );
            }
            ratio = average === 0 ? null : volumes[index] / average;
            if (ratio !== null && !Number.isFinite(ratio)) {
                return invalidResult(
                    "NON_FINITE_RESULT", normalizedPeriod, [],
                    normalized.duplicateOpenTimeCount
                );
            }
            averageVolumes[index] = average;
            ratios[index] = ratio;
            latest = {
                openTime: openTimes[index],
                volume: volumes[index],
                averageVolume: average,
                ratio: ratio
            };
            if (index + 1 < volumes.length) {
                rollingSum = (
                    rollingSum -
                    volumes[index - normalizedPeriod] +
                    volumes[index]
                );
                if (!Number.isFinite(rollingSum)) {
                    return invalidResult(
                        "NON_FINITE_RESULT", normalizedPeriod, [],
                        normalized.duplicateOpenTimeCount
                    );
                }
            }
        }

        return {
            valid: true,
            error: null,
            period: normalizedPeriod,
            ready: true,
            seedIndex: normalizedPeriod,
            openTimes: openTimes.slice(),
            volumes: volumes.slice(),
            averageVolumes: averageVolumes.slice(),
            ratios: ratios.slice(),
            latest: Object.assign({}, latest),
            rejected: [],
            duplicateOpenTimeCount: normalized.duplicateOpenTimeCount
        };
    }

    return {
        normalizePeriod: normalizePeriod,
        calculateVolumeMetrics: calculateVolumeMetrics
    };
}));
