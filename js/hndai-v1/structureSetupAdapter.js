(function (root, factory) {
    "use strict";
    var gate = null;
    if (typeof module === "object" && module.exports) {
        gate = require("./structureSetupGate.js");
    } else if (root && typeof root === "object") {
        gate = root.HNDStructureSetupGate;
    }
    var api = factory(gate);
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === "object") {
        root.HNDStructureSetupAdapter = api;
    }
}(typeof window !== "undefined" ? window : null, function (structureSetupGate) {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_SETUP_ADAPTER_V1";
    var TARGET_SCHEMA_VERSION = "HND_STRUCTURE_SETUP_GATE_V1";
    var CONTEXT_FIELDS = [
        "symbol", "interval", "evaluationAtIndex",
        "evaluationOpenTime", "evaluationCloseTime"
    ];

    function getSchemaVersion() {
        return SCHEMA_VERSION;
    }

    function getVocabulary() {
        return {
            targetSchemas: [TARGET_SCHEMA_VERSION],
            directions: ["LONG", "SHORT"],
            sourceCandidateFields: [
                "key", "direction", "structureEventId",
                "structureConfirmationIndex"
            ],
            evaluationContextFields: CONTEXT_FIELDS.slice(),
            gateCandidateFields: [
                "id", "symbol", "interval", "direction", "structureEventId",
                "evaluationAtIndex", "evaluationOpenTime", "evaluationCloseTime"
            ]
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
        return keys.length === expected.length &&
            expected.every(function (field, index) {
                return keys[index] === field;
            });
    }

    function safeInteger(value) {
        return typeof value === "number" &&
            Number.isSafeInteger(value) && value >= 0;
    }

    function baseAdaptation() {
        return {
            valid: false,
            error: null,
            ready: false,
            schemaVersion: SCHEMA_VERSION,
            targetSchemaVersion: TARGET_SCHEMA_VERSION,
            sourceCandidateKey: null,
            sourceDirection: null,
            sourceStructureEventId: null,
            sourceStructureConfirmationIndex: null,
            evaluationContext: null,
            gateCandidate: null
        };
    }

    function adaptationFailure(error, metadata, context) {
        var output = baseAdaptation();
        output.error = error;
        if (metadata) {
            output.sourceCandidateKey = metadata.key;
            output.sourceDirection = metadata.direction;
            output.sourceStructureEventId = metadata.structureEventId;
            output.sourceStructureConfirmationIndex =
                metadata.structureConfirmationIndex;
        }
        output.evaluationContext = context ? clone(context) : null;
        return output;
    }

    function validContextShape(context) {
        return exactFields(context, CONTEXT_FIELDS) &&
            typeof context.symbol === "string" && context.symbol.length > 0 &&
            context.symbol === context.symbol.trim().toUpperCase() &&
            typeof context.interval === "string" && context.interval.length > 0 &&
            context.interval === context.interval.trim();
    }

    function adaptCandidate(candidate, evaluationContext) {
        var metadata;
        var context;
        var output;
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
            return adaptationFailure("INVALID_SOURCE_CANDIDATE", null, null);
        }
        if (typeof candidate.key !== "string" || candidate.key.length === 0) {
            return adaptationFailure("INVALID_CANDIDATE_KEY", null, null);
        }
        if (["LONG", "SHORT"].indexOf(candidate.direction) === -1) {
            return adaptationFailure("INVALID_CANDIDATE_DIRECTION", {
                key: candidate.key,
                direction: null,
                structureEventId: null,
                structureConfirmationIndex: null
            }, null);
        }
        if (typeof candidate.structureEventId !== "string" ||
            candidate.structureEventId.length === 0) {
            return adaptationFailure("INVALID_STRUCTURE_EVENT_ID", {
                key: candidate.key,
                direction: candidate.direction,
                structureEventId: null,
                structureConfirmationIndex: null
            }, null);
        }
        if (!safeInteger(candidate.structureConfirmationIndex)) {
            return adaptationFailure("INVALID_STRUCTURE_CONFIRMATION_INDEX", {
                key: candidate.key,
                direction: candidate.direction,
                structureEventId: candidate.structureEventId,
                structureConfirmationIndex: null
            }, null);
        }
        metadata = {
            key: candidate.key,
            direction: candidate.direction,
            structureEventId: candidate.structureEventId,
            structureConfirmationIndex: candidate.structureConfirmationIndex
        };
        if (!validContextShape(evaluationContext)) {
            return adaptationFailure("INVALID_EVALUATION_CONTEXT", metadata, null);
        }
        context = {
            symbol: evaluationContext.symbol,
            interval: evaluationContext.interval,
            evaluationAtIndex: evaluationContext.evaluationAtIndex,
            evaluationOpenTime: evaluationContext.evaluationOpenTime,
            evaluationCloseTime: evaluationContext.evaluationCloseTime
        };
        if (!safeInteger(context.evaluationAtIndex)) {
            return adaptationFailure("INVALID_EVALUATION_INDEX", metadata, null);
        }
        if (!safeInteger(context.evaluationOpenTime) ||
            !safeInteger(context.evaluationCloseTime) ||
            context.evaluationOpenTime >= context.evaluationCloseTime) {
            return adaptationFailure("INVALID_EVALUATION_TIME", metadata, null);
        }
        if (metadata.structureConfirmationIndex > context.evaluationAtIndex) {
            return adaptationFailure("FUTURE_STRUCTURE_CONFIRMATION",
                metadata, context);
        }
        output = baseAdaptation();
        output.valid = true;
        output.ready = true;
        output.sourceCandidateKey = metadata.key;
        output.sourceDirection = metadata.direction;
        output.sourceStructureEventId = metadata.structureEventId;
        output.sourceStructureConfirmationIndex =
            metadata.structureConfirmationIndex;
        output.evaluationContext = clone(context);
        output.gateCandidate = {
            id: metadata.key,
            symbol: context.symbol,
            interval: context.interval,
            direction: metadata.direction,
            structureEventId: metadata.structureEventId,
            evaluationAtIndex: context.evaluationAtIndex,
            evaluationOpenTime: context.evaluationOpenTime,
            evaluationCloseTime: context.evaluationCloseTime
        };
        return output;
    }

    function evaluationFailure(error, adaptation) {
        return {
            valid: false,
            error: error,
            ready: false,
            schemaVersion: SCHEMA_VERSION,
            adaptation: clone(adaptation),
            gateResult: null
        };
    }

    function evaluateCandidate(structureSnapshotResult, candidate,
        evaluationContext) {
        var adaptation = adaptCandidate(candidate, evaluationContext);
        var gateResult;
        if (!adaptation.valid) {
            return evaluationFailure(adaptation.error, adaptation);
        }
        if (!structureSetupGate ||
            typeof structureSetupGate.evaluateSetup !== "function" ||
            typeof structureSetupGate.getSchemaVersion !== "function") {
            return evaluationFailure("GATE_DEPENDENCY_INVALID", adaptation);
        }
        try {
            if (structureSetupGate.getSchemaVersion() !== TARGET_SCHEMA_VERSION) {
                return evaluationFailure("GATE_DEPENDENCY_INVALID", adaptation);
            }
        } catch (error) {
            return evaluationFailure("GATE_DEPENDENCY_INVALID", adaptation);
        }
        try {
            gateResult = structureSetupGate.evaluateSetup(
                structureSnapshotResult, clone(adaptation.gateCandidate));
            if (!gateResult || typeof gateResult !== "object" ||
                Array.isArray(gateResult) ||
                typeof gateResult.valid !== "boolean" ||
                typeof gateResult.ready !== "boolean") {
                return evaluationFailure("GATE_EVALUATION_FAILED", adaptation);
            }
            return {
                valid: gateResult.valid,
                error: gateResult.error,
                ready: gateResult.ready,
                schemaVersion: SCHEMA_VERSION,
                adaptation: clone(adaptation),
                gateResult: clone(gateResult)
            };
        } catch (error) {
            return evaluationFailure("GATE_EVALUATION_FAILED", adaptation);
        }
    }

    return {
        getSchemaVersion: getSchemaVersion,
        getVocabulary: getVocabulary,
        adaptCandidate: adaptCandidate,
        evaluateCandidate: evaluateCandidate
    };
}));
