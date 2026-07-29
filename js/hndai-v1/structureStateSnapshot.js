(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === "object") {
        root.HNDStructureStateSnapshot = api;
    }
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_STATE_SNAPSHOT_V1";
    var SOURCE_SCHEMA_VERSION = "HND_BOS_CHOCH_RESOLVER_V1";
    var INITIAL_REGIME = "UNDETERMINED";
    var RESULT_FIELDS = [
        "valid", "error", "ready", "schemaVersion", "market",
        "sourceEventCount", "resolvedEventCount", "initialRegime",
        "currentRegime", "events", "initialBreaks", "bosEvents",
        "chochEvents", "bullishEvents", "bearishEvents", "latestEvent",
        "latestBos", "latestChoch"
    ];
    var EVENT_FIELDS = [
        "id", "sourceEventId", "schemaVersion", "sourceSchemaVersion",
        "type", "direction", "regimeBefore", "regimeAfter", "symbol",
        "interval", "breakType", "breakAtIndex", "breakOpenTime",
        "breakCloseTime", "breakClosePrice", "levelType",
        "levelClassification", "levelCandidateIndex", "levelOpenTime",
        "levelCloseTime", "levelPrice", "levelConfirmedAtIndex",
        "levelConfirmedAtOpenTime", "levelConfirmedAtCloseTime"
    ];

    function getSchemaVersion() {
        return SCHEMA_VERSION;
    }

    function getVocabulary() {
        return {
            sourceSchemas: [SOURCE_SCHEMA_VERSION],
            eventTypes: ["INITIAL_BREAK", "BOS", "CHOCH"],
            regimes: ["UNDETERMINED", "BULLISH", "BEARISH"],
            structurePhases: ["ESTABLISHMENT", "CONTINUATION", "REVERSAL"],
            directions: ["BULLISH", "BEARISH"]
        };
    }

    function copy(item) {
        return Object.assign({}, item);
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
        if (!value || typeof value !== "object" || Array.isArray(value) ||
            typeof value.symbol !== "string" ||
            typeof value.interval !== "string" ||
            !value.symbol || !value.interval ||
            value.symbol !== value.symbol.trim().toUpperCase() ||
            value.interval !== value.interval.trim()) {
            return null;
        }
        return { symbol: value.symbol, interval: value.interval };
    }

    function failure(error, market) {
        return {
            valid: false,
            error: error,
            ready: false,
            schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            market: market ? copy(market) : null,
            sourceEventCount: 0,
            snapshotCount: 0,
            snapshotOpenTimes: [],
            snapshots: [],
            bullishSnapshots: [],
            bearishSnapshots: [],
            establishmentSnapshots: [],
            continuationSnapshots: [],
            reversalSnapshots: [],
            latest: null,
            latestBullish: null,
            latestBearish: null,
            latestEstablishment: null,
            latestContinuation: null,
            latestReversal: null
        };
    }

    function sameEvent(left, right) {
        return exactFields(left, EVENT_FIELDS) &&
            exactFields(right, EVENT_FIELDS) &&
            EVENT_FIELDS.every(function (field) {
                return left[field] === right[field];
            });
    }

    function projectionMatches(actual, expected) {
        return Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every(function (item, index) {
                return sameEvent(actual[index], item);
            });
    }

    function latestMatches(actual, expected) {
        return expected ? sameEvent(actual, expected) : actual === null;
    }

    function validEventSchema(item, market) {
        var bullish;
        var classifications;
        if (!exactFields(item, EVENT_FIELDS) ||
            typeof item.id !== "string" || !item.id ||
            typeof item.sourceEventId !== "string" || !item.sourceEventId ||
            item.schemaVersion !== SOURCE_SCHEMA_VERSION ||
            item.sourceSchemaVersion !== "HND_STRUCTURE_EVENT_V1" ||
            item.symbol !== market.symbol || item.interval !== market.interval) {
            return false;
        }
        bullish = item.direction === "BULLISH";
        if (!bullish && item.direction !== "BEARISH") {
            return false;
        }
        if (["INITIAL_BREAK", "BOS", "CHOCH"].indexOf(item.type) === -1 ||
            ["UNDETERMINED", "BULLISH", "BEARISH"].indexOf(item.regimeBefore) === -1 ||
            ["BULLISH", "BEARISH"].indexOf(item.regimeAfter) === -1 ||
            item.breakType !== (bullish
                ? "BREAK_ABOVE_SWING_HIGH" : "BREAK_BELOW_SWING_LOW") ||
            item.levelType !== (bullish ? "SWING_HIGH" : "SWING_LOW")) {
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
        return finite(item.breakClosePrice) && finite(item.levelPrice) &&
            (bullish
                ? item.breakClosePrice > item.levelPrice
                : item.breakClosePrice < item.levelPrice);
    }

    function validTransition(item, previousRegime, index) {
        if (item.regimeAfter !== item.direction ||
            item.regimeBefore !== previousRegime) {
            return false;
        }
        if (index === 0) {
            return item.type === "INITIAL_BREAK" &&
                previousRegime === INITIAL_REGIME;
        }
        if (item.type === "INITIAL_BREAK" ||
            previousRegime === INITIAL_REGIME) {
            return false;
        }
        if (item.type === "BOS") {
            return item.direction === previousRegime;
        }
        return item.type === "CHOCH" && item.direction !== previousRegime;
    }

    function inCanonicalOrder(previous, current) {
        if (!previous) {
            return true;
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

    function phaseFor(type) {
        if (type === "INITIAL_BREAK") {
            return "ESTABLISHMENT";
        }
        return type === "BOS" ? "CONTINUATION" : "REVERSAL";
    }

    function makeId(event, market, sequenceIndex) {
        return [
            SCHEMA_VERSION,
            market.symbol,
            market.interval,
            event.id,
            sequenceIndex
        ].map(function (part) {
            return encodeURIComponent(String(part));
        }).join("|");
    }

    function makeSnapshot(event, market, sequenceIndex, ready) {
        return {
            id: makeId(event, market, sequenceIndex),
            schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            sourceEventId: event.id,
            sequenceIndex: sequenceIndex,
            symbol: event.symbol,
            interval: event.interval,
            eventType: event.type,
            direction: event.direction,
            structurePhase: phaseFor(event.type),
            regimeBefore: event.regimeBefore,
            currentRegime: event.regimeAfter,
            breakAtIndex: event.breakAtIndex,
            breakOpenTime: event.breakOpenTime,
            breakCloseTime: event.breakCloseTime,
            breakClosePrice: event.breakClosePrice,
            levelType: event.levelType,
            levelClassification: event.levelClassification,
            levelCandidateIndex: event.levelCandidateIndex,
            levelOpenTime: event.levelOpenTime,
            levelCloseTime: event.levelCloseTime,
            levelPrice: event.levelPrice,
            levelConfirmedAtIndex: event.levelConfirmedAtIndex,
            levelConfirmedAtOpenTime: event.levelConfirmedAtOpenTime,
            levelConfirmedAtCloseTime: event.levelConfirmedAtCloseTime,
            isReady: ready
        };
    }

    function select(items, predicate) {
        return items.filter(predicate).map(copy);
    }

    function latest(items) {
        return items.length ? copy(items[items.length - 1]) : null;
    }

    function buildStructureStateSnapshot(resolverResult) {
        var market;
        var events;
        var sourceIds = new Set();
        var priorRegime = INITIAL_REGIME;
        var initialEvents;
        var bosEvents;
        var chochEvents;
        var bullishEvents;
        var bearishEvents;
        var snapshotIds = new Set();
        var snapshots = [];
        var bullishSnapshots;
        var bearishSnapshots;
        var establishmentSnapshots;
        var continuationSnapshots;
        var reversalSnapshots;
        if (!exactFields(resolverResult, RESULT_FIELDS) ||
            resolverResult.valid !== true ||
            resolverResult.error !== null ||
            typeof resolverResult.ready !== "boolean" ||
            !safeInteger(resolverResult.sourceEventCount) ||
            !safeInteger(resolverResult.resolvedEventCount) ||
            !Array.isArray(resolverResult.events) ||
            !Array.isArray(resolverResult.initialBreaks) ||
            !Array.isArray(resolverResult.bosEvents) ||
            !Array.isArray(resolverResult.chochEvents) ||
            !Array.isArray(resolverResult.bullishEvents) ||
            !Array.isArray(resolverResult.bearishEvents)) {
            return failure("INVALID_RESOLVER_RESULT", null);
        }
        if (resolverResult.schemaVersion !== SOURCE_SCHEMA_VERSION) {
            return failure("SOURCE_SCHEMA_MISMATCH", null);
        }
        market = cleanMarket(resolverResult.market);
        if (!market) {
            return failure("MARKET_INVALID", null);
        }
        events = resolverResult.events;
        if (resolverResult.sourceEventCount !== events.length ||
            resolverResult.resolvedEventCount !== events.length) {
            return failure("EVENT_PROJECTION_MISMATCH", market);
        }
        if (resolverResult.initialRegime !== INITIAL_REGIME) {
            return failure("REGIME_TRANSITION_CONFLICT", market);
        }
        for (var index = 0; index < events.length; index += 1) {
            var event = events[index];
            if (!validEventSchema(event, market)) {
                return failure("EVENT_SCHEMA_CONFLICT", market);
            }
            if (sourceIds.has(event.id)) {
                return failure("DUPLICATE_EVENT_ID", market);
            }
            if (!inCanonicalOrder(index ? events[index - 1] : null, event)) {
                return failure("CHRONOLOGY_VIOLATION", market);
            }
            if (!validTransition(event, priorRegime, index)) {
                return failure("REGIME_TRANSITION_CONFLICT", market);
            }
            sourceIds.add(event.id);
            priorRegime = event.regimeAfter;
        }
        if ((events.length && resolverResult.currentRegime !== priorRegime) ||
            (!events.length && resolverResult.currentRegime !== INITIAL_REGIME)) {
            return failure("REGIME_TRANSITION_CONFLICT", market);
        }
        initialEvents = events.filter(function (item) {
            return item.type === "INITIAL_BREAK";
        });
        bosEvents = events.filter(function (item) {
            return item.type === "BOS";
        });
        chochEvents = events.filter(function (item) {
            return item.type === "CHOCH";
        });
        bullishEvents = events.filter(function (item) {
            return item.direction === "BULLISH";
        });
        bearishEvents = events.filter(function (item) {
            return item.direction === "BEARISH";
        });
        if (!projectionMatches(resolverResult.initialBreaks, initialEvents) ||
            !projectionMatches(resolverResult.bosEvents, bosEvents) ||
            !projectionMatches(resolverResult.chochEvents, chochEvents) ||
            !projectionMatches(resolverResult.bullishEvents, bullishEvents) ||
            !projectionMatches(resolverResult.bearishEvents, bearishEvents)) {
            return failure("EVENT_PROJECTION_MISMATCH", market);
        }
        if (!latestMatches(resolverResult.latestEvent,
            events.length ? events[events.length - 1] : null) ||
            !latestMatches(resolverResult.latestBos,
                bosEvents.length ? bosEvents[bosEvents.length - 1] : null) ||
            !latestMatches(resolverResult.latestChoch,
                chochEvents.length ? chochEvents[chochEvents.length - 1] : null)) {
            return failure("LATEST_PROJECTION_MISMATCH", market);
        }
        for (var snapshotIndex = 0;
            snapshotIndex < events.length;
            snapshotIndex += 1) {
            var snapshot = makeSnapshot(
                events[snapshotIndex], market, snapshotIndex, resolverResult.ready
            );
            if (snapshotIds.has(snapshot.id)) {
                return failure("DUPLICATE_EVENT_ID", market);
            }
            snapshotIds.add(snapshot.id);
            snapshots.push(snapshot);
        }
        bullishSnapshots = select(snapshots, function (item) {
            return item.direction === "BULLISH";
        });
        bearishSnapshots = select(snapshots, function (item) {
            return item.direction === "BEARISH";
        });
        establishmentSnapshots = select(snapshots, function (item) {
            return item.structurePhase === "ESTABLISHMENT";
        });
        continuationSnapshots = select(snapshots, function (item) {
            return item.structurePhase === "CONTINUATION";
        });
        reversalSnapshots = select(snapshots, function (item) {
            return item.structurePhase === "REVERSAL";
        });
        return {
            valid: true,
            error: null,
            ready: snapshots.length > 0 && resolverResult.ready === true,
            schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            market: copy(market),
            sourceEventCount: events.length,
            snapshotCount: snapshots.length,
            snapshotOpenTimes: snapshots.map(function (item) {
                return item.breakOpenTime;
            }),
            snapshots: snapshots.map(copy),
            bullishSnapshots: bullishSnapshots,
            bearishSnapshots: bearishSnapshots,
            establishmentSnapshots: establishmentSnapshots,
            continuationSnapshots: continuationSnapshots,
            reversalSnapshots: reversalSnapshots,
            latest: latest(snapshots),
            latestBullish: latest(bullishSnapshots),
            latestBearish: latest(bearishSnapshots),
            latestEstablishment: latest(establishmentSnapshots),
            latestContinuation: latest(continuationSnapshots),
            latestReversal: latest(reversalSnapshots)
        };
    }

    return {
        getSchemaVersion: getSchemaVersion,
        getVocabulary: getVocabulary,
        buildStructureStateSnapshot: buildStructureStateSnapshot
    };
}));
