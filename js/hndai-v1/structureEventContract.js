(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
    if (root && typeof root === "object") {
        root.HNDStructureEventContract = api;
    }
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_EVENT_V1";
    var BREAK_FIELDS = [
        "type", "direction", "breakAtIndex", "breakOpenTime", "breakCloseTime",
        "breakClosePrice", "levelType", "levelClassification", "levelCandidateIndex",
        "levelOpenTime", "levelCloseTime", "levelPrice", "levelConfirmedAtIndex",
        "levelConfirmedAtOpenTime", "levelConfirmedAtCloseTime"
    ];

    function getSchemaVersion() {
        return SCHEMA_VERSION;
    }

    function getVocabulary() {
        return {
            schemaVersions: [SCHEMA_VERSION],
            kinds: ["STRUCTURE_BREAK"],
            statuses: ["CONFIRMED"],
            directions: ["BULLISH", "BEARISH"],
            breakTypes: [
                "BREAK_ABOVE_SWING_HIGH",
                "BREAK_BELOW_SWING_LOW"
            ],
            levelTypes: ["SWING_HIGH", "SWING_LOW"]
        };
    }

    function cleanMarket(marketContext) {
        var symbol;
        var interval;
        if (!marketContext || typeof marketContext !== "object" ||
            Array.isArray(marketContext) ||
            typeof marketContext.symbol !== "string" ||
            typeof marketContext.interval !== "string") {
            return null;
        }
        symbol = marketContext.symbol.trim().toUpperCase();
        interval = marketContext.interval.trim();
        if (!symbol || !interval) {
            return null;
        }
        return { symbol: symbol, interval: interval };
    }

    function failure(error, market) {
        return {
            valid: false,
            error: error,
            ready: false,
            schemaVersion: SCHEMA_VERSION,
            market: market ? { symbol: market.symbol, interval: market.interval } : null,
            sourceBreakCount: 0,
            eventCount: 0,
            events: [],
            bullishEvents: [],
            bearishEvents: [],
            latestBullishEvent: null,
            latestBearishEvent: null
        };
    }

    function safeIndex(value) {
        return typeof value === "number" &&
            Number.isSafeInteger(value) && value >= 0;
    }

    function finite(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function safeTimestamp(value) {
        return typeof value === "number" &&
            Number.isSafeInteger(value) && value >= 0;
    }

    function sameBreak(left, right) {
        return !!left && !!right && BREAK_FIELDS.every(function (field) {
            return left[field] === right[field];
        });
    }

    function arraysMatch(actual, expected) {
        return Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every(function (item, index) {
                return sameBreak(actual[index], item);
            });
    }

    function validBreak(item) {
        var bullish;
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            return false;
        }
        bullish = item.direction === "BULLISH";
        if (!bullish && item.direction !== "BEARISH") {
            return false;
        }
        if (item.type !== (bullish
            ? "BREAK_ABOVE_SWING_HIGH" : "BREAK_BELOW_SWING_LOW") ||
            item.levelType !== (bullish ? "SWING_HIGH" : "SWING_LOW")) {
            return false;
        }
        if (!safeIndex(item.levelCandidateIndex) ||
            !safeIndex(item.levelConfirmedAtIndex) ||
            !safeIndex(item.breakAtIndex) ||
            !(item.levelCandidateIndex < item.levelConfirmedAtIndex &&
                item.levelConfirmedAtIndex < item.breakAtIndex)) {
            return false;
        }
        if (!safeTimestamp(item.levelOpenTime) ||
            !safeTimestamp(item.levelCloseTime) ||
            !safeTimestamp(item.levelConfirmedAtOpenTime) ||
            !safeTimestamp(item.levelConfirmedAtCloseTime) ||
            !safeTimestamp(item.breakOpenTime) ||
            !safeTimestamp(item.breakCloseTime) ||
            !(item.levelOpenTime < item.levelCloseTime &&
                item.levelCloseTime < item.levelConfirmedAtOpenTime &&
                item.levelConfirmedAtOpenTime < item.levelConfirmedAtCloseTime &&
                item.levelConfirmedAtCloseTime < item.breakOpenTime &&
                item.breakOpenTime < item.breakCloseTime)) {
            return false;
        }
        if (!finite(item.breakClosePrice) || !finite(item.levelPrice) ||
            (bullish
                ? item.breakClosePrice <= item.levelPrice
                : item.breakClosePrice >= item.levelPrice)) {
            return false;
        }
        return (bullish
            ? ["INITIAL_HIGH", "HIGHER_HIGH", "LOWER_HIGH", "EQUAL_HIGH"]
            : ["INITIAL_LOW", "HIGHER_LOW", "LOWER_LOW", "EQUAL_LOW"]
        ).indexOf(item.levelClassification) !== -1;
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

    function makeId(item, market) {
        return [
            SCHEMA_VERSION,
            market.symbol,
            market.interval,
            item.type,
            item.breakOpenTime,
            item.levelType,
            item.levelOpenTime,
            item.levelPrice
        ].map(function (part) {
            return encodeURIComponent(String(part));
        }).join("|");
    }

    function makeEvent(item, market) {
        return {
            id: makeId(item, market),
            schemaVersion: SCHEMA_VERSION,
            kind: "STRUCTURE_BREAK",
            status: "CONFIRMED",
            symbol: market.symbol,
            interval: market.interval,
            direction: item.direction,
            breakType: item.type,
            breakAtIndex: item.breakAtIndex,
            breakOpenTime: item.breakOpenTime,
            breakCloseTime: item.breakCloseTime,
            breakClosePrice: item.breakClosePrice,
            levelType: item.levelType,
            levelClassification: item.levelClassification,
            levelCandidateIndex: item.levelCandidateIndex,
            levelOpenTime: item.levelOpenTime,
            levelCloseTime: item.levelCloseTime,
            levelPrice: item.levelPrice,
            levelConfirmedAtIndex: item.levelConfirmedAtIndex,
            levelConfirmedAtOpenTime: item.levelConfirmedAtOpenTime,
            levelConfirmedAtCloseTime: item.levelConfirmedAtCloseTime
        };
    }

    function copy(item) {
        return Object.assign({}, item);
    }

    function buildStructureEvents(breakResult, marketContext) {
        var market = cleanMarket(marketContext);
        var breaks;
        var expectedBullish;
        var expectedBearish;
        var events = [];
        var ids = new Set();
        var bullishEvents;
        var bearishEvents;
        if (!market) {
            return failure("INVALID_MARKET_CONTEXT", null);
        }
        if (!breakResult || typeof breakResult !== "object" ||
            Array.isArray(breakResult) || breakResult.valid !== true ||
            typeof breakResult.ready !== "boolean" ||
            !Array.isArray(breakResult.breaks) ||
            !Array.isArray(breakResult.bullishBreaks) ||
            !Array.isArray(breakResult.bearishBreaks)) {
            return failure("STRUCTURE_BREAK_RESULT_INVALID", market);
        }
        breaks = breakResult.breaks;
        expectedBullish = breaks.filter(function (item) {
            return item && item.direction === "BULLISH";
        });
        expectedBearish = breaks.filter(function (item) {
            return item && item.direction === "BEARISH";
        });
        if (!arraysMatch(breakResult.bullishBreaks, expectedBullish) ||
            !arraysMatch(breakResult.bearishBreaks, expectedBearish) ||
            (expectedBullish.length
                ? !sameBreak(breakResult.latestBullishBreak,
                    expectedBullish[expectedBullish.length - 1])
                : breakResult.latestBullishBreak !== null) ||
            (expectedBearish.length
                ? !sameBreak(breakResult.latestBearishBreak,
                    expectedBearish[expectedBearish.length - 1])
                : breakResult.latestBearishBreak !== null)) {
            return failure("STRUCTURE_BREAK_ALIGNMENT_ERROR", market);
        }
        for (var index = 0; index < breaks.length; index += 1) {
            if (!validBreak(breaks[index])) {
                return failure("STRUCTURE_BREAK_ALIGNMENT_ERROR", market);
            }
            var event = makeEvent(breaks[index], market);
            if (ids.has(event.id)) {
                return failure("DUPLICATE_STRUCTURE_EVENT", market);
            }
            if (!inCanonicalOrder(index ? breaks[index - 1] : null, breaks[index])) {
                return failure("STRUCTURE_BREAK_ALIGNMENT_ERROR", market);
            }
            ids.add(event.id);
            events.push(event);
        }
        bullishEvents = events.filter(function (item) {
            return item.direction === "BULLISH";
        }).map(copy);
        bearishEvents = events.filter(function (item) {
            return item.direction === "BEARISH";
        }).map(copy);
        return {
            valid: true,
            error: null,
            ready: breakResult.ready === true,
            schemaVersion: SCHEMA_VERSION,
            market: { symbol: market.symbol, interval: market.interval },
            sourceBreakCount: breaks.length,
            eventCount: events.length,
            events: events.map(copy),
            bullishEvents: bullishEvents,
            bearishEvents: bearishEvents,
            latestBullishEvent: bullishEvents.length
                ? copy(bullishEvents[bullishEvents.length - 1]) : null,
            latestBearishEvent: bearishEvents.length
                ? copy(bearishEvents[bearishEvents.length - 1]) : null
        };
    }

    return {
        getSchemaVersion: getSchemaVersion,
        getVocabulary: getVocabulary,
        buildStructureEvents: buildStructureEvents
    };
}));
