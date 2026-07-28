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
    root.HNDCandleBuffer = api;
}(typeof window !== "undefined" ? window : null, function (normalizer) {
    "use strict";

    if (
        !normalizer ||
        typeof normalizer.normalizeCandles !== "function"
    ) {
        throw new Error("HND_CANDLE_NORMALIZER_MISSING");
    }

    function cloneCandle(candle) {
        return {
            openTime: candle.openTime,
            closeTime: candle.closeTime,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            isClosed: candle.isClosed
        };
    }

    function createCandleBuffer(options) {
        var maxCandles = (
            options &&
            typeof options === "object" &&
            Number.isInteger(options.maxCandles) &&
            options.maxCandles >= 1
        ) ? options.maxCandles : 500;
        var candlesByOpenTime = new Map();
        var totalInserted = 0;
        var totalReplaced = 0;
        var totalRejected = 0;
        var totalEvicted = 0;

        function sortedCandles() {
            return Array.from(candlesByOpenTime.values()).sort(function (left, right) {
                return left.openTime - right.openTime;
            });
        }

        function evictOverflow() {
            var ordered = sortedCandles();
            var removalCount = Math.max(0, ordered.length - maxCandles);
            var evicted = ordered.slice(0, removalCount).map(function (candle) {
                candlesByOpenTime.delete(candle.openTime);
                return candle.openTime;
            });

            totalEvicted += evicted.length;
            return evicted;
        }

        function storeCanonical(candle) {
            var replaced = candlesByOpenTime.has(candle.openTime);

            candlesByOpenTime.set(candle.openTime, cloneCandle(candle));
            if (replaced) {
                totalReplaced += 1;
            } else {
                totalInserted += 1;
            }

            return replaced;
        }

        function getCandles() {
            return sortedCandles().map(cloneCandle);
        }

        function upsert(rawCandle, normalizeOptions) {
            var normalized = normalizer.normalizeCandles(
                [rawCandle],
                normalizeOptions
            );
            var candle;
            var replaced;
            var evicted;

            if (normalized.candles.length === 0) {
                totalRejected += normalized.rejected.length;
                return {
                    accepted: false,
                    action: "REJECTED",
                    candle: null,
                    reason: normalized.rejected.length > 0
                        ? normalized.rejected[0].reason
                        : "INVALID_INPUT",
                    evictedOpenTimes: []
                };
            }

            candle = normalized.candles[0];
            replaced = storeCanonical(candle);
            evicted = evictOverflow();

            return {
                accepted: true,
                action: replaced ? "REPLACED" : "INSERTED",
                candle: cloneCandle(candle),
                reason: null,
                evictedOpenTimes: evicted.slice()
            };
        }

        function upsertMany(rawCandles, normalizeOptions) {
            var normalized = normalizer.normalizeCandles(
                rawCandles,
                normalizeOptions
            );
            var insertedCount = 0;
            var replacedCount = 0;
            var evictedOpenTimes = [];

            totalRejected += normalized.rejected.length;

            normalized.candles.forEach(function (candle) {
                if (storeCanonical(candle)) {
                    replacedCount += 1;
                } else {
                    insertedCount += 1;
                }
                evictedOpenTimes = evictedOpenTimes.concat(evictOverflow());
            });

            evictedOpenTimes.sort(function (left, right) {
                return left - right;
            });

            return {
                insertedCount: insertedCount,
                replacedCount: replacedCount,
                rejected: normalized.rejected.map(function (entry) {
                    return {
                        inputIndex: entry.inputIndex,
                        reason: entry.reason
                    };
                }),
                duplicateOpenTimeCount: normalized.duplicateOpenTimeCount,
                evictedOpenTimes: evictedOpenTimes.slice(),
                candles: getCandles()
            };
        }

        function getClosedCandles() {
            return sortedCandles().filter(function (candle) {
                return candle.isClosed === true;
            }).map(cloneCandle);
        }

        function getLatest() {
            var ordered = sortedCandles();
            return ordered.length === 0
                ? null
                : cloneCandle(ordered[ordered.length - 1]);
        }

        function getLatestClosed() {
            var closed = getClosedCandles();
            return closed.length === 0 ? null : cloneCandle(closed[closed.length - 1]);
        }

        function getStats() {
            var ordered = sortedCandles();
            var closedCount = ordered.filter(function (candle) {
                return candle.isClosed === true;
            }).length;

            return {
                size: ordered.length,
                maxCandles: maxCandles,
                firstOpenTime: ordered.length === 0 ? null : ordered[0].openTime,
                lastOpenTime: ordered.length === 0
                    ? null
                    : ordered[ordered.length - 1].openTime,
                closedCount: closedCount,
                openCount: ordered.length - closedCount,
                totalInserted: totalInserted,
                totalReplaced: totalReplaced,
                totalRejected: totalRejected,
                totalEvicted: totalEvicted
            };
        }

        function clear() {
            candlesByOpenTime.clear();
            totalInserted = 0;
            totalReplaced = 0;
            totalRejected = 0;
            totalEvicted = 0;
            return true;
        }

        return {
            upsert: upsert,
            upsertMany: upsertMany,
            getCandles: getCandles,
            getClosedCandles: getClosedCandles,
            getLatest: getLatest,
            getLatestClosed: getLatestClosed,
            getStats: getStats,
            clear: clear
        };
    }

    return {
        createCandleBuffer: createCandleBuffer
    };
}));
