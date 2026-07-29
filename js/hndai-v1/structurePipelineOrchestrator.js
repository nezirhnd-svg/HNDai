(function (root, factory) {
    "use strict";
    var dependencies;
    if (typeof module === "object" && module.exports) {
        dependencies = {
            breakDetector: require("./structureBreakDetector.js"),
            eventContract: require("./structureEventContract.js"),
            resolver: require("./bosChochResolver.js"),
            snapshot: require("./structureStateSnapshot.js"),
            adapter: require("./structureSetupAdapter.js")
        };
    } else {
        dependencies = {
            breakDetector: root && root.HNDStructureBreakDetector,
            eventContract: root && root.HNDStructureEventContract,
            resolver: root && root.HNDBosChochResolver,
            snapshot: root && root.HNDStructureStateSnapshot,
            adapter: root && root.HNDStructureSetupAdapter
        };
    }
    var api = factory(dependencies);
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === "object") {
        root.HNDStructurePipelineOrchestrator = api;
    }
}(typeof window !== "undefined" ? window : null, function (dependencies) {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_PIPELINE_V1";
    var CONTEXT_FIELDS = ["symbol", "interval", "nowMs", "leftBars", "rightBars"];
    var required = [
        ["breakDetector", "detectBreaks"],
        ["eventContract", "buildStructureEvents"],
        ["resolver", "resolveStructure"],
        ["snapshot", "buildStructureStateSnapshot"],
        ["adapter", "evaluateCandidate"]
    ];
    required.forEach(function (entry) {
        if (!dependencies[entry[0]] ||
            typeof dependencies[entry[0]][entry[1]] !== "function") {
            throw new Error("HND_STRUCTURE_PIPELINE_DEPENDENCY_MISSING");
        }
    });

    function getSchemaVersion() {
        return SCHEMA_VERSION;
    }

    function getVocabulary() {
        return {
            stages: ["STRUCTURE_BREAK", "STRUCTURE_EVENT", "BOS_CHOCH",
                "STRUCTURE_SNAPSHOT", "SETUP_ADAPTER"],
            operations: ["ANALYZE_STRUCTURE", "EVALUATE_SETUP"],
            statuses: ["SUCCESS", "FAILED"],
            directions: ["BULLISH", "BEARISH", "UNDETERMINED"]
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

    function safePositiveInteger(value) {
        return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    }

    function validContext(context) {
        return exactFields(context, CONTEXT_FIELDS) &&
            typeof context.symbol === "string" && context.symbol.length > 0 &&
            context.symbol === context.symbol.trim().toUpperCase() &&
            typeof context.interval === "string" && context.interval.length > 0 &&
            context.interval === context.interval.trim() &&
            typeof context.nowMs === "number" && Number.isFinite(context.nowMs) &&
            context.nowMs >= 0 &&
            safePositiveInteger(context.leftBars) &&
            safePositiveInteger(context.rightBars);
    }

    function validStageResult(result) {
        return result && typeof result === "object" && !Array.isArray(result) &&
            typeof result.valid === "boolean" &&
            typeof result.ready === "boolean" &&
            Object.prototype.hasOwnProperty.call(result, "error");
    }

    function analysisBase() {
        return {
            valid: false, error: null, ready: false,
            schemaVersion: SCHEMA_VERSION,
            operation: "ANALYZE_STRUCTURE", status: "FAILED",
            failedStage: null, stageError: null, market: null, config: null,
            breakResult: null, structureEventResult: null, resolverResult: null,
            snapshotResult: null, latestStructure: null
        };
    }

    function analysisFailure(error, stage, stageError) {
        var output = analysisBase();
        output.error = error;
        output.failedStage = stage;
        output.stageError = stageError;
        return output;
    }

    function stageFailure(stage, result) {
        if (!validStageResult(result)) {
            return analysisFailure("DEPENDENCY_RESULT_INVALID", stage,
                "DEPENDENCY_RESULT_INVALID");
        }
        return analysisFailure("PIPELINE_STAGE_FAILED", stage,
            result.error === undefined ? null : result.error);
    }

    function analyzeStructure(rawCandles, analysisContext) {
        var context;
        var breakResult;
        var eventResult;
        var resolverResult;
        var snapshotResult;
        if (!Array.isArray(rawCandles)) {
            return analysisFailure("INVALID_RAW_CANDLES", null, null);
        }
        if (!validContext(analysisContext)) {
            return analysisFailure("INVALID_ANALYSIS_INPUT", null, null);
        }
        context = clone(analysisContext);
        try {
            breakResult = dependencies.breakDetector.detectBreaks(clone(rawCandles), {
                nowMs: context.nowMs,
                leftBars: context.leftBars,
                rightBars: context.rightBars
            });
            if (!validStageResult(breakResult) || !breakResult.valid) {
                return stageFailure("STRUCTURE_BREAK", breakResult);
            }
            eventResult = dependencies.eventContract.buildStructureEvents(
                breakResult, { symbol: context.symbol, interval: context.interval });
            if (!validStageResult(eventResult) || !eventResult.valid) {
                return stageFailure("STRUCTURE_EVENT", eventResult);
            }
            resolverResult = dependencies.resolver.resolveStructure(eventResult);
            if (!validStageResult(resolverResult) || !resolverResult.valid) {
                return stageFailure("BOS_CHOCH", resolverResult);
            }
            snapshotResult =
                dependencies.snapshot.buildStructureStateSnapshot(resolverResult);
            if (!validStageResult(snapshotResult) || !snapshotResult.valid) {
                return stageFailure("STRUCTURE_SNAPSHOT", snapshotResult);
            }
            return {
                valid: true, error: null, ready: snapshotResult.ready,
                schemaVersion: SCHEMA_VERSION,
                operation: "ANALYZE_STRUCTURE", status: "SUCCESS",
                failedStage: null, stageError: null,
                market: { symbol: context.symbol, interval: context.interval },
                config: {
                    nowMs: context.nowMs,
                    leftBars: context.leftBars,
                    rightBars: context.rightBars
                },
                breakResult: clone(breakResult),
                structureEventResult: clone(eventResult),
                resolverResult: clone(resolverResult),
                snapshotResult: clone(snapshotResult),
                latestStructure: clone(snapshotResult.latest)
            };
        } catch (error) {
            return analysisFailure("UNEXPECTED_PIPELINE_ERROR", null,
                error && typeof error.message === "string" ? error.message : null);
        }
    }

    function setupFailure(error, failedStage, stageError, pipelineResult) {
        return {
            valid: false, error: error, ready: false,
            schemaVersion: SCHEMA_VERSION,
            operation: "EVALUATE_SETUP", status: "FAILED",
            failedStage: failedStage, stageError: stageError,
            pipelineResult: clone(pipelineResult),
            adapterResult: null, gateDecision: null, gateReason: null
        };
    }

    function evaluateSetupCandidate(rawCandles, analysisContext, candidate,
        evaluationContext) {
        var pipelineResult = analyzeStructure(rawCandles, analysisContext);
        var adapterResult;
        if (!pipelineResult.valid) {
            return setupFailure(pipelineResult.error, pipelineResult.failedStage,
                pipelineResult.stageError, pipelineResult);
        }
        try {
            adapterResult = dependencies.adapter.evaluateCandidate(
                pipelineResult.snapshotResult, clone(candidate),
                clone(evaluationContext));
        } catch (error) {
            return setupFailure("SETUP_EVALUATION_FAILED", "SETUP_ADAPTER",
                error && typeof error.message === "string" ? error.message : null,
                pipelineResult);
        }
        if (!validStageResult(adapterResult)) {
            return setupFailure("DEPENDENCY_RESULT_INVALID", "SETUP_ADAPTER",
                "DEPENDENCY_RESULT_INVALID", pipelineResult);
        }
        if (!adapterResult.valid) {
            return setupFailure("SETUP_EVALUATION_FAILED", "SETUP_ADAPTER",
                adapterResult.error, pipelineResult);
        }
        if (!adapterResult.gateResult ||
            typeof adapterResult.gateResult.decision !== "string" ||
            typeof adapterResult.gateResult.reason !== "string") {
            return setupFailure("DEPENDENCY_RESULT_INVALID", "SETUP_ADAPTER",
                "DEPENDENCY_RESULT_INVALID", pipelineResult);
        }
        return {
            valid: true, error: null, ready: adapterResult.ready,
            schemaVersion: SCHEMA_VERSION,
            operation: "EVALUATE_SETUP", status: "SUCCESS",
            failedStage: null, stageError: null,
            pipelineResult: clone(pipelineResult),
            adapterResult: clone(adapterResult),
            gateDecision: adapterResult.gateResult.decision,
            gateReason: adapterResult.gateResult.reason
        };
    }

    return {
        getSchemaVersion: getSchemaVersion,
        getVocabulary: getVocabulary,
        analyzeStructure: analyzeStructure,
        evaluateSetupCandidate: evaluateSetupCandidate
    };
}));
