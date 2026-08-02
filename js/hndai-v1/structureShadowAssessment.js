(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureShadowAssessment = api;
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_ASSESSMENT_V1";
    var SOURCE_SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_TELEMETRY_V1";
    var DISCLAIMER = "Diagnostic observation criteria only; this result does not authorize entries or trading.";
    var CAPACITY = 200;
    var DEFAULT_CRITERIA = {
        minObservationCount: 100, minComparableCount: 50,
        minMarketCount: 3, minIntervalCount: 2,
        maxMismatchRate: 5, maxFailureRate: 2
    };
    var CRITERIA_FIELDS = Object.keys(DEFAULT_CRITERIA);
    var SUMMARY_FIELDS = [
        "observationCount", "comparableCount", "matchCount", "mismatchCount",
        "failedCount", "notApplicableCount", "notComparableCount",
        "matchAllowCount", "matchBlockCount", "legacyAllowGateBlockCount",
        "legacyBlockGateAllowCount", "matchRate", "mismatchRate",
        "latestObservation", "markets", "intervals", "capacity", "droppedCount"
    ];
    var OBSERVATION_FIELDS = [
        "key", "symbol", "interval", "evaluationCloseTime", "observedAt", "shadow"
    ];
    var SHADOW_FIELDS = [
        "enabled", "status", "reason", "mode", "legacyDecision", "gateDecision",
        "comparison", "wouldChangeDecision", "gateReason", "error", "failedStage",
        "candidateKey"
    ];
    var COMPARISONS = [
        "MATCH_ALLOW", "MATCH_BLOCK", "LEGACY_ALLOW_GATE_BLOCK",
        "LEGACY_BLOCK_GATE_ALLOW", "NOT_COMPARABLE", "NOT_APPLICABLE",
        "PIPELINE_FAILED"
    ];

    function clone(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }

    function exactFields(value, fields) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort();
        var expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (field, index) {
            return keys[index] === field;
        });
    }

    function safePositiveInteger(value) {
        return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    }

    function optionalString(value) {
        return value === null || (typeof value === "string" && value.length > 0);
    }

    function percentage(numerator, denominator) {
        if (!denominator) return null;
        return Math.round((numerator / denominator) * 10000) / 100;
    }

    function validShadow(shadow) {
        if (!exactFields(shadow, SHADOW_FIELDS) || shadow.enabled !== true ||
            shadow.mode !== "SHADOW" || ["COMPLETED", "FAILED", "NOT_APPLICABLE"].indexOf(shadow.status) === -1 ||
            COMPARISONS.indexOf(shadow.comparison) === -1 ||
            !optionalString(shadow.reason) || !optionalString(shadow.gateReason) ||
            !optionalString(shadow.error) || !optionalString(shadow.failedStage) ||
            !optionalString(shadow.candidateKey) || typeof shadow.wouldChangeDecision !== "boolean") return false;
        if (shadow.status === "NOT_APPLICABLE") {
            return shadow.comparison === "NOT_APPLICABLE" && shadow.gateDecision === null &&
                (shadow.legacyDecision === null || ["ALLOW", "BLOCK"].indexOf(shadow.legacyDecision) >= 0) &&
                shadow.wouldChangeDecision === false;
        }
        if (["ALLOW", "BLOCK"].indexOf(shadow.legacyDecision) === -1 ||
            (shadow.gateDecision !== null && ["ALLOW", "BLOCK"].indexOf(shadow.gateDecision) === -1)) return false;
        var expected = {
            MATCH_ALLOW: ["ALLOW", "ALLOW", false], MATCH_BLOCK: ["BLOCK", "BLOCK", false],
            LEGACY_ALLOW_GATE_BLOCK: ["ALLOW", "BLOCK", true],
            LEGACY_BLOCK_GATE_ALLOW: ["BLOCK", "ALLOW", true]
        }[shadow.comparison];
        if (expected) return shadow.status === "COMPLETED" && shadow.legacyDecision === expected[0] &&
            shadow.gateDecision === expected[1] && shadow.wouldChangeDecision === expected[2];
        if (shadow.comparison === "PIPELINE_FAILED") {
            return shadow.status === "FAILED" && shadow.gateDecision === null &&
                shadow.wouldChangeDecision === false;
        }
        return shadow.comparison === "NOT_COMPARABLE" && shadow.status === "COMPLETED" &&
            shadow.gateDecision === null && shadow.wouldChangeDecision === false;
    }

    function validObservation(item) {
        if (!exactFields(item, OBSERVATION_FIELDS) ||
            typeof item.symbol !== "string" || !/^[A-Z0-9]+$/.test(item.symbol) ||
            item.symbol !== item.symbol.trim().toUpperCase() ||
            typeof item.interval !== "string" || !item.interval || item.interval !== item.interval.trim() ||
            !safePositiveInteger(item.evaluationCloseTime) || !safePositiveInteger(item.observedAt) ||
            item.key !== [item.symbol, item.interval, item.evaluationCloseTime].join("|")) return false;
        return validShadow(item.shadow);
    }

    function recompute(observations) {
        var comparisons = observations.map(function (item) { return item.shadow.comparison; });
        function count(value) { return comparisons.filter(function (item) { return item === value; }).length; }
        var matchAllowCount = count("MATCH_ALLOW");
        var matchBlockCount = count("MATCH_BLOCK");
        var legacyAllowGateBlockCount = count("LEGACY_ALLOW_GATE_BLOCK");
        var legacyBlockGateAllowCount = count("LEGACY_BLOCK_GATE_ALLOW");
        var matchCount = matchAllowCount + matchBlockCount;
        var mismatchCount = legacyAllowGateBlockCount + legacyBlockGateAllowCount;
        var comparableCount = matchCount + mismatchCount;
        var failedCount = observations.filter(function (item) {
            return item.shadow.status === "FAILED" || item.shadow.comparison === "PIPELINE_FAILED";
        }).length;
        return {
            observationCount: observations.length, comparableCount: comparableCount,
            matchCount: matchCount, mismatchCount: mismatchCount, failedCount: failedCount,
            notApplicableCount: count("NOT_APPLICABLE"), notComparableCount: count("NOT_COMPARABLE"),
            matchAllowCount: matchAllowCount, matchBlockCount: matchBlockCount,
            legacyAllowGateBlockCount: legacyAllowGateBlockCount,
            legacyBlockGateAllowCount: legacyBlockGateAllowCount,
            matchRate: percentage(matchCount, comparableCount),
            mismatchRate: percentage(mismatchCount, comparableCount),
            latestObservation: observations.length ? clone(observations[observations.length - 1]) : null,
            markets: Array.from(new Set(observations.map(function (item) { return item.symbol; }))).sort(),
            intervals: Array.from(new Set(observations.map(function (item) { return item.interval; }))).sort(),
            capacity: CAPACITY
        };
    }

    function invalidValidation(error, mismatches) {
        return { valid: false, error: error, schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: null, recomputedSummary: null, mismatches: mismatches || [] };
    }

    function validateSnapshot(snapshot) {
        try {
            var input = clone(snapshot);
            if (!exactFields(input, ["schemaVersion", "summary", "observations"])) return invalidValidation("INVALID_SNAPSHOT");
            if (input.schemaVersion !== SOURCE_SCHEMA_VERSION) return invalidValidation("INVALID_SCHEMA_VERSION");
            if (!Array.isArray(input.observations)) return invalidValidation("INVALID_OBSERVATIONS");
            if (input.observations.length > CAPACITY) return invalidValidation("OBSERVATION_LIMIT_EXCEEDED");
            var keys = new Set();
            for (var index = 0; index < input.observations.length; index += 1) {
                if (!validObservation(input.observations[index])) return invalidValidation("INVALID_OBSERVATION");
                if (keys.has(input.observations[index].key)) return invalidValidation("DUPLICATE_OBSERVATION_KEY");
                keys.add(input.observations[index].key);
            }
            if (!exactFields(input.summary, SUMMARY_FIELDS) ||
                !Number.isSafeInteger(input.summary.droppedCount) || input.summary.droppedCount < 0) {
                return invalidValidation("INVALID_SUMMARY");
            }
            var calculated = recompute(input.observations);
            var mismatches = Object.keys(calculated).filter(function (field) {
                return JSON.stringify(input.summary[field]) !== JSON.stringify(calculated[field]);
            }).map(function (field) {
                return { field: field, actual: clone(input.summary[field]), expected: clone(calculated[field]) };
            });
            if (mismatches.length) return {
                valid: false, error: "SUMMARY_MISMATCH", schemaVersion: SCHEMA_VERSION,
                sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
                recomputedSummary: clone(calculated), mismatches: mismatches
            };
            calculated.droppedCount = input.summary.droppedCount;
            return { valid: true, error: null, schemaVersion: SCHEMA_VERSION,
                sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
                recomputedSummary: clone(calculated), mismatches: [] };
        } catch (error) {
            return invalidValidation("INVALID_SNAPSHOT");
        }
    }

    function validateCriteria(criteria) {
        if (!exactFields(criteria, CRITERIA_FIELDS)) return false;
        return ["minObservationCount", "minComparableCount", "minMarketCount", "minIntervalCount"].every(function (field) {
            return typeof criteria[field] === "number" && Number.isSafeInteger(criteria[field]) && criteria[field] >= 0;
        }) && ["maxMismatchRate", "maxFailureRate"].every(function (field) {
            return typeof criteria[field] === "number" && Number.isFinite(criteria[field]) &&
                criteria[field] >= 0 && criteria[field] <= 100;
        });
    }

    function assessmentBase(validation, criteria) {
        return {
            valid: false, error: validation.error, schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: validation.sourceSchemaVersion, status: "INVALID_SNAPSHOT",
            criteria: criteria, recomputedSummary: validation.recomputedSummary,
            failureRate: null, checks: [], failedChecks: [],
            warnings: validation.mismatches || [], disclaimer: DISCLAIMER
        };
    }

    function assessSnapshot(snapshot, criteria) {
        var selected;
        try { selected = criteria === undefined ? clone(DEFAULT_CRITERIA) : clone(criteria); }
        catch (error) { selected = criteria; }
        var validation = validateSnapshot(snapshot);
        var result = assessmentBase(validation, selected);
        if (!validation.valid) return clone(result);
        result.sourceSchemaVersion = SOURCE_SCHEMA_VERSION;
        result.error = null;
        if (!validateCriteria(selected)) {
            result.error = "INVALID_CRITERIA";
            result.status = "INVALID_CRITERIA";
            return clone(result);
        }
        var summary = validation.recomputedSummary;
        var failureRate = percentage(summary.failedCount, summary.observationCount);
        result.failureRate = failureRate;
        function check(name, actual, expected, pass) {
            return { name: name, actual: actual, expected: expected, pass: pass };
        }
        result.checks = [
            check("MIN_OBSERVATION_COUNT", summary.observationCount, selected.minObservationCount, summary.observationCount >= selected.minObservationCount),
            check("MIN_COMPARABLE_COUNT", summary.comparableCount, selected.minComparableCount, summary.comparableCount >= selected.minComparableCount),
            check("MIN_MARKET_COUNT", summary.markets.length, selected.minMarketCount, summary.markets.length >= selected.minMarketCount),
            check("MIN_INTERVAL_COUNT", summary.intervals.length, selected.minIntervalCount, summary.intervals.length >= selected.minIntervalCount),
            check("MAX_MISMATCH_RATE", summary.mismatchRate, selected.maxMismatchRate, summary.mismatchRate !== null && summary.mismatchRate <= selected.maxMismatchRate),
            check("MAX_FAILURE_RATE", failureRate, selected.maxFailureRate, failureRate !== null && failureRate <= selected.maxFailureRate)
        ];
        result.failedChecks = result.checks.filter(function (item) { return !item.pass; }).map(function (item) { return item.name; });
        var minimumFailed = result.checks.slice(0, 4).some(function (item) { return !item.pass; });
        result.status = minimumFailed ? "INSUFFICIENT_DATA" :
            result.checks.slice(4).some(function (item) { return !item.pass; })
                ? "REVIEW_REQUIRED" : "OBSERVATION_CRITERIA_MET";
        result.valid = true;
        return clone(result);
    }

    function getVocabulary() {
        return clone({
            schemaVersion: SCHEMA_VERSION, sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            statuses: ["INVALID_SNAPSHOT", "INVALID_CRITERIA", "INSUFFICIENT_DATA", "REVIEW_REQUIRED", "OBSERVATION_CRITERIA_MET"],
            comparisons: COMPARISONS
        });
    }

    return {
        getSchemaVersion: function () { return SCHEMA_VERSION; },
        getVocabulary: getVocabulary,
        getDefaultCriteria: function () { return clone(DEFAULT_CRITERIA); },
        validateSnapshot: validateSnapshot,
        assessSnapshot: assessSnapshot
    };
}));
