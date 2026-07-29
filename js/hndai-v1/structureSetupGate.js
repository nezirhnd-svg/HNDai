(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === "object") {
        root.HNDStructureSetupGate = api;
    }
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_SETUP_GATE_V1";
    var SOURCE_SCHEMA_VERSION = "HND_STRUCTURE_STATE_SNAPSHOT_V1";
    var SOURCE_RESULT_FIELDS = [
        "valid", "error", "ready", "schemaVersion", "sourceSchemaVersion",
        "market", "sourceEventCount", "snapshotCount", "snapshotOpenTimes",
        "snapshots", "bullishSnapshots", "bearishSnapshots",
        "establishmentSnapshots", "continuationSnapshots", "reversalSnapshots",
        "latest", "latestBullish", "latestBearish", "latestEstablishment",
        "latestContinuation", "latestReversal"
    ];
    var SNAPSHOT_FIELDS = [
        "id", "schemaVersion", "sourceSchemaVersion", "sourceEventId",
        "sequenceIndex", "symbol", "interval", "eventType", "direction",
        "structurePhase", "regimeBefore", "currentRegime", "breakAtIndex",
        "breakOpenTime", "breakCloseTime", "breakClosePrice", "levelType",
        "levelClassification", "levelCandidateIndex", "levelOpenTime",
        "levelCloseTime", "levelPrice", "levelConfirmedAtIndex",
        "levelConfirmedAtOpenTime", "levelConfirmedAtCloseTime", "isReady"
    ];
    var SETUP_FIELDS = [
        "id", "symbol", "interval", "direction", "structureEventId",
        "evaluationAtIndex", "evaluationOpenTime", "evaluationCloseTime"
    ];

    function getSchemaVersion() {
        return SCHEMA_VERSION;
    }

    function getVocabulary() {
        return {
            decisions: ["ALLOW", "BLOCK"],
            setupDirections: ["LONG", "SHORT"],
            structureDirections: ["BULLISH", "BEARISH"],
            structurePhases: ["ESTABLISHMENT", "CONTINUATION", "REVERSAL"],
            allowReasons: ["STRUCTURE_MATCH"],
            blockReasons: [
                "SOURCE_NOT_READY",
                "NO_CAUSAL_STRUCTURE",
                "STRUCTURE_EVENT_NOT_FOUND",
                "FUTURE_STRUCTURE_EVENT",
                "STALE_STRUCTURE_REFERENCE",
                "DIRECTION_MISMATCH"
            ]
        };
    }

    function copy(value) {
        return value ? Object.assign({}, value) : null;
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

    function finite(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function cleanMarket(value) {
        if (!exactFields(value, ["symbol", "interval"]) ||
            typeof value.symbol !== "string" ||
            typeof value.interval !== "string" ||
            !value.symbol || !value.interval ||
            value.symbol !== value.symbol.trim().toUpperCase() ||
            value.interval !== value.interval.trim()) {
            return null;
        }
        return { symbol: value.symbol, interval: value.interval };
    }

    function emptyEvidence() {
        return {
            setupStructureEventId: null,
            referencedSnapshotId: null,
            latestCausalSnapshotId: null,
            structureDirection: null,
            currentRegime: null,
            structurePhase: null,
            eventType: null,
            breakAtIndex: null,
            breakCloseTime: null
        };
    }

    function resultBase() {
        return {
            valid: false,
            error: null,
            ready: false,
            schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            market: null,
            decision: "BLOCK",
            reason: null,
            setupId: null,
            setupDirection: null,
            expectedStructureDirection: null,
            evaluationAtIndex: null,
            evaluationOpenTime: null,
            evaluationCloseTime: null,
            sourceSnapshotCount: 0,
            causalSnapshotCount: 0,
            referencedSnapshot: null,
            latestCausalSnapshot: null,
            evidence: emptyEvidence()
        };
    }

    function invalid(error, market) {
        var output = resultBase();
        output.error = error;
        output.market = copy(market);
        return output;
    }

    function expectedDirection(direction) {
        return direction === "LONG" ? "BULLISH" : "BEARISH";
    }

    function evidenceFor(setup, referenced, latestCausal) {
        var selected = referenced || latestCausal;
        return {
            setupStructureEventId: setup.structureEventId,
            referencedSnapshotId: referenced ? referenced.id : null,
            latestCausalSnapshotId: latestCausal ? latestCausal.id : null,
            structureDirection: selected ? selected.direction : null,
            currentRegime: selected ? selected.currentRegime : null,
            structurePhase: selected ? selected.structurePhase : null,
            eventType: selected ? selected.eventType : null,
            breakAtIndex: selected ? selected.breakAtIndex : null,
            breakCloseTime: selected ? selected.breakCloseTime : null
        };
    }

    function decision(source, setup, causal, referenced, latestCausal,
        decisionValue, reason, ready) {
        return {
            valid: true,
            error: null,
            ready: ready,
            schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            market: copy(source.market),
            decision: decisionValue,
            reason: reason,
            setupId: setup.id,
            setupDirection: setup.direction,
            expectedStructureDirection: expectedDirection(setup.direction),
            evaluationAtIndex: setup.evaluationAtIndex,
            evaluationOpenTime: setup.evaluationOpenTime,
            evaluationCloseTime: setup.evaluationCloseTime,
            sourceSnapshotCount: source.snapshots.length,
            causalSnapshotCount: causal.length,
            referencedSnapshot: copy(referenced),
            latestCausalSnapshot: copy(latestCausal),
            evidence: evidenceFor(setup, referenced, latestCausal)
        };
    }

    function sameSnapshot(left, right) {
        return exactFields(left, SNAPSHOT_FIELDS) &&
            exactFields(right, SNAPSHOT_FIELDS) &&
            SNAPSHOT_FIELDS.every(function (field) {
                return left[field] === right[field];
            });
    }

    function projectionMatches(actual, expected) {
        return Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every(function (item, index) {
                return sameSnapshot(actual[index], item);
            });
    }

    function latestMatches(actual, expected) {
        return expected ? sameSnapshot(actual, expected) : actual === null;
    }

    function validSnapshotSchema(item, market) {
        var bullish;
        var expectedPhase;
        var classifications;
        if (!exactFields(item, SNAPSHOT_FIELDS) ||
            typeof item.id !== "string" || !item.id ||
            typeof item.sourceEventId !== "string" || !item.sourceEventId ||
            item.schemaVersion !== SOURCE_SCHEMA_VERSION ||
            item.sourceSchemaVersion !== "HND_BOS_CHOCH_RESOLVER_V1" ||
            item.symbol !== market.symbol || item.interval !== market.interval ||
            !safeInteger(item.sequenceIndex) ||
            typeof item.isReady !== "boolean") {
            return false;
        }
        bullish = item.direction === "BULLISH";
        if (!bullish && item.direction !== "BEARISH") {
            return false;
        }
        if (item.currentRegime !== item.direction ||
            ["UNDETERMINED", "BULLISH", "BEARISH"].indexOf(item.regimeBefore) === -1 ||
            ["INITIAL_BREAK", "BOS", "CHOCH"].indexOf(item.eventType) === -1) {
            return false;
        }
        expectedPhase = item.eventType === "INITIAL_BREAK"
            ? "ESTABLISHMENT" : item.eventType === "BOS"
                ? "CONTINUATION" : "REVERSAL";
        if (item.structurePhase !== expectedPhase ||
            (item.eventType === "INITIAL_BREAK" &&
                item.regimeBefore !== "UNDETERMINED") ||
            (item.eventType === "BOS" && item.regimeBefore !== item.direction) ||
            (item.eventType === "CHOCH" &&
                (item.regimeBefore === "UNDETERMINED" ||
                    item.regimeBefore === item.direction))) {
            return false;
        }
        if (item.levelType !== (bullish ? "SWING_HIGH" : "SWING_LOW")) {
            return false;
        }
        classifications = bullish
            ? ["INITIAL_HIGH", "HIGHER_HIGH", "LOWER_HIGH", "EQUAL_HIGH"]
            : ["INITIAL_LOW", "HIGHER_LOW", "LOWER_LOW", "EQUAL_LOW"];
        if (classifications.indexOf(item.levelClassification) === -1 ||
            !safeInteger(item.levelCandidateIndex) ||
            !safeInteger(item.levelConfirmedAtIndex) ||
            !safeInteger(item.breakAtIndex) ||
            !(item.levelCandidateIndex < item.levelConfirmedAtIndex &&
                item.levelConfirmedAtIndex < item.breakAtIndex)) {
            return false;
        }
        if (!safeInteger(item.levelOpenTime) ||
            !safeInteger(item.levelCloseTime) ||
            !safeInteger(item.levelConfirmedAtOpenTime) ||
            !safeInteger(item.levelConfirmedAtCloseTime) ||
            !safeInteger(item.breakOpenTime) ||
            !safeInteger(item.breakCloseTime) ||
            !(item.levelOpenTime < item.levelCloseTime &&
                item.levelCloseTime < item.levelConfirmedAtOpenTime &&
                item.levelConfirmedAtOpenTime < item.levelConfirmedAtCloseTime &&
                item.levelConfirmedAtCloseTime < item.breakOpenTime &&
                item.breakOpenTime < item.breakCloseTime)) {
            return false;
        }
        return finite(item.breakClosePrice) && finite(item.levelPrice);
    }

    function inCanonicalOrder(previous, current) {
        if (!previous) {
            return true;
        }
        if (current.sequenceIndex !== previous.sequenceIndex + 1) {
            return false;
        }
        if (current.breakAtIndex !== previous.breakAtIndex) {
            return current.breakAtIndex > previous.breakAtIndex &&
                current.breakOpenTime > previous.breakOpenTime &&
                current.breakCloseTime > previous.breakCloseTime;
        }
        return current.breakOpenTime === previous.breakOpenTime &&
            current.breakCloseTime === previous.breakCloseTime &&
            current.breakClosePrice === previous.breakClosePrice &&
            previous.direction === "BULLISH" &&
            current.direction === "BEARISH";
    }

    function validateSource(source) {
        var market;
        var snapshots;
        var snapshotIds = new Set();
        var sourceIds = new Set();
        var bullish;
        var bearish;
        var establishment;
        var continuation;
        var reversal;
        if (!exactFields(source, SOURCE_RESULT_FIELDS) ||
            source.valid !== true || source.error !== null ||
            typeof source.ready !== "boolean" ||
            !safeInteger(source.sourceEventCount) ||
            !safeInteger(source.snapshotCount) ||
            !Array.isArray(source.snapshotOpenTimes) ||
            !Array.isArray(source.snapshots) ||
            !Array.isArray(source.bullishSnapshots) ||
            !Array.isArray(source.bearishSnapshots) ||
            !Array.isArray(source.establishmentSnapshots) ||
            !Array.isArray(source.continuationSnapshots) ||
            !Array.isArray(source.reversalSnapshots)) {
            return { error: "INVALID_SNAPSHOT_RESULT", market: null };
        }
        if (source.schemaVersion !== SOURCE_SCHEMA_VERSION ||
            source.sourceSchemaVersion !== "HND_BOS_CHOCH_RESOLVER_V1") {
            return { error: "SOURCE_SCHEMA_MISMATCH", market: null };
        }
        market = cleanMarket(source.market);
        if (!market) {
            return { error: "INVALID_MARKET", market: null };
        }
        snapshots = source.snapshots;
        if (source.sourceEventCount !== snapshots.length ||
            source.snapshotCount !== snapshots.length ||
            source.snapshotOpenTimes.length !== snapshots.length) {
            return { error: "SNAPSHOT_PROJECTION_MISMATCH", market: market };
        }
        for (var index = 0; index < snapshots.length; index += 1) {
            var item = snapshots[index];
            if (!validSnapshotSchema(item, market) ||
                item.sequenceIndex !== index) {
                return { error: "SNAPSHOT_SCHEMA_CONFLICT", market: market };
            }
            if ((index === 0 && item.eventType !== "INITIAL_BREAK") ||
                (index > 0 && (item.eventType === "INITIAL_BREAK" ||
                    item.regimeBefore !== snapshots[index - 1].currentRegime))) {
                return { error: "SNAPSHOT_SCHEMA_CONFLICT", market: market };
            }
            if (snapshotIds.has(item.id)) {
                return { error: "DUPLICATE_SNAPSHOT_ID", market: market };
            }
            if (sourceIds.has(item.sourceEventId)) {
                return { error: "DUPLICATE_SOURCE_EVENT_ID", market: market };
            }
            if (!inCanonicalOrder(index ? snapshots[index - 1] : null, item)) {
                return { error: "CHRONOLOGY_VIOLATION", market: market };
            }
            if (source.snapshotOpenTimes[index] !== item.breakOpenTime) {
                return { error: "SNAPSHOT_PROJECTION_MISMATCH", market: market };
            }
            snapshotIds.add(item.id);
            sourceIds.add(item.sourceEventId);
        }
        if (source.ready !== (snapshots.length > 0 &&
            snapshots.every(function (item) { return item.isReady === true; })) ||
            (!source.ready && snapshots.some(function (item) {
                return item.isReady !== false;
            }))) {
            return { error: "SNAPSHOT_SCHEMA_CONFLICT", market: market };
        }
        bullish = snapshots.filter(function (item) {
            return item.direction === "BULLISH";
        });
        bearish = snapshots.filter(function (item) {
            return item.direction === "BEARISH";
        });
        establishment = snapshots.filter(function (item) {
            return item.structurePhase === "ESTABLISHMENT";
        });
        continuation = snapshots.filter(function (item) {
            return item.structurePhase === "CONTINUATION";
        });
        reversal = snapshots.filter(function (item) {
            return item.structurePhase === "REVERSAL";
        });
        if (!projectionMatches(source.bullishSnapshots, bullish) ||
            !projectionMatches(source.bearishSnapshots, bearish) ||
            !projectionMatches(source.establishmentSnapshots, establishment) ||
            !projectionMatches(source.continuationSnapshots, continuation) ||
            !projectionMatches(source.reversalSnapshots, reversal)) {
            return { error: "SNAPSHOT_PROJECTION_MISMATCH", market: market };
        }
        if (!latestMatches(source.latest,
            snapshots.length ? snapshots[snapshots.length - 1] : null) ||
            !latestMatches(source.latestBullish,
                bullish.length ? bullish[bullish.length - 1] : null) ||
            !latestMatches(source.latestBearish,
                bearish.length ? bearish[bearish.length - 1] : null) ||
            !latestMatches(source.latestEstablishment,
                establishment.length ? establishment[establishment.length - 1] : null) ||
            !latestMatches(source.latestContinuation,
                continuation.length ? continuation[continuation.length - 1] : null) ||
            !latestMatches(source.latestReversal,
                reversal.length ? reversal[reversal.length - 1] : null)) {
            return { error: "LATEST_PROJECTION_MISMATCH", market: market };
        }
        return { error: null, market: market };
    }

    function validSetup(setup, market) {
        return exactFields(setup, SETUP_FIELDS) &&
            typeof setup.id === "string" && setup.id.length > 0 &&
            typeof setup.structureEventId === "string" &&
            setup.structureEventId.length > 0 &&
            setup.symbol === market.symbol &&
            setup.interval === market.interval &&
            ["LONG", "SHORT"].indexOf(setup.direction) !== -1 &&
            safeInteger(setup.evaluationAtIndex) &&
            safeInteger(setup.evaluationOpenTime) &&
            safeInteger(setup.evaluationCloseTime) &&
            setup.evaluationOpenTime < setup.evaluationCloseTime;
    }

    function evaluateSetup(structureSnapshotResult, setupCandidate) {
        var sourceValidation = validateSource(structureSnapshotResult);
        var snapshots;
        var causal;
        var referenced;
        var latestCausal;
        var expected;
        if (sourceValidation.error) {
            return invalid(sourceValidation.error, sourceValidation.market);
        }
        if (!validSetup(setupCandidate, sourceValidation.market)) {
            return invalid("INVALID_SETUP_CANDIDATE", sourceValidation.market);
        }
        snapshots = structureSnapshotResult.snapshots;
        causal = snapshots.filter(function (item) {
            return item.breakAtIndex <= setupCandidate.evaluationAtIndex &&
                item.breakCloseTime <= setupCandidate.evaluationCloseTime;
        });
        referenced = snapshots.find(function (item) {
            return item.sourceEventId === setupCandidate.structureEventId;
        }) || null;
        latestCausal = causal.length ? causal[causal.length - 1] : null;
        if (!structureSnapshotResult.ready) {
            return decision(structureSnapshotResult, setupCandidate, causal,
                referenced, latestCausal, "BLOCK", "SOURCE_NOT_READY", false);
        }
        if (!snapshots.length) {
            return decision(structureSnapshotResult, setupCandidate, causal,
                null, null, "BLOCK", "NO_CAUSAL_STRUCTURE", false);
        }
        if (!referenced) {
            return decision(structureSnapshotResult, setupCandidate, causal,
                null, latestCausal, "BLOCK", "STRUCTURE_EVENT_NOT_FOUND",
                causal.length > 0);
        }
        if (referenced.breakAtIndex > setupCandidate.evaluationAtIndex ||
            referenced.breakCloseTime > setupCandidate.evaluationCloseTime) {
            return decision(structureSnapshotResult, setupCandidate, causal,
                referenced, latestCausal, "BLOCK", "FUTURE_STRUCTURE_EVENT",
                causal.length > 0);
        }
        if (!latestCausal) {
            return decision(structureSnapshotResult, setupCandidate, causal,
                referenced, null, "BLOCK", "NO_CAUSAL_STRUCTURE", false);
        }
        if (referenced.id !== latestCausal.id) {
            return decision(structureSnapshotResult, setupCandidate, causal,
                referenced, latestCausal, "BLOCK", "STALE_STRUCTURE_REFERENCE", true);
        }
        expected = expectedDirection(setupCandidate.direction);
        if (referenced.direction !== expected ||
            referenced.currentRegime !== expected ||
            referenced.isReady !== true) {
            return decision(structureSnapshotResult, setupCandidate, causal,
                referenced, latestCausal, "BLOCK", "DIRECTION_MISMATCH", true);
        }
        return decision(structureSnapshotResult, setupCandidate, causal,
            referenced, latestCausal, "ALLOW", "STRUCTURE_MATCH", true);
    }

    return {
        getSchemaVersion: getSchemaVersion,
        getVocabulary: getVocabulary,
        evaluateSetup: evaluateSetup
    };
}));
