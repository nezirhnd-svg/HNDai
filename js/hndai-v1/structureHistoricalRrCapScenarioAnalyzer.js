(function (root, factory) {
    "use strict";
    var api = factory(function () {
        if (root && root.HNDStructureHistoricalMismatchOutcomeAnalyzer)
            return root.HNDStructureHistoricalMismatchOutcomeAnalyzer;
        if (typeof require === "function") {
            try { return require("./structureHistoricalMismatchOutcomeAnalyzer.js"); }
            catch (error) { return null; }
        }
        return null;
    });
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalRrCapScenarioAnalyzer = api;
}(typeof window !== "undefined" ? window : null, function (getOutcomeAnalyzer) {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_RR_CAP_SCENARIO_ANALYSIS_V1";
    var SOURCE = "HISTORICAL_REPLAY";
    var SCENARIOS = [
        { key: "ORIGINAL_UNCAPPED", maxR: null },
        { key: "MAX_2R", maxR: 2 }, { key: "MAX_3R", maxR: 3 },
        { key: "MAX_4R", maxR: 4 }, { key: "MAX_5R", maxR: 5 }
    ];
    var DISCLAIMER = "DIAGNOSTIC SCENARIO ONLY — DOES NOT CHANGE LIVE TP. Retrospective outcomes do not count toward live readiness, authorize entries, or prove profitability.";
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function finitePositive(value) { return Number.isFinite(value) && value > 0; }
    function getSchemaVersion() { return SCHEMA; }
    function getVocabulary() { return clone({ schemaVersions: [SCHEMA], source: SOURCE,
        scenarios: SCENARIOS, statuses: ["SCENARIOS_AVAILABLE", "NO_EVALUABLE_ITEMS", "INVALID_INPUT", "DEPENDENCY_FAILURE"] }); }
    function getDefaultPolicy() { return { maximumForwardBars: 24, includeMatches: false }; }
    function fail(status, error, policy) { return { valid: false, error: error || null, schemaVersion: SCHEMA,
        source: SOURCE, countsTowardLiveReadiness: false, status: status, policy: clone(policy || null),
        analyzedItemCount: 0, scenarioSummaries: [], scenarioItems: [], warnings: [], disclaimer: DISCLAIMER }; }
    function validPolicy(policy) { return policy && typeof policy === "object" && !Array.isArray(policy) &&
        Object.keys(policy).sort().join("|") === "includeMatches|maximumForwardBars" &&
        Number.isSafeInteger(policy.maximumForwardBars) && policy.maximumForwardBars > 0 &&
        policy.maximumForwardBars <= 500 && typeof policy.includeMatches === "boolean"; }
    function validEvidence(evidence) {
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) ||
            !["LONG", "SHORT"].includes(evidence.direction) ||
            ![evidence.entryPrice, evidence.stopLoss, evidence.takeProfit].every(finitePositive)) return false;
        var risk = Math.abs(evidence.entryPrice - evidence.stopLoss);
        return risk > 0 && (evidence.direction === "LONG"
            ? evidence.stopLoss < evidence.entryPrice && evidence.entryPrice < evidence.takeProfit
            : evidence.takeProfit < evidence.entryPrice && evidence.entryPrice < evidence.stopLoss);
    }
    function validObservationEvidence(observation) {
        var evidence = observation && observation.legacyPlanEvidence;
        return validEvidence(evidence) && evidence.source === SOURCE &&
            evidence.countsTowardLiveReadiness === false && evidence.symbol === observation.symbol &&
            evidence.interval === observation.interval && evidence.candidateKey === observation.candidateKey &&
            evidence.evaluationCloseTime === observation.evaluationCloseTime &&
            typeof evidence.setupCandidateKey === "string" && evidence.setupCandidateKey &&
            typeof evidence.setupCore === "string" && evidence.setupCore &&
            typeof evidence.planCore === "string" && evidence.planCore;
    }
    function cappedEvidence(evidence, maxR) {
        if (!validEvidence(evidence)) return null;
        var output = clone(evidence), risk = Math.abs(evidence.entryPrice - evidence.stopLoss);
        var boundary = evidence.direction === "LONG"
            ? evidence.entryPrice + maxR * risk : evidence.entryPrice - maxR * risk;
        output.takeProfit = evidence.direction === "LONG"
            ? Math.min(evidence.takeProfit, boundary) : Math.max(evidence.takeProfit, boundary);
        return { evidence: output, risk: risk,
            originalR: Math.abs(evidence.takeProfit - evidence.entryPrice) / risk,
            effectiveR: Math.abs(output.takeProfit - evidence.entryPrice) / risk,
            wasCapped: output.takeProfit !== evidence.takeProfit };
    }
    function scenarioReplay(replay, maxR) {
        var output = clone(replay), metadata = new Map();
        if (!output || !Array.isArray(output.observations)) return null;
        output.observations.forEach(function (observation) {
            if (!validObservationEvidence(observation)) return;
            var capped = cappedEvidence(observation.legacyPlanEvidence, maxR);
            if (!capped) return;
            observation.legacyPlanEvidence = capped.evidence;
            metadata.set(observation.key, capped);
        });
        return { replay: output, metadata: metadata };
    }
    function summary(scenario, result) {
        return { scenario: scenario.key, maxR: scenario.maxR,
            analyzedCount: result.analyzedMismatchCount, evaluableCount: result.evaluableCount,
            notEvaluableCount: result.notEvaluableCount, tpFirstCount: result.tpFirstCount,
            slFirstCount: result.slFirstCount, ambiguousCount: result.ambiguousCount,
            entryNotReachedCount: result.entryNotReachedCount, openAtHorizonCount: result.openAtHorizonCount,
            insufficientFutureDataCount: result.insufficientFutureDataCount };
    }
    function analyzeScenarios(mismatchAnalysis, replayResult, candles, policy) {
        var selectedPolicy = policy === undefined ? getDefaultPolicy() : clone(policy);
        if (!validPolicy(selectedPolicy)) return fail("INVALID_INPUT", "INVALID_POLICY", selectedPolicy);
        var analyzer = getOutcomeAnalyzer();
        if (!analyzer || typeof analyzer.analyzeOutcomes !== "function")
            return fail("DEPENDENCY_FAILURE", "OUTCOME_ANALYZER_UNAVAILABLE", selectedPolicy);
        var before;
        try { before = JSON.stringify([mismatchAnalysis, replayResult, candles, selectedPolicy]); }
        catch (error) { return fail("INVALID_INPUT", "INPUT_CLONE_FAILED", selectedPolicy); }
        var results = [], metadataByScenario = new Map();
        try {
            SCENARIOS.forEach(function (scenario) {
                var prepared = scenario.maxR === null
                    ? { replay: clone(replayResult), metadata: new Map() }
                    : scenarioReplay(replayResult, scenario.maxR);
                if (!prepared) throw new Error("INVALID_REPLAY");
                var result = analyzer.analyzeOutcomes(clone(mismatchAnalysis), prepared.replay,
                    clone(candles), clone(selectedPolicy));
                if (!result || result.valid !== true || !Array.isArray(result.outcomeItems) ||
                    result.source !== SOURCE || result.countsTowardLiveReadiness !== false)
                    throw new Error("MALFORMED_OUTCOME_RESULT");
                results.push({ scenario: scenario, result: result });
                metadataByScenario.set(scenario.key, prepared.metadata);
            });
        } catch (error2) { return fail("DEPENDENCY_FAILURE", "OUTCOME_ANALYZER_EXCEPTION", selectedPolicy); }
        if (JSON.stringify([mismatchAnalysis, replayResult, candles, selectedPolicy]) !== before)
            return fail("INVALID_INPUT", "INPUT_MUTATION_DETECTED", selectedPolicy);
        var original = results[0].result, originalByKey = new Map();
        original.outcomeItems.forEach(function (item) { originalByKey.set(item.key, item); });
        var items = [];
        for (var resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
            var current = results[resultIndex], scenario = current.scenario;
            if (current.result.outcomeItems.length !== original.outcomeItems.length)
                return fail("DEPENDENCY_FAILURE", "SCENARIO_ITEM_COUNT_MISMATCH", selectedPolicy);
            for (var itemIndex = 0; itemIndex < current.result.outcomeItems.length; itemIndex += 1) {
                var item = current.result.outcomeItems[itemIndex], baseline = originalByKey.get(item.key);
                if (!baseline || item.candidateKey !== baseline.candidateKey ||
                    item.evaluationCloseTime !== baseline.evaluationCloseTime)
                    return fail("DEPENDENCY_FAILURE", "SCENARIO_PROVENANCE_MISMATCH", selectedPolicy);
                var observation = replayResult && Array.isArray(replayResult.observations)
                    ? replayResult.observations.find(function (entry) { return entry && entry.key === item.key; }) : null;
                var evidence = observation && observation.legacyPlanEvidence;
                var evidenceValid = validObservationEvidence(observation);
                var capped = scenario.maxR === null && evidenceValid
                    ? { evidence: evidence, risk: Math.abs(evidence.entryPrice - evidence.stopLoss),
                        originalR: Math.abs(evidence.takeProfit - evidence.entryPrice) / Math.abs(evidence.entryPrice - evidence.stopLoss),
                        effectiveR: Math.abs(evidence.takeProfit - evidence.entryPrice) / Math.abs(evidence.entryPrice - evidence.stopLoss), wasCapped: false }
                    : metadataByScenario.get(scenario.key).get(item.key);
                items.push({ key: item.key, candidateKey: item.candidateKey, symbol: item.symbol,
                    interval: item.interval, evaluationCloseTime: item.evaluationCloseTime,
                    scenario: scenario.key, maxR: scenario.maxR, direction: item.direction,
                    entryPrice: capped ? capped.evidence.entryPrice : null,
                    stopLoss: capped ? capped.evidence.stopLoss : null,
                    originalTakeProfit: evidenceValid ? evidence.takeProfit : null,
                    scenarioTakeProfit: capped ? capped.evidence.takeProfit : null,
                    originalR: capped ? capped.originalR : null, effectiveR: capped ? capped.effectiveR : null,
                    wasCapped: capped ? capped.wasCapped : false,
                    originalOutcome: baseline.category, scenarioOutcome: item.category,
                    outcomeChanged: baseline.category !== item.category,
                    entryReachedAt: item.entryReachedAt, outcomeAt: item.outcomeAt,
                    barsObserved: item.barsObserved });
            }
        }
        var summaries = results.map(function (entry) { return summary(entry.scenario, entry.result); });
        var evaluable = summaries.some(function (entry) { return entry.evaluableCount > 0; });
        return { valid: true, error: null, schemaVersion: SCHEMA, source: SOURCE,
            countsTowardLiveReadiness: false, status: evaluable ? "SCENARIOS_AVAILABLE" : "NO_EVALUABLE_ITEMS",
            policy: clone(selectedPolicy), analyzedItemCount: original.outcomeItems.length,
            scenarioSummaries: summaries, scenarioItems: items, warnings: [], disclaimer: DISCLAIMER };
    }
    function exportScenarioAnalysis(result) {
        if (!result || result.valid !== true || result.schemaVersion !== SCHEMA || result.source !== SOURCE ||
            result.countsTowardLiveReadiness !== false || !Array.isArray(result.scenarioSummaries) ||
            !Array.isArray(result.scenarioItems)) return null;
        var summaryFields = ["scenario", "maxR", "analyzedCount", "evaluableCount", "notEvaluableCount",
            "tpFirstCount", "slFirstCount", "ambiguousCount", "entryNotReachedCount",
            "openAtHorizonCount", "insufficientFutureDataCount"];
        var itemFields = ["key", "candidateKey", "symbol", "interval", "evaluationCloseTime", "scenario",
            "maxR", "direction", "entryPrice", "stopLoss", "originalTakeProfit", "scenarioTakeProfit",
            "originalR", "effectiveR", "wasCapped", "originalOutcome", "scenarioOutcome", "outcomeChanged",
            "entryReachedAt", "outcomeAt", "barsObserved"];
        function whitelist(value, fields) { var output = {};
            fields.forEach(function (field) { output[field] = clone(value && value[field]); }); return output; }
        var safe = { schemaVersion: SCHEMA, source: SOURCE, countsTowardLiveReadiness: false,
            status: result.status, policy: clone(result.policy), analyzedItemCount: result.analyzedItemCount,
            scenarioSummaries: result.scenarioSummaries.map(function (item) { return whitelist(item, summaryFields); }),
            scenarioItems: result.scenarioItems.map(function (item) { return whitelist(item, itemFields); }),
            warnings: clone(result.warnings || []), disclaimer: DISCLAIMER };
        return JSON.stringify(safe, null, 2);
    }
    return { getSchemaVersion: getSchemaVersion, getVocabulary: getVocabulary,
        getDefaultPolicy: getDefaultPolicy, analyzeScenarios: analyzeScenarios,
        exportScenarioAnalysis: exportScenarioAnalysis };
}));
