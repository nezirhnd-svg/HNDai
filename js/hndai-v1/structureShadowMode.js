(function (root, factory) {
    "use strict";
    var orchestrator = null;
    if (typeof module === "object" && module.exports) {
        orchestrator = require("./structurePipelineOrchestrator.js");
    } else if (root && typeof root === "object") {
        orchestrator = root.HNDStructurePipelineOrchestrator;
    }
    var api = factory(orchestrator);
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === "object") {
        root.HNDStructureShadowMode = api;
    }
}(typeof window !== "undefined" ? window : null, function (orchestrator) {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_MODE_V1";
    var FEATURE_FIELDS = ["structureShadowEnabled"];
    var LEGACY_FIELDS = ["decision", "reason", "candidate"];
    var DECISIONS = ["ALLOW", "BLOCK"];

    function getSchemaVersion() {
        return SCHEMA_VERSION;
    }

    function getVocabulary() {
        return {
            modes: ["OFF", "SHADOW"],
            decisions: DECISIONS.slice(),
            comparisons: [
                "NOT_EVALUATED", "NOT_COMPARABLE", "MATCH_ALLOW", "MATCH_BLOCK",
                "LEGACY_ALLOW_GATE_BLOCK", "LEGACY_BLOCK_GATE_ALLOW", "PIPELINE_FAILED"
            ],
            statuses: ["DISABLED", "COMPLETED", "FAILED"]
        };
    }

    function clone(value) {
        if (value === null || value === undefined) {
            return value;
        }
        return JSON.parse(JSON.stringify(value));
    }

    function exactFields(value, fields) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return false;
        }
        var keys = Object.keys(value).sort();
        var expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (field, index) {
            return keys[index] === field;
        });
    }

    function diagnostics() {
        return {
            evaluated: false,
            comparable: false,
            pipelineValid: null,
            pipelineReady: null,
            pipelineError: null,
            failedStage: null,
            stageError: null,
            gateValid: null,
            gateReady: null,
            mismatch: false
        };
    }

    function base(legacyResult) {
        var decision = legacyResult && DECISIONS.indexOf(legacyResult.decision) !== -1
            ? legacyResult.decision : null;
        var reason = legacyResult &&
            (legacyResult.reason === null ||
                (typeof legacyResult.reason === "string" && legacyResult.reason.length > 0))
            ? legacyResult.reason : null;
        var candidate = legacyResult && legacyResult.candidate &&
            typeof legacyResult.candidate === "object" && !Array.isArray(legacyResult.candidate)
            ? legacyResult.candidate : null;
        return {
            valid: false,
            error: null,
            ready: false,
            schemaVersion: SCHEMA_VERSION,
            mode: "OFF",
            status: "FAILED",
            enabled: false,
            legacyDecision: decision,
            legacyReason: reason,
            gateDecision: null,
            gateReason: null,
            effectiveDecision: decision,
            effectiveReason: reason,
            comparison: "NOT_EVALUATED",
            wouldChangeDecision: false,
            candidateKey: candidate && typeof candidate.key === "string" && candidate.key.length > 0
                ? String(candidate.key) : null,
            pipelineEvaluation: null,
            diagnostics: diagnostics()
        };
    }

    function failure(error, legacyResult, enabled) {
        var output = base(legacyResult);
        output.error = error;
        output.enabled = enabled === true;
        output.mode = enabled === true ? "SHADOW" : "OFF";
        return output;
    }

    function legacyError(value) {
        if (!exactFields(value, LEGACY_FIELDS)) {
            return "INVALID_LEGACY_RESULT";
        }
        if (DECISIONS.indexOf(value.decision) === -1) {
            return "INVALID_LEGACY_DECISION";
        }
        if (value.reason !== null &&
            (typeof value.reason !== "string" || value.reason.length === 0)) {
            return "INVALID_LEGACY_REASON";
        }
        if (value.decision === "ALLOW" && value.candidate === null) {
            return "LEGACY_CANDIDATE_REQUIRED";
        }
        if (value.candidate !== null &&
            (!value.candidate || typeof value.candidate !== "object" ||
                Array.isArray(value.candidate))) {
            return "INVALID_LEGACY_CANDIDATE";
        }
        return null;
    }

    function comparison(legacy, gate) {
        if (legacy === "ALLOW" && gate === "ALLOW") { return "MATCH_ALLOW"; }
        if (legacy === "BLOCK" && gate === "BLOCK") { return "MATCH_BLOCK"; }
        if (legacy === "ALLOW") { return "LEGACY_ALLOW_GATE_BLOCK"; }
        return "LEGACY_BLOCK_GATE_ALLOW";
    }

    function runShadow(rawCandles, analysisContext, legacyResult,
        evaluationContext, featureFlags) {
        var output;
        var error;
        var result;
        var gateValid;
        if (!exactFields(featureFlags, FEATURE_FIELDS) ||
            typeof featureFlags.structureShadowEnabled !== "boolean") {
            return failure("INVALID_FEATURE_FLAGS", legacyResult, false);
        }
        error = legacyError(legacyResult);
        if (error) {
            return failure(error, legacyResult, featureFlags.structureShadowEnabled);
        }
        output = base(legacyResult);
        output.valid = true;
        output.error = null;
        output.enabled = featureFlags.structureShadowEnabled;
        if (!featureFlags.structureShadowEnabled) {
            output.status = "DISABLED";
            return output;
        }
        output.mode = "SHADOW";
        if (legacyResult.candidate === null) {
            output.status = "COMPLETED";
            output.comparison = "NOT_COMPARABLE";
            return output;
        }
        if (!orchestrator ||
            typeof orchestrator.evaluateSetupCandidate !== "function") {
            return failure("ORCHESTRATOR_DEPENDENCY_INVALID", legacyResult, true);
        }
        output.diagnostics.evaluated = true;
        output.diagnostics.comparable = true;
        try {
            result = orchestrator.evaluateSetupCandidate(
                clone(rawCandles), clone(analysisContext),
                clone(legacyResult.candidate), clone(evaluationContext));
            output.pipelineEvaluation = clone(result);
        } catch (exception) {
            output = failure("SHADOW_EVALUATION_FAILED", legacyResult, true);
            output.diagnostics.evaluated = true;
            output.diagnostics.comparable = true;
            return output;
        }
        if (!result || typeof result !== "object" || Array.isArray(result) ||
            typeof result.valid !== "boolean" || typeof result.ready !== "boolean") {
            output.status = "COMPLETED";
            output.comparison = "PIPELINE_FAILED";
            output.diagnostics.pipelineValid = false;
            output.diagnostics.pipelineReady = false;
            output.diagnostics.pipelineError = "DEPENDENCY_RESULT_INVALID";
            output.diagnostics.gateValid = false;
            output.diagnostics.gateReady = false;
            return output;
        }
        output.diagnostics.pipelineValid = result.valid;
        output.diagnostics.pipelineReady = result.ready;
        output.diagnostics.pipelineError = result.error === undefined ? null : clone(result.error);
        output.diagnostics.failedStage = result.failedStage === undefined ? null : clone(result.failedStage);
        output.diagnostics.stageError = result.stageError === undefined ? null : clone(result.stageError);
        gateValid = result.valid === true && DECISIONS.indexOf(result.gateDecision) !== -1 &&
            typeof result.gateReason === "string" && result.gateReason.length > 0;
        output.diagnostics.gateValid = gateValid;
        output.diagnostics.gateReady = gateValid ? result.ready : false;
        output.status = "COMPLETED";
        if (!gateValid) {
            output.comparison = "PIPELINE_FAILED";
            return output;
        }
        output.ready = result.ready;
        output.gateDecision = result.gateDecision;
        output.gateReason = result.gateReason;
        output.comparison = comparison(legacyResult.decision, result.gateDecision);
        output.wouldChangeDecision = legacyResult.decision !== result.gateDecision;
        output.diagnostics.mismatch = output.wouldChangeDecision;
        return output;
    }

    return {
        getSchemaVersion: getSchemaVersion,
        getVocabulary: getVocabulary,
        runShadow: runShadow
    };
}));
