(function (root, factory) {
    "use strict";
    var assessment = typeof module === "object" && module.exports
        ? require("./structureShadowAssessment.js") : root && root.HNDStructureShadowAssessment;
    var api = factory(assessment);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureShadowMismatchAnalyzer = api;
}(typeof window !== "undefined" ? window : null, function (assessment) {
    "use strict";
    var SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_MISMATCH_ANALYZER_V1";
    var SOURCE_SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_TELEMETRY_V1";
    var DISCLAIMER = "Diagnostic classification only; this analysis does not change rules or authorize entries.";
    var PRIORITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
    var MAP = {
        MATCH_ALLOW: ["MATCH", "INFO"], MATCH_BLOCK: ["MATCH", "INFO"],
        LEGACY_ALLOW_GATE_BLOCK: ["LEGACY_ALLOWED_GATE_BLOCKED", "HIGH"],
        LEGACY_BLOCK_GATE_ALLOW: ["LEGACY_BLOCKED_GATE_ALLOWED", "MEDIUM"],
        PIPELINE_FAILED: ["PIPELINE_FAILURE", "HIGH"],
        NOT_COMPARABLE: ["NO_COMPARABLE_CANDIDATE", "LOW"],
        NOT_APPLICABLE: ["EXISTING_SETUP_NOT_APPLICABLE", "INFO"]
    };
    var SUGGESTIONS = {
        PIPELINE_FAILURE: "Review the dependency and failed-stage diagnostic record.",
        LEGACY_ALLOWED_GATE_BLOCKED: "Review candidate-to-structure-event matching.",
        LEGACY_BLOCKED_GATE_ALLOWED: "Compare legacy candidate filters with gate conditions.",
        NO_COMPARABLE_CANDIDATE: "Compare the missing legacy candidate with setup debug diagnostics.",
        EXISTING_SETUP_NOT_APPLICABLE: "Review the existing setup update or locked flow separately.",
        MATCH: "Record the diagnostic agreement; no rule change is suggested.",
        UNCLASSIFIED_DIAGNOSTIC: "Review the directly available diagnostic fields only."
    };
    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function percent(n, d) { return d ? Math.round(n / d * 10000) / 100 : null; }
    function group(values, denominator) {
        var counts = new Map();
        values.forEach(function (value) { if (value !== null && value !== undefined && value !== "") counts.set(String(value), (counts.get(String(value)) || 0) + 1); });
        return Array.from(counts, function (entry) { return { key: entry[0], count: entry[1], percentage: percent(entry[1], denominator) }; })
            .sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key); });
    }
    function base(valid, error, status) {
        return { valid: valid, error: error, schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: valid ? SOURCE_SCHEMA_VERSION : null, status: status,
            observationCount: 0, comparableCount: 0, matchCount: 0, mismatchCount: 0,
            failureCount: 0, notComparableCount: 0, notApplicableCount: 0,
            matchRate: null, mismatchRate: null, percentageDenominator: "observationCount",
            byComparison: [], byCategory: [], byPriority: [], byMarket: [], byInterval: [],
            byMarketInterval: [], byGateReason: [], byError: [], byFailedStage: [],
            reviewItems: [], failureItems: [], disclaimer: DISCLAIMER };
    }
    function classify(item) {
        var mapped = MAP[item.shadow.comparison] || ["UNCLASSIFIED_DIAGNOSTIC", "INFO"];
        if (item.shadow.status === "FAILED" || item.shadow.failedStage || item.shadow.error) mapped = ["PIPELINE_FAILURE", "HIGH"];
        return { category: mapped[0], priority: mapped[1] };
    }
    function evidence(item) {
        var shadow = item.shadow, codes = [];
        if (shadow.error) codes.push("PIPELINE_ERROR");
        if (shadow.failedStage) codes.push("FAILED_STAGE");
        if (shadow.gateReason) codes.push("GATE_REASON");
        if (shadow.comparison === "NOT_COMPARABLE" && shadow.candidateKey === null) codes.push("NO_CANDIDATE");
        if (shadow.comparison === "NOT_APPLICABLE" && /EXISTING_SETUP/.test(shadow.reason || "")) codes.push("EXISTING_SETUP_EVALUATION");
        if (shadow.legacyDecision && shadow.gateDecision && shadow.legacyDecision !== shadow.gateDecision) codes.push("DECISION_DIVERGENCE");
        return codes.length ? codes : ["NO_DIRECT_EVIDENCE"];
    }
    function reviewItem(item, classification) {
        return { key: item.key, symbol: item.symbol, interval: item.interval,
            evaluationCloseTime: item.evaluationCloseTime, category: classification.category,
            priority: classification.priority, comparison: item.shadow.comparison,
            legacyDecision: item.shadow.legacyDecision, gateDecision: item.shadow.gateDecision,
            gateReason: item.shadow.gateReason, error: item.shadow.error,
            failedStage: item.shadow.failedStage, candidateKey: item.shadow.candidateKey,
            evidenceCodes: evidence(item), suggestedReview: SUGGESTIONS[classification.category] };
    }
    function reviewSort(a, b) { return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        b.evaluationCloseTime - a.evaluationCloseTime || a.symbol.localeCompare(b.symbol) ||
        a.interval.localeCompare(b.interval) || a.key.localeCompare(b.key); }
    function analyzeSnapshot(snapshot) {
        var source, validation;
        try { source = clone(snapshot); validation = assessment && assessment.validateSnapshot(source); }
        catch (error) { validation = { valid: false, error: "INVALID_SNAPSHOT" }; }
        if (!validation || validation.valid !== true) return base(false, validation && validation.error || "INVALID_SNAPSHOT", "INVALID_SNAPSHOT");
        var result = base(true, null, "NO_OBSERVATIONS"), rows = [];
        result.sourceSchemaVersion = SOURCE_SCHEMA_VERSION;
        source.observations.forEach(function (item) {
            var classification = classify(item);
            rows.push({ item: item, category: classification.category, priority: classification.priority });
        });
        var comparisons = rows.map(function (row) { return row.item.shadow.comparison; });
        function count(list) { return comparisons.filter(function (value) { return list.indexOf(value) >= 0; }).length; }
        result.observationCount = rows.length;
        result.matchCount = count(["MATCH_ALLOW", "MATCH_BLOCK"]);
        result.mismatchCount = count(["LEGACY_ALLOW_GATE_BLOCK", "LEGACY_BLOCK_GATE_ALLOW"]);
        result.comparableCount = result.matchCount + result.mismatchCount;
        result.failureCount = rows.filter(function (row) { return row.category === "PIPELINE_FAILURE"; }).length;
        result.notComparableCount = count(["NOT_COMPARABLE"]);
        result.notApplicableCount = count(["NOT_APPLICABLE"]);
        result.matchRate = percent(result.matchCount, result.comparableCount);
        result.mismatchRate = percent(result.mismatchCount, result.comparableCount);
        result.byComparison = group(comparisons, rows.length);
        result.byCategory = group(rows.map(function (row) { return row.category; }), rows.length);
        result.byPriority = group(rows.map(function (row) { return row.priority; }), rows.length);
        result.byMarket = group(rows.map(function (row) { return row.item.symbol; }), rows.length);
        result.byInterval = group(rows.map(function (row) { return row.item.interval; }), rows.length);
        result.byMarketInterval = group(rows.map(function (row) { return row.item.symbol + "|" + row.item.interval; }), rows.length);
        result.byGateReason = group(rows.map(function (row) { return row.item.shadow.gateReason; }), rows.length);
        result.byError = group(rows.map(function (row) { return row.item.shadow.error; }), rows.length);
        result.byFailedStage = group(rows.map(function (row) { return row.item.shadow.failedStage; }), rows.length);
        var review = rows.filter(function (row) { return row.category !== "MATCH"; }).map(function (row) { return reviewItem(row.item, row); }).sort(reviewSort);
        result.reviewItems = review.slice(0, 50);
        result.failureItems = review.filter(function (item) { return item.category === "PIPELINE_FAILURE"; }).slice(0, 25);
        result.status = !rows.length ? "NO_OBSERVATIONS" : result.failureCount ? "FAILURES_FOUND" :
            result.mismatchCount ? "REVIEW_ITEMS_FOUND" : !result.comparableCount ? "NO_COMPARABLE" : "MATCH_ONLY";
        return clone(result);
    }
    return { getSchemaVersion: function () { return SCHEMA_VERSION; }, getVocabulary: function () {
        return clone({ schemaVersion: SCHEMA_VERSION, sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            statuses: ["INVALID_SNAPSHOT", "NO_OBSERVATIONS", "NO_COMPARABLE", "MATCH_ONLY", "REVIEW_ITEMS_FOUND", "FAILURES_FOUND"],
            categories: Object.keys(SUGGESTIONS), priorities: ["HIGH", "MEDIUM", "LOW", "INFO"] });
    }, analyzeSnapshot: analyzeSnapshot };
}));
