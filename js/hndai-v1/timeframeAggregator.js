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
    root.HNDTimeframeAggregator = api;
}(typeof window !== "undefined" ? window : null, function (normalizer) {
    "use strict";

    var INTERVALS = {
        "1m": 60000,
        "3m": 180000,
        "5m": 300000,
        "15m": 900000,
        "30m": 1800000,
        "1h": 3600000,
        "2h": 7200000,
        "4h": 14400000,
        "6h": 21600000,
        "8h": 28800000,
        "12h": 43200000,
        "1d": 86400000
    };

    if (
        !normalizer ||
        typeof normalizer.normalizeCandles !== "function" ||
        typeof normalizer.validateCandleSequence !== "function"
    ) {
        throw new Error("HND_CANDLE_NORMALIZER_MISSING");
    }

    function normalizeIntervalMs(value) {
        var trimmed;
        var label;

        if (typeof value === "number") {
            return Number.isSafeInteger(value) && value > 0 ? value : null;
        }
        if (typeof value !== "string") {
            return null;
        }

        trimmed = value.trim();
        if (trimmed === "" || trimmed === "1M") {
            return null;
        }
        label = trimmed.toLowerCase();
        return Object.prototype.hasOwnProperty.call(INTERVALS, label)
            ? INTERVALS[label]
            : null;
    }

    function getBucketBounds(openTime, targetInterval) {
        var intervalMs = normalizeIntervalMs(targetInterval);
        var bucketOpenTime;
        var bucketCloseTime;

        if (
            !Number.isSafeInteger(openTime) ||
            openTime < 0 ||
            intervalMs === null
        ) {
            return null;
        }

        bucketOpenTime = Math.floor(openTime / intervalMs) * intervalMs;
        bucketCloseTime = bucketOpenTime + intervalMs - 1;
        if (
            !Number.isSafeInteger(bucketOpenTime) ||
            !Number.isSafeInteger(bucketCloseTime)
        ) {
            return null;
        }

        return {
            openTime: bucketOpenTime,
            closeTime: bucketCloseTime
        };
    }

    function invalidConfigResult(sourceIntervalMs, targetIntervalMs) {
        return {
            valid: false,
            error: "INVALID_INTERVAL_CONFIG",
            sourceIntervalMs: sourceIntervalMs,
            targetIntervalMs: targetIntervalMs,
            expectedSourceCandlesPerBucket: null,
            candles: [],
            rejected: [],
            duplicateOpenTimeCount: 0,
            misalignedSourceOpenTimes: [],
            incompleteBucketOpenTimes: []
        };
    }

    function aggregateCandles(rawCandles, options) {
        var config = options && typeof options === "object" ? options : {};
        var sourceIntervalMs = normalizeIntervalMs(config.sourceInterval);
        var targetIntervalMs = normalizeIntervalMs(config.targetInterval);
        var expected;
        var normalized;
        var buckets = new Map();
        var misaligned = new Set();
        var incomplete = new Set();
        var candles = [];

        if (
            sourceIntervalMs === null ||
            targetIntervalMs === null ||
            targetIntervalMs < sourceIntervalMs ||
            targetIntervalMs % sourceIntervalMs !== 0
        ) {
            return invalidConfigResult(sourceIntervalMs, targetIntervalMs);
        }

        expected = targetIntervalMs / sourceIntervalMs;
        normalized = normalizer.normalizeCandles(
            rawCandles,
            { nowMs: config.nowMs }
        );

        normalized.candles.forEach(function (candle) {
            var expectedCloseTime = candle.openTime + sourceIntervalMs - 1;
            var bounds;
            var bucket;

            if (
                !Number.isSafeInteger(expectedCloseTime) ||
                candle.openTime % sourceIntervalMs !== 0 ||
                candle.closeTime !== expectedCloseTime
            ) {
                misaligned.add(candle.openTime);
                return;
            }

            bounds = getBucketBounds(candle.openTime, targetIntervalMs);
            if (bounds === null) {
                misaligned.add(candle.openTime);
                return;
            }

            bucket = buckets.get(bounds.openTime);
            if (!bucket) {
                bucket = { bounds: bounds, sources: [] };
                buckets.set(bounds.openTime, bucket);
            }
            bucket.sources.push(candle);
        });

        Array.from(buckets.keys()).sort(function (left, right) {
            return left - right;
        }).forEach(function (bucketOpenTime) {
            var bucket = buckets.get(bucketOpenTime);
            var sources = bucket.sources;
            var complete = sources.length === expected;
            var volume = 0;
            var high = sources[0].high;
            var low = sources[0].low;
            var allSourcesClosed = true;
            var nowIsValid = (
                typeof config.nowMs === "number" &&
                Number.isFinite(config.nowMs) &&
                config.nowMs >= 0
            );

            sources.forEach(function (source, index) {
                var expectedOpenTime = bucketOpenTime + (index * sourceIntervalMs);
                complete = complete && source.openTime === expectedOpenTime;
                high = Math.max(high, source.high);
                low = Math.min(low, source.low);
                volume += source.volume;
                allSourcesClosed = allSourcesClosed && source.isClosed === true;
            });

            complete = complete && (
                sources[0].openTime === bucketOpenTime &&
                sources[sources.length - 1].openTime ===
                    bucketOpenTime + ((expected - 1) * sourceIntervalMs)
            );

            if (!Number.isFinite(volume)) {
                incomplete.add(bucketOpenTime);
                return;
            }
            if (!complete) {
                incomplete.add(bucketOpenTime);
            }

            candles.push({
                openTime: bucketOpenTime,
                closeTime: bucket.bounds.closeTime,
                open: sources[0].open,
                high: high,
                low: low,
                close: sources[sources.length - 1].close,
                volume: volume,
                isClosed: (
                    complete &&
                    nowIsValid &&
                    bucket.bounds.closeTime <= config.nowMs &&
                    allSourcesClosed
                )
            });
        });

        if (!normalizer.validateCandleSequence(candles).valid) {
            throw new Error("HND_TIMEFRAME_AGGREGATION_INTERNAL_INVALID");
        }

        return {
            valid: true,
            error: null,
            sourceIntervalMs: sourceIntervalMs,
            targetIntervalMs: targetIntervalMs,
            expectedSourceCandlesPerBucket: expected,
            candles: candles.map(function (candle) {
                return Object.assign({}, candle);
            }),
            rejected: normalized.rejected.map(function (entry) {
                return { inputIndex: entry.inputIndex, reason: entry.reason };
            }),
            duplicateOpenTimeCount: normalized.duplicateOpenTimeCount,
            misalignedSourceOpenTimes: Array.from(misaligned).sort(function (left, right) {
                return left - right;
            }),
            incompleteBucketOpenTimes: Array.from(incomplete).sort(function (left, right) {
                return left - right;
            })
        };
    }

    return {
        normalizeIntervalMs: normalizeIntervalMs,
        getBucketBounds: getBucketBounds,
        aggregateCandles: aggregateCandles
    };
}));
