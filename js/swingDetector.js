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
    root.HNDSwingDetector = api;
}(typeof window !== "undefined" ? window : null, function (normalizer) {
    "use strict";
    if (!normalizer || typeof normalizer.normalizeCandles !== "function" ||
        typeof normalizer.validateCandleSequence !== "function") {
        throw new Error("HND_CANDLE_NORMALIZER_MISSING");
    }
    function getDefaults() { return { leftBars: 2, rightBars: 2 }; }
    function validBars(value) {
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
    }
    function errorResult(error, leftBars, rightBars, rejected, duplicates) {
        return {
            valid: false, error: error, ready: false,
            config: { leftBars: validBars(leftBars) ? leftBars : null,
                rightBars: validBars(rightBars) ? rightBars : null },
            sourceCandleCount: 0, closedCandleCount: 0, excludedOpenCandleCount: 0,
            evaluatedCandidateCount: 0, openTimes: [], swingHighs: [], swingLows: [],
            events: [], latestHigh: null, latestLow: null, rejected: rejected || [],
            duplicateOpenTimeCount: duplicates || 0
        };
    }
    function copyEvent(event) { return Object.assign({}, event); }
    function detectSwings(rawCandles, options) {
        var configInput = options && typeof options === "object" ? options : {};
        var nowMs = configInput.nowMs;
        var defaults = getDefaults();
        var leftBars = configInput.leftBars === undefined ? defaults.leftBars : configInput.leftBars;
        var rightBars = configInput.rightBars === undefined ? defaults.rightBars : configInput.rightBars;
        if (typeof nowMs !== "number" || !Number.isFinite(nowMs) || nowMs < 0) {
            return errorResult("INVALID_NOW_MS", leftBars, rightBars, [], 0);
        }
        if (!validBars(leftBars) || !validBars(rightBars)) {
            return errorResult("INVALID_WINDOW", leftBars, rightBars, [], 0);
        }
        if (!Array.isArray(rawCandles)) {
            return errorResult("INVALID_CANDLE_SERIES", leftBars, rightBars, [], 0);
        }
        var normalized = normalizer.normalizeCandles(rawCandles, { nowMs: nowMs });
        if (normalized.rejected.length) {
            return errorResult("INVALID_CANDLE_SERIES", leftBars, rightBars,
                normalized.rejected.map(function (x) {
                    return { inputIndex: x.inputIndex, reason: x.reason };
                }), normalized.duplicateOpenTimeCount);
        }
        if (!normalizer.validateCandleSequence(normalized.candles).valid) {
            return errorResult("INVALID_CANDLE_SEQUENCE", leftBars, rightBars, [],
                normalized.duplicateOpenTimeCount);
        }
        var closed = normalized.candles.filter(function (x) { return x.isClosed === true; });
        var events = [];
        for (var index = leftBars; index < closed.length - rightBars; index += 1) {
            var candidate = closed[index];
            var high = true;
            var low = true;
            for (var neighbor = index - leftBars; neighbor <= index + rightBars; neighbor += 1) {
                if (neighbor === index) { continue; }
                high = high && candidate.high > closed[neighbor].high;
                low = low && candidate.low < closed[neighbor].low;
            }
            var confirmation = closed[index + rightBars];
            function event(type, price) {
                return {
                    type: type, candidateIndex: index, openTime: candidate.openTime,
                    closeTime: candidate.closeTime, price: price,
                    confirmedAtIndex: index + rightBars,
                    confirmedAtOpenTime: confirmation.openTime,
                    confirmedAtCloseTime: confirmation.closeTime
                };
            }
            if (high) { events.push(event("SWING_HIGH", candidate.high)); }
            if (low) { events.push(event("SWING_LOW", candidate.low)); }
        }
        var highs = events.filter(function (x) { return x.type === "SWING_HIGH"; }).map(copyEvent);
        var lows = events.filter(function (x) { return x.type === "SWING_LOW"; }).map(copyEvent);
        return {
            valid: true, error: null,
            ready: closed.length >= leftBars + rightBars + 1,
            config: { leftBars: leftBars, rightBars: rightBars },
            sourceCandleCount: normalized.candles.length, closedCandleCount: closed.length,
            excludedOpenCandleCount: normalized.candles.length - closed.length,
            evaluatedCandidateCount: Math.max(0, closed.length - leftBars - rightBars),
            openTimes: closed.map(function (x) { return x.openTime; }),
            swingHighs: highs, swingLows: lows, events: events.map(copyEvent),
            latestHigh: highs.length ? copyEvent(highs[highs.length - 1]) : null,
            latestLow: lows.length ? copyEvent(lows[lows.length - 1]) : null,
            rejected: [], duplicateOpenTimeCount: normalized.duplicateOpenTimeCount
        };
    }
    return { getDefaults: getDefaults, detectSwings: detectSwings };
}));
