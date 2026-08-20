(function (root, factory) {
    "use strict";
    var dependency = null;
    if (typeof module === "object" && module.exports) {
        try { dependency = require("./structureHistoricalLegacyCandidateAdapter.js"); } catch (error) { dependency = null; }
    } else if (root && typeof root === "object") {
        dependency = root.HNDStructureHistoricalShadowEvaluator || root.HNDStructureHistoricalLegacyCandidateAdapter;
    }
    var api = factory(dependency);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalShadowReplay = api;
}(typeof window !== "undefined" ? window : null, function (dependency) {
    "use strict";

    var SCHEMA = "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1";
    var SOURCE = "HISTORICAL_REPLAY";
    var DISCLAIMER = "Historical diagnostic replay only; results do not count as live readiness evidence and do not authorize paper or real trading.";
    var CONFIG_FIELDS = ["symbol", "interval", "warmupCandles", "maximumEvaluationCandles", "includeNonComparable", "evaluationCutoffTime"];
    var DEFAULT_CONFIG = { symbol: "BTCUSDT", interval: "15m", warmupCandles: 250,
        maximumEvaluationCandles: 1000, includeNonComparable: true, evaluationCutoffTime: Number.MAX_SAFE_INTEGER };

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function getSchemaVersion() { return SCHEMA; }
    function getDefaultConfig() { return clone(DEFAULT_CONFIG); }
    function exact(value, fields) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort(), expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (key, index) { return keys[index] === key; });
    }
    function configError(config) {
        if (!exact(config, CONFIG_FIELDS)) return "INVALID_CONFIG_FIELDS";
        if (!["BTCUSDT", "ETHUSDT", "SOLUSDT"].includes(config.symbol)) return "INVALID_SYMBOL";
        if (!["15m", "4h"].includes(config.interval)) return "INVALID_INTERVAL";
        if (!Number.isSafeInteger(config.warmupCandles) || config.warmupCandles < 1) return "INVALID_WARMUP_CANDLES";
        if (!Number.isSafeInteger(config.maximumEvaluationCandles) || config.maximumEvaluationCandles < 1 ||
            config.maximumEvaluationCandles > 10000) return "INVALID_MAXIMUM_EVALUATION_CANDLES";
        if (typeof config.includeNonComparable !== "boolean") return "INVALID_INCLUDE_NON_COMPARABLE";
        if (!Number.isSafeInteger(config.evaluationCutoffTime) || config.evaluationCutoffTime <= 0)
            return "INVALID_EVALUATION_CUTOFF_TIME";
        return null;
    }
    function validateCandles(candles) {
        if (!Array.isArray(candles)) return { valid: false, error: "CANDLES_MUST_BE_ARRAY" };
        var previous = 0;
        for (var index = 0; index < candles.length; index += 1) {
            var candle = candles[index];
            if (!exact(candle, ["openTime", "closeTime", "open", "high", "low", "close", "volume"]))
                return { valid: false, error: "INVALID_CANDLE_FIELDS", index: index };
            if (!Number.isSafeInteger(candle.openTime) || candle.openTime <= 0 ||
                !Number.isSafeInteger(candle.closeTime) || candle.closeTime <= candle.openTime)
                return { valid: false, error: "INVALID_CANDLE_TIME", index: index };
            if (candle.closeTime <= previous)
                return { valid: false, error: candle.closeTime === previous ? "DUPLICATE_CLOSE_TIME" : "CANDLES_NOT_ORDERED", index: index };
            if (![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) ||
                candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 || candle.volume < 0 ||
                candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low)
                return { valid: false, error: "INVALID_CANDLE_OHLC", index: index };
            previous = candle.closeTime;
        }
        return { valid: true, error: null };
    }
    function base(candles, config, status, error) {
        return { valid: false, error: error || null, schemaVersion: SCHEMA, status: status, source: SOURCE,
            countsTowardLiveReadiness: false, symbol: config && config.symbol || null,
            interval: config && config.interval || null, inputCandleCount: Array.isArray(candles) ? candles.length : 0,
            evaluationCutoffTime: config && config.evaluationCutoffTime || null,
            evaluatedCandleCount: 0, observationCount: 0, comparableCount: 0, matchCount: 0,
            mismatchCount: 0, failureCount: 0, notComparableCount: 0, notApplicableCount: 0,
            duplicateCandidateCount: 0, pendingCandidateCreatedCount: 0,
            pendingCandidateResolvedCount: 0, pendingCandidateExpiredCount: 0,
            unmatchedStructureEventCount: 0, legacyDecisionAvailableCount: 0,
            legacyAllowCount: 0, legacyBlockCount: 0, legacyUnavailableCount: 0,
            gateDecisionAvailableCount: 0, builderReadyCount: 0, builderUnavailableCount: 0,
            notComparableReasons: {}, byLegacyReason: [], byBuilderStatus: [],
            matchRate: null, mismatchRate: null, observations: [], warnings: [], disclaimer: DISCLAIMER };
    }
    function classify(value) {
        var comparison = value && value.comparison;
        if (comparison === "MATCH_ALLOW" || comparison === "MATCH_BLOCK") return "MATCH";
        if (comparison === "LEGACY_ALLOW_GATE_BLOCK" || comparison === "LEGACY_BLOCK_GATE_ALLOW") return "MISMATCH";
        if (comparison === "NOT_APPLICABLE") return "NOT_APPLICABLE";
        if (comparison === "NOT_COMPARABLE" || comparison === "NOT_EVALUATED") return "NOT_COMPARABLE";
        return "FAILURE";
    }
    function evaluate(prefix, config, closeTime, lifecycle) {
        if (dependency && typeof dependency.evaluateHistoricalShadow === "function")
            return dependency.evaluateHistoricalShadow(clone(prefix), clone(config), closeTime, clone(lifecycle));
        throw new Error("REPLAY_EVALUATOR_UNAVAILABLE");
    }
    function runReplay(candles, config) {
        var cfg = config === undefined ? getDefaultConfig() : clone(config);
        var cfgError = configError(cfg), validation = validateCandles(candles);
        if (cfgError) return base(candles, cfg, "INVALID_INPUT", cfgError);
        if (!validation.valid) return base(candles, cfg, "INVALID_INPUT", validation.error);
        var input = clone(candles);
        var closed = input.filter(function (candle) { return candle.closeTime <= cfg.evaluationCutoffTime; });
        if (closed.length <= cfg.warmupCandles) return base(candles, cfg, "INSUFFICIENT_HISTORY", "INSUFFICIENT_CLOSED_CANDLES");
        if (!dependency || typeof dependency.evaluateHistoricalShadow !== "function")
            return base(candles, cfg, "DEPENDENCY_FAILURE", "REPLAY_EVALUATOR_UNAVAILABLE");
        var output = base(candles, cfg, "COMPLETED_NO_COMPARABLE", null);
        var comparedCandidateKeys = new Set();
        var lifecycle = { candidates: [], seenCandidateKeys: [], resolvedEventIds: [], consumedCandidateKeys: [] };
        var end = Math.min(closed.length, cfg.warmupCandles + cfg.maximumEvaluationCandles);
        for (var index = 0; index < end; index += 1) {
            var candle = closed[index], result;
            try { result = evaluate(closed.slice(0, index + 1), cfg, candle.closeTime, lifecycle); }
            catch (error) {
                output.status = "DEPENDENCY_FAILURE";
                output.error = "DEPENDENCY_EXCEPTION";
                output.valid = false;
                output.observations = [];
                output.evaluatedCandleCount = 0;
                return clone(output);
            }
            lifecycle = result && result.lifecycle ? clone(result.lifecycle) : lifecycle;
            ["pendingCandidateCreatedCount", "pendingCandidateResolvedCount", "pendingCandidateExpiredCount",
                "duplicateCandidateCount", "unmatchedStructureEventCount", "legacyDecisionAvailableCount",
                "legacyAllowCount", "legacyBlockCount", "legacyUnavailableCount", "gateDecisionAvailableCount"].forEach(function (field) {
                if (result && Number.isSafeInteger(result[field]) && result[field] >= 0) output[field] += result[field];
            });
            if (result && result.legacyReasonCounts && typeof result.legacyReasonCounts === "object") {
                Object.keys(result.legacyReasonCounts).forEach(function (reason) {
                    if (!output._legacyReasonCounts) output._legacyReasonCounts = {};
                    output._legacyReasonCounts[reason] = (output._legacyReasonCounts[reason] || 0) + result.legacyReasonCounts[reason];
                });
            }
            if (result && result.builderStatusCounts && typeof result.builderStatusCounts === "object") {
                Object.keys(result.builderStatusCounts).forEach(function (status) {
                    if (!output._builderStatusCounts) output._builderStatusCounts = {};
                    output._builderStatusCounts[status] = (output._builderStatusCounts[status] || 0) + result.builderStatusCounts[status];
                    if (status === "INPUT_READY") output.builderReadyCount += result.builderStatusCounts[status];
                    else output.builderUnavailableCount += result.builderStatusCounts[status];
                });
            }
            if (index < cfg.warmupCandles) continue;
            var values = result && Array.isArray(result.comparisons) && result.comparisons.length ? result.comparisons : [result];
            output.evaluatedCandleCount += 1;
            values.forEach(function (value, valueIndex) {
            var category = classify(value);
            if ((category === "MATCH" || category === "MISMATCH" || category === "FAILURE") &&
                value && typeof value.candidateKey === "string" && value.candidateKey.length > 0) {
                if (comparedCandidateKeys.has(value.candidateKey)) {
                    output.duplicateCandidateCount += 1;
                    category = "NOT_COMPARABLE";
                    value = { comparison: "NOT_COMPARABLE", error: "DUPLICATE_CANDIDATE_SKIPPED",
                        candidateKey: value.candidateKey };
                } else comparedCandidateKeys.add(value.candidateKey);
            }
            var observation = { key: cfg.symbol + "|" + cfg.interval + "|" + candle.closeTime + "|" + valueIndex,
                symbol: cfg.symbol, interval: cfg.interval, evaluationCloseTime: candle.closeTime,
                source: SOURCE, countsTowardLiveReadiness: false, category: category,
                comparison: value && typeof value.comparison === "string" ? value.comparison : null,
                error: value && value.error != null ? String(value.error) : null,
                candidateKey: value && typeof value.candidateKey === "string" ? value.candidateKey : null,
                reason: value && typeof value.reason === "string" ? value.reason : null,
                legacyReason: value && typeof value.legacyReason === "string" ? value.legacyReason : null,
                gateReason: value && typeof value.gateReason === "string" ? value.gateReason : null,
                legacyDecision: value && ["ALLOW", "BLOCK"].includes(value.legacyDecision) ? value.legacyDecision : null,
                gateDecision: value && ["ALLOW", "BLOCK"].includes(value.gateDecision) ? value.gateDecision : null,
                legacyDecisionSource: value && typeof value.legacyDecisionSource === "string" ? value.legacyDecisionSource : null,
                gateDecisionSource: value && typeof value.gateDecisionSource === "string" ? value.gateDecisionSource : null,
                legacyDecisionEvidence: value && value.legacyDecisionEvidence && typeof value.legacyDecisionEvidence === "object" ? clone(value.legacyDecisionEvidence) : null,
                gateDecisionEvidence: value && value.gateDecisionEvidence && typeof value.gateDecisionEvidence === "object" ? clone(value.gateDecisionEvidence) : null };
            observation.builderStatus = value && typeof value.builderStatus === "string" ? value.builderStatus : null;
            if (category === "MATCH") { output.matchCount += 1; output.comparableCount += 1; }
            else if (category === "MISMATCH") { output.mismatchCount += 1; output.comparableCount += 1; }
            else if (category === "FAILURE") output.failureCount += 1;
            else if (category === "NOT_APPLICABLE") output.notApplicableCount += 1;
            else {
                output.notComparableCount += 1;
                var reason = observation.reason || "UNSPECIFIED_NOT_COMPARABLE";
                output.notComparableReasons[reason] = (output.notComparableReasons[reason] || 0) + 1;
            }
            if (category !== "NOT_COMPARABLE" || cfg.includeNonComparable) output.observations.push(observation);
            });
        }
        output.observationCount = output.observations.length;
        output.byLegacyReason = Object.keys(output._legacyReasonCounts || {}).map(function (key) {
            return { key: key, count: output._legacyReasonCounts[key] };
        }).sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key); });
        delete output._legacyReasonCounts;
        output.byBuilderStatus = Object.keys(output._builderStatusCounts || {}).map(function (key) {
            return { key: key, count: output._builderStatusCounts[key] };
        }).sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key); });
        delete output._builderStatusCounts;
        output.matchRate = output.comparableCount ? Math.round(output.matchCount / output.comparableCount * 10000) / 100 : null;
        output.mismatchRate = output.comparableCount ? Math.round(output.mismatchCount / output.comparableCount * 10000) / 100 : null;
        if (output.duplicateCandidateCount) output.warnings.push("DUPLICATE_CANDIDATES_SKIPPED:" + output.duplicateCandidateCount);
        output.status = output.comparableCount ? "COMPLETED_WITH_RESULTS" : "COMPLETED_NO_COMPARABLE";
        output.valid = true;
        return clone(output);
    }
    function exportReplay(result) {
        if (!result || typeof result !== "object" || result.schemaVersion !== SCHEMA || result.source !== SOURCE ||
            result.countsTowardLiveReadiness !== false) return null;
        var fields = ["valid", "error", "schemaVersion", "status", "source", "countsTowardLiveReadiness",
            "symbol", "interval", "inputCandleCount", "evaluatedCandleCount", "observationCount",
            "comparableCount", "matchCount", "mismatchCount", "failureCount", "notComparableCount",
            "notApplicableCount", "duplicateCandidateCount", "pendingCandidateCreatedCount",
            "pendingCandidateResolvedCount", "pendingCandidateExpiredCount", "unmatchedStructureEventCount",
            "legacyDecisionAvailableCount", "gateDecisionAvailableCount", "notComparableReasons",
            "legacyAllowCount", "legacyBlockCount", "legacyUnavailableCount", "byLegacyReason",
            "builderReadyCount", "builderUnavailableCount", "byBuilderStatus",
            "matchRate", "mismatchRate", "evaluationCutoffTime", "warnings", "disclaimer"];
        var safe = {};
        fields.forEach(function (field) { safe[field] = clone(result[field]); });
        safe.observations = Array.isArray(result.observations) ? result.observations.map(function (observation) {
            return { key: observation.key, symbol: observation.symbol, interval: observation.interval,
                evaluationCloseTime: observation.evaluationCloseTime, source: SOURCE,
                countsTowardLiveReadiness: false, category: observation.category,
                comparison: observation.comparison, error: observation.error,
                candidateKey: observation.candidateKey, reason: observation.reason,
                legacyReason: observation.legacyReason, gateReason: observation.gateReason,
                legacyDecision: observation.legacyDecision, gateDecision: observation.gateDecision,
                legacyDecisionSource: observation.legacyDecisionSource,
                gateDecisionSource: observation.gateDecisionSource,
                legacyDecisionEvidence: clone(observation.legacyDecisionEvidence),
                gateDecisionEvidence: clone(observation.gateDecisionEvidence),
                builderStatus: observation.builderStatus };
        }) : [];
        return JSON.stringify(safe, null, 2);
    }
    return { getSchemaVersion: getSchemaVersion, getDefaultConfig: getDefaultConfig,
        validateCandles: validateCandles, runReplay: runReplay, exportReplay: exportReplay };
}));
