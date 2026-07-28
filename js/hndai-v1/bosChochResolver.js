(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === "object") {
        root.HNDBosChochResolver = api;
    }
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    var SCHEMA_VERSION = "HND_BOS_CHOCH_RESOLVER_V1";
    var SOURCE_SCHEMA_VERSION = "HND_STRUCTURE_EVENT_V1";
    var INITIAL_REGIME = "UNDETERMINED";
    var RESULT_FIELDS = [
        "valid", "error", "ready", "schemaVersion", "market",
        "sourceBreakCount", "eventCount", "events", "bullishEvents",
        "bearishEvents", "latestBullishEvent", "latestBearishEvent"
    ];
    var SOURCE_EVENT_FIELDS = [
        "id", "schemaVersion", "kind", "status", "symbol", "interval",
        "direction", "breakType", "breakAtIndex", "breakOpenTime",
        "breakCloseTime", "breakClosePrice", "levelType",
        "levelClassification", "levelCandidateIndex", "levelOpenTime",
        "levelCloseTime", "levelPrice", "levelConfirmedAtIndex",
        "levelConfirmedAtOpenTime", "levelConfirmedAtCloseTime"
    ];

    function getVocabulary() {
        return {
            eventTypes: ["INITIAL_BREAK", "BOS", "CHOCH"],
            regimes: ["UNDETERMINED", "BULLISH", "BEARISH"],
            directions: ["BULLISH", "BEARISH"]
        };
    }

    function copy(item) {
        return Object.assign({}, item);
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
            market: market ? copy(market) : null,
            sourceEventCount: 0,
            resolvedEventCount: 0,
            initialRegime: INITIAL_REGIME,
            currentRegime: INITIAL_REGIME,
            events: [],
            initialBreaks: [],
            bosEvents: [],
            chochEvents: [],
            bullishEvents: [],
            bearishEvents: [],
            latestEvent: null,
            latestBos: null,
            latestChoch: null
        };
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

    function sameSourceEvent(left, right) {
        return exactFields(left, SOURCE_EVENT_FIELDS) &&
            exactFields(right, SOURCE_EVENT_FIELDS) &&
            SOURCE_EVENT_FIELDS.every(function (field) {
                return left[field] === right[field];
            });
    }

    function projectionMatches(actual, expected) {
        return Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every(function (item, index) {
                return sameSourceEvent(actual[index], item);
            });
    }

    function latestMatches(actual, expected) {
        return expected ? sameSourceEvent(actual, expected) : actual === null;
    }

    function validSourceEvent(item, market) {
        var bullish;
        var classifications;
        if (!exactFields(item, SOURCE_EVENT_FIELDS) ||
            typeof item.id !== "string" || !item.id ||
            item.schemaVersion !== SOURCE_SCHEMA_VERSION ||
            item.kind !== "STRUCTURE_BREAK" ||
            item.status !== "CONFIRMED" ||
            item.symbol !== market.symbol ||
            item.interval !== market.interval) {
            return false;
        }
        bullish = item.direction === "BULLISH";
        if (!bullish && item.direction !== "BEARISH") {
            return false;
        }
        if (item.breakType !== (bullish
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

    function makeId(source, market, type) {
        return [
            SCHEMA_VERSION,
            market.symbol,
            market.interval,
            source.id,
            type
        ].map(function (part) {
            return encodeURIComponent(String(part));
        }).join("|");
    }

    function classify(source, market, regime) {
        var type;
        var nextRegime;
        if (regime === INITIAL_REGIME) {
            type = "INITIAL_BREAK";
            nextRegime = source.direction;
        } else if (regime === source.direction) {
            type = "BOS";
            nextRegime = regime;
        } else {
            type = "CHOCH";
            nextRegime = source.direction;
        }
        return {
            id: makeId(source, market, type),
            sourceEventId: source.id,
            schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: source.schemaVersion,
            type: type,
            direction: source.direction,
            regimeBefore: regime,
            regimeAfter: nextRegime,
            symbol: source.symbol,
            interval: source.interval,
            breakType: source.breakType,
            breakAtIndex: source.breakAtIndex,
            breakOpenTime: source.breakOpenTime,
            breakCloseTime: source.breakCloseTime,
            breakClosePrice: source.breakClosePrice,
            levelType: source.levelType,
            levelClassification: source.levelClassification,
            levelCandidateIndex: source.levelCandidateIndex,
            levelOpenTime: source.levelOpenTime,
            levelCloseTime: source.levelCloseTime,
            levelPrice: source.levelPrice,
            levelConfirmedAtIndex: source.levelConfirmedAtIndex,
            levelConfirmedAtOpenTime: source.levelConfirmedAtOpenTime,
            levelConfirmedAtCloseTime: source.levelConfirmedAtCloseTime
        };
    }

    function select(events, predicate) {
        return events.filter(predicate).map(copy);
    }

    function resolveStructure(structureEventResult) {
        var market;
        var sourceEvents;
        var bullish;
        var bearish;
        var ids = new Set();
        var resolvedIds = new Set();
        var resolved = [];
        var regime = INITIAL_REGIME;
        var initialBreaks;
        var bosEvents;
        var chochEvents;
        var bullishEvents;
        var bearishEvents;
        if (!exactFields(structureEventResult, RESULT_FIELDS) ||
            structureEventResult.valid !== true ||
            typeof structureEventResult.ready !== "boolean" ||
            structureEventResult.error !== null ||
            !safeInteger(structureEventResult.sourceBreakCount) ||
            !safeInteger(structureEventResult.eventCount) ||
            !Array.isArray(structureEventResult.events) ||
            !Array.isArray(structureEventResult.bullishEvents) ||
            !Array.isArray(structureEventResult.bearishEvents)) {
            return failure("INVALID_INPUT_RESULT", null);
        }
        if (structureEventResult.schemaVersion !== SOURCE_SCHEMA_VERSION) {
            return failure("SCHEMA_VERSION_MISMATCH", null);
        }
        market = cleanMarket(structureEventResult.market);
        if (!market) {
            return failure("MARKET_MISSING", null);
        }
        sourceEvents = structureEventResult.events;
        if (structureEventResult.sourceBreakCount !== sourceEvents.length ||
            structureEventResult.eventCount !== sourceEvents.length) {
            return failure("EVENT_ARRAY_PROJECTION_MISMATCH", market);
        }
        bullish = sourceEvents.filter(function (item) {
            return item && item.direction === "BULLISH";
        });
        bearish = sourceEvents.filter(function (item) {
            return item && item.direction === "BEARISH";
        });
        if (!projectionMatches(structureEventResult.bullishEvents, bullish) ||
            !projectionMatches(structureEventResult.bearishEvents, bearish)) {
            return failure("EVENT_ARRAY_PROJECTION_MISMATCH", market);
        }
        if (!latestMatches(structureEventResult.latestBullishEvent,
            bullish.length ? bullish[bullish.length - 1] : null) ||
            !latestMatches(structureEventResult.latestBearishEvent,
                bearish.length ? bearish[bearish.length - 1] : null)) {
            return failure("LATEST_EVENT_PROJECTION_MISMATCH", market);
        }
        for (var index = 0; index < sourceEvents.length; index += 1) {
            var source = sourceEvents[index];
            if (!validSourceEvent(source, market)) {
                return failure("EVENT_CONTRACT_CONFLICT", market);
            }
            if (ids.has(source.id)) {
                return failure("DUPLICATE_EVENT_ID", market);
            }
            if (!inCanonicalOrder(index ? sourceEvents[index - 1] : null, source)) {
                return failure("CHRONOLOGY_VIOLATION", market);
            }
            ids.add(source.id);
            var event = classify(source, market, regime);
            if (resolvedIds.has(event.id)) {
                return failure("DUPLICATE_EVENT_ID", market);
            }
            resolvedIds.add(event.id);
            resolved.push(event);
            regime = event.regimeAfter;
        }
        initialBreaks = select(resolved, function (item) {
            return item.type === "INITIAL_BREAK";
        });
        bosEvents = select(resolved, function (item) {
            return item.type === "BOS";
        });
        chochEvents = select(resolved, function (item) {
            return item.type === "CHOCH";
        });
        bullishEvents = select(resolved, function (item) {
            return item.direction === "BULLISH";
        });
        bearishEvents = select(resolved, function (item) {
            return item.direction === "BEARISH";
        });
        return {
            valid: true,
            error: null,
            ready: structureEventResult.ready,
            schemaVersion: SCHEMA_VERSION,
            market: copy(market),
            sourceEventCount: sourceEvents.length,
            resolvedEventCount: resolved.length,
            initialRegime: INITIAL_REGIME,
            currentRegime: regime,
            events: resolved.map(copy),
            initialBreaks: initialBreaks,
            bosEvents: bosEvents,
            chochEvents: chochEvents,
            bullishEvents: bullishEvents,
            bearishEvents: bearishEvents,
            latestEvent: resolved.length ? copy(resolved[resolved.length - 1]) : null,
            latestBos: bosEvents.length ? copy(bosEvents[bosEvents.length - 1]) : null,
            latestChoch: chochEvents.length
                ? copy(chochEvents[chochEvents.length - 1]) : null
        };
    }

    return {
        getVocabulary: getVocabulary,
        resolveStructure: resolveStructure
    };
}));
