(function (root, factory) {
    "use strict";
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalRrCapEvidenceCollection = api;
}(typeof window !== "undefined" ? window : null, function () {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_RR_CAP_EVIDENCE_COLLECTION_V1";
    var PILOT_SCHEMA = "HND_STRUCTURE_HISTORICAL_RR_CAP_BOUNDED_PILOT_V1";
    var PILOT_EXPORT_SCHEMA = "HND_STRUCTURE_HISTORICAL_RR_CAP_BOUNDED_PILOT_EXPORT_V1";
    var SOURCE = "HISTORICAL_REPLAY";
    var SOURCE_SHA = "166c88bb22be55941eae62ce6f788e68e680b5eb";
    var DISCLAIMER = "DIAGNOSTIC COLLECTION ONLY — DOES NOT CHANGE LIVE TP OR READINESS.";
    var PILOT_DISCLAIMER = "PILOT ONLY — NOT PART OF FULL COLLECTION — DOES NOT CHANGE LIVE TP OR READINESS";
    var OUTCOMES = ["TP_FIRST", "SL_FIRST", "AMBIGUOUS_SAME_BAR", "ENTRY_NOT_REACHED",
        "OPEN_AT_HORIZON", "INSUFFICIENT_FUTURE_DATA", "NOT_EVALUABLE"];
    var SCENARIOS = ["ORIGINAL_UNCAPPED", "MAX_2R", "MAX_3R", "MAX_4R", "MAX_5R"];
    var SPLITS = ["EXPLORATORY", "OOS"];
    var INTERVAL_MS = { "15m": 900000, "4h": 14400000 };
    var DEPENDENCY_SCHEMAS = { pager: "HND_STRUCTURE_HISTORICAL_REPLAY_BINANCE_PAGER_V1",
        replay: "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1", mismatch: "HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1",
        outcome: "HND_STRUCTURE_HISTORICAL_MISMATCH_OUTCOME_V1", scenario: "HND_STRUCTURE_HISTORICAL_RR_CAP_SCENARIO_ANALYSIS_V1" };
    var CONFIG_FIELDS = ["sourceSha", "markets", "intervals", "splits", "horizonBars", "warmupCandles",
        "evaluationCandlesPerUnit", "maximumUnitsPerCell", "maximumCollectionUnits", "sessionUnitLimit",
        "retryLimit", "concurrency", "requestDelayMs", "unitCooldownMs", "targets"];
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function exact(value, fields) { if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort(), expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (key, index) { return keys[index] === key; }); }
    function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value);
        if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
        return "{" + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ":" + canonical(value[key]); }).join(",") + "}"; }
    function rightRotate(value, amount) { return value >>> amount | value << (32 - amount); }
    function sha256(text) {
        var ascii = unescape(encodeURIComponent(String(text))), maxWord = Math.pow(2, 32), words = [], hash = [], k = [], primeCounter = 0;
        for (var candidate = 2; primeCounter < 64; candidate += 1) { var prime = true;
            for (var factor = 2; factor * factor <= candidate; factor += 1) if (candidate % factor === 0) { prime = false; break; }
            if (prime) { if (primeCounter < 8) hash[primeCounter] = Math.pow(candidate, 0.5) * maxWord | 0;
                k[primeCounter] = Math.pow(candidate, 1 / 3) * maxWord | 0; primeCounter += 1; } }
        ascii += "\x80"; while (ascii.length % 64 !== 56) ascii += "\x00";
        for (var index = 0; index < ascii.length; index += 1) words[index >> 2] |= ascii.charCodeAt(index) << ((3 - index) % 4) * 8;
        var bitLength = (ascii.length - 1 - ((ascii.length - 1) % 64)) * 8;
        words.push(bitLength / maxWord | 0); words.push(bitLength | 0);
        for (var block = 0; block < words.length; block += 16) { var oldHash = hash.slice(), schedule = words.slice(block, block + 16);
            for (var round = 0; round < 64; round += 1) { var w = schedule[round];
                if (round >= 16) { var w15 = schedule[round - 15], w2 = schedule[round - 2];
                    w = schedule[round] = (schedule[round - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ w15 >>> 3) +
                        schedule[round - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ w2 >>> 10)) | 0; }
                var a = hash[0], e = hash[4], temp1 = (hash[7] + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
                    (e & hash[5] ^ ~e & hash[6]) + k[round] + w) | 0;
                var temp2 = ((rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + (a & hash[1] ^ a & hash[2] ^ hash[1] & hash[2])) | 0;
                hash = [(temp1 + temp2) | 0, a, hash[1], hash[2], (hash[3] + temp1) | 0, e, hash[5], hash[6]]; }
            for (var h = 0; h < 8; h += 1) hash[h] = (hash[h] + oldHash[h]) | 0; }
        return hash.map(function (value) { return (value >>> 0).toString(16).padStart(8, "0"); }).join("");
    }
    function getSchemaVersion() { return SCHEMA; }
    function getVocabulary() { return clone({ schemaVersion: SCHEMA, source: SOURCE, sourceSha: SOURCE_SHA,
        splits: SPLITS, scenarios: SCENARIOS, outcomes: OUTCOMES,
        states: ["READY", "RUNNING", "PAUSED", "PAUSED_RETRYABLE", "EXPLORATORY_LOCKED", "OOS_RUNNING", "COMPLETED", "TARGET_NOT_MET", "FAILED_CLOSED"] }); }
    function getDefaultConfig() { return { sourceSha: SOURCE_SHA, markets: ["BTCUSDT", "ETHUSDT", "SOLUSDT"], intervals: ["15m", "4h"],
        splits: { exploratory: { start: 1640995200000, end: 1735689599999 }, oos: { start: 1735689600000, end: 1782863999999 } },
        horizonBars: 24, warmupCandles: 250, evaluationCandlesPerUnit: 9726, maximumUnitsPerCell: 10,
        maximumCollectionUnits: 120, sessionUnitLimit: 6, retryLimit: 2, concurrency: 1,
        requestDelayMs: 500, unitCooldownMs: 1000,
        targets: { exploratory: { total: 300, perCellTarget: 50, perCellMinimum: 30 }, oos: { total: 100, perCellTarget: 17, perCellMinimum: 10 } } }; }
    function configError(config) {
        if (!exact(config, CONFIG_FIELDS) || config.sourceSha !== SOURCE_SHA || canonical(config.markets) !== canonical(["BTCUSDT", "ETHUSDT", "SOLUSDT"]) ||
            canonical(config.intervals) !== canonical(["15m", "4h"]) || !exact(config.splits, ["exploratory", "oos"]) ||
            !exact(config.splits.exploratory, ["start", "end"]) || !exact(config.splits.oos, ["start", "end"]) ||
            config.splits.exploratory.start !== 1640995200000 || config.splits.exploratory.end !== 1735689599999 ||
            config.splits.oos.start !== 1735689600000 || config.splits.oos.end !== 1782863999999) return "INVALID_IMMUTABLE_CONFIG";
        if (config.horizonBars !== 24 || config.warmupCandles !== 250 || !Number.isSafeInteger(config.evaluationCandlesPerUnit) || config.evaluationCandlesPerUnit < 1 || config.evaluationCandlesPerUnit > 9750 ||
            !Number.isSafeInteger(config.maximumUnitsPerCell) || config.maximumUnitsPerCell < 1 || config.maximumUnitsPerCell > 10 ||
            !Number.isSafeInteger(config.maximumCollectionUnits) || config.maximumCollectionUnits < 1 || config.maximumCollectionUnits > 120 ||
            !Number.isSafeInteger(config.sessionUnitLimit) || config.sessionUnitLimit < 1 || config.sessionUnitLimit > 12 ||
            config.retryLimit < 0 || config.retryLimit > 2 || config.concurrency !== 1 || config.requestDelayMs < 200 || config.requestDelayMs > 2000 || config.unitCooldownMs < 1000 ||
            canonical(config.targets) !== canonical(getDefaultConfig().targets)) return "INVALID_BOUNDS";
        return null;
    }
    function workUnits(config) { var units = [];
        SPLITS.forEach(function (split) { var period = config.splits[split.toLowerCase()];
            config.markets.forEach(function (symbol) { config.intervals.forEach(function (interval) { var step = INTERVAL_MS[interval];
                var span = config.evaluationCandlesPerUnit * step, cursor = period.start + step - 1, sequence = 0;
                while (cursor <= period.end && sequence < config.maximumUnitsPerCell && units.length < config.maximumCollectionUnits) {
                    var evaluationEnd = Math.min(period.end, cursor + span - step), outcomeEnd = Math.min(period.end, evaluationEnd + config.horizonBars * step);
                    units.push({ id: split + "|" + symbol + "|" + interval + "|" + sequence, sequence: units.length,
                        split: split, symbol: symbol, interval: interval, intervalMs: step,
                        evaluationStart: cursor, evaluationEnd: evaluationEnd, fetchStart: Math.max(1, cursor - config.warmupCandles * step),
                        fetchEnd: outcomeEnd, outcomeCutoff: period.end, expectedCandleCount: Math.floor((outcomeEnd - Math.max(1, cursor - config.warmupCandles * step)) / step) + 1,
                        source: SOURCE, countsTowardLiveReadiness: false }); cursor = evaluationEnd + step; sequence += 1; }
            }); }); }); return units; }
    function checkpointHash(value) { var safe = clone(value); delete safe.checkpointHash; return sha256(canonical(safe)); }
    function createManifest(config) { var cfg = clone(config === undefined ? getDefaultConfig() : config), error = configError(cfg); if (error) return null;
        var configHash = sha256(canonical(cfg)); var checkpoint = { schemaVersion: SCHEMA, source: SOURCE, sourceSha: SOURCE_SHA,
            countsTowardLiveReadiness: false, readiness: "NONE", disclaimer: DISCLAIMER, config: cfg, configHash: configHash,
            dependencySchemas: clone(DEPENDENCY_SCHEMAS), state: "READY", revision: 0, cursor: 0, previousCheckpointHash: null,
            exploratoryLock: null, units: [], workUnits: workUnits(cfg), planIds: [], eventIds: [], clusters: [], exclusions: [], audit: [] };
        checkpoint.checkpointHash = checkpointHash(checkpoint); return clone(checkpoint); }
    function validateCheckpoint(value) { var fields = ["schemaVersion", "source", "sourceSha", "countsTowardLiveReadiness", "readiness", "disclaimer", "config", "configHash", "dependencySchemas", "state", "revision", "cursor", "previousCheckpointHash", "exploratoryLock", "units", "workUnits", "planIds", "eventIds", "clusters", "exclusions", "audit", "checkpointHash"];
        if (!exact(value, fields) || value.schemaVersion !== SCHEMA || value.source !== SOURCE || value.sourceSha !== SOURCE_SHA || value.countsTowardLiveReadiness !== false || value.readiness !== "NONE" || value.disclaimer !== DISCLAIMER) return { valid: false, error: "INVALID_CHECKPOINT_FIELDS" };
        if (configError(value.config) || value.configHash !== sha256(canonical(value.config)) || canonical(value.workUnits) !== canonical(workUnits(value.config)) || canonical(value.dependencySchemas) !== canonical(DEPENDENCY_SCHEMAS)) return { valid: false, error: "CONFIG_OR_PLAN_HASH_MISMATCH" };
        if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.cursor) || value.cursor < 0 || value.cursor > value.workUnits.length || !Array.isArray(value.units) || value.units.length !== value.cursor ||
            !Array.isArray(value.planIds) || !Array.isArray(value.eventIds) || !Array.isArray(value.clusters) || !Array.isArray(value.exclusions) || !Array.isArray(value.audit) || value.checkpointHash !== checkpointHash(value)) return { valid: false, error: "CHECKPOINT_INTEGRITY_FAILURE" };
        return { valid: true, error: null };
    }
    function getNextWorkUnit(checkpoint) { var validation = validateCheckpoint(checkpoint); if (!validation.valid) return null;
        var unit = checkpoint.workUnits[checkpoint.cursor]; if (!unit) return null;
        if (unit.split === "OOS" && (!checkpoint.exploratoryLock || checkpoint.state !== "EXPLORATORY_LOCKED" && checkpoint.state !== "OOS_RUNNING")) return null;
        return clone(unit); }
    function identity(item, eventOnly) { var base = eventOnly ? { symbol: item.symbol, interval: item.interval, candidateKey: item.candidateKey, setupCandidateKey: item.setupCandidateKey } :
        { schemaVersion: SCHEMA, source: SOURCE, symbol: item.symbol, interval: item.interval, candidateKey: item.candidateKey,
            setupCandidateKey: item.setupCandidateKey, evaluationCloseTime: item.evaluationCloseTime, direction: item.direction,
            entryPrice: item.entryPrice, stopLoss: item.stopLoss, takeProfit: item.originalTakeProfit }; return sha256(canonical(base)); }
    function normalizedPlans(evidence, unit) { if (!evidence || evidence.valid !== true || evidence.schemaVersion !== "HND_STRUCTURE_HISTORICAL_RR_CAP_SCENARIO_ANALYSIS_V1" || evidence.source !== SOURCE || evidence.countsTowardLiveReadiness !== false || !Array.isArray(evidence.scenarioItems)) return null;
        var grouped = {}, bad = false; evidence.scenarioItems.forEach(function (item) { if (!item || item.symbol !== unit.symbol || item.interval !== unit.interval || !SCENARIOS.includes(item.scenario) || !OUTCOMES.includes(item.scenarioOutcome) || !Number.isSafeInteger(item.evaluationCloseTime) || item.evaluationCloseTime < unit.evaluationStart || item.evaluationCloseTime > unit.evaluationEnd || !item.candidateKey) { bad = true; return; }
            var key = item.key; if (!grouped[key]) grouped[key] = []; grouped[key].push(clone(item)); }); if (bad) return null;
        return Object.keys(grouped).sort().map(function (key) { var seenRows = new Set(); var rows = grouped[key].filter(function (row) { var fingerprint = canonical(row); if (seenRows.has(fingerprint)) return false; seenRows.add(fingerprint); return true; }).sort(function (a, b) { return SCENARIOS.indexOf(a.scenario) - SCENARIOS.indexOf(b.scenario); });
            if (rows.length !== 5 || rows.some(function (row, index) { return row.scenario !== SCENARIOS[index]; })) { bad = true; return null; }
            var first = rows[0]; return { key: key, candidateKey: first.candidateKey, setupCandidateKey: first.setupCandidateKey || (first.candidateKey + "|SETUP"), symbol: first.symbol, interval: first.interval,
                evaluationCloseTime: first.evaluationCloseTime, direction: first.direction, entryPrice: first.entryPrice, stopLoss: first.stopLoss,
                originalTakeProfit: first.originalTakeProfit, outcomeAt: first.outcomeAt, split: unit.split, scenarios: rows }; }).filter(Boolean);
    }
    function lockExploratory(checkpoint) { var next = clone(checkpoint), validation = validateCheckpoint(next); if (!validation.valid) return null;
        var pendingExploratory = next.workUnits.slice(next.cursor).some(function (unit) { return unit.split === "EXPLORATORY"; }); if (pendingExploratory) return null;
        var exploratoryAggregate = aggregateCollection(next).splits.EXPLORATORY;
        next.previousCheckpointHash = next.checkpointHash; next.revision += 1; next.state = "EXPLORATORY_LOCKED";
        next.exploratoryLock = { configHash: next.configHash, aggregateHash: sha256(canonical(exploratoryAggregate)), lockedRevision: next.revision };
        next.audit.push({ sequence: next.audit.length, action: "EXPLORATORY_LOCKED" }); next.checkpointHash = checkpointHash(next); return clone(next); }
    function ingestWorkUnit(checkpoint, unitEvidence) { var validation = validateCheckpoint(checkpoint); if (!validation.valid) return { valid: false, error: validation.error, checkpoint: null };
        var unit = getNextWorkUnit(checkpoint); if (!unit || !unitEvidence || unitEvidence.unitId !== unit.id || unitEvidence.source !== SOURCE || unitEvidence.countsTowardLiveReadiness !== false || unitEvidence.gridValid !== true || unitEvidence.rawCandles !== undefined) return { valid: false, error: "INVALID_UNIT_EVIDENCE", checkpoint: null };
        var plans = normalizedPlans(unitEvidence.scenarioAnalysis, unit); if (!plans) return { valid: false, error: "INVALID_SCENARIO_EVIDENCE", checkpoint: null };
        var next = clone(checkpoint), planSet = new Set(next.planIds), eventSet = new Set(next.eventIds), accepted = [];
        plans.sort(function (a, b) { return a.evaluationCloseTime - b.evaluationCloseTime || INTERVAL_MS[a.interval] - INTERVAL_MS[b.interval] || a.key.localeCompare(b.key); }).forEach(function (plan) {
            var planId = identity(plan, false), eventId = identity(plan, true), end = plan.outcomeAt || plan.evaluationCloseTime + next.config.horizonBars * INTERVAL_MS[plan.interval];
            var reason = planSet.has(planId) ? "DUPLICATE_PLAN" : eventSet.has(eventId) ? "DUPLICATE_EVENT" : null;
            var overlaps = next.clusters.concat(accepted.map(function (entry) { return entry.cluster; })).filter(function (cluster) { return cluster.symbol === plan.symbol && cluster.start <= end && plan.evaluationCloseTime <= cluster.end; });
            if (!reason && overlaps.length) reason = "OVERLAPPING_EPISODE";
            if (reason) { next.exclusions.push({ unitId: unit.id, key: plan.key, reason: reason }); return; }
            var cluster = { symbol: plan.symbol, start: plan.evaluationCloseTime, end: end, planId: planId };
            plan.planIdentity = planId; plan.eventIdentity = eventId; plan.cluster = cluster; accepted.push(plan); planSet.add(planId); eventSet.add(eventId); });
        var stored = { unitId: unit.id, sequence: unit.sequence, split: unit.split, symbol: unit.symbol, interval: unit.interval,
            source: SOURCE, countsTowardLiveReadiness: false, candleGrid: clone(unitEvidence.candleGrid), inputChecksum: unitEvidence.inputChecksum,
            evidence: accepted.map(function (plan) { var output = clone(plan); delete output.cluster; return output; }), outputChecksum: sha256(canonical(accepted)) };
        next.previousCheckpointHash = next.checkpointHash; next.units.push(stored); next.cursor += 1; next.revision += 1; next.planIds = Array.from(planSet).sort(); next.eventIds = Array.from(eventSet).sort(); next.clusters = next.clusters.concat(accepted.map(function (entry) { return entry.cluster; }));
        next.state = next.workUnits[next.cursor] && next.workUnits[next.cursor].split === "OOS" ? "READY" : "RUNNING"; next.audit.push({ sequence: next.audit.length, action: "UNIT_COMMITTED", unitId: unit.id }); next.checkpointHash = checkpointHash(next);
        return { valid: true, error: null, checkpoint: clone(next), acceptedCount: accepted.length };
    }
    function blankScenario() { var value = { sampleCount: 0, resolvedDirectionalCount: 0, tpShare: null }; OUTCOMES.forEach(function (outcome) { value[outcome] = 0; }); return value; }
    function aggregateCollection(checkpoint) { var validation = validateCheckpoint(checkpoint); if (!validation.valid) return { valid: false, error: validation.error };
        var result = { valid: true, schemaVersion: SCHEMA, source: SOURCE, countsTowardLiveReadiness: false, readiness: "NONE", splits: {} };
        SPLITS.forEach(function (split) { var cells = {}, scenarios = {}; SCENARIOS.forEach(function (scenario) { scenarios[scenario] = blankScenario(); });
            checkpoint.config.markets.forEach(function (market) { checkpoint.config.intervals.forEach(function (interval) { cells[market + "|" + interval] = { sampleCount: 0, scenarios: clone(scenarios) }; }); });
            checkpoint.units.filter(function (unit) { return unit.split === split; }).forEach(function (unit) { unit.evidence.forEach(function (plan) { var cell = cells[unit.symbol + "|" + unit.interval]; cell.sampleCount += 1;
                plan.scenarios.forEach(function (row) { var targets = [scenarios[row.scenario], cell.scenarios[row.scenario]]; targets.forEach(function (target) { target.sampleCount += 1; target[row.scenarioOutcome] += 1; if (["TP_FIRST", "SL_FIRST"].includes(row.scenarioOutcome)) target.resolvedDirectionalCount += 1; }); }); }); });
            Object.keys(scenarios).forEach(function (key) { scenarios[key].tpShare = scenarios[key].resolvedDirectionalCount ? scenarios[key].TP_FIRST / scenarios[key].resolvedDirectionalCount : null; });
            var counts = Object.keys(cells).map(function (key) { return cells[key].sampleCount; }), minimum = checkpoint.config.targets[split.toLowerCase()].perCellMinimum;
            result.splits[split] = { sampleCount: scenarios.ORIGINAL_UNCAPPED.sampleCount, scenarios: scenarios, cells: cells,
                coverage: { minimum: Math.min.apply(Math, counts), maximum: Math.max.apply(Math, counts), imbalanceRatio: Math.min.apply(Math, counts) ? Math.max.apply(Math, counts) / Math.min.apply(Math, counts) : null, balanced: counts.every(function (count) { return count >= minimum; }) } }; });
        result.aggregateHash = sha256(canonical(result.splits)); return clone(result); }
    function finalizeCollection(checkpoint) { var aggregate = aggregateCollection(checkpoint); if (!aggregate.valid) return aggregate;
        if (!checkpoint.exploratoryLock) return { valid: false, error: "EXPLORATORY_NOT_LOCKED", aggregate: aggregate };
        var exploratory = aggregate.splits.EXPLORATORY, oos = aggregate.splits.OOS, complete = exploratory.sampleCount >= checkpoint.config.targets.exploratory.total && oos.sampleCount >= checkpoint.config.targets.oos.total && exploratory.coverage.balanced && oos.coverage.balanced;
        return { valid: true, schemaVersion: SCHEMA, source: SOURCE, sourceSha: SOURCE_SHA, countsTowardLiveReadiness: false, readiness: "NONE", status: complete ? "COMPLETED" : "TARGET_NOT_MET", configHash: checkpoint.configHash, checkpointHash: checkpoint.checkpointHash, aggregate: aggregate, disclaimer: DISCLAIMER }; }
    function exportCheckpoint(checkpoint) { return validateCheckpoint(checkpoint).valid ? JSON.stringify(clone(checkpoint), null, 2) : null; }
    function exportCollection(result) { if (!result || result.valid !== true || !["COMPLETED", "TARGET_NOT_MET"].includes(result.status) || result.source !== SOURCE || result.countsTowardLiveReadiness !== false || result.readiness !== "NONE") return null;
        var fields = ["schemaVersion", "source", "sourceSha", "countsTowardLiveReadiness", "readiness", "status", "configHash", "checkpointHash", "aggregate", "disclaimer"], safe = {}; fields.forEach(function (field) { safe[field] = clone(result[field]); }); return JSON.stringify(safe, null, 2); }
    function pilotConfigError(config) {
        if (!exact(config, ["mode", "symbol", "interval", "split", "maximumCompletedUnits"]) ||
            config.mode !== "PILOT_ONLY" || !["BTCUSDT", "ETHUSDT", "SOLUSDT"].includes(config.symbol) ||
            !["15m", "4h"].includes(config.interval) || config.split !== "EXPLORATORY" ||
            config.maximumCompletedUnits !== 1) return "INVALID_PILOT_CONFIG";
        return null;
    }
    function pilotCheckpointHash(value) { var safe = clone(value); delete safe.pilotCheckpointHash; return sha256(canonical(safe)); }
    function createPilotManifest(config) {
        var cfg = clone(config), error = pilotConfigError(cfg); if (error) return null;
        var fullConfig = getDefaultConfig(), unit = workUnits(fullConfig).find(function (candidate) {
            return candidate.split === "EXPLORATORY" && candidate.symbol === cfg.symbol && candidate.interval === cfg.interval;
        });
        if (!unit) return null;
        unit = clone(unit); unit.id = "PILOT_ONLY|" + cfg.symbol + "|" + cfg.interval + "|0"; unit.sequence = 0;
        var configHash = sha256(canonical(cfg)), checkpoint = { schemaVersion: PILOT_SCHEMA, mode: "PILOT_ONLY",
            collectionId: "PILOT_ONLY-" + configHash.slice(0, 24), storageNamespace: "HNDaiHistoricalRrCapBoundedPilotV1",
            source: SOURCE, sourceSha: SOURCE_SHA, countsTowardLiveReadiness: false, readiness: "NONE",
            disclaimer: PILOT_DISCLAIMER, pilotConfig: cfg, pilotConfigHash: configHash,
            dependencySchemas: clone(DEPENDENCY_SCHEMAS), state: "PILOT_READY", revision: 0, cursor: 0,
            previousPilotCheckpointHash: null, units: [], workUnit: unit, planIds: [], eventIds: [],
            clusters: [], exclusions: [], audit: [] };
        checkpoint.pilotCheckpointHash = pilotCheckpointHash(checkpoint); return clone(checkpoint);
    }
    function validatePilotCheckpoint(value) {
        var fields = ["schemaVersion", "mode", "collectionId", "storageNamespace", "source", "sourceSha",
            "countsTowardLiveReadiness", "readiness", "disclaimer", "pilotConfig", "pilotConfigHash",
            "dependencySchemas", "state", "revision", "cursor", "previousPilotCheckpointHash", "units",
            "workUnit", "planIds", "eventIds", "clusters", "exclusions", "audit", "pilotCheckpointHash"];
        if (!exact(value, fields) || value.schemaVersion !== PILOT_SCHEMA || value.mode !== "PILOT_ONLY" ||
            value.storageNamespace !== "HNDaiHistoricalRrCapBoundedPilotV1" || value.source !== SOURCE ||
            value.sourceSha !== SOURCE_SHA || value.countsTowardLiveReadiness !== false || value.readiness !== "NONE" ||
            value.disclaimer !== PILOT_DISCLAIMER || pilotConfigError(value.pilotConfig) ||
            value.pilotConfigHash !== sha256(canonical(value.pilotConfig)) ||
            value.collectionId !== "PILOT_ONLY-" + value.pilotConfigHash.slice(0, 24) ||
            canonical(value.dependencySchemas) !== canonical(DEPENDENCY_SCHEMAS)) return { valid: false, error: "INVALID_PILOT_CHECKPOINT" };
        var expected = createPilotManifest(value.pilotConfig);
        if (!expected || canonical(value.workUnit) !== canonical(expected.workUnit) ||
            !["PILOT_READY", "PILOT_RUNNING", "PILOT_PAUSED", "PILOT_PAUSED_RETRYABLE", "PILOT_COMPLETED_PAUSED", "PILOT_FAILED_CLOSED"].includes(value.state) ||
            !Number.isSafeInteger(value.revision) || value.revision < 0 || ![0, 1].includes(value.cursor) ||
            !Array.isArray(value.units) || value.units.length !== value.cursor || !Array.isArray(value.planIds) ||
            !Array.isArray(value.eventIds) || !Array.isArray(value.clusters) || !Array.isArray(value.exclusions) ||
            !Array.isArray(value.audit) || value.cursor === 1 && value.state !== "PILOT_COMPLETED_PAUSED" ||
            value.pilotCheckpointHash !== pilotCheckpointHash(value)) return { valid: false, error: "PILOT_CHECKPOINT_INTEGRITY_FAILURE" };
        return { valid: true, error: null };
    }
    function getPilotWorkUnit(checkpoint) {
        var validation = validatePilotCheckpoint(checkpoint); if (!validation.valid || checkpoint.cursor !== 0 ||
            checkpoint.state === "PILOT_COMPLETED_PAUSED") return null; return clone(checkpoint.workUnit);
    }
    function ingestPilotWorkUnit(checkpoint, unitEvidence) {
        var validation = validatePilotCheckpoint(checkpoint); if (!validation.valid) return { valid: false, error: validation.error, checkpoint: null };
        var unit = getPilotWorkUnit(checkpoint); if (!unit || !unitEvidence || unitEvidence.unitId !== unit.id ||
            unitEvidence.source !== SOURCE || unitEvidence.countsTowardLiveReadiness !== false ||
            unitEvidence.gridValid !== true || unitEvidence.rawCandles !== undefined)
            return { valid: false, error: "INVALID_PILOT_UNIT_EVIDENCE", checkpoint: null };
        var plans = normalizedPlans(unitEvidence.scenarioAnalysis, unit); if (!plans)
            return { valid: false, error: "INVALID_PILOT_SCENARIO_EVIDENCE", checkpoint: null };
        var next = clone(checkpoint), planSet = new Set(), eventSet = new Set(), accepted = [];
        plans.sort(function (a, b) { return a.evaluationCloseTime - b.evaluationCloseTime || a.key.localeCompare(b.key); }).forEach(function (plan) {
            var planId = identity(plan, false), eventId = identity(plan, true), end = plan.outcomeAt ||
                plan.evaluationCloseTime + 24 * INTERVAL_MS[plan.interval];
            var reason = planSet.has(planId) ? "DUPLICATE_PLAN" : eventSet.has(eventId) ? "DUPLICATE_EVENT" : null;
            var overlaps = accepted.filter(function (entry) { return entry.cluster.symbol === plan.symbol &&
                entry.cluster.start <= end && plan.evaluationCloseTime <= entry.cluster.end; });
            if (!reason && overlaps.length) reason = "OVERLAPPING_EPISODE";
            if (reason) { next.exclusions.push({ unitId: unit.id, key: plan.key, reason: reason }); return; }
            var cluster = { symbol: plan.symbol, start: plan.evaluationCloseTime, end: end, planId: planId };
            plan.planIdentity = planId; plan.eventIdentity = eventId; plan.cluster = cluster;
            accepted.push(plan); planSet.add(planId); eventSet.add(eventId);
        });
        var stored = { unitId: unit.id, sequence: 0, split: "EXPLORATORY", symbol: unit.symbol,
            interval: unit.interval, source: SOURCE, countsTowardLiveReadiness: false,
            candleGrid: clone(unitEvidence.candleGrid), inputChecksum: unitEvidence.inputChecksum,
            evidence: accepted.map(function (plan) { var output = clone(plan); delete output.cluster; return output; }),
            outputChecksum: sha256(canonical(accepted)), metrics: { raw: plans.length,
                evaluable: plans.filter(function (plan) { return !["NOT_EVALUABLE", "INSUFFICIENT_FUTURE_DATA"].includes(plan.scenarios[0].scenarioOutcome); }).length,
                dedup: next.exclusions.filter(function (item) { return item.reason.indexOf("DUPLICATE_") === 0; }).length,
                overlap: next.exclusions.filter(function (item) { return item.reason === "OVERLAPPING_EPISODE"; }).length,
                independent: accepted.length } };
        next.previousPilotCheckpointHash = next.pilotCheckpointHash; next.units.push(stored); next.cursor = 1;
        next.revision += 1; next.planIds = Array.from(planSet).sort(); next.eventIds = Array.from(eventSet).sort();
        next.clusters = accepted.map(function (entry) { return entry.cluster; }); next.state = "PILOT_COMPLETED_PAUSED";
        next.audit.push({ sequence: next.audit.length, action: "PILOT_UNIT_COMMITTED_AND_PAUSED", unitId: unit.id });
        next.pilotCheckpointHash = pilotCheckpointHash(next);
        return { valid: true, error: null, checkpoint: clone(next), acceptedCount: accepted.length };
    }
    function exportPilotCheckpoint(checkpoint) {
        if (!validatePilotCheckpoint(checkpoint).valid) return null;
        var safe = clone(checkpoint); safe.exportSchemaVersion = PILOT_EXPORT_SCHEMA;
        return JSON.stringify(safe, null, 2);
    }
    return { getSchemaVersion: getSchemaVersion, getVocabulary: getVocabulary, getDefaultConfig: getDefaultConfig,
        createManifest: createManifest, validateCheckpoint: validateCheckpoint, getNextWorkUnit: getNextWorkUnit,
        ingestWorkUnit: ingestWorkUnit, lockExploratory: lockExploratory, aggregateCollection: aggregateCollection,
        finalizeCollection: finalizeCollection, exportCheckpoint: exportCheckpoint, exportCollection: exportCollection,
        createPilotManifest: createPilotManifest, validatePilotCheckpoint: validatePilotCheckpoint,
        getPilotWorkUnit: getPilotWorkUnit, ingestPilotWorkUnit: ingestPilotWorkUnit,
        exportPilotCheckpoint: exportPilotCheckpoint };
}));
