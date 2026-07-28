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
    root.HNDRsiIndicator = api;
}(typeof window !== "undefined" ? window : null, function (normalizer) {
    "use strict";

    if (!normalizer || typeof normalizer.finiteCandleNumber !== "function") {
        throw new Error("HND_CANDLE_NORMALIZER_MISSING");
    }

    function normalizePeriod(value) {
        return (
            typeof value === "number" &&
            Number.isSafeInteger(value) &&
            value >= 1
        ) ? value : null;
    }

    function invalidResult(error, period) {
        return {
            valid: false,
            error: error,
            period: period,
            ready: false,
            seedIndex: null,
            values: [],
            latest: null
        };
    }

    function rsiFromAverages(averageGain, averageLoss) {
        var ratio;
        var rsi;

        if (averageGain === 0 && averageLoss === 0) {
            return 50;
        }
        if (averageLoss === 0 && averageGain > 0) {
            return 100;
        }
        if (averageGain === 0 && averageLoss > 0) {
            return 0;
        }

        ratio = averageGain / averageLoss;
        if (!Number.isFinite(ratio)) {
            return null;
        }
        rsi = 100 - (100 / (1 + ratio));
        if (!Number.isFinite(rsi)) {
            return null;
        }
        return Math.min(100, Math.max(0, rsi));
    }

    function calculateRSI(rawValues, period) {
        var normalizedPeriod = normalizePeriod(period);
        var normalizedValues = [];
        var values;
        var gainSum = 0;
        var lossSum = 0;
        var averageGain;
        var averageLoss;
        var currentRsi;
        var delta;
        var gain;
        var loss;
        var index;

        if (normalizedPeriod === null) {
            return invalidResult("INVALID_PERIOD", null);
        }
        if (!Array.isArray(rawValues)) {
            return invalidResult("INVALID_VALUE_SERIES", normalizedPeriod);
        }

        for (index = 0; index < rawValues.length; index += 1) {
            normalizedValues[index] = normalizer.finiteCandleNumber(rawValues[index]);
            if (normalizedValues[index] === null) {
                return invalidResult("INVALID_VALUE_SERIES", normalizedPeriod);
            }
        }

        values = normalizedValues.map(function () {
            return null;
        });
        if (normalizedValues.length < normalizedPeriod + 1) {
            return {
                valid: true,
                error: null,
                period: normalizedPeriod,
                ready: false,
                seedIndex: null,
                values: values,
                latest: null
            };
        }

        for (index = 1; index <= normalizedPeriod; index += 1) {
            delta = normalizedValues[index] - normalizedValues[index - 1];
            if (!Number.isFinite(delta)) {
                return invalidResult("NON_FINITE_RESULT", normalizedPeriod);
            }
            gain = delta > 0 ? delta : 0;
            loss = delta < 0 ? Math.abs(delta) : 0;
            gainSum += gain;
            lossSum += loss;
            if (!Number.isFinite(gainSum) || !Number.isFinite(lossSum)) {
                return invalidResult("NON_FINITE_RESULT", normalizedPeriod);
            }
        }

        averageGain = gainSum / normalizedPeriod;
        averageLoss = lossSum / normalizedPeriod;
        if (!Number.isFinite(averageGain) || !Number.isFinite(averageLoss)) {
            return invalidResult("NON_FINITE_RESULT", normalizedPeriod);
        }

        currentRsi = rsiFromAverages(averageGain, averageLoss);
        if (currentRsi === null) {
            return invalidResult("NON_FINITE_RESULT", normalizedPeriod);
        }
        values[normalizedPeriod] = currentRsi;

        for (index = normalizedPeriod + 1; index < normalizedValues.length; index += 1) {
            delta = normalizedValues[index] - normalizedValues[index - 1];
            if (!Number.isFinite(delta)) {
                return invalidResult("NON_FINITE_RESULT", normalizedPeriod);
            }
            gain = delta > 0 ? delta : 0;
            loss = delta < 0 ? Math.abs(delta) : 0;
            averageGain = (
                (averageGain * (normalizedPeriod - 1)) + gain
            ) / normalizedPeriod;
            averageLoss = (
                (averageLoss * (normalizedPeriod - 1)) + loss
            ) / normalizedPeriod;
            if (!Number.isFinite(averageGain) || !Number.isFinite(averageLoss)) {
                return invalidResult("NON_FINITE_RESULT", normalizedPeriod);
            }
            currentRsi = rsiFromAverages(averageGain, averageLoss);
            if (currentRsi === null) {
                return invalidResult("NON_FINITE_RESULT", normalizedPeriod);
            }
            values[index] = currentRsi;
        }

        return {
            valid: true,
            error: null,
            period: normalizedPeriod,
            ready: true,
            seedIndex: normalizedPeriod,
            values: values,
            latest: currentRsi
        };
    }

    return {
        normalizePeriod: normalizePeriod,
        calculateRSI: calculateRSI
    };
}));
