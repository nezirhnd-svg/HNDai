(function (root, factory) {
    "use strict";
    var api = factory(function () { return root && root.HNDSetupEngine; },
        function () { return root && root.HNDStructureHistoricalLegacyInputBuilder; },
        function () { return root && root.HNDStructureHistoricalPlanEvidence; });
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalLegacyEvaluator = api;
}(typeof window !== "undefined" ? window : null, function (getCore, getInputBuilder, getPlanEvidence) {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_LEGACY_EVALUATOR_V1";
    var CONTEXT_FIELDS = ["symbol", "interval", "evaluationIndex", "evaluationCloseTime",
        "pendingCandidate", "consumedCandidateKeys", "higherTimeframeCandles"];
    var REASONS = ["SETUP_CREATED", "WAIT_SIGNAL", "INVALID_PRICE", "NO_SOURCE_ZONES",
        "NO_VALID_QUALIFIED_ZONES", "NO_DIRECTION_MATCH", "ALL_ZONES_INVALID_PRICE_SIDE",
        "NO_CANDIDATES", "ALL_CANDIDATES_TOO_FAR", "ALL_CANDIDATES_LOW_QUALITY",
        "ALL_CANDIDATES_CONSUMED", "LEGACY_INPUT_BUILDER_UNAVAILABLE",
        "LEGACY_INPUT_BUILDER_EXCEPTION", "LEGACY_INPUT_BUNDLE_MALFORMED",
        "LEGACY_SHARED_CORE_UNAVAILABLE", "LEGACY_SHARED_CORE_EXCEPTION",
        "LEGACY_SHARED_CORE_MALFORMED", "INSUFFICIENT_WARMUP", "MTF_DATA_UNAVAILABLE",
        "FUTURE_DATA_SUSPECTED", "INVALID_HISTORICAL_INPUT"];
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function getSchemaVersion() { return SCHEMA; }
    function getVocabulary() { return clone({ schemaVersions: [SCHEMA], decisions: ["ALLOW", "BLOCK", "UNAVAILABLE"], reasons: REASONS }); }
    function exact(value, fields) { if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort(), expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (key, index) { return key === keys[index]; }); }
    function unavailable(reason, error, warnings, builderStatus) { return { valid: true, error: error || null,
        schemaVersion: SCHEMA, decision: "UNAVAILABLE", decisionSource: null, evidence: null,
        reason: reason, candidateKey: null, filterResults: [], warnings: warnings || [],
        builderStatus: builderStatus || null, planEvidence: null }; }
    function validCandle(candle) { return exact(candle, ["openTime", "closeTime", "open", "high", "low", "close", "volume"]) &&
        Number.isSafeInteger(candle.openTime) && Number.isSafeInteger(candle.closeTime) && candle.openTime > 0 && candle.closeTime > candle.openTime &&
        [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) && candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 && candle.volume >= 0 &&
        candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close); }
    function validate(prefix, context) {
        if (!Array.isArray(prefix) || !exact(context, CONTEXT_FIELDS) || typeof context.symbol !== "string" || !context.symbol || context.symbol !== context.symbol.toUpperCase() ||
            typeof context.interval !== "string" || !context.interval || !Number.isSafeInteger(context.evaluationIndex) || context.evaluationIndex !== prefix.length - 1 ||
            !Number.isSafeInteger(context.evaluationCloseTime) || context.evaluationCloseTime <= 0 || !context.pendingCandidate || typeof context.pendingCandidate !== "object" ||
            !Array.isArray(context.consumedCandidateKeys) || !Array.isArray(context.higherTimeframeCandles)) return "INVALID_HISTORICAL_INPUT";
        var previous = 0;
        for (var i = 0; i < prefix.length; i += 1) {
            if (!validCandle(prefix[i]) || prefix[i].closeTime <= previous || prefix[i].closeTime > context.evaluationCloseTime) return "FUTURE_DATA_SUSPECTED";
            previous = prefix[i].closeTime;
        }
        if (!prefix.length || prefix[prefix.length - 1].closeTime !== context.evaluationCloseTime) return "INVALID_HISTORICAL_INPUT";
        var unique = new Set();
        for (var j = 0; j < context.consumedCandidateKeys.length; j += 1) {
            var key = context.consumedCandidateKeys[j]; if (typeof key !== "string" || !key || unique.has(key)) return "INVALID_HISTORICAL_INPUT"; unique.add(key);
        }
        for (var h = 0; h < context.higherTimeframeCandles.length; h += 1)
            if (!validCandle(context.higherTimeframeCandles[h]) || context.higherTimeframeCandles[h].closeTime > context.evaluationCloseTime) return "FUTURE_DATA_SUSPECTED";
        return null;
    }
    function filters(debug) {
        var summary = debug && debug.source ? debug : null;
        if (!summary) return [];
        return [
            { key: "SIGNAL", passed: ["LONG", "SHORT"].includes(summary.signal), actual: summary.signal, expected: "LONG_OR_SHORT", reason: summary.signal ? null : "WAIT_SIGNAL" },
            { key: "PRICE", passed: Number.isFinite(summary.price) && summary.price > 0, actual: summary.price, expected: "FINITE_POSITIVE", reason: "INVALID_PRICE" },
            { key: "SOURCE_ZONE", passed: summary.source.total > 0, actual: summary.source.total, expected: ">0", reason: "NO_SOURCE_ZONES" },
            { key: "ZONE_VALIDATION", passed: summary.validation.acceptedTotal > 0, actual: summary.validation.acceptedTotal, expected: ">0", reason: "NO_VALID_QUALIFIED_ZONES" },
            { key: "DIRECTION", passed: summary.direction.matchedTotal > 0, actual: summary.direction.matchedTotal, expected: ">0", reason: "NO_DIRECTION_MATCH" },
            { key: "PRICE_SIDE", passed: summary.priceSide.accepted > 0, actual: summary.priceSide.accepted, expected: ">0", reason: "ALL_ZONES_INVALID_PRICE_SIDE" },
            { key: "DISTANCE", passed: summary.distance.accepted > 0, actual: summary.distance.accepted, expected: ">0", reason: "ALL_CANDIDATES_TOO_FAR" },
            { key: "QUALITY", passed: summary.quality.accepted > 0, actual: summary.quality.accepted, expected: ">0", reason: "ALL_CANDIDATES_LOW_QUALITY" },
            { key: "CONSUMED_KEY", passed: summary.consumed.rejected === 0, actual: summary.consumed.rejected, expected: 0, reason: "ALL_CANDIDATES_CONSUMED" }
        ];
    }
    function evaluateHistoricalLegacy(prefix, context) {
        var safePrefix, safeContext;
        try { safePrefix = clone(prefix); safeContext = clone(context); } catch (error) { return unavailable("INVALID_HISTORICAL_INPUT", "CLONE_FAILED"); }
        var error = validate(safePrefix, safeContext); if (error) return unavailable(error, null);
        if (safePrefix.length < 200) return unavailable("INSUFFICIENT_WARMUP", null);
        var builder = getInputBuilder();
        if (!builder || typeof builder.buildHistoricalInput !== "function") return unavailable("LEGACY_INPUT_BUILDER_UNAVAILABLE", null, [], "DEPENDENCY_FAILURE");
        var bundle;
        var builderContext = { symbol: safeContext.symbol, interval: safeContext.interval,
            evaluationIndex: safeContext.evaluationIndex, evaluationCloseTime: safeContext.evaluationCloseTime,
            pendingCandidate: clone(safeContext.pendingCandidate),
            higherTimeframeCandles: clone(safeContext.higherTimeframeCandles) };
        try { bundle = builder.buildHistoricalInput(clone(safePrefix), builderContext); }
        catch (exception) { return unavailable("LEGACY_INPUT_BUILDER_EXCEPTION", "DEPENDENCY_EXCEPTION", [], "DEPENDENCY_FAILURE"); }
        if (!bundle || typeof bundle.status !== "string")
            return unavailable("LEGACY_INPUT_BUNDLE_MALFORMED", null, [], "DEPENDENCY_FAILURE");
        if (bundle.status !== "INPUT_READY") return unavailable(
            "LEGACY_INPUT_BUILDER_" + bundle.status, bundle.error || null, bundle.warnings, bundle.status);
        if (bundle.valid !== true || !bundle.input || typeof bundle.input !== "object" || Array.isArray(bundle.input))
            return unavailable("LEGACY_INPUT_BUNDLE_MALFORMED", null, [], bundle.status);
        var core = getCore();
        if (!core || typeof core.evaluateCandidateDecisionBundle !== "function") return unavailable("LEGACY_SHARED_CORE_UNAVAILABLE", null);
        var result;
        try { result = core.evaluateCandidateDecisionBundle(clone(bundle.input), clone(safeContext.consumedCandidateKeys), safeContext.evaluationCloseTime); }
        catch (exception2) { return unavailable("LEGACY_SHARED_CORE_EXCEPTION", "DEPENDENCY_EXCEPTION"); }
        if (!result || result.valid !== true || !["ALLOW", "BLOCK"].includes(result.decision) ||
            typeof result.decisionSource !== "string" || !result.decisionSource || REASONS.indexOf(result.reason) === -1 || !result.debug)
            return unavailable("LEGACY_SHARED_CORE_MALFORMED", null);
        var planEvidence = null;
        var warnings = Array.isArray(bundle.warnings) ? clone(bundle.warnings) : [];
        if (result.decision === "ALLOW") {
            var evidenceBuilder = getPlanEvidence();
            if (!evidenceBuilder || typeof evidenceBuilder.buildPlanEvidence !== "function") {
                warnings.push("PLAN_EVIDENCE_DEPENDENCY_UNAVAILABLE");
            } else {
                try {
                    var planResult = evidenceBuilder.buildPlanEvidence(clone(bundle.input), clone(result), {
                        symbol: safeContext.symbol, interval: safeContext.interval,
                        candidateKey: safeContext.pendingCandidate.key,
                        evaluationCloseTime: safeContext.evaluationCloseTime
                    });
                    if (planResult && planResult.valid === true &&
                        planResult.status === "PLAN_EVIDENCE_AVAILABLE" && planResult.evidence)
                        planEvidence = clone(planResult.evidence);
                    else warnings.push("PLAN_EVIDENCE_" + (planResult && planResult.error || "UNAVAILABLE"));
                } catch (planError) { warnings.push("PLAN_EVIDENCE_EXCEPTION"); }
            }
        }
        return { valid: true, error: null, schemaVersion: SCHEMA, decision: result.decision,
            decisionSource: result.decisionSource, evidence: clone(result.evidence), reason: result.reason,
            candidateKey: result.candidate && typeof result.candidate.key === "string" ? result.candidate.key : null,
            filterResults: filters(result.debug), warnings: warnings,
            builderStatus: bundle.status, planEvidence: planEvidence };
    }
    return { getSchemaVersion: getSchemaVersion, getVocabulary: getVocabulary,
        evaluateHistoricalLegacy: evaluateHistoricalLegacy };
}));
