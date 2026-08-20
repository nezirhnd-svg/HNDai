(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalMismatchAnalyzer = api;
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    var SCHEMA = "HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1";
    var SOURCE_SCHEMA = "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1";
    var SOURCE = "HISTORICAL_REPLAY";
    var DISCLAIMER = "Historical diagnostic classification only; this analysis does not change rules, count toward live readiness, or authorize entries.";
    var STATUSES = ["INVALID_REPLAY", "NO_OBSERVATIONS", "NO_COMPARABLE", "MATCH_ONLY", "REVIEW_ITEMS_FOUND", "FAILURES_FOUND"];
    var CATEGORIES = ["MATCH_ALLOW", "MATCH_BLOCK", "LEGACY_ALLOW_GATE_BLOCK", "LEGACY_BLOCK_GATE_ALLOW",
        "NOT_COMPARABLE", "PIPELINE_FAILURE", "UNCLASSIFIED_DIAGNOSTIC"];
    var PRIORITIES = ["HIGH", "MEDIUM", "LOW", "INFO"];
    var PRIORITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
    var SOURCE_CATEGORIES = ["MATCH", "MISMATCH", "FAILURE", "NOT_COMPARABLE", "NOT_APPLICABLE"];
    var COMPARISONS = ["MATCH_ALLOW", "MATCH_BLOCK", "LEGACY_ALLOW_GATE_BLOCK", "LEGACY_BLOCK_GATE_ALLOW",
        "NOT_COMPARABLE", "NOT_EVALUATED", "NOT_APPLICABLE", "PIPELINE_FAILED"];
    var COUNT_FIELDS = ["observationCount", "comparableCount", "matchCount", "mismatchCount", "failureCount", "notComparableCount"];
    var EVIDENCE_CODES = ["LEGACY_DECISION", "GATE_DECISION", "LEGACY_FILTER_EVIDENCE", "LEGACY_BLOCK_REASON",
        "GATE_BLOCK_REASON", "BUILDER_STATUS", "PENDING_CANDIDATE", "DECISION_DIVERGENCE", "PIPELINE_ERROR", "NO_DIRECT_EVIDENCE"];
    var SUGGESTIONS = {
        LEGACY_ALLOW_GATE_BLOCK: "Compare the legacy allow evidence with the gate block reason.",
        LEGACY_BLOCK_GATE_ALLOW: "Compare the legacy block reason with the gate allow evidence.",
        PIPELINE_FAILURE: "Review the dependency or stage error record.",
        NOT_COMPARABLE: "Review the builder and evaluator availability fields.",
        MATCH_ALLOW: "Record the direct diagnostic agreement.",
        MATCH_BLOCK: "Record the direct diagnostic agreement.",
        UNCLASSIFIED_DIAGNOSTIC: "Review only the directly available diagnostic fields."
    };

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function percent(count, denominator) { return denominator ? Math.round(count / denominator * 10000) / 100 : null; }
    function safeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
    function safeText(value, nullable) {
        return value === null && nullable || typeof value === "string" && value.length > 0 && value.length <= 500 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
    }
    function safeJson(value, depth) {
        if (value === null || typeof value === "boolean" || typeof value === "string" && value.length <= 2000 ||
            typeof value === "number" && Number.isFinite(value)) return true;
        if (depth > 5) return false;
        if (Array.isArray(value)) return value.length <= 100 && value.every(function (item) { return safeJson(item, depth + 1); });
        if (!value || typeof value !== "object") return false;
        var keys = Object.keys(value);
        return keys.length <= 100 && keys.every(function (key) { return safeText(key, false) && safeJson(value[key], depth + 1); });
    }
    function decision(value) { return value === null || value === "ALLOW" || value === "BLOCK"; }
    function base(valid, error, status) {
        return { valid: valid, error: error || null, schemaVersion: SCHEMA, sourceSchemaVersion: SOURCE_SCHEMA,
            source: SOURCE, countsTowardLiveReadiness: false, status: status,
            observationCount: 0, comparableCount: 0, matchCount: 0, mismatchCount: 0,
            failureCount: 0, notComparableCount: 0, matchRate: null, mismatchRate: null,
            percentageDenominator: "observationCount", byCategory: [], byPriority: [], byMarket: [], byInterval: [],
            byMarketInterval: [], byLegacyDecision: [], byGateDecision: [], byLegacyReason: [], byGateReason: [],
            byBuilderStatus: [], reviewItems: [], failureItems: [], warnings: [], disclaimer: DISCLAIMER };
    }
    function validateObservation(item) {
        if (!item || typeof item !== "object" || Array.isArray(item) || !safeText(item.key, false) ||
            !safeText(item.symbol, false) || !/^[A-Z0-9]+$/.test(item.symbol) || !safeText(item.interval, false) ||
            !Number.isSafeInteger(item.evaluationCloseTime) || item.evaluationCloseTime <= 0 || item.source !== SOURCE ||
            item.countsTowardLiveReadiness !== false || SOURCE_CATEGORIES.indexOf(item.category) < 0 ||
            !(item.comparison === null || COMPARISONS.indexOf(item.comparison) >= 0) || !decision(item.legacyDecision) ||
            !decision(item.gateDecision)) return false;
        var nullableTexts = ["error", "candidateKey", "reason", "legacyReason", "gateReason", "builderStatus"];
        if (!nullableTexts.every(function (field) { return item[field] === undefined || safeText(item[field], true); })) return false;
        return ["legacyDecisionEvidence", "gateDecisionEvidence"].every(function (field) {
            return item[field] === undefined || safeJson(item[field], 0);
        });
    }
    function validateReplay(replay) {
        if (!replay || typeof replay !== "object" || Array.isArray(replay) || replay.schemaVersion !== SOURCE_SCHEMA ||
            replay.source !== SOURCE || replay.countsTowardLiveReadiness !== false || !Array.isArray(replay.observations) ||
            !COUNT_FIELDS.every(function (field) { return safeInteger(replay[field]); }) ||
            !replay.observations.every(validateObservation)) return { valid: false, error: "INVALID_REPLAY" };
        return { valid: true, error: null };
    }
    function group(values, denominator) {
        var counts = new Map();
        values.forEach(function (value) {
            if (value !== null && value !== undefined && value !== "") counts.set(String(value), (counts.get(String(value)) || 0) + 1);
        });
        return Array.from(counts, function (entry) { return { key: entry[0], count: entry[1], percentage: percent(entry[1], denominator) }; })
            .sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key); });
    }
    function category(item) {
        if (item.category === "FAILURE" || item.comparison === "PIPELINE_FAILED" || item.error) return "PIPELINE_FAILURE";
        if (CATEGORIES.indexOf(item.comparison) >= 0 && item.comparison !== "PIPELINE_FAILURE") return item.comparison;
        if (item.category === "NOT_COMPARABLE" || item.comparison === "NOT_EVALUATED") return "NOT_COMPARABLE";
        return "UNCLASSIFIED_DIAGNOSTIC";
    }
    function priority(value) {
        if (value === "PIPELINE_FAILURE" || value === "LEGACY_ALLOW_GATE_BLOCK") return "HIGH";
        if (value === "LEGACY_BLOCK_GATE_ALLOW") return "MEDIUM";
        if (value === "MATCH_ALLOW" || value === "MATCH_BLOCK") return "INFO";
        return "LOW";
    }
    function legacyReason(item) {
        if (safeText(item.legacyReason, true) && item.legacyReason) return item.legacyReason;
        if (item.legacyDecision === "BLOCK" && safeText(item.reason, true) && item.reason && item.reason !== "VERIFIED_DUAL_DECISION") return item.reason;
        return null;
    }
    function gateReason(item) {
        if (safeText(item.gateReason, true) && item.gateReason) return item.gateReason;
        var evidence = item.gateDecisionEvidence;
        return evidence && safeText(evidence.reason, true) && evidence.reason ? evidence.reason : null;
    }
    function evidence(item, legacyBlockReason, gateBlockReason) {
        var codes = [];
        if (item.legacyDecision) codes.push("LEGACY_DECISION");
        if (item.gateDecision) codes.push("GATE_DECISION");
        if (item.legacyDecisionEvidence && typeof item.legacyDecisionEvidence === "object") codes.push("LEGACY_FILTER_EVIDENCE");
        if (item.legacyDecision === "BLOCK" && legacyBlockReason) codes.push("LEGACY_BLOCK_REASON");
        if (item.gateDecision === "BLOCK" && gateBlockReason) codes.push("GATE_BLOCK_REASON");
        if (item.builderStatus) codes.push("BUILDER_STATUS");
        if (item.candidateKey) codes.push("PENDING_CANDIDATE");
        if (item.legacyDecision && item.gateDecision && item.legacyDecision !== item.gateDecision) codes.push("DECISION_DIVERGENCE");
        if (item.error) codes.push("PIPELINE_ERROR");
        return codes.length ? codes : ["NO_DIRECT_EVIDENCE"];
    }
    function directEvidence(item, legacyBlockReason, gateBlockReason) {
        return { legacyFilterEvidencePresent: !!(item.legacyDecisionEvidence && typeof item.legacyDecisionEvidence === "object"),
            gateEvidencePresent: !!(item.gateDecisionEvidence && typeof item.gateDecisionEvidence === "object"),
            error: item.error || null, legacyReason: legacyBlockReason,
            gateReason: gateBlockReason, builderStatus: item.builderStatus || null, candidateKey: item.candidateKey || null };
    }
    function reviewItem(item) {
        var classified = category(item), legacyBlockReason = legacyReason(item), gateBlockReason = gateReason(item);
        return { key: item.key, symbol: item.symbol, interval: item.interval, evaluationCloseTime: item.evaluationCloseTime,
            category: classified, priority: priority(classified), comparison: item.comparison,
            legacyDecision: item.legacyDecision, gateDecision: item.gateDecision,
            legacyReason: legacyBlockReason, gateReason: gateBlockReason, builderStatus: item.builderStatus || null,
            candidateKey: item.candidateKey || null, evidenceCodes: evidence(item, legacyBlockReason, gateBlockReason),
            directEvidence: directEvidence(item, legacyBlockReason, gateBlockReason), suggestedReview: SUGGESTIONS[classified] };
    }
    function reviewSort(a, b) {
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.evaluationCloseTime - a.evaluationCloseTime ||
            a.symbol.localeCompare(b.symbol) || a.interval.localeCompare(b.interval) || a.key.localeCompare(b.key);
    }
    function analyzeReplay(replayResult) {
        var source, validation;
        try { source = clone(replayResult); validation = validateReplay(source); }
        catch (error) { validation = { valid: false, error: "INVALID_REPLAY" }; }
        if (!validation.valid) return base(false, validation.error, "INVALID_REPLAY");
        var result = base(true, null, "NO_OBSERVATIONS");
        var rows = source.observations.map(reviewItem);
        result.observationCount = rows.length;
        result.matchCount = rows.filter(function (row) { return row.category === "MATCH_ALLOW" || row.category === "MATCH_BLOCK"; }).length;
        result.mismatchCount = rows.filter(function (row) { return row.category === "LEGACY_ALLOW_GATE_BLOCK" || row.category === "LEGACY_BLOCK_GATE_ALLOW"; }).length;
        result.comparableCount = result.matchCount + result.mismatchCount;
        result.failureCount = rows.filter(function (row) { return row.category === "PIPELINE_FAILURE"; }).length;
        result.notComparableCount = rows.filter(function (row) { return row.category === "NOT_COMPARABLE"; }).length;
        result.matchRate = percent(result.matchCount, result.comparableCount);
        result.mismatchRate = percent(result.mismatchCount, result.comparableCount);
        var denominator = rows.length;
        result.byCategory = group(rows.map(function (row) { return row.category; }), denominator);
        result.byPriority = group(rows.map(function (row) { return row.priority; }), denominator);
        result.byMarket = group(rows.map(function (row) { return row.symbol; }), denominator);
        result.byInterval = group(rows.map(function (row) { return row.interval; }), denominator);
        result.byMarketInterval = group(rows.map(function (row) { return row.symbol + "|" + row.interval; }), denominator);
        result.byLegacyDecision = group(rows.map(function (row) { return row.legacyDecision; }), denominator);
        result.byGateDecision = group(rows.map(function (row) { return row.gateDecision; }), denominator);
        result.byLegacyReason = group(rows.map(function (row) { return row.legacyReason; }), denominator);
        result.byGateReason = group(rows.map(function (row) { return row.gateReason; }), denominator);
        result.byBuilderStatus = group(rows.map(function (row) { return row.builderStatus; }), denominator);
        var review = rows.filter(function (row) { return row.category !== "MATCH_ALLOW" && row.category !== "MATCH_BLOCK"; }).sort(reviewSort);
        result.reviewItems = review.slice(0, 100);
        result.failureItems = review.filter(function (row) { return row.category === "PIPELINE_FAILURE"; }).slice(0, 25);
        if (review.length > 100) result.warnings.push("REVIEW_ITEMS_TRUNCATED:" + (review.length - 100));
        if (result.failureCount > 25) result.warnings.push("FAILURE_ITEMS_TRUNCATED:" + (result.failureCount - 25));
        result.status = !rows.length ? "NO_OBSERVATIONS" : result.failureCount ? "FAILURES_FOUND" :
            result.mismatchCount ? "REVIEW_ITEMS_FOUND" : !result.comparableCount ? "NO_COMPARABLE" : "MATCH_ONLY";
        return clone(result);
    }
    function exportAnalysis(analysis) {
        if (!analysis || typeof analysis !== "object" || analysis.schemaVersion !== SCHEMA || analysis.sourceSchemaVersion !== SOURCE_SCHEMA ||
            analysis.source !== SOURCE || analysis.countsTowardLiveReadiness !== false || STATUSES.indexOf(analysis.status) < 0) return null;
        var fields = ["valid", "error", "schemaVersion", "sourceSchemaVersion", "source", "countsTowardLiveReadiness", "status",
            "observationCount", "comparableCount", "matchCount", "mismatchCount", "failureCount", "notComparableCount",
            "matchRate", "mismatchRate", "percentageDenominator", "byCategory", "byPriority", "byMarket", "byInterval",
            "byMarketInterval", "byLegacyDecision", "byGateDecision", "byLegacyReason", "byGateReason", "byBuilderStatus",
            "reviewItems", "failureItems", "warnings", "disclaimer"];
        var safe = {};
        fields.forEach(function (field) { safe[field] = clone(analysis[field]); });
        return JSON.stringify(safe, null, 2);
    }
    return { getSchemaVersion: function () { return SCHEMA; }, getVocabulary: function () {
        return clone({ schemaVersion: SCHEMA, sourceSchemaVersion: SOURCE_SCHEMA, statuses: STATUSES,
            categories: CATEGORIES, priorities: PRIORITIES, evidenceCodes: EVIDENCE_CODES });
    }, analyzeReplay: analyzeReplay, exportAnalysis: exportAnalysis };
}));
