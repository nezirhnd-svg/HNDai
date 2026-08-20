(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalMismatchOutcomeAnalyzer = api;
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_MISMATCH_OUTCOME_V1";
    var SOURCE = "HISTORICAL_REPLAY";
    var POLICY_FIELDS = ["maximumForwardBars", "includeMatches"];
    var OUTCOMES = ["TP_FIRST", "SL_FIRST", "AMBIGUOUS_SAME_BAR", "ENTRY_NOT_REACHED",
        "OPEN_AT_HORIZON", "INSUFFICIENT_FUTURE_DATA", "NOT_EVALUABLE", "INVALID_INPUT"];
    var DISCLAIMER = "Retrospective historical diagnostic only; outcomes do not change rules, count toward live readiness, authorize entries, or guarantee profitability.";
    var INTERPRETATION = {
        TP_FIRST: "Legacy setup path reached TP before SL.",
        SL_FIRST: "Legacy setup path reached SL before TP.",
        AMBIGUOUS_SAME_BAR: "Same-bar order cannot be determined from OHLC.",
        ENTRY_NOT_REACHED: "Setup entry was not touched.",
        OPEN_AT_HORIZON: "Neither TP nor SL was reached within the horizon.",
        INSUFFICIENT_FUTURE_DATA: "Required future bars were unavailable.",
        NOT_EVALUABLE: "Required direct plan evidence was unavailable.",
        INVALID_INPUT: "Required validated historical input was unavailable."
    };
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function exact(value, fields) { if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort(), expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (key, index) { return key === keys[index]; }); }
    function getSchemaVersion() { return SCHEMA; }
    function getVocabulary() { return clone({ schemaVersions: [SCHEMA], source: SOURCE, outcomes: OUTCOMES,
        statuses: ["INVALID_INPUT", "NO_MISMATCHES", "NO_EVALUABLE_ITEMS", "OUTCOMES_AVAILABLE"] }); }
    function getDefaultPolicy() { return { maximumForwardBars: 24, includeMatches: false }; }
    function validPolicy(value) { return exact(value, POLICY_FIELDS) && Number.isSafeInteger(value.maximumForwardBars) &&
        value.maximumForwardBars > 0 && value.maximumForwardBars <= 500 && typeof value.includeMatches === "boolean"; }
    function validCandle(candle) { return exact(candle, ["openTime", "closeTime", "open", "high", "low", "close", "volume"]) &&
        Number.isSafeInteger(candle.openTime) && Number.isSafeInteger(candle.closeTime) && candle.openTime > 0 && candle.closeTime > candle.openTime &&
        [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) && candle.open > 0 && candle.high > 0 &&
        candle.low > 0 && candle.close > 0 && candle.volume >= 0 && candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close); }
    function validCandles(candles) { if (!Array.isArray(candles)) return false; var previous = 0;
        return candles.every(function (candle) { if (!validCandle(candle) || candle.closeTime <= previous) return false; previous = candle.closeTime; return true; }); }
    function safeHistorical(value, schema) { return value && typeof value === "object" && !Array.isArray(value) &&
        value.valid === true && value.schemaVersion === schema && value.source === SOURCE && value.countsTowardLiveReadiness === false; }
    function validEvidence(value) { if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var fields = ["direction", "entryMode", "entryPrice", "entryLow", "entryHigh", "stopLoss", "takeProfit"];
        if (!fields.every(function (field) { return Object.prototype.hasOwnProperty.call(value, field); })) return false;
        if (["LONG", "SHORT"].indexOf(value.direction) === -1 || ["MARKET", "LIMIT", "ZONE"].indexOf(value.entryMode) === -1) return false;
        if (![value.entryPrice, value.entryLow, value.entryHigh, value.stopLoss, value.takeProfit].every(function (item) { return item === null || (Number.isFinite(item) && item > 0); })) return false;
        if (!(Number.isFinite(value.stopLoss) && Number.isFinite(value.takeProfit))) return false;
        if (value.entryMode === "MARKET" && !Number.isFinite(value.entryPrice)) return false;
        if (value.entryMode === "LIMIT" && !Number.isFinite(value.entryPrice)) return false;
        if (value.entryMode === "ZONE" && !(Number.isFinite(value.entryLow) && Number.isFinite(value.entryHigh) && value.entryLow <= value.entryHigh)) return false;
        var entry = Number.isFinite(value.entryPrice) ? value.entryPrice : (value.entryLow + value.entryHigh) / 2;
        return value.direction === "LONG" ? value.stopLoss < entry && entry < value.takeProfit : value.takeProfit < entry && entry < value.stopLoss;
    }
    function empty(status, policy, error) { return { valid: status !== "INVALID_INPUT", error: error || null,
        schemaVersion: SCHEMA, source: SOURCE, countsTowardLiveReadiness: false, status: status,
        policy: clone(policy), analyzedMismatchCount: 0, evaluableCount: 0, notEvaluableCount: 0,
        tpFirstCount: 0, slFirstCount: 0, ambiguousCount: 0, entryNotReachedCount: 0,
        openAtHorizonCount: 0, insufficientFutureDataCount: 0, byOutcome: [], byDirection: [],
        byMarket: [], byInterval: [], outcomeItems: [], warnings: [], disclaimer: DISCLAIMER }; }
    function hitEntry(candle, evidence) { if (evidence.entryMode === "MARKET") return true;
        if (evidence.entryMode === "LIMIT") return candle.low <= evidence.entryPrice && candle.high >= evidence.entryPrice;
        return candle.high >= evidence.entryLow && candle.low <= evidence.entryHigh; }
    function hits(candle, evidence) { return evidence.direction === "LONG"
        ? { stop: candle.low <= evidence.stopLoss, target: candle.high >= evidence.takeProfit }
        : { stop: candle.high >= evidence.stopLoss, target: candle.low <= evidence.takeProfit }; }
    function directCodes(evidence) { return validEvidence(evidence) ? ["LEGACY_DIRECTION", "LEGACY_ENTRY_MODE", "LEGACY_ENTRY",
        "LEGACY_STOP_LOSS", "LEGACY_TAKE_PROFIT", "EVALUATION_CLOSE_TIME", "CANDIDATE_KEY"] : []; }
    function itemBase(observation, category, evidence) { return { key: observation.key, candidateKey: observation.candidateKey,
        symbol: observation.symbol, interval: observation.interval, evaluationCloseTime: observation.evaluationCloseTime,
        category: category, direction: evidence && evidence.direction || null,
        entry: evidence ? { mode: evidence.entryMode, price: evidence.entryPrice, low: evidence.entryLow, high: evidence.entryHigh } : null,
        stopLoss: evidence && evidence.stopLoss || null, takeProfit: evidence && evidence.takeProfit || null,
        entryReachedAt: null, outcomeAt: null, barsObserved: 0, directEvidenceCodes: directCodes(evidence),
        diagnosticInterpretation: INTERPRETATION[category] }; }
    function classify(observation, candles, policy) {
        var evidence = observation.legacyPlanEvidence;
        if (!validEvidence(evidence)) return itemBase(observation, "NOT_EVALUABLE", null);
        var future = candles.filter(function (candle) { return candle.closeTime > observation.evaluationCloseTime; });
        if (future.length < policy.maximumForwardBars) {
            var insufficient = itemBase(observation, "INSUFFICIENT_FUTURE_DATA", evidence);
            insufficient.barsObserved = future.length; return insufficient;
        }
        var scan = future.slice(0, policy.maximumForwardBars), entered = false, result = itemBase(observation, "OPEN_AT_HORIZON", evidence);
        for (var index = 0; index < scan.length; index += 1) {
            var candle = scan[index]; result.barsObserved += 1;
            if (!entered) {
                if (!hitEntry(candle, evidence)) continue;
                entered = true; result.entryReachedAt = candle.closeTime;
                var entryHits = hits(candle, evidence);
                if (entryHits.stop || entryHits.target) { result.category = "AMBIGUOUS_SAME_BAR"; result.outcomeAt = candle.closeTime; break; }
                continue;
            }
            var outcome = hits(candle, evidence);
            if (outcome.stop && outcome.target) { result.category = "AMBIGUOUS_SAME_BAR"; result.outcomeAt = candle.closeTime; break; }
            if (outcome.target) { result.category = "TP_FIRST"; result.outcomeAt = candle.closeTime; break; }
            if (outcome.stop) { result.category = "SL_FIRST"; result.outcomeAt = candle.closeTime; break; }
        }
        if (!entered) result.category = "ENTRY_NOT_REACHED";
        result.diagnosticInterpretation = INTERPRETATION[result.category]; return result;
    }
    function groups(items, field) { var counts = new Map(); items.forEach(function (item) { var key = item[field] || "UNKNOWN"; counts.set(key, (counts.get(key) || 0) + 1); });
        return Array.from(counts, function (entry) { return { key: entry[0], count: entry[1] }; }).sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key); }); }
    function analyzeOutcomes(mismatchAnalysis, replayResult, candles, policy) {
        var selectedPolicy = policy === undefined ? getDefaultPolicy() : clone(policy);
        try { mismatchAnalysis = clone(mismatchAnalysis); replayResult = clone(replayResult); candles = clone(candles); } catch (error) { return empty("INVALID_INPUT", selectedPolicy, "CLONE_FAILED"); }
        if (!validPolicy(selectedPolicy) || !safeHistorical(mismatchAnalysis, "HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1") ||
            typeof mismatchAnalysis.status !== "string" || !Number.isSafeInteger(mismatchAnalysis.mismatchCount) || mismatchAnalysis.mismatchCount < 0 ||
            !Array.isArray(mismatchAnalysis.reviewItems) || !safeHistorical(replayResult, "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1") ||
            !Array.isArray(replayResult.observations) || !validCandles(candles))
            return empty("INVALID_INPUT", validPolicy(selectedPolicy) ? selectedPolicy : getDefaultPolicy(), "INVALID_INPUT");
        var allowed = selectedPolicy.includeMatches ? ["MISMATCH", "MATCH"] : ["MISMATCH"];
        var observations = replayResult.observations.filter(function (item) { return item && allowed.indexOf(item.category) !== -1 &&
            typeof item.key === "string" && item.key && typeof item.candidateKey === "string" && item.candidateKey &&
            typeof item.symbol === "string" && item.symbol && typeof item.interval === "string" && item.interval &&
            Number.isSafeInteger(item.evaluationCloseTime) && item.evaluationCloseTime > 0; });
        var output = empty(observations.length ? "OUTCOMES_AVAILABLE" : "NO_MISMATCHES", selectedPolicy, null);
        output.analyzedMismatchCount = observations.length;
        output.outcomeItems = observations.map(function (item) { return classify(item, candles, selectedPolicy); });
        output.outcomeItems.forEach(function (item) { var field = { TP_FIRST: "tpFirstCount", SL_FIRST: "slFirstCount",
            AMBIGUOUS_SAME_BAR: "ambiguousCount", ENTRY_NOT_REACHED: "entryNotReachedCount", OPEN_AT_HORIZON: "openAtHorizonCount",
            INSUFFICIENT_FUTURE_DATA: "insufficientFutureDataCount" }[item.category];
            if (item.category === "NOT_EVALUABLE") output.notEvaluableCount += 1; else output.evaluableCount += 1;
            if (field) output[field] += 1; });
        if (observations.length && !output.evaluableCount) output.status = "NO_EVALUABLE_ITEMS";
        output.byOutcome = groups(output.outcomeItems, "category"); output.byDirection = groups(output.outcomeItems, "direction");
        output.byMarket = groups(output.outcomeItems, "symbol"); output.byInterval = groups(output.outcomeItems, "interval");
        return clone(output);
    }
    function exportOutcomeAnalysis(result) { if (!safeHistorical(result, SCHEMA) || OUTCOMES.indexOf(result.status) !== -1) return null;
        var fields = ["valid", "error", "schemaVersion", "source", "countsTowardLiveReadiness", "status", "policy",
            "analyzedMismatchCount", "evaluableCount", "notEvaluableCount", "tpFirstCount", "slFirstCount", "ambiguousCount",
            "entryNotReachedCount", "openAtHorizonCount", "insufficientFutureDataCount", "byOutcome", "byDirection", "byMarket",
            "byInterval", "outcomeItems", "warnings", "disclaimer"], safe = {};
        fields.forEach(function (field) { safe[field] = clone(result[field]); }); return JSON.stringify(safe, null, 2); }
    return { getSchemaVersion: getSchemaVersion, getVocabulary: getVocabulary, getDefaultPolicy: getDefaultPolicy,
        analyzeOutcomes: analyzeOutcomes, exportOutcomeAnalysis: exportOutcomeAnalysis };
}));
