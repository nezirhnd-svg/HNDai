(function (root, factory) {
    "use strict";
    var api = factory(root);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalLegacyInputBuilder = api;
}(typeof window !== "undefined" ? window : null, function (root) {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_LEGACY_INPUT_BUILDER_V1";
    var CONTEXT_FIELDS = ["symbol", "interval", "evaluationIndex", "evaluationCloseTime",
        "pendingCandidate", "higherTimeframeCandles"];
    var STATUSES = ["INPUT_READY", "INVALID_INPUT", "INSUFFICIENT_HISTORY",
        "DEPENDENCY_FAILURE", "SIGNAL_UNAVAILABLE", "ZONE_UNAVAILABLE", "MTF_UNAVAILABLE"];
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function getSchemaVersion() { return SCHEMA; }
    function getVocabulary() { return clone({ schemaVersions: [SCHEMA], statuses: STATUSES }); }
    function exact(value, fields) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort(), expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (key, index) { return key === keys[index]; });
    }
    function validCandle(candle) {
        return exact(candle, ["openTime", "closeTime", "open", "high", "low", "close", "volume"]) &&
            Number.isSafeInteger(candle.openTime) && Number.isSafeInteger(candle.closeTime) &&
            candle.openTime > 0 && candle.closeTime > candle.openTime &&
            [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) &&
            candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 && candle.volume >= 0 &&
            candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close);
    }
    function result(status, error, input, evidence, warnings) {
        return { valid: status === "INPUT_READY", error: error || null, schemaVersion: SCHEMA,
            status: status, input: input || null, sourceEvidence: evidence || null,
            warnings: Array.isArray(warnings) ? warnings.slice() : [] };
    }
    function validate(prefix, context) {
        if (!Array.isArray(prefix) || !exact(context, CONTEXT_FIELDS) ||
            typeof context.symbol !== "string" || !/^[A-Z0-9]+$/.test(context.symbol) ||
            !["15m", "4h"].includes(context.interval) ||
            !Number.isSafeInteger(context.evaluationIndex) || context.evaluationIndex !== prefix.length - 1 ||
            !Number.isSafeInteger(context.evaluationCloseTime) || context.evaluationCloseTime <= 0 ||
            !context.pendingCandidate || typeof context.pendingCandidate !== "object" || Array.isArray(context.pendingCandidate) ||
            !Array.isArray(context.higherTimeframeCandles)) return "INVALID_CONTEXT";
        var previous = 0;
        for (var index = 0; index < prefix.length; index += 1) {
            if (!validCandle(prefix[index])) return "MALFORMED_CANDLE";
            if (prefix[index].closeTime <= previous) return "UNORDERED_CANDLES";
            if (prefix[index].closeTime > context.evaluationCloseTime) return "FUTURE_CANDLE";
            previous = prefix[index].closeTime;
        }
        if (!prefix.length || prefix[prefix.length - 1].closeTime !== context.evaluationCloseTime)
            return "EVALUATION_CANDLE_NOT_CLOSED";
        previous = 0;
        for (var h = 0; h < context.higherTimeframeCandles.length; h += 1) {
            var candle = context.higherTimeframeCandles[h];
            if (!validCandle(candle)) return "MALFORMED_HIGHER_TIMEFRAME_CANDLE";
            if (candle.closeTime <= previous) return "UNORDERED_HIGHER_TIMEFRAME_CANDLES";
            if (candle.closeTime > context.evaluationCloseTime) return "FUTURE_HIGHER_TIMEFRAME_CANDLE";
            previous = candle.closeTime;
        }
        return null;
    }
    function canonical(candle) {
        return { time: candle.openTime, closeTime: candle.closeTime, open: candle.open,
            high: candle.high, low: candle.low, close: candle.close, volume: candle.volume };
    }
    function dependencies() {
        if (!root) return null;
        var names = ["analyzeMarket", "detectStructureEvents", "detectOrderBlocks", "detectFVGs",
            "selectStructureConfirmedPriceZones", "getLiveStructureZoneQualificationOptions",
            "getLiveStructureHistoricalInputOptions"];
        for (var index = 0; index < names.length; index += 1)
            if (typeof root[names[index]] !== "function") return null;
        if (!root.HNDMTFEngine || typeof root.HNDMTFEngine.analyzeCandles !== "function") return null;
        return root;
    }
    function buildHistoricalInput(prefix, context) {
        var safePrefix, safeContext;
        try { safePrefix = clone(prefix); safeContext = clone(context); }
        catch (error) { return result("INVALID_INPUT", "CLONE_FAILED"); }
        var validation = validate(safePrefix, safeContext);
        if (validation) return result("INVALID_INPUT", validation);
        if (safePrefix.length < 220) return result("INSUFFICIENT_HISTORY", "MINIMUM_220_CLOSED_CANDLES_REQUIRED");
        var deps = dependencies();
        if (!deps) return result("DEPENDENCY_FAILURE", "AUTHORITATIVE_LIVE_DEPENDENCY_UNAVAILABLE");
        var candles = safePrefix.map(canonical), higher = safeContext.higherTimeframeCandles.map(canonical);
        var analysis, events, orderBlocks, fvgs, zones, mtfRow;
        try {
            var liveOptions = deps.getLiveStructureHistoricalInputOptions();
            if (!liveOptions || !Number.isInteger(liveOptions.structureLookback) ||
                !Number.isInteger(liveOptions.structureHistoryLimit) || !Number.isInteger(liveOptions.rawZoneHistoryLimit))
                return result("DEPENDENCY_FAILURE", "MALFORMED_LIVE_INPUT_OPTIONS");
            analysis = deps.analyzeMarket(candles);
            events = deps.detectStructureEvents({ candles: candles, lookback: liveOptions.structureLookback,
                limit: liveOptions.structureHistoryLimit,
                includeBOS: true, includeCHoCH: true });
            orderBlocks = deps.detectOrderBlocks({ candles: candles, limit: liveOptions.rawZoneHistoryLimit, includeInvalidated: true });
            fvgs = deps.detectFVGs({ candles: candles, limit: liveOptions.rawZoneHistoryLimit, includeInvalidated: true });
            zones = deps.selectStructureConfirmedPriceZones({ candles: candles,
                structureEvents: events, orderBlocks: orderBlocks, fvgs: fvgs },
                Object.assign({}, deps.getLiveStructureZoneQualificationOptions(),
                    { now: safeContext.evaluationCloseTime }));
            if (safeContext.interval === "4h" && !higher.length)
                return result("MTF_UNAVAILABLE", "HIGHER_TIMEFRAME_REQUIRED_FOR_4H");
            if (!higher.length) return result("MTF_UNAVAILABLE", "HIGHER_TIMEFRAME_CANDLES_REQUIRED");
            mtfRow = deps.HNDMTFEngine.analyzeCandles(higher, safeContext.interval === "15m" ? "4h" : "1d",
                safeContext.evaluationCloseTime);
        } catch (exception) {
            return result("DEPENDENCY_FAILURE", "AUTHORITATIVE_DEPENDENCY_EXCEPTION");
        }
        if (!analysis || typeof analysis !== "object" || !["LONG", "SHORT", "WAIT"].includes(analysis.signal))
            return result("DEPENDENCY_FAILURE", "MALFORMED_STRATEGY_RESULT");
        if (analysis.signal === "WAIT") return result("SIGNAL_UNAVAILABLE", analysis.signalReason || "WAIT_SIGNAL");
        if (!zones || !Array.isArray(zones.orderBlocks) || !Array.isArray(zones.fvgs))
            return result("DEPENDENCY_FAILURE", "MALFORMED_ZONE_RESULT");
        if (!zones.orderBlocks.length && !zones.fvgs.length)
            return result("ZONE_UNAVAILABLE", "NO_STRUCTURE_QUALIFIED_SOURCE_ZONE");
        if (!mtfRow || mtfRow.status !== "OK") return result("MTF_UNAVAILABLE", "HIGHER_TIMEFRAME_ANALYSIS_UNAVAILABLE");
        var input = { symbol: safeContext.symbol, interval: safeContext.interval,
            candles: candles, price: candles[candles.length - 1].close, analysis: clone(analysis),
            qualifiedPriceZones: clone(zones), mtfState: { rows: [clone(mtfRow)] } };
        var evidence = {
            signal: "analyzeMarket(explicit closed candle prefix)",
            price: "evaluation candle close", indicators: "live indicator functions via analyzeMarket",
            smc: "detectStructureEvents/detectOrderBlocks/detectFVGs explicit prefix",
            sourceZone: "selectStructureConfirmedPriceZones live qualification options",
            mtf: "HNDMTFEngine.analyzeCandles closed at evaluationCloseTime",
            evaluationCloseTime: safeContext.evaluationCloseTime
        };
        return result("INPUT_READY", null, clone(input), clone(evidence), []);
    }
    return { getSchemaVersion: getSchemaVersion, getVocabulary: getVocabulary,
        buildHistoricalInput: buildHistoricalInput };
}));
