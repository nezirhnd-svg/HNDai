(function (root, factory) {
    "use strict";

    var api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root && typeof root === "object") {
        root.HNDCandleNormalizer = api;
    }
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    var CANONICAL_KEYS = [
        "openTime",
        "closeTime",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "isClosed"
    ];

    function finiteCandleNumber(value) {
        var converted;

        if (typeof value === "number") {
            return Number.isFinite(value) ? value : null;
        }

        if (typeof value !== "string" || value.trim() === "") {
            return null;
        }

        converted = Number(value.trim());
        return Number.isFinite(converted) ? converted : null;
    }

    function classifyRawCandle(raw) {
        var values;
        var openTime;
        var closeTime;
        var open;
        var high;
        var low;
        var close;
        var volume;

        if (Array.isArray(raw)) {
            if (raw.length < 7) {
                return { candle: null, reason: "INVALID_INPUT" };
            }
            values = {
                openTime: raw[0],
                open: raw[1],
                high: raw[2],
                low: raw[3],
                close: raw[4],
                volume: raw[5],
                closeTime: raw[6]
            };
        } else if (raw !== null && typeof raw === "object") {
            values = raw;
        } else {
            return { candle: null, reason: "INVALID_INPUT" };
        }

        openTime = finiteCandleNumber(values.openTime);
        closeTime = finiteCandleNumber(values.closeTime);
        if (
            openTime === null ||
            closeTime === null ||
            !Number.isInteger(openTime) ||
            !Number.isInteger(closeTime) ||
            openTime < 0 ||
            closeTime < 0 ||
            closeTime < openTime
        ) {
            return { candle: null, reason: "INVALID_TIME" };
        }

        open = finiteCandleNumber(values.open);
        high = finiteCandleNumber(values.high);
        low = finiteCandleNumber(values.low);
        close = finiteCandleNumber(values.close);
        if (open === null || high === null || low === null || close === null) {
            return { candle: null, reason: "INVALID_PRICE" };
        }

        volume = finiteCandleNumber(values.volume);
        if (volume === null || volume < 0) {
            return { candle: null, reason: "INVALID_VOLUME" };
        }

        if (high < open || high < close || high < low || low > open || low > close) {
            return { candle: null, reason: "INVALID_RANGE" };
        }

        return {
            candle: {
                openTime: openTime,
                closeTime: closeTime,
                open: open,
                high: high,
                low: low,
                close: close,
                volume: volume,
                isClosed: false
            },
            reason: null
        };
    }

    function normalizedNow(options) {
        var nowMs;

        if (options === null || typeof options !== "object" || Array.isArray(options)) {
            return null;
        }

        nowMs = options.nowMs;
        return typeof nowMs === "number" && Number.isFinite(nowMs) && nowMs >= 0
            ? nowMs
            : null;
    }

    function normalizeCandle(raw, options) {
        var result = classifyRawCandle(raw);
        var nowMs;

        if (result.candle === null) {
            return null;
        }

        nowMs = normalizedNow(options);
        result.candle.isClosed = nowMs !== null && result.candle.closeTime <= nowMs;
        return result.candle;
    }

    function normalizeCandles(rawCandles, options) {
        var byOpenTime = new Map();
        var rejected = [];
        var duplicateOpenTimeCount = 0;
        var nowMs = normalizedNow(options);

        if (!Array.isArray(rawCandles)) {
            return {
                candles: [],
                rejected: [],
                duplicateOpenTimeCount: 0
            };
        }

        rawCandles.forEach(function (raw, inputIndex) {
            var result = classifyRawCandle(raw);

            if (result.candle === null) {
                rejected.push({ inputIndex: inputIndex, reason: result.reason });
                return;
            }

            result.candle.isClosed =
                nowMs !== null && result.candle.closeTime <= nowMs;

            if (byOpenTime.has(result.candle.openTime)) {
                duplicateOpenTimeCount += 1;
            }
            byOpenTime.set(result.candle.openTime, result.candle);
        });

        return {
            candles: Array.from(byOpenTime.values()).sort(function (left, right) {
                return left.openTime - right.openTime;
            }),
            rejected: rejected,
            duplicateOpenTimeCount: duplicateOpenTimeCount
        };
    }

    function isCanonicalCandle(candle) {
        var classified;
        var keys;

        if (candle === null || typeof candle !== "object" || Array.isArray(candle)) {
            return false;
        }

        keys = Object.keys(candle);
        if (
            keys.length !== CANONICAL_KEYS.length ||
            !CANONICAL_KEYS.every(function (key) {
                return Object.prototype.hasOwnProperty.call(candle, key);
            }) ||
            typeof candle.isClosed !== "boolean"
        ) {
            return false;
        }

        classified = classifyRawCandle(candle);
        return classified.candle !== null;
    }

    function validateCandleSequence(candles) {
        var errors = [];
        var seenOpenTimes = new Set();
        var previousOpenTime = null;

        function addError(error) {
            if (errors.indexOf(error) === -1) {
                errors.push(error);
            }
        }

        if (!Array.isArray(candles)) {
            return { valid: false, errors: ["INVALID_SEQUENCE_INPUT"] };
        }

        candles.forEach(function (candle) {
            if (!isCanonicalCandle(candle)) {
                addError("INVALID_CANONICAL_CANDLE");
                return;
            }

            if (seenOpenTimes.has(candle.openTime)) {
                addError("DUPLICATE_OPEN_TIME");
            }
            if (previousOpenTime !== null && candle.openTime <= previousOpenTime) {
                addError("NON_ASCENDING_OPEN_TIME");
            }

            seenOpenTimes.add(candle.openTime);
            previousOpenTime = candle.openTime;
        });

        return { valid: errors.length === 0, errors: errors };
    }

    return {
        finiteCandleNumber: finiteCandleNumber,
        normalizeCandle: normalizeCandle,
        normalizeCandles: normalizeCandles,
        validateCandleSequence: validateCandleSequence
    };
}));
