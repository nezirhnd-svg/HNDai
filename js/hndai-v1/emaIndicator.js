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
    root.HNDEmaIndicator = api;
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

    function resultError(error, period, multiplier) {
        return {
            valid: false,
            error: error,
            period: period,
            multiplier: multiplier,
            ready: false,
            seedIndex: null,
            values: [],
            latest: null
        };
    }

    function calculateEMA(rawValues, period) {
        var normalizedPeriod = normalizePeriod(period);
        var multiplier;
        var normalizedValues;
        var values;
        var seedSum = 0;
        var seed;
        var previous;
        var index;

        if (normalizedPeriod === null) {
            return resultError("INVALID_PERIOD", null, null);
        }

        if (!Array.isArray(rawValues)) {
            return resultError("INVALID_VALUE_SERIES", normalizedPeriod, null);
        }

        multiplier = 2 / (normalizedPeriod + 1);
        normalizedValues = [];

        for (index = 0; index < rawValues.length; index += 1) {
            normalizedValues[index] = normalizer.finiteCandleNumber(rawValues[index]);
            if (normalizedValues[index] === null) {
                return resultError(
                    "INVALID_VALUE_SERIES",
                    normalizedPeriod,
                    multiplier
                );
            }
        }

        values = normalizedValues.map(function () {
            return null;
        });

        if (normalizedValues.length < normalizedPeriod) {
            return {
                valid: true,
                error: null,
                period: normalizedPeriod,
                multiplier: multiplier,
                ready: false,
                seedIndex: null,
                values: values,
                latest: null
            };
        }

        for (index = 0; index < normalizedPeriod; index += 1) {
            seedSum += normalizedValues[index];
            if (!Number.isFinite(seedSum)) {
                return resultError(
                    "NON_FINITE_RESULT",
                    normalizedPeriod,
                    multiplier
                );
            }
        }

        seed = seedSum / normalizedPeriod;
        if (!Number.isFinite(seed)) {
            return resultError("NON_FINITE_RESULT", normalizedPeriod, multiplier);
        }

        values[normalizedPeriod - 1] = seed;
        previous = seed;

        for (index = normalizedPeriod; index < normalizedValues.length; index += 1) {
            previous = (
                normalizedValues[index] * multiplier +
                previous * (1 - multiplier)
            );
            if (!Number.isFinite(previous)) {
                return resultError(
                    "NON_FINITE_RESULT",
                    normalizedPeriod,
                    multiplier
                );
            }
            values[index] = previous;
        }

        return {
            valid: true,
            error: null,
            period: normalizedPeriod,
            multiplier: multiplier,
            ready: true,
            seedIndex: normalizedPeriod - 1,
            values: values,
            latest: previous
        };
    }

    return {
        normalizePeriod: normalizePeriod,
        calculateEMA: calculateEMA
    };
}));
