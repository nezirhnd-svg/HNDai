(function (root, factory) {
    "use strict";
    var api = factory(root);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalRrCapEvidenceCollectionController = api;
}(typeof window !== "undefined" ? window : null, function (root) {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_RR_CAP_EVIDENCE_COLLECTION_CONTROLLER_V1";
    var SOURCE = "HISTORICAL_REPLAY";
    var DEPENDENCIES = [
        ["collection", "HNDStructureHistoricalRrCapEvidenceCollection"],
        ["pager", "HNDStructureHistoricalReplayBinancePager"],
        ["replay", "HNDStructureHistoricalShadowReplay"],
        ["mismatch", "HNDStructureHistoricalMismatchAnalyzer"],
        ["outcome", "HNDStructureHistoricalMismatchOutcomeAnalyzer"],
        ["scenario", "HNDStructureHistoricalRrCapScenarioAnalyzer"]
    ];
    var EXPECTED_SCHEMAS = { collection: "HND_STRUCTURE_HISTORICAL_RR_CAP_EVIDENCE_COLLECTION_V1",
        pager: "HND_STRUCTURE_HISTORICAL_REPLAY_BINANCE_PAGER_V1", replay: "HND_STRUCTURE_HISTORICAL_SHADOW_REPLAY_V1",
        mismatch: "HND_STRUCTURE_HISTORICAL_MISMATCH_ANALYSIS_V1", outcome: "HND_STRUCTURE_HISTORICAL_MISMATCH_OUTCOME_V1",
        scenario: "HND_STRUCTURE_HISTORICAL_RR_CAP_SCENARIO_ANALYSIS_V1" };
    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function getSchemaVersion() { return SCHEMA; }
    function resolveDependencies(overrides) { var output = {};
        DEPENDENCIES.forEach(function (entry) { output[entry[0]] = overrides && overrides[entry[0]] || root && root[entry[1]] || null; }); return output; }
    function dependencyError(dependencies) { for (var index = 0; index < DEPENDENCIES.length; index += 1) { var name = DEPENDENCIES[index][0], value = dependencies[name];
        if (!value || typeof value.getSchemaVersion !== "function" || value.getSchemaVersion() !== EXPECTED_SCHEMAS[name]) return "DEPENDENCY_SCHEMA_MISMATCH:" + name; }
        if (typeof dependencies.pager.fetchClosedCandles !== "function" || typeof dependencies.replay.runReplay !== "function" ||
            typeof dependencies.mismatch.analyzeReplay !== "function" || typeof dependencies.outcome.analyzeOutcomes !== "function" ||
            typeof dependencies.scenario.analyzeScenarios !== "function" || typeof dependencies.collection.ingestWorkUnit !== "function") return "DEPENDENCY_API_MISSING";
        return null; }
    function validateCandleGrid(candles, unit) {
        if (!Array.isArray(candles) || !unit || candles.length !== unit.expectedCandleCount || candles.length < 251) return { valid: false, error: "INCOMPLETE_CANDLE_COUNT" };
        var previous = null;
        for (var index = 0; index < candles.length; index += 1) { var candle = candles[index];
            if (!candle || Object.keys(candle).sort().join("|") !== ["openTime", "closeTime", "open", "high", "low", "close", "volume"].sort().join("|") ||
                !Number.isSafeInteger(candle.openTime) || !Number.isSafeInteger(candle.closeTime) || candle.closeTime <= candle.openTime ||
                ![candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) || candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 || candle.volume < 0 ||
                candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) return { valid: false, error: "MALFORMED_CANDLE", index: index };
            if (previous !== null && candle.closeTime - previous !== unit.intervalMs) return { valid: false, error: candle.closeTime === previous ? "DUPLICATE_CANDLE" : "CANDLE_GRID_GAP", index: index };
            if (candle.closeTime > unit.fetchEnd || candle.closeTime > unit.outcomeCutoff) return { valid: false, error: "FUTURE_OR_CUTOFF_CANDLE", index: index };
            previous = candle.closeTime;
        }
        if (candles[0].closeTime !== unit.fetchStart || candles[candles.length - 1].closeTime !== unit.fetchEnd) return { valid: false, error: "CANDLE_GRID_BOUNDARY_MISMATCH" };
        return { valid: true, error: null, firstCloseTime: candles[0].closeTime, lastCloseTime: candles[candles.length - 1].closeTime, count: candles.length };
    }
    function checksum(candles) { var text = candles.map(function (candle) { return [candle.openTime, candle.closeTime, candle.open, candle.high, candle.low, candle.close, candle.volume].join(":"); }).join("|");
        var hash = 2166136261; for (var index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); }
    function safeHistorical(value, schema) { return value && value.valid === true && value.schemaVersion === schema && value.source === SOURCE && value.countsTowardLiveReadiness === false; }
    function memoryStore(initial) { var saved = initial ? clone(initial) : null; return { load: async function () { return clone(saved); },
        commit: async function (checkpoint) { saved = clone(checkpoint); return clone(saved); }, clearRunning: async function () {}, get: function () { return clone(saved); } }; }
    function createController(options) {
        var opts = options || {}, dependencies = resolveDependencies(opts.dependencies), store = opts.store || memoryStore(), sleep = opts.sleep || function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
        var checkpoint = null, state = "IDLE", token = 0, pauseRequested = false, cancelRequested = false, running = null;
        function snapshot(error) { return { schemaVersion: SCHEMA, source: SOURCE, countsTowardLiveReadiness: false, readiness: "NONE", state: state,
            error: error || null, checkpoint: clone(checkpoint), progress: checkpoint ? { completedUnits: checkpoint.cursor, totalUnits: checkpoint.workUnits.length,
                revision: checkpoint.revision, nextUnit: dependencies.collection.getNextWorkUnit(checkpoint) } : null }; }
        async function create(config) { var error = dependencyError(dependencies); if (error) { state = "FAILED_CLOSED"; return snapshot(error); }
            checkpoint = dependencies.collection.createManifest(config); if (!checkpoint) { state = "FAILED_CLOSED"; return snapshot("INVALID_CONFIG"); }
            await store.commit(checkpoint); state = "READY"; return snapshot(); }
        async function restore() { var error = dependencyError(dependencies); if (error) { state = "FAILED_CLOSED"; return snapshot(error); }
            var loaded = await store.load(); var validation = dependencies.collection.validateCheckpoint(loaded);
            if (!validation.valid) { state = "FAILED_CLOSED"; return snapshot(validation.error); } checkpoint = loaded; state = checkpoint.state === "EXPLORATORY_LOCKED" ? "EXPLORATORY_LOCKED" : "PAUSED"; return snapshot(); }
        async function executeUnit(unit, runToken) {
            var paged = await dependencies.pager.fetchClosedCandles({ symbol: unit.symbol, interval: unit.interval,
                candleCount: unit.expectedCandleCount, evaluationCutoffTime: unit.fetchEnd, pageSize: 1000,
                requestDelayMs: checkpoint.config.requestDelayMs });
            if (runToken !== token || cancelRequested) return { cancelled: true };
            if (!paged || paged.valid !== true || paged.schemaVersion !== EXPECTED_SCHEMAS.pager || !Array.isArray(paged.candles)) return { error: paged && paged.error || "PAGINATION_FAILED_UNKNOWN", retryable: true };
            var grid = validateCandleGrid(paged.candles, unit); if (!grid.valid) return { error: grid.error, retryable: false };
            var replayConfig = dependencies.replay.getDefaultConfig(); Object.assign(replayConfig, { symbol: unit.symbol, interval: unit.interval,
                warmupCandles: checkpoint.config.warmupCandles, maximumEvaluationCandles: Math.max(1, paged.candles.length - checkpoint.config.warmupCandles - checkpoint.config.horizonBars),
                includeNonComparable: true, evaluationCutoffTime: unit.evaluationEnd });
            var before = JSON.stringify(paged.candles), replay = dependencies.replay.runReplay(clone(paged.candles), replayConfig);
            if (JSON.stringify(paged.candles) !== before || !safeHistorical(replay, EXPECTED_SCHEMAS.replay) || replay.symbol !== unit.symbol || replay.interval !== unit.interval || replay.evaluationCutoffTime !== unit.evaluationEnd) return { error: "INVALID_REPLAY_RESULT" };
            var mismatch = dependencies.mismatch.analyzeReplay(clone(replay)); if (!safeHistorical(mismatch, EXPECTED_SCHEMAS.mismatch)) return { error: "INVALID_MISMATCH_RESULT" };
            var outcomePolicy = dependencies.outcome.getDefaultPolicy(); outcomePolicy.maximumForwardBars = checkpoint.config.horizonBars;
            var outcome = dependencies.outcome.analyzeOutcomes(clone(mismatch), clone(replay), clone(paged.candles), clone(outcomePolicy)); if (!safeHistorical(outcome, EXPECTED_SCHEMAS.outcome)) return { error: "INVALID_OUTCOME_RESULT" };
            var scenarioPolicy = dependencies.scenario.getDefaultPolicy(); scenarioPolicy.maximumForwardBars = checkpoint.config.horizonBars;
            var scenario = dependencies.scenario.analyzeScenarios(clone(mismatch), clone(replay), clone(paged.candles), clone(scenarioPolicy)); if (!safeHistorical(scenario, EXPECTED_SCHEMAS.scenario)) return { error: "INVALID_SCENARIO_RESULT" };
            if (runToken !== token || cancelRequested) return { cancelled: true };
            var ingested = dependencies.collection.ingestWorkUnit(checkpoint, { unitId: unit.id, source: SOURCE, countsTowardLiveReadiness: false,
                gridValid: true, candleGrid: grid, inputChecksum: checksum(paged.candles), scenarioAnalysis: scenario });
            if (!ingested.valid) return { error: ingested.error || "INGEST_FAILED" };
            try { await store.commit(ingested.checkpoint); } catch (error) { return { error: "ATOMIC_CHECKPOINT_COMMIT_FAILED" }; }
            if (runToken !== token || cancelRequested) return { cancelled: true };
            checkpoint = ingested.checkpoint; return { valid: true };
        }
        async function run() { if (running) return running; var error = dependencyError(dependencies); if (error || !checkpoint || !dependencies.collection.validateCheckpoint(checkpoint).valid) { state = "FAILED_CLOSED"; return snapshot(error || "INVALID_CHECKPOINT"); }
            pauseRequested = false; cancelRequested = false; var runToken = ++token; state = checkpoint.exploratoryLock ? "OOS_RUNNING" : "RUNNING";
            running = (async function () { var completed = 0;
                while (completed < checkpoint.config.sessionUnitLimit) { var unit = dependencies.collection.getNextWorkUnit(checkpoint);
                    if (!unit && !checkpoint.exploratoryLock) { var locked = dependencies.collection.lockExploratory(checkpoint); if (!locked) { state = "FAILED_CLOSED"; return snapshot("EXPLORATORY_LOCK_FAILED"); }
                        try { await store.commit(locked); } catch (error2) { state = "FAILED_CLOSED"; return snapshot("ATOMIC_CHECKPOINT_COMMIT_FAILED"); }
                        checkpoint = locked; state = "EXPLORATORY_LOCKED"; return snapshot(); }
                    if (!unit) { state = "PAUSED"; return snapshot(); }
                    var attempts = 0, result; do { result = await executeUnit(unit, runToken); if (result.valid || result.cancelled || !result.retryable) break; attempts += 1; } while (attempts <= checkpoint.config.retryLimit);
                    if (result.cancelled) { state = "PAUSED"; await store.clearRunning(); return snapshot("CURRENT_UNIT_CANCELLED"); }
                    if (!result.valid) { state = result.retryable ? "PAUSED_RETRYABLE" : "FAILED_CLOSED"; await store.clearRunning(); return snapshot(result.error); }
                    completed += 1; if (pauseRequested) { state = "PAUSED"; return snapshot(); }
                    if (completed < checkpoint.config.sessionUnitLimit) await sleep(checkpoint.config.unitCooldownMs);
                } state = "PAUSED"; return snapshot("SESSION_UNIT_LIMIT_REACHED");
            }()).finally(function () { running = null; }); return running; }
        function pause() { pauseRequested = true; if (state === "RUNNING" || state === "OOS_RUNNING") state = "PAUSING"; return snapshot(); }
        function cancel() { cancelRequested = true; token += 1; state = "PAUSED"; return snapshot("CURRENT_UNIT_CANCEL_REQUESTED"); }
        function resume() { return run(); }
        return { create: create, restore: restore, start: run, pause: pause, resume: resume, cancelCurrentUnit: cancel,
            getSnapshot: function () { return snapshot(); } };
    }
    return { getSchemaVersion: getSchemaVersion, validateCandleGrid: validateCandleGrid,
        createMemoryStore: memoryStore, createController: createController };
}));
