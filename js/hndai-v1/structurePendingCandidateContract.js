(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructurePendingCandidateContract = api;
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_PENDING_CANDIDATE_V1";
    var DEFAULT_POLICY = { maximumPendingBars: 100 };
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function getSchemaVersion() { return SCHEMA; }
    function getVocabulary() { return { schemaVersions: [SCHEMA], statuses: ["PENDING", "RESOLVED", "EXPIRED", "INVALID"], directions: ["LONG", "SHORT"], sourceSwingTypes: ["SWING_HIGH", "SWING_LOW"] }; }
    function getDefaultPolicy() { return clone(DEFAULT_POLICY); }
    function index(value) { return Number.isSafeInteger(value) && value >= 0; }
    function time(value) { return Number.isSafeInteger(value) && value > 0; }
    function market(context) {
        if (!context || typeof context !== "object" || typeof context.symbol !== "string" || typeof context.interval !== "string") return null;
        var symbol = context.symbol.trim().toUpperCase(), interval = context.interval.trim();
        return symbol && interval ? { symbol: symbol, interval: interval } : null;
    }
    function policy(value) {
        var input = value === undefined ? DEFAULT_POLICY : value;
        return input && typeof input === "object" && Object.keys(input).length === 1 &&
            Number.isSafeInteger(input.maximumPendingBars) && input.maximumPendingBars > 0
            ? { maximumPendingBars: input.maximumPendingBars } : null;
    }
    function invalid(error) { return { valid: false, error: error, schemaVersion: SCHEMA, status: "INVALID", candidate: null }; }
    function sourceId(symbol, interval, type, candidateIndex, confirmedAtIndex, confirmedAtCloseTime) {
        return [SCHEMA, symbol, interval, type, candidateIndex, confirmedAtIndex, confirmedAtCloseTime]
            .map(function (part) { return encodeURIComponent(String(part)); }).join("|");
    }
    function createCandidate(swing, context, policyInput) {
        var m = market(context), p = policy(policyInput);
        if (!m || !p || !swing || typeof swing !== "object") return invalid("INVALID_CREATE_INPUT");
        if (!["SWING_HIGH", "SWING_LOW"].includes(swing.type) || !index(swing.candidateIndex) ||
            !index(swing.confirmedAtIndex) || swing.confirmedAtIndex <= swing.candidateIndex ||
            !time(swing.confirmedAtCloseTime) || !index(context.evaluationAtIndex) ||
            !time(context.evaluationCloseTime) || context.evaluationAtIndex !== swing.confirmedAtIndex ||
            context.evaluationCloseTime !== swing.confirmedAtCloseTime) return invalid("NOT_EXACT_CONFIRMATION_CANDLE");
        var id = sourceId(m.symbol, m.interval, swing.type, swing.candidateIndex,
            swing.confirmedAtIndex, swing.confirmedAtCloseTime);
        var candidate = { key: id, symbol: m.symbol, interval: m.interval,
            direction: swing.type === "SWING_HIGH" ? "LONG" : "SHORT", sourceSwingId: id,
            sourceSwingType: swing.type, sourceSwingCandidateIndex: swing.candidateIndex,
            sourceSwingConfirmedAtIndex: swing.confirmedAtIndex,
            sourceSwingConfirmedAtCloseTime: swing.confirmedAtCloseTime,
            createdAtIndex: context.evaluationAtIndex, createdAtCloseTime: context.evaluationCloseTime,
            status: "PENDING", resolvedByEventId: null, resolvedAtIndex: null,
            resolvedAtCloseTime: null, expiresAtIndex: context.evaluationAtIndex + p.maximumPendingBars };
        return { valid: true, error: null, schemaVersion: SCHEMA, status: candidate.status, candidate: clone(candidate) };
    }
    function validPending(candidate) {
        return candidate && typeof candidate === "object" && candidate.status === "PENDING" &&
            typeof candidate.key === "string" && candidate.key === candidate.sourceSwingId &&
            typeof candidate.symbol === "string" && typeof candidate.interval === "string" &&
            ["LONG", "SHORT"].includes(candidate.direction) && ["SWING_HIGH", "SWING_LOW"].includes(candidate.sourceSwingType) &&
            index(candidate.sourceSwingCandidateIndex) && index(candidate.sourceSwingConfirmedAtIndex) &&
            time(candidate.sourceSwingConfirmedAtCloseTime) && index(candidate.createdAtIndex) &&
            time(candidate.createdAtCloseTime) && index(candidate.expiresAtIndex) &&
            candidate.resolvedByEventId === null && candidate.resolvedAtIndex === null && candidate.resolvedAtCloseTime === null;
    }
    function resolveCandidate(candidate, event, context) {
        var m = market(context);
        if (!validPending(candidate)) return invalid("CANDIDATE_NOT_PENDING");
        if (!m || !event || typeof event !== "object" || !index(context.evaluationAtIndex) || !time(context.evaluationCloseTime)) return invalid("INVALID_RESOLUTION_INPUT");
        var expectedDirection = event.direction === "BULLISH" ? "LONG" : event.direction === "BEARISH" ? "SHORT" : null;
        var identity = sourceId(m.symbol, m.interval, event.levelType, event.levelCandidateIndex,
            event.levelConfirmedAtIndex, event.levelConfirmedAtCloseTime);
        if (m.symbol !== candidate.symbol || m.interval !== candidate.interval || event.symbol !== candidate.symbol ||
            event.interval !== candidate.interval || expectedDirection !== candidate.direction || identity !== candidate.sourceSwingId)
            return invalid("SOURCE_SWING_IDENTITY_MISMATCH");
        if (event.breakAtIndex !== context.evaluationAtIndex || event.breakCloseTime !== context.evaluationCloseTime ||
            event.breakAtIndex <= candidate.sourceSwingConfirmedAtIndex) return invalid("NOT_EXACT_RESOLUTION_CANDLE");
        if (context.evaluationAtIndex >= candidate.expiresAtIndex) return invalid("CANDIDATE_EXPIRED");
        if (typeof event.id !== "string" || !event.id) return invalid("INVALID_STRUCTURE_EVENT_ID");
        var resolved = clone(candidate);
        resolved.status = "RESOLVED"; resolved.resolvedByEventId = event.id;
        resolved.resolvedAtIndex = context.evaluationAtIndex; resolved.resolvedAtCloseTime = context.evaluationCloseTime;
        return { valid: true, error: null, schemaVersion: SCHEMA, status: resolved.status, candidate: resolved };
    }
    function expireCandidate(candidate, context, policyInput) {
        var m = market(context), p = policy(policyInput);
        if (!validPending(candidate)) return invalid("CANDIDATE_NOT_PENDING");
        if (!m || !p || !index(context.evaluationAtIndex) || !time(context.evaluationCloseTime) ||
            m.symbol !== candidate.symbol || m.interval !== candidate.interval) return invalid("INVALID_EXPIRATION_INPUT");
        if (candidate.expiresAtIndex !== candidate.createdAtIndex + p.maximumPendingBars) return invalid("POLICY_MISMATCH");
        if (context.evaluationAtIndex < candidate.expiresAtIndex) return invalid("CANDIDATE_NOT_DUE_TO_EXPIRE");
        var expired = clone(candidate); expired.status = "EXPIRED";
        return { valid: true, error: null, schemaVersion: SCHEMA, status: expired.status, candidate: expired };
    }
    return { getSchemaVersion: getSchemaVersion, getVocabulary: getVocabulary,
        getDefaultPolicy: getDefaultPolicy, createCandidate: createCandidate,
        resolveCandidate: resolveCandidate, expireCandidate: expireCandidate };
}));
