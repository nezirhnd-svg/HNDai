(function (root, factory) {
    "use strict";
    var detector;
    var api;
    if (typeof module === "object" && module.exports) {
        detector = require("./swingDetector.js");
        api = factory(detector);
        module.exports = api;
        return;
    }
    detector = root && root.HNDSwingDetector;
    api = factory(detector);
    root.HNDSwingSequence = api;
}(typeof window !== "undefined" ? window : null, function (detector) {
    "use strict";
    if (!detector || typeof detector.detectSwings !== "function") {
        throw new Error("HND_SWING_DETECTOR_DEPENDENCY_MISSING");
    }
    function getVocabulary() {
        return {
            highClasses: ["INITIAL_HIGH", "HIGHER_HIGH", "LOWER_HIGH", "EQUAL_HIGH"],
            lowClasses: ["INITIAL_LOW", "HIGHER_LOW", "LOWER_LOW", "EQUAL_LOW"]
        };
    }
    function safeCount(value) {
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    }
    function safeConfig(value) {
        var leftKey = ["left", "Bars"].join("");
        var rightKey = ["right", "Bars"].join("");
        function valid(number) {
            return typeof number === "number" && Number.isSafeInteger(number) && number >= 1;
        }
        var output = {};
        output[leftKey] = value && valid(value[leftKey]) ? value[leftKey] : null;
        output[rightKey] = value && valid(value[rightKey]) ? value[rightKey] : null;
        return output;
    }
    function failure(error, swingError, source) {
        return {
            valid: false, error: error,
            swingError: swingError === undefined ? null : swingError,
            ready: false, config: safeConfig(source && source.config),
            sourceCandleCount: safeCount(source && source.sourceCandleCount),
            closedCandleCount: safeCount(source && source.closedCandleCount),
            excludedOpenCandleCount: safeCount(source && source.excludedOpenCandleCount),
            evaluatedCandidateCount: safeCount(source && source.evaluatedCandidateCount),
            openTimes: [], swingHighs: [], swingLows: [], events: [],
            latestHigh: null, latestLow: null,
            duplicateOpenTimeCount: safeCount(source && source.duplicateOpenTimeCount)
        };
    }
    function copy(item) { return Object.assign({}, item); }
    function classifySwings(rawCandles, options) {
        var source = detector.detectSwings(rawCandles, options);
        if (!source || source.valid !== true) {
            return failure("SWING_DETECTOR_FAILED", source && source.error, source);
        }
        if (!Array.isArray(source.openTimes) || !Array.isArray(source.events) ||
            !Array.isArray(source.swingHighs) || !Array.isArray(source.swingLows)) {
            return failure("SWING_ALIGNMENT_ERROR", null, source);
        }
        for (var timeIndex = 0; timeIndex < source.openTimes.length; timeIndex += 1) {
            if (typeof source.openTimes[timeIndex] !== "number" ||
                !Number.isFinite(source.openTimes[timeIndex]) ||
                !Number.isSafeInteger(source.openTimes[timeIndex]) ||
                source.openTimes[timeIndex] < 0 ||
                (timeIndex > 0 &&
                    source.openTimes[timeIndex] <= source.openTimes[timeIndex - 1])) {
                return failure("SWING_ALIGNMENT_ERROR", null, source);
            }
        }
        var priorConfirmed = -1;
        var priorCandidate = -1;
        var priorType = null;
        for (var checkIndex = 0; checkIndex < source.events.length; checkIndex += 1) {
            var checked = source.events[checkIndex];
            var validType = checked && (checked.type === "SWING_HIGH" || checked.type === "SWING_LOW");
            if (!validType || !Number.isSafeInteger(checked.candidateIndex) ||
                checked.candidateIndex < 0 ||
                checked.candidateIndex >= source.openTimes.length ||
                !Number.isSafeInteger(checked.confirmedAtIndex) ||
                checked.confirmedAtIndex >= source.openTimes.length ||
                checked.confirmedAtIndex < checked.candidateIndex ||
                typeof checked.openTime !== "number" ||
                !Number.isFinite(checked.openTime) ||
                !Number.isSafeInteger(checked.openTime) ||
                checked.openTime < 0 ||
                typeof checked.closeTime !== "number" ||
                !Number.isFinite(checked.closeTime) ||
                !Number.isSafeInteger(checked.closeTime) ||
                checked.closeTime < checked.openTime ||
                typeof checked.confirmedAtOpenTime !== "number" ||
                !Number.isFinite(checked.confirmedAtOpenTime) ||
                !Number.isSafeInteger(checked.confirmedAtOpenTime) ||
                checked.confirmedAtOpenTime < 0 ||
                typeof checked.confirmedAtCloseTime !== "number" ||
                !Number.isFinite(checked.confirmedAtCloseTime) ||
                !Number.isSafeInteger(checked.confirmedAtCloseTime) ||
                checked.confirmedAtCloseTime < checked.confirmedAtOpenTime ||
                checked.openTime !== source.openTimes[checked.candidateIndex] ||
                checked.confirmedAtOpenTime !== source.openTimes[checked.confirmedAtIndex] ||
                typeof checked.price !== "number" || !Number.isFinite(checked.price) ||
                checked.confirmedAtIndex < priorConfirmed ||
                (checked.confirmedAtIndex === priorConfirmed && checked.candidateIndex < priorCandidate) ||
                (checked.confirmedAtIndex === priorConfirmed &&
                    checked.candidateIndex === priorCandidate &&
                    priorType === "SWING_LOW" && checked.type === "SWING_HIGH")) {
                return failure("SWING_ALIGNMENT_ERROR", null, source);
            }
            priorConfirmed = checked.confirmedAtIndex;
            priorCandidate = checked.candidateIndex;
            priorType = checked.type;
        }
        var previousHigh = null;
        var previousLow = null;
        var events = source.events.map(function (event) {
            var previous = event.type === "SWING_HIGH" ? previousHigh : previousLow;
            var classification;
            if (!previous) {
                classification = event.type === "SWING_HIGH" ? "INITIAL_HIGH" : "INITIAL_LOW";
            } else if (event.price > previous.price) {
                classification = event.type === "SWING_HIGH" ? "HIGHER_HIGH" : "HIGHER_LOW";
            } else if (event.price < previous.price) {
                classification = event.type === "SWING_HIGH" ? "LOWER_HIGH" : "LOWER_LOW";
            } else {
                classification = event.type === "SWING_HIGH" ? "EQUAL_HIGH" : "EQUAL_LOW";
            }
            var output = {
                type: event.type, classification: classification,
                candidateIndex: event.candidateIndex, openTime: event.openTime,
                closeTime: event.closeTime, price: event.price,
                confirmedAtIndex: event.confirmedAtIndex,
                confirmedAtOpenTime: event.confirmedAtOpenTime,
                confirmedAtCloseTime: event.confirmedAtCloseTime,
                previousSameTypeCandidateIndex: previous ? previous.candidateIndex : null,
                previousSameTypePrice: previous ? previous.price : null
            };
            if (event.type === "SWING_HIGH") { previousHigh = event; } else { previousLow = event; }
            return output;
        });
        var highs = events.filter(function (x) { return x.type === "SWING_HIGH"; }).map(copy);
        var lows = events.filter(function (x) { return x.type === "SWING_LOW"; }).map(copy);
        return {
            valid: true, error: null, swingError: null, ready: source.ready === true,
            config: safeConfig(source.config),
            sourceCandleCount: safeCount(source.sourceCandleCount),
            closedCandleCount: safeCount(source.closedCandleCount),
            excludedOpenCandleCount: safeCount(source.excludedOpenCandleCount),
            evaluatedCandidateCount: safeCount(source.evaluatedCandidateCount),
            openTimes: source.openTimes.slice(), swingHighs: highs, swingLows: lows,
            events: events.map(copy),
            latestHigh: highs.length ? copy(highs[highs.length - 1]) : null,
            latestLow: lows.length ? copy(lows[lows.length - 1]) : null,
            duplicateOpenTimeCount: safeCount(source.duplicateOpenTimeCount)
        };
    }
    return { getVocabulary: getVocabulary, classifySwings: classifySwings };
}));
