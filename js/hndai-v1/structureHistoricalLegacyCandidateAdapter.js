(function (root, factory) {
    "use strict";
    var deps = typeof module === "object" && module.exports ? {
        pipeline: require("./structurePipelineOrchestrator.js"), adapter: require("./structureSetupAdapter.js"),
        swingDetector: require("./swingDetector.js"), pendingContract: require("./structurePendingCandidateContract.js"),
        legacyEvaluator: null
    } : { pipeline: root && root.HNDStructurePipelineOrchestrator, adapter: root && root.HNDStructureSetupAdapter,
        swingDetector: root && root.HNDSwingDetector, pendingContract: root && root.HNDStructurePendingCandidateContract,
        legacyEvaluator: root && root.HNDHistoricalLegacySetupEvaluator };
    var api = factory(deps);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalLegacyCandidateAdapter = api;
}(typeof window !== "undefined" ? window : null, function (deps) {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_LEGACY_CANDIDATE_ADAPTER_V1";
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function getSchemaVersion() { return SCHEMA; }
    function emptyLifecycle(value) {
        return value && Array.isArray(value.candidates) && Array.isArray(value.seenCandidateKeys) && Array.isArray(value.resolvedEventIds)
            ? clone(value) : { candidates: [], seenCandidateKeys: [], resolvedEventIds: [] };
    }
    function failure(error, lifecycle) { return { valid: false, error: error, schemaVersion: SCHEMA,
        comparison: "PIPELINE_FAILED", legacyDecision: null, gateDecision: null, candidateKey: null,
        comparisons: [], lifecycle: emptyLifecycle(lifecycle), pendingCandidateCreatedCount: 0,
        pendingCandidateResolvedCount: 0, pendingCandidateExpiredCount: 0,
        duplicateCandidateCount: 0, unmatchedStructureEventCount: 0,
        legacyDecisionAvailableCount: 0, gateDecisionAvailableCount: 0 }; }
    function notComparable(candidateKey, reason, gateDecision, gateEvidence) {
        return { valid: true, error: null, comparison: "NOT_COMPARABLE", legacyDecision: null,
            gateDecision: gateDecision || null, candidateKey: candidateKey, reason: reason,
            legacyDecisionSource: null, gateDecisionSource: gateDecision ? "HND_STRUCTURE_SETUP_ADAPTER_V1" : null,
            legacyDecisionEvidence: null, gateDecisionEvidence: gateEvidence || null };
    }
    function evaluateHistoricalShadow(prefix, config, evaluationCloseTime, lifecycleInput) {
        var lifecycle = emptyLifecycle(lifecycleInput), index = prefix && prefix.length - 1;
        if (!Array.isArray(prefix) || !config || !Number.isSafeInteger(evaluationCloseTime) || evaluationCloseTime <= 0 || index < 0)
            return failure("INVALID_HISTORICAL_EVALUATION_INPUT", lifecycle);
        if (!deps.pipeline || !deps.adapter || !deps.swingDetector || !deps.pendingContract) return failure("DEPENDENCY_UNAVAILABLE", lifecycle);
        var candle = prefix[index], context = { symbol: config.symbol, interval: config.interval,
            evaluationAtIndex: index, evaluationCloseTime: evaluationCloseTime };
        var analysis, swings;
        try {
            analysis = deps.pipeline.analyzeStructure(clone(prefix), { symbol: config.symbol, interval: config.interval,
                nowMs: evaluationCloseTime, leftBars: 2, rightBars: 2 });
            swings = deps.swingDetector.detectSwings(clone(prefix), { nowMs: evaluationCloseTime, leftBars: 2, rightBars: 2 });
        } catch (error) { return failure("STRUCTURE_ANALYSIS_EXCEPTION", lifecycle); }
        if (!analysis || analysis.valid !== true || !swings || swings.valid !== true) return failure("STRUCTURE_ANALYSIS_FAILED", lifecycle);
        var counts = { pendingCandidateCreatedCount: 0, pendingCandidateResolvedCount: 0,
            pendingCandidateExpiredCount: 0, duplicateCandidateCount: 0, unmatchedStructureEventCount: 0,
            legacyDecisionAvailableCount: 0, gateDecisionAvailableCount: 0 };
        var seen = new Set(lifecycle.seenCandidateKeys), resolvedEvents = new Set(lifecycle.resolvedEventIds);
        var candidates = lifecycle.candidates.map(clone), comparisons = [];
        swings.events.filter(function (swing) { return swing.confirmedAtIndex === index; }).forEach(function (swing) {
            var created = deps.pendingContract.createCandidate(clone(swing), clone(context));
            if (!created.valid) return;
            if (seen.has(created.candidate.key)) { counts.duplicateCandidateCount += 1; return; }
            seen.add(created.candidate.key); candidates.push(created.candidate); counts.pendingCandidateCreatedCount += 1;
        });
        var events = analysis.structureEventResult && Array.isArray(analysis.structureEventResult.events)
            ? analysis.structureEventResult.events.filter(function (event) { return event.breakAtIndex === index; }) : [];
        events.forEach(function (event) {
            if (resolvedEvents.has(event.id)) { counts.duplicateCandidateCount += 1; return; }
            var resolved = null, position = -1;
            for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
                var attempt = deps.pendingContract.resolveCandidate(candidates[candidateIndex], clone(event), clone(context));
                if (attempt.valid) { resolved = attempt.candidate; position = candidateIndex; break; }
            }
            if (!resolved) { counts.unmatchedStructureEventCount += 1; return; }
            candidates[position] = resolved; resolvedEvents.add(event.id); counts.pendingCandidateResolvedCount += 1;
            var setupCandidate = { key: resolved.key, direction: resolved.direction,
                structureEventId: event.id, structureConfirmationIndex: resolved.sourceSwingConfirmedAtIndex };
            try {
                var result = deps.adapter.evaluateCandidate(analysis.snapshotResult, setupCandidate,
                    { symbol: config.symbol, interval: config.interval, evaluationAtIndex: index,
                        evaluationOpenTime: candle.openTime, evaluationCloseTime: candle.closeTime });
                if (!result || result.valid !== true || !result.gateResult || !["ALLOW", "BLOCK"].includes(result.gateResult.decision)) {
                    comparisons.push({ valid: false, error: "GATE_RESULT_INVALID", comparison: "PIPELINE_FAILED", candidateKey: resolved.key });
                    return;
                }
                var gate = result.gateResult.decision;
                counts.gateDecisionAvailableCount += 1;
                var gateEvidence = { decision: gate, reason: result.gateResult.reason || null,
                    structureEventId: event.id, evaluationAtIndex: index };
                if (!deps.legacyEvaluator || typeof deps.legacyEvaluator.evaluateHistoricalLegacy !== "function") {
                    comparisons.push(notComparable(resolved.key, "LEGACY_EVALUATOR_UNAVAILABLE", gate, gateEvidence));
                    return;
                }
                var legacy;
                try {
                    legacy = deps.legacyEvaluator.evaluateHistoricalLegacy(clone(prefix), {
                        symbol: config.symbol, interval: config.interval, evaluationAtIndex: index,
                        evaluationCloseTime: evaluationCloseTime
                    });
                } catch (error) {
                    comparisons.push(notComparable(resolved.key, "LEGACY_EVALUATOR_EXCEPTION", gate, gateEvidence));
                    return;
                }
                if (!legacy || legacy.valid !== true || !["ALLOW", "BLOCK"].includes(legacy.decision) ||
                    typeof legacy.source !== "string" || !legacy.source || !legacy.evidence ||
                    typeof legacy.evidence !== "object" || Array.isArray(legacy.evidence)) {
                    comparisons.push(notComparable(resolved.key, "LEGACY_EVALUATOR_MALFORMED", gate, gateEvidence));
                    return;
                }
                counts.legacyDecisionAvailableCount += 1;
                var comparison = legacy.decision === gate ? "MATCH_" + gate
                    : legacy.decision === "ALLOW" ? "LEGACY_ALLOW_GATE_BLOCK" : "LEGACY_BLOCK_GATE_ALLOW";
                comparisons.push({ valid: true, error: null, comparison: comparison,
                    legacyDecision: legacy.decision, gateDecision: gate, candidateKey: resolved.key,
                    reason: "VERIFIED_DUAL_DECISION", legacyDecisionSource: legacy.source,
                    gateDecisionSource: "HND_STRUCTURE_SETUP_ADAPTER_V1",
                    legacyDecisionEvidence: clone(legacy.evidence), gateDecisionEvidence: gateEvidence });
            } catch (error) { comparisons.push({ valid: false, error: "GATE_EVALUATION_EXCEPTION", comparison: "PIPELINE_FAILED", candidateKey: resolved.key }); }
        });
        candidates = candidates.map(function (candidate) {
            if (candidate.status !== "PENDING") return candidate;
            var expired = deps.pendingContract.expireCandidate(candidate, clone(context));
            if (expired.valid) { counts.pendingCandidateExpiredCount += 1; return expired.candidate; }
            return candidate;
        });
        lifecycle = { candidates: candidates, seenCandidateKeys: Array.from(seen), resolvedEventIds: Array.from(resolvedEvents) };
        var first = comparisons[0] || notComparable(null, "NO_RESOLVED_PENDING_CANDIDATE", null, null);
        return Object.assign({ schemaVersion: SCHEMA, comparisons: comparisons, lifecycle: lifecycle }, counts, first);
    }
    return { getSchemaVersion: getSchemaVersion, evaluateHistoricalShadow: evaluateHistoricalShadow };
}));
