(function () {
    "use strict";

    const HND_SETUP_VERSION = "4.1";
    const HND_SETUP_MIN_QUALITY = 60;
    const HND_SETUP_MAX_AGE_BARS = 24;
    const HND_SETUP_APPROACH_ATR = 0.25;
    const HND_SETUP_MAX_DISTANCE_ATR = 3;
    const HND_SETUP_INVALIDATION_BUFFER_ATR = 0.05;
    const HND_SETUP_MAX_HISTORY = 50;
    const HND_SETUP_DEBUG_VERSION = "4.1.1";
    const HND_SETUP_DEBUG_MAX_REJECTED_SAMPLES = 10;
    const HND_SETUP_DEBUG_MAX_TOP_CANDIDATES = 5;
    const HND_SETUP_STATES = Object.freeze({
        NO_SETUP: "NO_SETUP", PENDING: "PENDING", ARMED: "ARMED",
        TRIGGERED: "TRIGGERED", INVALIDATED: "INVALIDATED", MISSED: "MISSED"
    });
    const HND_SETUP_DEBUG_REASONS = Object.freeze({
        EXISTING_SETUP_LOCKED: "EXISTING_SETUP_LOCKED",
        EXISTING_SETUP_UPDATED: "EXISTING_SETUP_UPDATED",
        SETUP_TRIGGERED: "SETUP_TRIGGERED",
        SETUP_INVALIDATED: "SETUP_INVALIDATED",
        SETUP_MISSED: "SETUP_MISSED",
        WAIT_SIGNAL: "WAIT_SIGNAL",
        INVALID_PRICE: "INVALID_PRICE",
        NO_SOURCE_ZONES: "NO_SOURCE_ZONES",
        NO_VALID_QUALIFIED_ZONES: "NO_VALID_QUALIFIED_ZONES",
        NO_DIRECTION_MATCH: "NO_DIRECTION_MATCH",
        ALL_ZONES_INVALID_PRICE_SIDE: "ALL_ZONES_INVALID_PRICE_SIDE",
        NO_CANDIDATES: "NO_CANDIDATES",
        ALL_CANDIDATES_TOO_FAR: "ALL_CANDIDATES_TOO_FAR",
        ALL_CANDIDATES_LOW_QUALITY: "ALL_CANDIDATES_LOW_QUALITY",
        ALL_CANDIDATES_CONSUMED: "ALL_CANDIDATES_CONSUMED",
        SETUP_CREATED: "SETUP_CREATED",
        NO_ACCEPTED_CANDIDATE: "NO_ACCEPTED_CANDIDATE",
        SETUP_ENGINE_ERROR: "SETUP_ENGINE_ERROR"
    });
    const HND_SETUP_ZONE_REJECTION_REASONS = Object.freeze({
        INVALID_ZONE: "INVALID_ZONE",
        INVALID_ID: "INVALID_ID",
        WRONG_KIND: "WRONG_KIND",
        INVALID_DIRECTION: "INVALID_DIRECTION",
        UNSUPPORTED_STATUS: "UNSUPPORTED_STATUS",
        NOT_STRUCTURE_QUALIFIED: "NOT_STRUCTURE_QUALIFIED",
        NOT_STRUCTURE_SIGNIFICANT: "NOT_STRUCTURE_SIGNIFICANT",
        MISSING_STRUCTURE_EVENT: "MISSING_STRUCTURE_EVENT",
        INVALID_TIME: "INVALID_TIME",
        INVALID_BOUNDS: "INVALID_BOUNDS",
        INVALID_SIGNIFICANCE: "INVALID_SIGNIFICANCE",
        INVALID_ZONE_HEIGHT_ATR: "INVALID_ZONE_HEIGHT_ATR",
        INVALID_ATR: "INVALID_ATR",
        DIRECTION_MISMATCH: "DIRECTION_MISMATCH",
        INVALID_PRICE_SIDE: "INVALID_PRICE_SIDE"
    });

    let currentSetup = null;
    let lastTerminalSetup = null;
    let setupHistory = [];
    let consumedSetupKeys = new Set();
    let lastEvaluation = null;
    let lastStructureShadow = null;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }
    function finitePositive(value) { return Number.isFinite(value) && value > 0; }
    function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }

    function normalizeSetupCandles(source) {
        const byTime = new Map();
        (Array.isArray(source) ? source : []).forEach(item => {
            if (!item || !finitePositive(item.time) || !finitePositive(item.open) ||
                !finitePositive(item.high) || !finitePositive(item.low) ||
                !finitePositive(item.close) || item.high < item.open ||
                item.high < item.close || item.high < item.low || item.low > item.open ||
                item.low > item.close || (item.volume !== undefined && !Number.isFinite(item.volume)) ||
                (item.closeTime !== undefined && !finitePositive(item.closeTime))) return;
            byTime.set(item.time, {
                time: item.time, open: item.open, high: item.high, low: item.low, close: item.close,
                ...(item.volume !== undefined ? { volume: item.volume } : {}),
                ...(item.closeTime !== undefined ? { closeTime: item.closeTime } : {})
            });
        });
        return [...byTime.values()].sort((a, b) => a.time - b.time);
    }

    function getLastClosedSetupCandle(candles, now = Date.now()) {
        const data = normalizeSetupCandles(candles);
        if (!data.length) return null;
        const closed = data.filter(candle => Number.isFinite(candle.closeTime) && candle.closeTime <= now);
        if (closed.length) return clone(closed[closed.length - 1]);
        if (data.some(candle => Number.isFinite(candle.closeTime))) return null;
        return data.length > 1 ? clone(data[data.length - 2]) : null;
    }

    function calculateSetupTrueRange(candle, previousCandle) {
        if (!candle) return null;
        const range = candle.high - candle.low;
        return previousCandle ? Math.max(range,
            Math.abs(candle.high - previousCandle.close),
            Math.abs(candle.low - previousCandle.close)) : range;
    }

    function calculateSetupATR(candles, period = 14) {
        const data = normalizeSetupCandles(candles);
        const ranges = data.map((candle, index) =>
            calculateSetupTrueRange(candle, index ? data[index - 1] : null)
        ).filter(finitePositive).slice(-Math.max(1, period));
        if (!ranges.length) return null;
        const atr = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
        return finitePositive(atr) ? atr : null;
    }

    function getRejectedZoneSample(zone) {
        return {
            id: typeof zone?.id === "string" ? zone.id : null,
            kind: typeof zone?.kind === "string" ? zone.kind : null,
            type: typeof zone?.type === "string" ? zone.type : null,
            status: typeof zone?.status === "string" ? zone.status : null
        };
    }

    function inspectSetupZone(zone, expectedKind, fallbackATR) {
        const reject = reason => ({
            accepted: false, reason, zone: null, sample: getRejectedZoneSample(zone)
        });
        if (!zone || typeof zone !== "object" || Array.isArray(zone))
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.INVALID_ZONE);
        if (typeof zone.id !== "string" || !zone.id.trim())
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.INVALID_ID);
        if (zone.kind !== expectedKind || !["ORDER_BLOCK", "FVG"].includes(zone.kind))
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.WRONG_KIND);
        if (!["BULLISH", "BEARISH"].includes(zone.type))
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.INVALID_DIRECTION);
        if (!["ACTIVE", "TOUCHED"].includes(zone.status))
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.UNSUPPORTED_STATUS);
        if (zone.structureQualified !== true)
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.NOT_STRUCTURE_QUALIFIED);
        if (zone.structureSignificant !== true)
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.NOT_STRUCTURE_SIGNIFICANT);
        if (typeof zone.structureEventId !== "string" || !zone.structureEventId.trim())
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.MISSING_STRUCTURE_EVENT);
        if (!finitePositive(zone.startTime) || !finitePositive(zone.confirmationTime))
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.INVALID_TIME);
        const top = expectedKind === "ORDER_BLOCK" ? zone.high : zone.top;
        const bottom = expectedKind === "ORDER_BLOCK" ? zone.low : zone.bottom;
        if (!finitePositive(top) || !finitePositive(bottom) || top < bottom)
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.INVALID_BOUNDS);
        if (!Number.isFinite(zone.structureSignificanceScore))
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.INVALID_SIGNIFICANCE);
        if (!Number.isFinite(zone.zoneHeightATR) || zone.zoneHeightATR < 0)
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.INVALID_ZONE_HEIGHT_ATR);
        const atr = finitePositive(zone.structureATR) ? zone.structureATR : fallbackATR;
        if (!finitePositive(atr))
            return reject(HND_SETUP_ZONE_REJECTION_REASONS.INVALID_ATR);
        const normalizedZone = {
            id: zone.id, kind: zone.kind, type: zone.type, status: zone.status, top, bottom,
            midpoint: (top + bottom) / 2,
            touches: Number.isFinite(zone.touches) && zone.touches >= 0 ? zone.touches : 0,
            structureEventId: zone.structureEventId,
            structureEventType: typeof zone.structureEventType === "string" ? zone.structureEventType : null,
            structureConfirmationIndex: Number.isInteger(zone.structureConfirmationIndex)
                ? zone.structureConfirmationIndex : -1,
            structureConfirmationTime: finitePositive(zone.structureConfirmationTime)
                ? zone.structureConfirmationTime : zone.confirmationTime,
            structureSignificanceScore: zone.structureSignificanceScore,
            structureATR: atr, zoneHeightATR: zone.zoneHeightATR,
            dominantQualifiedZone: zone.dominantQualifiedZone === true,
            qualificationVersion: typeof zone.qualificationVersion === "string" ? zone.qualificationVersion : null,
            startTime: zone.startTime, confirmationTime: zone.confirmationTime
        };
        return { accepted: true, reason: null, zone: normalizedZone };
    }

    function normalizeSetupZone(zone, expectedKind, fallbackATR) {
        return inspectSetupZone(zone, expectedKind, fallbackATR).zone;
    }

    function getSetupZoneDistance(price, zone) {
        if (price > zone.top) return price - zone.top;
        if (price < zone.bottom) return zone.bottom - price;
        return 0;
    }

    function getSetupMTFAlignment(mtfState, direction) {
        const sourceRows = Array.isArray(mtfState?.rows)
            ? mtfState.rows
            : mtfState?.rows && typeof mtfState.rows === "object"
                ? Object.values(mtfState.rows) : [];
        const rows = sourceRows.filter(row => row?.status === "OK");
        let matching = 0, opposing = 0, neutral = 0;
        rows.forEach(row => {
            const trend = String(row.trend || "").toUpperCase();
            if (trend === (direction === "LONG" ? "BULL" : "BEAR")) matching += 1;
            else if (trend === (direction === "LONG" ? "BEAR" : "BULL")) opposing += 1;
            else neutral += 1;
        });
        let status = "NO_DATA";
        if (rows.length && matching > 0 && opposing === 0) status = "ALIGNED";
        else if (rows.length && opposing > 0 && matching === 0) status = "OPPOSED";
        else if (rows.length) status = "MIXED";
        return { status, matching, opposing, neutral,
            score: status === "ALIGNED" ? 5 : status === "MIXED" ? 2 : 0 };
    }

    function makeCandidate(zones, sourceType, direction, price, fallbackATR) {
        const atrValues = zones.map(zone => zone.structureATR).filter(finitePositive);
        const atr = atrValues.length ? Math.max(...atrValues) : fallbackATR;
        const entryLow = sourceType === "OB_FVG_CONFLUENCE"
            ? Math.max(...zones.map(zone => zone.bottom)) : zones[0].bottom;
        const entryHigh = sourceType === "OB_FVG_CONFLUENCE"
            ? Math.min(...zones.map(zone => zone.top)) : zones[0].top;
        if (!finitePositive(atr) || entryLow > entryHigh) return null;
        const distanceATR = getSetupZoneDistance(price, { bottom: entryLow, top: entryHigh }) / atr;
        return {
            sourceType, direction, zoneIds: zones.map(zone => zone.id).sort(),
            orderBlockId: zones.find(zone => zone.kind === "ORDER_BLOCK")?.id || null,
            fvgId: zones.find(zone => zone.kind === "FVG")?.id || null,
            structureEventId: zones[0].structureEventId, entryLow, entryHigh,
            entryTarget: (entryLow + entryHigh) / 2, atr, distanceATR,
            structureSignificanceScore: Math.max(...zones.map(zone => zone.structureSignificanceScore)),
            zoneHeightATR: Math.max(...zones.map(zone => zone.zoneHeightATR)),
            dominantQualifiedZone: zones.some(zone => zone.dominantQualifiedZone),
            status: zones.every(zone => zone.status === "ACTIVE") ? "ACTIVE" : "TOUCHED",
            totalTouches: zones.reduce((sum, zone) => sum + zone.touches, 0),
            structureConfirmationIndex: Math.max(...zones.map(zone => zone.structureConfirmationIndex)),
            zones: zones.map(clone)
        };
    }

    function addSetupRejectedSample(debug, sample) {
        if (!debug || debug.rejectedSamples.length >= HND_SETUP_DEBUG_MAX_REJECTED_SAMPLES) return;
        const finiteOrNull = value => Number.isFinite(value) ? value : null;
        debug.rejectedSamples.push({
            stage: typeof sample?.stage === "string" ? sample.stage : null,
            reason: typeof sample?.reason === "string" ? sample.reason : null,
            id: typeof sample?.id === "string" ? sample.id : null,
            key: typeof sample?.key === "string" ? sample.key : null,
            kind: typeof sample?.kind === "string" ? sample.kind : null,
            type: typeof sample?.type === "string" ? sample.type : null,
            status: typeof sample?.status === "string" ? sample.status : null,
            sourceType: typeof sample?.sourceType === "string" ? sample.sourceType : null,
            distanceATR: finiteOrNull(sample?.distanceATR),
            quality: finiteOrNull(sample?.quality),
            structureEventId: typeof sample?.structureEventId === "string"
                ? sample.structureEventId : null,
            zoneIds: Array.isArray(sample?.zoneIds)
                ? sample.zoneIds.filter(id => typeof id === "string").slice() : []
        });
    }

    function createSetupDebug(input, existingSetup = null, evaluatedAt = Date.now()) {
        const orderBlocks = Array.isArray(input.qualifiedPriceZones?.orderBlocks)
            ? input.qualifiedPriceZones.orderBlocks.length : 0;
        const fvgs = Array.isArray(input.qualifiedPriceZones?.fvgs)
            ? input.qualifiedPriceZones.fvgs.length : 0;
        const signal = typeof input.analysis?.signal === "string" ? input.analysis.signal : null;
        const expectedDirection = signal === "LONG" ? "LONG" : signal === "SHORT" ? "SHORT" : null;
        const expectedZoneType = expectedDirection === "LONG" ? "BULLISH"
            : expectedDirection === "SHORT" ? "BEARISH" : null;
        const validationReasons = {};
        Object.values(HND_SETUP_ZONE_REJECTION_REASONS).slice(0, 13)
            .forEach(reason => { validationReasons[reason] = 0; });
        return {
            version: HND_SETUP_DEBUG_VERSION,
            symbol: String(input.symbol || ""),
            interval: String(input.interval || ""),
            price: Number.isFinite(input.price) ? input.price : null,
            signal,
            expectedDirection,
            expectedZoneType,
            evaluatedAt,
            primaryReason: null,
            existingSetup: {
                present: Boolean(existingSetup),
                id: existingSetup?.id ?? null,
                key: existingSetup?.key ?? null,
                state: existingSetup?.state ?? null
            },
            source: { orderBlocks, fvgs, total: orderBlocks + fvgs },
            validation: {
                acceptedOrderBlocks: 0, acceptedFVGs: 0, acceptedTotal: 0,
                rejectedTotal: 0, reasons: validationReasons
            },
            direction: { matchedOrderBlocks: 0, matchedFVGs: 0, matchedTotal: 0, rejected: 0 },
            priceSide: { accepted: 0, rejected: 0 },
            confluence: {
                pairsChecked: 0, sameDirectionPairs: 0, sameEventPairs: 0,
                overlappingPairs: 0, candidates: 0
            },
            singleCandidates: { orderBlocks: 0, fvgs: 0, total: 0 },
            distance: { maxATR: HND_SETUP_MAX_DISTANCE_ATR, accepted: 0, rejected: 0 },
            quality: { minimum: HND_SETUP_MIN_QUALITY, accepted: 0, rejected: 0 },
            consumed: { accepted: 0, rejected: 0 },
            final: { candidates: 0, selectedKey: null, selectedQuality: null, selectedSourceType: null },
            topCandidates: [],
            rejectedSamples: []
        };
    }

    function buildConfluenceCandidates(orderBlocks, fvgs, direction, price, atr, debug = null) {
        const candidates = [];
        orderBlocks.forEach(ob => fvgs.forEach(fvg => {
            if (debug) debug.confluence.pairsChecked += 1;
            if (ob.type !== fvg.type) return;
            if (debug) debug.confluence.sameDirectionPairs += 1;
            if (ob.structureEventId !== fvg.structureEventId) return;
            if (debug) debug.confluence.sameEventPairs += 1;
            if (Math.max(ob.bottom, fvg.bottom) > Math.min(ob.top, fvg.top)) return;
            if (debug) debug.confluence.overlappingPairs += 1;
            const candidate = makeCandidate([ob, fvg], "OB_FVG_CONFLUENCE", direction, price, atr);
            if (candidate) {
                candidates.push(candidate);
                if (debug) debug.confluence.candidates += 1;
            }
        }));
        return candidates;
    }

    function calculateSetupQuality(candidate, context) {
        const directionBias = candidate.direction === "LONG" ? "BULLISH" : "BEARISH";
        const marketBias = String(context.analysis?.marketBias || "NEUTRAL").toUpperCase();
        const score = clamp(candidate.structureSignificanceScore, 0, 100) * 0.30 +
            (candidate.dominantQualifiedZone ? 10 : 0) + (candidate.status === "ACTIVE" ? 10 : 6) +
            clamp(candidate.zoneHeightATR * 10, 0, 10) +
            clamp(15 * (1 - candidate.distanceATR / HND_SETUP_MAX_DISTANCE_ATR), 0, 15) +
            (candidate.sourceType === "OB_FVG_CONFLUENCE" ? 15 : 0) +
            (marketBias === directionBias ? 5 : marketBias === "NEUTRAL" ? 2 : 0) +
            context.mtfAlignment.score - Math.min(10, candidate.totalTouches * 2);
        return clamp(Math.round(score), 0, 100);
    }

    function createSetupKey(candidate, symbol, interval) {
        return [String(symbol || "").toUpperCase(), String(interval || ""), candidate.direction,
            candidate.structureEventId, candidate.zoneIds.slice().sort().join(",")].join("|");
    }

    function compareSetupCandidates(first, second) {
        return second.quality - first.quality ||
            Number(second.sourceType === "OB_FVG_CONFLUENCE") - Number(first.sourceType === "OB_FVG_CONFLUENCE") ||
            second.structureSignificanceScore - first.structureSignificanceScore ||
            second.zoneHeightATR - first.zoneHeightATR || first.distanceATR - second.distanceATR ||
            Number(second.status === "ACTIVE") - Number(first.status === "ACTIVE") ||
            second.structureConfirmationIndex - first.structureConfirmationIndex || first.key.localeCompare(second.key);
    }

    function buildCandidatesDetailed(input = {}, pureOptions = null) {
        const historicalConsumedKeys = pureOptions && pureOptions.consumedCandidateKeys instanceof Set
            ? pureOptions.consumedCandidateKeys : consumedSetupKeys;
        const evaluationTime = pureOptions && Number.isSafeInteger(pureOptions.evaluationTime)
            ? pureOptions.evaluationTime : Date.now();
        const debug = createSetupDebug(input, null, evaluationTime);
        const price = input.price;
        const direction = input.analysis?.signal === "LONG" ? "LONG"
            : input.analysis?.signal === "SHORT" ? "SHORT" : null;
        if (!direction) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.WAIT_SIGNAL;
            return { candidates: [], debug };
        }
        if (!finitePositive(price)) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.INVALID_PRICE;
            return { candidates: [], debug };
        }
        if (!debug.source.total) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.NO_SOURCE_ZONES;
            return { candidates: [], debug };
        }
        const fallbackATR = calculateSetupATR(input.candles);
        const expectedType = direction === "LONG" ? "BULLISH" : "BEARISH";
        const zones = input.qualifiedPriceZones || {};
        const inspectList = (list, kind) => {
            const accepted = [];
            (Array.isArray(list) ? list : []).forEach(rawZone => {
                const inspection = inspectSetupZone(rawZone, kind, fallbackATR);
                if (inspection.accepted) {
                    accepted.push(inspection.zone);
                    if (kind === "ORDER_BLOCK") debug.validation.acceptedOrderBlocks += 1;
                    else debug.validation.acceptedFVGs += 1;
                } else {
                    debug.validation.rejectedTotal += 1;
                    debug.validation.reasons[inspection.reason] += 1;
                    addSetupRejectedSample(debug, {
                        stage: "VALIDATION", reason: inspection.reason, ...inspection.sample
                    });
                }
            });
            return accepted;
        };
        const validOrderBlocks = inspectList(zones.orderBlocks, "ORDER_BLOCK");
        const validFVGs = inspectList(zones.fvgs, "FVG");
        debug.validation.acceptedTotal = validOrderBlocks.length + validFVGs.length;
        if (!debug.validation.acceptedTotal) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.NO_VALID_QUALIFIED_ZONES;
            return { candidates: [], debug };
        }
        const directionFilter = (list, kind) => list.filter(zone => {
            if (zone.type === expectedType) return true;
            debug.direction.rejected += 1;
            addSetupRejectedSample(debug, {
                stage: "DIRECTION", reason: HND_SETUP_ZONE_REJECTION_REASONS.DIRECTION_MISMATCH,
                id: zone.id, kind: zone.kind, type: zone.type, status: zone.status,
                structureEventId: zone.structureEventId
            });
            return false;
        });
        const directionOrderBlocks = directionFilter(validOrderBlocks, "ORDER_BLOCK");
        const directionFVGs = directionFilter(validFVGs, "FVG");
        debug.direction.matchedOrderBlocks = directionOrderBlocks.length;
        debug.direction.matchedFVGs = directionFVGs.length;
        debug.direction.matchedTotal = directionOrderBlocks.length + directionFVGs.length;
        if (!debug.direction.matchedTotal) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.NO_DIRECTION_MATCH;
            return { candidates: [], debug };
        }
        const priceSideFilter = list => list.filter(zone => {
            const accepted = direction === "LONG"
                ? price >= zone.bottom - zone.structureATR * HND_SETUP_INVALIDATION_BUFFER_ATR
                : price <= zone.top + zone.structureATR * HND_SETUP_INVALIDATION_BUFFER_ATR;
            if (accepted) debug.priceSide.accepted += 1;
            else {
                debug.priceSide.rejected += 1;
                addSetupRejectedSample(debug, {
                    stage: "PRICE_SIDE", reason: HND_SETUP_ZONE_REJECTION_REASONS.INVALID_PRICE_SIDE,
                    id: zone.id, kind: zone.kind, type: zone.type, status: zone.status,
                    structureEventId: zone.structureEventId
                });
            }
            return accepted;
        });
        const orderBlocks = priceSideFilter(directionOrderBlocks);
        const fvgs = priceSideFilter(directionFVGs);
        if (!debug.priceSide.accepted) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.ALL_ZONES_INVALID_PRICE_SIDE;
            return { candidates: [], debug };
        }
        const confluence = buildConfluenceCandidates(
            orderBlocks, fvgs, direction, price, fallbackATR, debug
        );
        const singleOrderBlocks = orderBlocks.map(zone =>
            makeCandidate([zone], "ORDER_BLOCK", direction, price, fallbackATR)
        ).filter(Boolean);
        const singleFVGs = fvgs.map(zone =>
            makeCandidate([zone], "FVG", direction, price, fallbackATR)
        ).filter(Boolean);
        debug.singleCandidates.orderBlocks = singleOrderBlocks.length;
        debug.singleCandidates.fvgs = singleFVGs.length;
        debug.singleCandidates.total = singleOrderBlocks.length + singleFVGs.length;
        const raw = confluence.concat(singleOrderBlocks, singleFVGs).filter(Boolean);
        if (!raw.length) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.NO_CANDIDATES;
            return { candidates: [], debug };
        }
        const mtfAlignment = getSetupMTFAlignment(input.mtfState, direction);
        const scored = raw.map(candidate => {
            candidate.mtfAlignment = mtfAlignment;
            candidate.quality = calculateSetupQuality(candidate, { analysis: input.analysis, mtfAlignment });
            candidate.key = createSetupKey(candidate, input.symbol, input.interval);
            return candidate;
        });
        const distanceAccepted = scored.filter(candidate => {
            const accepted = candidate.distanceATR <= HND_SETUP_MAX_DISTANCE_ATR;
            if (accepted) debug.distance.accepted += 1;
            else {
                debug.distance.rejected += 1;
                addSetupRejectedSample(debug, {
                    stage: "DISTANCE", reason: "MAX_DISTANCE_EXCEEDED", ...candidate
                });
            }
            return accepted;
        });
        const topSorted = scored.slice().sort(compareSetupCandidates);
        debug.topCandidates = topSorted.slice(0, HND_SETUP_DEBUG_MAX_TOP_CANDIDATES)
            .map(candidate => ({
                key: candidate.key, sourceType: candidate.sourceType, direction: candidate.direction,
                quality: candidate.quality, distanceATR: candidate.distanceATR,
                entryLow: candidate.entryLow, entryHigh: candidate.entryHigh,
                entryTarget: candidate.entryTarget, status: candidate.status,
                structureSignificanceScore: candidate.structureSignificanceScore,
                zoneHeightATR: candidate.zoneHeightATR,
                structureEventId: candidate.structureEventId,
                zoneIds: candidate.zoneIds.slice(),
                consumed: historicalConsumedKeys.has(candidate.key),
                accepted: candidate.distanceATR <= HND_SETUP_MAX_DISTANCE_ATR &&
                    candidate.quality >= HND_SETUP_MIN_QUALITY && !historicalConsumedKeys.has(candidate.key)
            }));
        if (!distanceAccepted.length) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.ALL_CANDIDATES_TOO_FAR;
            return { candidates: [], debug };
        }
        const qualityAccepted = distanceAccepted.filter(candidate => {
            const accepted = candidate.quality >= HND_SETUP_MIN_QUALITY;
            if (accepted) debug.quality.accepted += 1;
            else {
                debug.quality.rejected += 1;
                addSetupRejectedSample(debug, {
                    stage: "QUALITY", reason: "MINIMUM_QUALITY_NOT_MET", ...candidate
                });
            }
            return accepted;
        });
        if (!qualityAccepted.length) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.ALL_CANDIDATES_LOW_QUALITY;
            return { candidates: [], debug };
        }
        const accepted = qualityAccepted.filter(candidate => {
            const consumed = historicalConsumedKeys.has(candidate.key);
            if (consumed) {
                debug.consumed.rejected += 1;
                addSetupRejectedSample(debug, {
                    stage: "CONSUMED", reason: "SETUP_KEY_CONSUMED", ...candidate
                });
            } else debug.consumed.accepted += 1;
            return !consumed;
        }).sort(compareSetupCandidates);
        if (!accepted.length) {
            debug.primaryReason = HND_SETUP_DEBUG_REASONS.ALL_CANDIDATES_CONSUMED;
            return { candidates: [], debug };
        }
        const selected = accepted[0];
        debug.final.candidates = accepted.length;
        debug.final.selectedKey = selected.key;
        debug.final.selectedQuality = selected.quality;
        debug.final.selectedSourceType = selected.sourceType;
        debug.primaryReason = HND_SETUP_DEBUG_REASONS.SETUP_CREATED;
        return { candidates: accepted.map(clone), debug };
    }

    function buildCandidates(input = {}) {
        return buildCandidatesDetailed(input).candidates;
    }

    function evaluateCandidateDecisionBundle(input = {}, consumedCandidateKeys = [], evaluationTime) {
        if (!Array.isArray(consumedCandidateKeys) || !Number.isSafeInteger(evaluationTime) || evaluationTime <= 0)
            return { valid: false, error: "INVALID_PURE_EVALUATION_INPUT" };
        const consumed = new Set();
        for (const key of consumedCandidateKeys) {
            if (typeof key !== "string" || !key || consumed.has(key))
                return { valid: false, error: "INVALID_CONSUMED_CANDIDATE_KEYS" };
            consumed.add(key);
        }
        const detailed = buildCandidatesDetailed(clone(input), {
            consumedCandidateKeys: consumed, evaluationTime
        });
        const selected = detailed.candidates[0] || null;
        return clone({ valid: true, error: null, decision: selected ? "ALLOW" : "BLOCK",
            decisionSource: "HND_SETUP_ENGINE_BUILD_CANDIDATES_DETAILED_V4_1",
            reason: detailed.debug.primaryReason, candidate: selected,
            evidence: { debugVersion: detailed.debug.version,
                summary: {
                    sourceZones: detailed.debug.source.total,
                    validZones: detailed.debug.validation.acceptedTotal,
                    directionMatched: detailed.debug.direction.matchedTotal,
                    priceSideAccepted: detailed.debug.priceSide.accepted,
                    distanceAccepted: detailed.debug.distance.accepted,
                    qualityAccepted: detailed.debug.quality.accepted,
                    consumedRejected: detailed.debug.consumed.rejected,
                    acceptedCandidates: detailed.debug.final.candidates
                }, topCandidates: detailed.debug.topCandidates }, debug: detailed.debug });
    }

    function snapshotAnalysis(analysis) {
        return {
            signal: analysis?.signal ?? "WAIT", signalReason: analysis?.signalReason ?? null,
            confidence: Number.isFinite(analysis?.confidence) ? analysis.confidence : null,
            marketBias: analysis?.marketBias ?? null, trend: analysis?.trend ?? null,
            bullScore: Number.isFinite(analysis?.bullScore) ? analysis.bullScore : null,
            bearScore: Number.isFinite(analysis?.bearScore) ? analysis.bearScore : null,
            scoreDifference: Number.isFinite(analysis?.scoreDifference) ? analysis.scoreDifference : null
        };
    }

    function setupReason(candidate) {
        const side = candidate.direction === "LONG" ? "BULLISH" : "BEARISH";
        if (candidate.sourceType === "OB_FVG_CONFLUENCE") return `${side} OB + FVG RETEST SETUP`;
        return `${side} ${candidate.sourceType === "ORDER_BLOCK" ? "ORDER BLOCK" : "FVG"} RETEST`;
    }

    function createSetup(candidate, input, candles) {
        const latest = candles[candles.length - 1] || null;
        const now = Date.now();
        const inZone = input.price >= candidate.entryLow && input.price <= candidate.entryHigh;
        const state = inZone ? HND_SETUP_STATES.TRIGGERED
            : candidate.distanceATR <= HND_SETUP_APPROACH_ATR ? HND_SETUP_STATES.ARMED : HND_SETUP_STATES.PENDING;
        return {
            id: `SETUP-${candidate.key}`, key: candidate.key, version: HND_SETUP_VERSION,
            symbol: String(input.symbol || "").toUpperCase(), interval: String(input.interval || ""),
            direction: candidate.direction, state, sourceType: candidate.sourceType,
            zoneIds: candidate.zoneIds.slice(), orderBlockId: candidate.orderBlockId,
            fvgId: candidate.fvgId, structureEventId: candidate.structureEventId,
            entryLow: candidate.entryLow, entryHigh: candidate.entryHigh, entryTarget: candidate.entryTarget,
            invalidationPrice: candidate.direction === "LONG"
                ? candidate.entryLow - candidate.atr * HND_SETUP_INVALIDATION_BUFFER_ATR
                : candidate.entryHigh + candidate.atr * HND_SETUP_INVALIDATION_BUFFER_ATR,
            atr: candidate.atr, quality: candidate.quality, distanceATR: candidate.distanceATR,
            mtfAlignment: clone(candidate.mtfAlignment), setupReason: setupReason(candidate),
            createdAt: now, createdAtCandleTime: latest?.time ?? null,
            createdAtCandleIndex: latest ? candles.length - 1 : -1, updatedAt: now, stateChangedAt: now,
            armedAt: state === HND_SETUP_STATES.ARMED ? now : null,
            triggeredAt: state === HND_SETUP_STATES.TRIGGERED ? now : null,
            triggerPrice: state === HND_SETUP_STATES.TRIGGERED ? input.price : null,
            ageBars: 0, analysisSnapshot: snapshotAnalysis(input.analysis),
            sourceSnapshot: candidate.zones.map(clone)
        };
    }

    function sourceInvalidated(setup, qualifiedPriceZones) {
        const all = [].concat(qualifiedPriceZones?.orderBlocks || [], qualifiedPriceZones?.fvgs || []);
        return all.some(zone => setup.zoneIds.includes(zone?.id) && zone?.status === "INVALIDATED");
    }

    function terminalize(setup, state, now) {
        const terminal = { ...setup, state, updatedAt: now, stateChangedAt: now };
        consumedSetupKeys.add(terminal.key);
        setupHistory.push(clone(terminal));
        setupHistory = setupHistory.slice(-HND_SETUP_MAX_HISTORY);
        lastTerminalSetup = clone(terminal);
        return terminal;
    }

    function updateExistingSetup(setup, input = {}) {
        const next = clone(setup);
        const candles = normalizeSetupCandles(input.candles);
        const latest = candles[candles.length - 1] || null;
        const latestIndex = candles.length - 1;
        const createdIndex = candles.findIndex(candle => candle.time === next.createdAtCandleTime);
        next.ageBars = createdIndex >= 0 ? Math.max(0, latestIndex - createdIndex)
            : Math.max(0, latestIndex - next.createdAtCandleIndex);
        const now = Date.now();
        const price = input.price;
        next.distanceATR = finitePositive(price) ? getSetupZoneDistance(price,
            { bottom: next.entryLow, top: next.entryHigh }) / next.atr : next.distanceATR;
        next.updatedAt = now;
        const closed = getLastClosedSetupCandle(candles, now);
        const priceInvalidated = closed && (next.direction === "LONG"
            ? closed.close < next.invalidationPrice : closed.close > next.invalidationPrice);
        if (priceInvalidated || sourceInvalidated(next, input.qualifiedPriceZones))
            return terminalize(next, HND_SETUP_STATES.INVALIDATED, now);
        if (next.state !== HND_SETUP_STATES.TRIGGERED &&
            (next.ageBars > HND_SETUP_MAX_AGE_BARS ||
                (next.ageBars >= 2 && next.distanceATR > HND_SETUP_MAX_DISTANCE_ATR)))
            return terminalize(next, HND_SETUP_STATES.MISSED, now);
        const tickerTrigger = finitePositive(price) && price >= next.entryLow && price <= next.entryHigh;
        const candleTrigger = latest && latest.time > next.createdAtCandleTime &&
            latest.high >= next.entryLow && latest.low <= next.entryHigh;
        let state = next.state;
        if (state !== HND_SETUP_STATES.TRIGGERED && (tickerTrigger || candleTrigger)) {
            state = HND_SETUP_STATES.TRIGGERED;
            next.triggeredAt = now;
            next.triggerPrice = tickerTrigger ? price : next.entryTarget;
        } else if (state !== HND_SETUP_STATES.TRIGGERED) {
            state = next.distanceATR <= HND_SETUP_APPROACH_ATR
                ? HND_SETUP_STATES.ARMED : HND_SETUP_STATES.PENDING;
            if (state === HND_SETUP_STATES.ARMED && next.armedAt === null) next.armedAt = now;
        }
        if (state !== next.state) next.stateChangedAt = now;
        next.state = state;
        return next;
    }

    function structureShadowDiagnostic(enabled, status, reason, legacyResult, shadowResult) {
        return {
            enabled,
            status,
            reason,
            legacyResult: clone(legacyResult),
            shadowResult: clone(shadowResult)
        };
    }

    function validStructureShadowContext(context) {
        if (!context || typeof context !== "object" || Array.isArray(context)) return false;
        const keys = Object.keys(context).sort();
        if (keys.length !== 3 || keys[0] !== "analysisContext" ||
            keys[1] !== "evaluationContext" || keys[2] !== "rawCandles") return false;
        return Array.isArray(context.rawCandles) && context.analysisContext &&
            typeof context.analysisContext === "object" && !Array.isArray(context.analysisContext) &&
            context.evaluationContext && typeof context.evaluationContext === "object" &&
            !Array.isArray(context.evaluationContext);
    }

    function evaluateStructureShadow(input, legacyResult, notApplicableReason) {
        const enabled = input?.featureFlags?.structureShadowEnabled === true;
        if (!enabled) {
            lastStructureShadow = structureShadowDiagnostic(
                false, "DISABLED", "FEATURE_DISABLED", null, null);
            return;
        }
        if (notApplicableReason) {
            lastStructureShadow = structureShadowDiagnostic(
                true, "NOT_APPLICABLE", notApplicableReason, null, null);
            return;
        }
        if (!validStructureShadowContext(input.structureShadowContext)) {
            lastStructureShadow = structureShadowDiagnostic(
                true, "NOT_APPLICABLE", "INVALID_STRUCTURE_SHADOW_CONTEXT",
                legacyResult, null);
            return;
        }
        const dependency = typeof window === "object" ? window.HNDStructureShadowMode : null;
        if (!dependency || typeof dependency.runShadow !== "function") {
            lastStructureShadow = structureShadowDiagnostic(
                true, "FAILED", "SHADOW_DEPENDENCY_UNAVAILABLE", legacyResult, null);
            return;
        }
        try {
            const context = input.structureShadowContext;
            const result = dependency.runShadow(
                clone(context.rawCandles), clone(context.analysisContext),
                clone(legacyResult), clone(context.evaluationContext),
                { structureShadowEnabled: true }
            );
            lastStructureShadow = structureShadowDiagnostic(
                true,
                result && typeof result.status === "string" ? result.status : "FAILED",
                result && result.error ? result.error : null,
                legacyResult,
                result
            );
        } catch (error) {
            lastStructureShadow = structureShadowDiagnostic(
                true, "FAILED", "SHADOW_EVALUATION_EXCEPTION", legacyResult, null);
        }
    }

    function evaluate(input = {}) {
        const candles = normalizeSetupCandles(input.candles);
        let debug;
        let shadowLegacyResult = null;
        let shadowNotApplicableReason = null;
        if (currentSetup) {
            shadowNotApplicableReason = "EXISTING_SETUP_EVALUATION";
            const previousSetup = clone(currentSetup);
            const previousState = currentSetup.state;
            debug = createSetupDebug(input, currentSetup);
            const updated = updateExistingSetup(currentSetup, { ...input, candles });
            if (updated.state === HND_SETUP_STATES.INVALIDATED) {
                debug.primaryReason = HND_SETUP_DEBUG_REASONS.SETUP_INVALIDATED;
                currentSetup = null;
            } else if (updated.state === HND_SETUP_STATES.MISSED) {
                debug.primaryReason = HND_SETUP_DEBUG_REASONS.SETUP_MISSED;
                currentSetup = null;
            } else {
                currentSetup = updated;
                if (previousState !== HND_SETUP_STATES.TRIGGERED &&
                    updated.state === HND_SETUP_STATES.TRIGGERED) {
                    debug.primaryReason = HND_SETUP_DEBUG_REASONS.SETUP_TRIGGERED;
                } else if (previousState === HND_SETUP_STATES.TRIGGERED) {
                    debug.primaryReason = HND_SETUP_DEBUG_REASONS.EXISTING_SETUP_LOCKED;
                } else {
                    debug.primaryReason = HND_SETUP_DEBUG_REASONS.EXISTING_SETUP_UPDATED;
                }
            }
            debug.existingSetup = {
                present: true, id: previousSetup.id, key: previousSetup.key, state: previousSetup.state
            };
        } else {
            const detailed = buildCandidatesDetailed({ ...input, candles });
            const candidates = detailed.candidates;
            debug = detailed.debug;
            if (candidates.length) {
                currentSetup = createSetup(candidates[0], input, candles);
                shadowLegacyResult = {
                    decision: "ALLOW", reason: debug.primaryReason,
                    candidate: clone(candidates[0])
                };
            } else {
                shadowLegacyResult = {
                    decision: "BLOCK", reason: debug.primaryReason, candidate: null
                };
            }
        }
        evaluateStructureShadow(input, shadowLegacyResult, shadowNotApplicableReason);
        lastEvaluation = {
            symbol: String(input.symbol || ""), interval: String(input.interval || ""),
            price: Number.isFinite(input.price) ? input.price : null,
            status: currentSetup?.state || HND_SETUP_STATES.NO_SETUP,
            evaluatedAt: Date.now(), debug: clone(debug)
        };
        return getState();
    }

    function reset(reason = "MANUAL_RESET") {
        currentSetup = null; lastTerminalSetup = null; setupHistory = [];
        consumedSetupKeys = new Set(); lastEvaluation = null; lastStructureShadow = null;
        return { status: HND_SETUP_STATES.NO_SETUP, reason };
    }
    function getCurrentSetup() { return clone(currentSetup); }
    function getHistory() { return clone(setupHistory); }
    function getLastDebug() { return clone(lastEvaluation?.debug ?? null); }
    function getLastStructureShadow() { return clone(lastStructureShadow); }
    function explainLastEvaluation() {
        const debug = getLastDebug();
        if (!debug) return {
            primaryReason: null, summary: null, topCandidates: [], rejectedSamples: []
        };
        return {
            primaryReason: debug.primaryReason,
            summary: {
                sourceZones: debug.source.total,
                validZones: debug.validation.acceptedTotal,
                directionMatched: debug.direction.matchedTotal,
                priceSideAccepted: debug.priceSide.accepted,
                confluenceCandidates: debug.confluence.candidates,
                singleCandidates: debug.singleCandidates.total,
                distanceAccepted: debug.distance.accepted,
                qualityAccepted: debug.quality.accepted,
                consumedRejected: debug.consumed.rejected,
                acceptedCandidates: debug.final.candidates
            },
            topCandidates: clone(debug.topCandidates),
            rejectedSamples: clone(debug.rejectedSamples)
        };
    }
    function getState() {
        return {
            version: HND_SETUP_VERSION, status: currentSetup?.state || HND_SETUP_STATES.NO_SETUP,
            currentSetup: clone(currentSetup), lastTerminalSetup: clone(lastTerminalSetup),
            historyCount: setupHistory.length, consumedSetupCount: consumedSetupKeys.size,
            lastEvaluation: clone(lastEvaluation)
        };
    }

    window.HNDSetupEngine = {
        evaluate, reset, getState, getCurrentSetup, getHistory, buildCandidates,
        updateExistingSetup, getLastDebug, getLastStructureShadow,
        explainLastEvaluation, buildCandidatesDetailed, evaluateCandidateDecisionBundle
    };
})();
