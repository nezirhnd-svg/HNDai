(function (root, factory) {
    "use strict";
    var core;
    var api;
    if (typeof module === "object" && module.exports) {
        core = require("./coreIndicatorSnapshot.js");
        api = factory(core);
        module.exports = api;
        return;
    }
    core = root && root.HNDCoreIndicatorSnapshot;
    api = factory(core);
    root.HNDMomentumState = api;
}(typeof window !== "undefined" ? window : null, function (core) {
    "use strict";
    if (!core || typeof core.buildSnapshot !== "function") {
        throw new Error("HND_CORE_SNAPSHOT_DEPENDENCY_MISSING");
    }
    function getVocabulary() {
        return {
            directions: ["BULLISH", "BEARISH", "NEUTRAL"],
            rsiStates: ["OVERBOUGHT", "BULLISH", "NEUTRAL", "BEARISH", "OVERSOLD"],
            volumeStates: ["EXPANDED", "NORMAL", "QUIET", "UNKNOWN"]
        };
    }
    function count(value) {
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    }
    function failed(error, coreError, source) {
        return {
            valid: false, error: error,
            coreError: coreError === undefined ? null : coreError, ready: false,
            sourceCandleCount: count(source && source.sourceCandleCount),
            closedCandleCount: count(source && source.closedCandleCount),
            excludedOpenCandleCount: count(source && source.excludedOpenCandleCount),
            openTimes: [], states: [], latest: null,
            duplicateOpenTimeCount: count(source && source.duplicateOpenTimeCount)
        };
    }
    function analyzeMomentum(rawCandles, options) {
        var result = core.buildSnapshot(rawCandles, options);
        var previous = null;
        var states = [];
        if (!result || result.valid !== true) {
            return failed("CORE_SNAPSHOT_FAILED", result && result.error, result);
        }
        if (!Array.isArray(result.openTimes) || !Array.isArray(result.snapshots) ||
            result.openTimes.length !== result.snapshots.length) {
            return failed("CORE_ALIGNMENT_ERROR", null, result);
        }
        for (var index = 0; index < result.snapshots.length; index += 1) {
            var snapshot = result.snapshots[index];
            if (!snapshot || typeof snapshot !== "object" ||
                snapshot.openTime !== result.openTimes[index] ||
                (previous !== null && snapshot.openTime <= previous)) {
                return failed("CORE_ALIGNMENT_ERROR", null, result);
            }
            previous = snapshot.openTime;
            var state = {
                openTime: snapshot.openTime, closeTime: snapshot.closeTime, close: snapshot.close,
                rsi14: snapshot.rsi14, averageVolume20: snapshot.averageVolume20,
                volumeRatio20: snapshot.volumeRatio20, rsiState: null, volumeState: null,
                direction: null, isReady: false
            };
            if (snapshot.isReady === true) {
                var finite = [snapshot.openTime, snapshot.closeTime, snapshot.close,
                    snapshot.rsi14, snapshot.averageVolume20].every(function (value) {
                    return typeof value === "number" && Number.isFinite(value);
                });
                var ratioValid = snapshot.volumeRatio20 === null ||
                    (typeof snapshot.volumeRatio20 === "number" &&
                    Number.isFinite(snapshot.volumeRatio20) && snapshot.volumeRatio20 >= 0);
                if (!finite || !Number.isSafeInteger(snapshot.openTime) ||
                    !Number.isSafeInteger(snapshot.closeTime) || snapshot.openTime < 0 ||
                    snapshot.closeTime < snapshot.openTime || snapshot.rsi14 < 0 ||
                    snapshot.rsi14 > 100 || snapshot.averageVolume20 < 0 || !ratioValid) {
                    return failed("INVALID_READY_SNAPSHOT", null, result);
                }
                state.rsiState = snapshot.rsi14 >= 70 ? "OVERBOUGHT"
                    : snapshot.rsi14 > 50 ? "BULLISH"
                    : snapshot.rsi14 === 50 ? "NEUTRAL"
                    : snapshot.rsi14 > 30 ? "BEARISH" : "OVERSOLD";
                state.direction = snapshot.rsi14 > 50 ? "BULLISH"
                    : snapshot.rsi14 < 50 ? "BEARISH" : "NEUTRAL";
                state.volumeState = snapshot.volumeRatio20 === null ? "UNKNOWN"
                    : snapshot.volumeRatio20 >= 1.5 ? "EXPANDED"
                    : snapshot.volumeRatio20 >= 0.75 ? "NORMAL" : "QUIET";
                state.isReady = true;
            }
            states.push(state);
        }
        var latest = states.length ? Object.assign({}, states[states.length - 1]) : null;
        return {
            valid: true, error: null, coreError: null,
            ready: latest !== null && latest.isReady === true,
            sourceCandleCount: count(result.sourceCandleCount),
            closedCandleCount: count(result.closedCandleCount),
            excludedOpenCandleCount: count(result.excludedOpenCandleCount),
            openTimes: result.openTimes.slice(),
            states: states.map(function (item) { return Object.assign({}, item); }),
            latest: latest, duplicateOpenTimeCount: count(result.duplicateOpenTimeCount)
        };
    }
    return { getVocabulary: getVocabulary, analyzeMomentum: analyzeMomentum };
}));
