(function (root, factory) {
    "use strict";
    var normalizer;
    var sequence;
    var api;
    if (typeof module === "object" && module.exports) {
        normalizer = require("./candleNormalizer.js");
        sequence = require("./swingSequence.js");
        api = factory(normalizer, sequence);
        module.exports = api;
        return;
    }
    normalizer = root && root.HNDCandleNormalizer;
    sequence = root && root.HNDSwingSequence;
    api = factory(normalizer, sequence);
    root.HNDStructureBreakDetector = api;
}(typeof window !== "undefined" ? window : null, function (normalizer, sequence) {
    "use strict";
    if (!normalizer || typeof normalizer.normalizeCandles !== "function" ||
        typeof normalizer.validateCandleSequence !== "function" ||
        !sequence || typeof sequence.classifySwings !== "function") {
        throw new Error("HND_STRUCTURE_BREAK_DEPENDENCY_MISSING");
    }
    function getVocabulary() {
        return {
            breakTypes: ["BREAK_ABOVE_SWING_HIGH", "BREAK_BELOW_SWING_LOW"],
            directions: ["BULLISH", "BEARISH"],
            levelTypes: ["SWING_HIGH", "SWING_LOW"]
        };
    }
    function count(value) {
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    }
    function config(value) {
        return value && typeof value === "object" ? Object.assign({}, value) : {};
    }
    function failure(error, sequenceError, source) {
        return {
            valid: false, error: error,
            sequenceError: sequenceError === undefined ? null : sequenceError,
            ready: false, config: config(source && source.config),
            sourceCandleCount: count(source && source.sourceCandleCount),
            closedCandleCount: count(source && source.closedCandleCount),
            excludedOpenCandleCount: count(source && source.excludedOpenCandleCount),
            openTimes: [], breaks: [], bullishBreaks: [], bearishBreaks: [],
            latestBullishBreak: null, latestBearishBreak: null,
            duplicateOpenTimeCount: count(source && source.duplicateOpenTimeCount)
        };
    }
    function clone(item) { return Object.assign({}, item); }
    function detectBreaks(rawCandles, options) {
        var sequenceResult = sequence.classifySwings(rawCandles, options);
        if (!sequenceResult || sequenceResult.valid !== true) {
            return failure("SWING_SEQUENCE_FAILED",
                sequenceResult && sequenceResult.error, sequenceResult);
        }
        var nowMs = options && options.nowMs;
        var normalized = normalizer.normalizeCandles(rawCandles, { nowMs: nowMs });
        if (normalized.rejected.length) {
            return failure("CANDLE_LAYER_FAILED", null, sequenceResult);
        }
        if (!normalizer.validateCandleSequence(normalized.candles).valid) {
            return failure("CANDLE_SEQUENCE_FAILED", null, sequenceResult);
        }
        var closed = normalized.candles.filter(function (item) {
            return item.isClosed === true;
        });
        var openTimes = closed.map(function (item) { return item.openTime; });
        if (!Array.isArray(sequenceResult.openTimes) ||
            !Array.isArray(sequenceResult.events) ||
            sequenceResult.openTimes.length !== openTimes.length ||
            !openTimes.every(function (value, index) {
                return typeof value === "number" && Number.isSafeInteger(value) &&
                    value >= 0 && value === sequenceResult.openTimes[index] &&
                    (index === 0 || value > openTimes[index - 1]);
            })) {
            return failure("INTERNAL_ALIGNMENT_ERROR", null, sequenceResult);
        }
        var highClasses = ["INITIAL_HIGH", "HIGHER_HIGH", "LOWER_HIGH", "EQUAL_HIGH"];
        var lowClasses = ["INITIAL_LOW", "HIGHER_LOW", "LOWER_LOW", "EQUAL_LOW"];
        var byConfirmation = new Map();
        var previousHigh = null;
        var previousLow = null;
        var priorConfirmedAtIndex = -1;
        var priorCandidateIndex = -1;
        var priorType = null;
        for (var eventIndex = 0; eventIndex < sequenceResult.events.length; eventIndex += 1) {
            var item = sequenceResult.events[eventIndex];
            var typeValid = item && (item.type === "SWING_HIGH" || item.type === "SWING_LOW");
            var classificationValid = typeValid && (
                item.type === "SWING_HIGH"
                    ? highClasses.indexOf(item.classification) !== -1
                    : lowClasses.indexOf(item.classification) !== -1
            );
            var previous = item && item.type === "SWING_HIGH" ? previousHigh : previousLow;
            var expectedClassification = null;
            if (typeValid) {
                if (!previous) {
                    expectedClassification = item.type === "SWING_HIGH"
                        ? "INITIAL_HIGH" : "INITIAL_LOW";
                } else if (item.price > previous.price) {
                    expectedClassification = item.type === "SWING_HIGH"
                        ? "HIGHER_HIGH" : "HIGHER_LOW";
                } else if (item.price < previous.price) {
                    expectedClassification = item.type === "SWING_HIGH"
                        ? "LOWER_HIGH" : "LOWER_LOW";
                } else {
                    expectedClassification = item.type === "SWING_HIGH"
                        ? "EQUAL_HIGH" : "EQUAL_LOW";
                }
            }
            if (!classificationValid || !Number.isSafeInteger(item.candidateIndex) ||
                !Number.isSafeInteger(item.confirmedAtIndex) || item.candidateIndex < 0 ||
                item.confirmedAtIndex <= item.candidateIndex ||
                item.confirmedAtIndex >= closed.length ||
                item.candidateIndex >= closed.length ||
                item.openTime !== openTimes[item.candidateIndex] ||
                item.closeTime !== closed[item.candidateIndex].closeTime ||
                item.confirmedAtOpenTime !== openTimes[item.confirmedAtIndex] ||
                item.confirmedAtCloseTime !== closed[item.confirmedAtIndex].closeTime ||
                typeof item.price !== "number" || !Number.isFinite(item.price) ||
                item.price !== (item.type === "SWING_HIGH"
                    ? closed[item.candidateIndex].high
                    : closed[item.candidateIndex].low) ||
                item.classification !== expectedClassification ||
                item.previousSameTypeCandidateIndex !==
                    (previous ? previous.candidateIndex : null) ||
                item.previousSameTypePrice !== (previous ? previous.price : null) ||
                item.confirmedAtIndex < priorConfirmedAtIndex ||
                (item.confirmedAtIndex === priorConfirmedAtIndex &&
                    item.candidateIndex < priorCandidateIndex) ||
                (item.confirmedAtIndex === priorConfirmedAtIndex &&
                    item.candidateIndex === priorCandidateIndex &&
                    priorType === "SWING_LOW" && item.type === "SWING_HIGH")) {
                return failure("INTERNAL_ALIGNMENT_ERROR", null, sequenceResult);
            }
            if (!byConfirmation.has(item.confirmedAtIndex)) {
                byConfirmation.set(item.confirmedAtIndex, []);
            }
            byConfirmation.get(item.confirmedAtIndex).push(item);
            if (item.type === "SWING_HIGH") { previousHigh = item; }
            else { previousLow = item; }
            priorConfirmedAtIndex = item.confirmedAtIndex;
            priorCandidateIndex = item.candidateIndex;
            priorType = item.type;
        }
        var activeHigh = null;
        var activeLow = null;
        var breaks = [];
        function breakEvent(type, candle, index, level) {
            return {
                type: type,
                direction: type === "BREAK_ABOVE_SWING_HIGH" ? "BULLISH" : "BEARISH",
                breakAtIndex: index, breakOpenTime: candle.openTime,
                breakCloseTime: candle.closeTime, breakClosePrice: candle.close,
                levelType: level.type, levelClassification: level.classification,
                levelCandidateIndex: level.candidateIndex, levelOpenTime: level.openTime,
                levelCloseTime: level.closeTime, levelPrice: level.price,
                levelConfirmedAtIndex: level.confirmedAtIndex,
                levelConfirmedAtOpenTime: level.confirmedAtOpenTime,
                levelConfirmedAtCloseTime: level.confirmedAtCloseTime
            };
        }
        for (var index = 0; index < closed.length; index += 1) {
            if (activeHigh && activeHigh.confirmedAtIndex < index &&
                closed[index].close > activeHigh.price) {
                breaks.push(breakEvent("BREAK_ABOVE_SWING_HIGH", closed[index], index, activeHigh));
                activeHigh = null;
            }
            if (activeLow && activeLow.confirmedAtIndex < index &&
                closed[index].close < activeLow.price) {
                breaks.push(breakEvent("BREAK_BELOW_SWING_LOW", closed[index], index, activeLow));
                activeLow = null;
            }
            var confirmed = byConfirmation.get(index) || [];
            confirmed.forEach(function (level) {
                if (level.type === "SWING_HIGH") { activeHigh = level; }
                else { activeLow = level; }
            });
        }
        var bullish = breaks.filter(function (item) {
            return item.direction === "BULLISH";
        }).map(clone);
        var bearish = breaks.filter(function (item) {
            return item.direction === "BEARISH";
        }).map(clone);
        return {
            valid: true, error: null, sequenceError: null,
            ready: sequenceResult.ready === true, config: config(sequenceResult.config),
            sourceCandleCount: normalized.candles.length,
            closedCandleCount: closed.length,
            excludedOpenCandleCount: normalized.candles.length - closed.length,
            openTimes: openTimes.slice(), breaks: breaks.map(clone),
            bullishBreaks: bullish, bearishBreaks: bearish,
            latestBullishBreak: bullish.length ? clone(bullish[bullish.length - 1]) : null,
            latestBearishBreak: bearish.length ? clone(bearish[bearish.length - 1]) : null,
            duplicateOpenTimeCount: normalized.duplicateOpenTimeCount
        };
    }
    return { getVocabulary: getVocabulary, detectBreaks: detectBreaks };
}));
