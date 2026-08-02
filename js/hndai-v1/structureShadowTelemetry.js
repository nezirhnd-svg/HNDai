(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === "object") {
        root.HNDStructureShadowTelemetry = api;
    }
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_TELEMETRY_V1";
    var CAPACITY = 200;
    var OBSERVATION_FIELDS = [
        "symbol", "interval", "evaluationCloseTime", "observedAt", "shadow"
    ];
    var COMPARISONS = [
        "MATCH_ALLOW", "MATCH_BLOCK", "LEGACY_ALLOW_GATE_BLOCK",
        "LEGACY_BLOCK_GATE_ALLOW", "NOT_COMPARABLE", "PIPELINE_FAILED"
    ];
    var observations = [];
    var droppedCount = 0;

    function clone(value) {
        if (value === null || value === undefined) return value;
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

    function validOptionalString(value) {
        return value === null || (typeof value === "string" && value.length > 0);
    }

    function projectShadow(source) {
        var result;
        var comparison;
        if (!source || typeof source !== "object" || Array.isArray(source) ||
            source.enabled !== true ||
            ["COMPLETED", "FAILED", "NOT_APPLICABLE"].indexOf(source.status) === -1 ||
            !validOptionalString(source.reason === undefined ? null : source.reason)) {
            return null;
        }
        result = source.shadowResult;
        if (source.status === "NOT_APPLICABLE") {
            if (result !== null && result !== undefined) return null;
            return {
                enabled: true, status: "NOT_APPLICABLE", reason: source.reason || null,
                mode: "SHADOW", legacyDecision: source.legacyResult &&
                    ["ALLOW", "BLOCK"].indexOf(source.legacyResult.decision) !== -1
                    ? source.legacyResult.decision : null,
                gateDecision: null, comparison: "NOT_APPLICABLE",
                wouldChangeDecision: false, gateReason: null, error: null,
                failedStage: null, candidateKey: source.legacyResult &&
                    typeof source.legacyResult.candidate?.key === "string"
                    ? source.legacyResult.candidate.key : null
            };
        }
        if (source.status === "FAILED" &&
            (result === null || result === undefined)) {
            return {
                enabled: true, status: "FAILED", reason: source.reason || null,
                mode: "SHADOW", legacyDecision: source.legacyResult &&
                    ["ALLOW", "BLOCK"].indexOf(source.legacyResult.decision) !== -1
                    ? source.legacyResult.decision : null,
                gateDecision: null, comparison: "PIPELINE_FAILED",
                wouldChangeDecision: false, gateReason: null,
                error: source.reason || "SHADOW_EVALUATION_FAILED",
                failedStage: null, candidateKey: source.legacyResult &&
                    typeof source.legacyResult.candidate?.key === "string"
                    ? source.legacyResult.candidate.key : null
            };
        }
        if (!result || typeof result !== "object" || Array.isArray(result) ||
            result.mode !== "SHADOW" ||
            ["COMPLETED", "FAILED"].indexOf(result.status) === -1 ||
            !validOptionalString(result.error === undefined ? null : result.error)) {
            return null;
        }
        comparison = result.status === "FAILED" && result.comparison === "NOT_EVALUATED"
            ? "PIPELINE_FAILED" : result.comparison;
        if (COMPARISONS.indexOf(comparison) === -1 ||
            ["ALLOW", "BLOCK"].indexOf(result.legacyDecision) === -1 ||
            (result.gateDecision !== null &&
                ["ALLOW", "BLOCK"].indexOf(result.gateDecision) === -1) ||
            typeof result.wouldChangeDecision !== "boolean") {
            return null;
        }
        return {
            enabled: true,
            status: source.status === "FAILED" || result.status === "FAILED"
                ? "FAILED" : "COMPLETED",
            reason: source.reason || null,
            mode: "SHADOW",
            legacyDecision: result.legacyDecision,
            gateDecision: result.gateDecision,
            comparison: comparison,
            wouldChangeDecision: result.wouldChangeDecision,
            gateReason: typeof result.gateReason === "string" && result.gateReason
                ? result.gateReason : null,
            error: result.error || null,
            failedStage: typeof result.diagnostics?.failedStage === "string" &&
                result.diagnostics.failedStage ? result.diagnostics.failedStage : null,
            candidateKey: typeof result.candidateKey === "string" && result.candidateKey
                ? result.candidateKey : null
        };
    }

    function invalid(error) {
        return {
            valid: false, error: error, recorded: false, replaced: false,
            key: null, observationCount: observations.length
        };
    }

    function record(observation) {
        var input;
        var shadow;
        var key;
        var index;
        if (!exactFields(observation, OBSERVATION_FIELDS)) {
            return invalid("INVALID_OBSERVATION");
        }
        try { input = clone(observation); }
        catch (error) { return invalid("INVALID_OBSERVATION"); }
        if (typeof input.symbol !== "string" || !/^[A-Z0-9]+$/.test(input.symbol) ||
            input.symbol !== input.symbol.trim().toUpperCase() ||
            typeof input.interval !== "string" || !input.interval ||
            input.interval !== input.interval.trim() ||
            !safePositiveInteger(input.evaluationCloseTime) ||
            !safePositiveInteger(input.observedAt)) {
            return invalid("INVALID_OBSERVATION");
        }
        if (input.shadow && (input.shadow.enabled === false ||
            input.shadow.status === "DISABLED")) {
            return {
                valid: true, error: null, recorded: false, replaced: false,
                key: null, observationCount: observations.length
            };
        }
        shadow = projectShadow(input.shadow);
        if (!shadow) return invalid("INVALID_SHADOW_DIAGNOSTIC");
        key = [input.symbol, input.interval, input.evaluationCloseTime].join("|");
        index = observations.findIndex(function (item) { return item.key === key; });
        var stored = {
            key: key, symbol: input.symbol, interval: input.interval,
            evaluationCloseTime: input.evaluationCloseTime,
            observedAt: input.observedAt, shadow: shadow
        };
        if (index >= 0) {
            observations[index] = stored;
        } else {
            observations.push(stored);
            if (observations.length > CAPACITY) {
                observations.shift();
                droppedCount += 1;
            }
        }
        return {
            valid: true, error: null, recorded: true, replaced: index >= 0,
            key: key, observationCount: observations.length
        };
    }

    function percentage(numerator, denominator) {
        if (!denominator) return null;
        return Math.round((numerator / denominator) * 10000) / 100;
    }

    function getSummary() {
        var comparisons = observations.map(function (item) {
            return item.shadow.comparison;
        });
        var matchAllowCount = comparisons.filter(function (value) {
            return value === "MATCH_ALLOW";
        }).length;
        var matchBlockCount = comparisons.filter(function (value) {
            return value === "MATCH_BLOCK";
        }).length;
        var legacyAllowGateBlockCount = comparisons.filter(function (value) {
            return value === "LEGACY_ALLOW_GATE_BLOCK";
        }).length;
        var legacyBlockGateAllowCount = comparisons.filter(function (value) {
            return value === "LEGACY_BLOCK_GATE_ALLOW";
        }).length;
        var matchCount = matchAllowCount + matchBlockCount;
        var mismatchCount = legacyAllowGateBlockCount + legacyBlockGateAllowCount;
        var comparableCount = matchCount + mismatchCount;
        var failedCount = observations.filter(function (item) {
            return item.shadow.status === "FAILED" ||
                item.shadow.comparison === "PIPELINE_FAILED";
        }).length;
        var notApplicableCount = comparisons.filter(function (value) {
            return value === "NOT_APPLICABLE";
        }).length;
        var notComparableCount = comparisons.filter(function (value) {
            return value === "NOT_COMPARABLE";
        }).length;
        return {
            observationCount: observations.length,
            comparableCount: comparableCount,
            matchCount: matchCount,
            mismatchCount: mismatchCount,
            failedCount: failedCount,
            notApplicableCount: notApplicableCount,
            notComparableCount: notComparableCount,
            matchAllowCount: matchAllowCount,
            matchBlockCount: matchBlockCount,
            legacyAllowGateBlockCount: legacyAllowGateBlockCount,
            legacyBlockGateAllowCount: legacyBlockGateAllowCount,
            matchRate: percentage(matchCount, comparableCount),
            mismatchRate: percentage(mismatchCount, comparableCount),
            latestObservation: observations.length
                ? clone(observations[observations.length - 1]) : null,
            markets: Array.from(new Set(observations.map(function (item) {
                return item.symbol;
            }))).sort(),
            intervals: Array.from(new Set(observations.map(function (item) {
                return item.interval;
            }))).sort(),
            capacity: CAPACITY,
            droppedCount: droppedCount
        };
    }

    function getObservations() {
        return clone(observations);
    }

    function reset(reason) {
        observations = [];
        droppedCount = 0;
        return {
            valid: true, error: null,
            reason: typeof reason === "string" && reason ? reason : "MANUAL_RESET",
            observationCount: 0
        };
    }

    function exportSnapshot() {
        return {
            schemaVersion: SCHEMA_VERSION,
            summary: getSummary(),
            observations: getObservations()
        };
    }

    function getSchemaVersion() {
        return SCHEMA_VERSION;
    }

    return {
        record: record,
        getSummary: getSummary,
        getObservations: getObservations,
        reset: reset,
        exportSnapshot: exportSnapshot,
        getSchemaVersion: getSchemaVersion
    };
}));
