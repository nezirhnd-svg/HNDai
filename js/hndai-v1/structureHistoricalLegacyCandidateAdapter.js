(function (root, factory) {
    "use strict";
    var deps = typeof module === "object" && module.exports ? {
        pipeline: require("./structurePipelineOrchestrator.js"), adapter: require("./structureSetupAdapter.js")
    } : { pipeline: root && root.HNDStructurePipelineOrchestrator,
        adapter: root && root.HNDStructureSetupAdapter };
    var api = factory(deps);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalLegacyCandidateAdapter = api;
}(typeof window !== "undefined" ? window : null, function (deps) {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_LEGACY_CANDIDATE_ADAPTER_V1";
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function getSchemaVersion() { return SCHEMA; }
    function failure(error) { return { valid: false, error: error, schemaVersion: SCHEMA,
        comparison: "PIPELINE_FAILED", legacyDecision: null, gateDecision: null, candidateKey: null }; }
    function evaluateHistoricalShadow(prefix, config, evaluationCloseTime) {
        if (!Array.isArray(prefix) || !config || !Number.isSafeInteger(evaluationCloseTime) || evaluationCloseTime <= 0)
            return failure("INVALID_HISTORICAL_EVALUATION_INPUT");
        if (!deps.pipeline || typeof deps.pipeline.analyzeStructure !== "function" ||
            !deps.adapter || typeof deps.adapter.evaluateCandidate !== "function") return failure("DEPENDENCY_UNAVAILABLE");
        var latestCandle = prefix[prefix.length - 1];
        var analysisContext = { symbol: config.symbol, interval: config.interval,
            nowMs: evaluationCloseTime, leftBars: 2, rightBars: 2 };
        var analysis;
        try { analysis = deps.pipeline.analyzeStructure(clone(prefix), clone(analysisContext)); }
        catch (error) { return failure("STRUCTURE_ANALYSIS_EXCEPTION"); }
        if (!analysis || analysis.valid !== true) return failure("STRUCTURE_ANALYSIS_FAILED");
        if (!analysis.ready || !analysis.latestStructure) {
            return { valid: true, error: null, schemaVersion: SCHEMA, comparison: "NOT_COMPARABLE",
                legacyDecision: "BLOCK", gateDecision: null, candidateKey: null };
        }
        var latest = analysis.latestStructure;
        var candidate = { key: [config.symbol, config.interval, latest.sourceEventId].join("|"),
            direction: latest.direction === "BULLISH" ? "LONG" : "SHORT",
            structureEventId: latest.sourceEventId,
            structureConfirmationIndex: latest.levelConfirmedAtIndex };
        if (!Number.isSafeInteger(latest.levelConfirmedAtIndex) ||
            latest.levelConfirmedAtIndex !== prefix.length - 1) {
            return { valid: true, error: null, schemaVersion: SCHEMA, comparison: "NOT_COMPARABLE",
                legacyDecision: "BLOCK", gateDecision: null, candidateKey: candidate.key,
                reason: "NOT_STRUCTURE_CONFIRMATION_CANDLE" };
        }
        var evaluationContext = { symbol: config.symbol, interval: config.interval,
            evaluationAtIndex: prefix.length - 1, evaluationOpenTime: latestCandle.openTime,
            evaluationCloseTime: latestCandle.closeTime };
        try {
            var result = deps.adapter.evaluateCandidate(analysis.snapshotResult, clone(candidate), clone(evaluationContext));
            if (!result || result.valid !== true || !result.gateResult ||
                !["ALLOW", "BLOCK"].includes(result.gateResult.decision)) return failure("GATE_RESULT_INVALID");
            var gate = result.gateResult.decision;
            return { valid: true, error: null, schemaVersion: SCHEMA,
                comparison: gate === "ALLOW" ? "MATCH_ALLOW" : "LEGACY_ALLOW_GATE_BLOCK",
                legacyDecision: "ALLOW", gateDecision: gate, candidateKey: candidate.key,
                reason: "STRUCTURE_CONFIRMATION_CANDLE" };
        } catch (error) { return failure("GATE_EVALUATION_EXCEPTION"); }
    }
    return { getSchemaVersion: getSchemaVersion, evaluateHistoricalShadow: evaluateHistoricalShadow };
}));
