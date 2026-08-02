(function (root, factory) {
    "use strict";
    var assessment = typeof module === "object" && module.exports
        ? require("./structureShadowAssessment.js") : root && root.HNDStructureShadowAssessment;
    var api = factory(assessment);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureShadowObservationPlan = api;
}(typeof window !== "undefined" ? window : null, function (assessment) {
    "use strict";
    var SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_OBSERVATION_PLAN_V1";
    var SOURCE_SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_TELEMETRY_V1";
    var DISCLAIMER = "Observation coverage only; completing this plan does not authorize entries or trading.";
    var DEFAULT_PLAN = { markets: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
        intervals: ["15m", "1h"], targetObservationsPerCell: 20, targetComparablePerCell: 10 };
    var COMPARABLE = ["MATCH_ALLOW", "MATCH_BLOCK", "LEGACY_ALLOW_GATE_BLOCK", "LEGACY_BLOCK_GATE_ALLOW"];

    function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
    function exactFields(value, fields) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort(), expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (field, index) { return keys[index] === field; });
    }
    function invalid(error) { return { valid: false, error: error, plan: null }; }
    function validatePlan(plan) {
        try {
            var input = clone(plan);
            if (!exactFields(input, ["markets", "intervals", "targetObservationsPerCell", "targetComparablePerCell"])) return invalid("INVALID_PLAN");
            if (!Array.isArray(input.markets) || !input.markets.length || input.markets.length > 10 ||
                !Array.isArray(input.intervals) || !input.intervals.length || input.intervals.length > 10 ||
                input.markets.length * input.intervals.length > 50) return invalid("INVALID_PLAN_DIMENSIONS");
            if (!input.markets.every(function (value) { return typeof value === "string" && /^[A-Z0-9]+$/.test(value) && value === value.trim().toUpperCase(); }) ||
                !input.intervals.every(function (value) { return typeof value === "string" && value.length > 0 && value === value.trim(); })) return invalid("INVALID_PLAN_VALUE");
            if (new Set(input.markets).size !== input.markets.length || new Set(input.intervals).size !== input.intervals.length) return invalid("DUPLICATE_PLAN_VALUE");
            if (![input.targetObservationsPerCell, input.targetComparablePerCell].every(function (value) {
                return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 200;
            })) return invalid("INVALID_PLAN_TARGET");
            if (input.targetComparablePerCell > input.targetObservationsPerCell) return invalid("COMPARABLE_TARGET_EXCEEDS_OBSERVATION_TARGET");
            if (input.markets.length * input.intervals.length * input.targetObservationsPerCell > 200) return invalid("TOTAL_TARGET_EXCEEDS_CAPACITY");
            input.markets.sort(); input.intervals.sort();
            return { valid: true, error: null, plan: input };
        } catch (error) { return invalid("INVALID_PLAN"); }
    }
    function progress(actual, target) { return Math.min(100, Math.round((actual / target) * 10000) / 100); }
    function invalidResult(error, status, plan) {
        return { valid: false, error: error, schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: null, status: status, plan: plan || null, cells: [], cellCount: 0,
            completedCellCount: 0, totalObservationCount: 0, plannedObservationCount: 0,
            plannedComparableCount: 0, targetObservationCount: 0, targetComparableCount: 0,
            observationRemaining: 0, comparableRemaining: 0, observationProgress: 0,
            comparableProgress: 0, outOfPlanObservationCount: 0, outOfPlanMarkets: [],
            outOfPlanIntervals: [], nextTargets: [], disclaimer: DISCLAIMER };
    }
    function evaluateProgress(snapshot, plan) {
        var source, validation, selected;
        try { source = clone(snapshot); } catch (error) { source = null; }
        try { validation = assessment && assessment.validateSnapshot(source); }
        catch (error) { validation = { valid: false, error: "INVALID_SNAPSHOT" }; }
        if (!validation || validation.valid !== true) return invalidResult(validation && validation.error || "INVALID_SNAPSHOT", "INVALID_SNAPSHOT", null);
        selected = validatePlan(plan === undefined ? DEFAULT_PLAN : plan);
        if (!selected.valid) {
            var bad = invalidResult(selected.error, "INVALID_PLAN", null);
            bad.sourceSchemaVersion = SOURCE_SCHEMA_VERSION;
            return bad;
        }
        var normalized = selected.plan;
        var cells = [];
        normalized.markets.forEach(function (symbol) {
            normalized.intervals.forEach(function (interval) {
                cells.push({ key: symbol + "|" + interval, symbol: symbol, interval: interval,
                    observationCount: 0, comparableCount: 0, matchCount: 0, mismatchCount: 0,
                    failedCount: 0, notApplicableCount: 0, notComparableCount: 0,
                    observationTarget: normalized.targetObservationsPerCell,
                    comparableTarget: normalized.targetComparablePerCell,
                    observationRemaining: normalized.targetObservationsPerCell,
                    comparableRemaining: normalized.targetComparablePerCell,
                    observationProgress: 0, comparableProgress: 0, status: "NOT_STARTED" });
            });
        });
        var byKey = new Map(cells.map(function (cell) { return [cell.key, cell]; }));
        var outMarkets = new Set(), outIntervals = new Set(), outCount = 0;
        source.observations.forEach(function (item) {
            var cell = byKey.get(item.symbol + "|" + item.interval);
            if (!cell) {
                outCount += 1;
                if (normalized.markets.indexOf(item.symbol) === -1) outMarkets.add(item.symbol);
                if (normalized.intervals.indexOf(item.interval) === -1) outIntervals.add(item.interval);
                return;
            }
            cell.observationCount += 1;
            if (COMPARABLE.indexOf(item.shadow.comparison) >= 0) cell.comparableCount += 1;
            if (["MATCH_ALLOW", "MATCH_BLOCK"].indexOf(item.shadow.comparison) >= 0) cell.matchCount += 1;
            if (["LEGACY_ALLOW_GATE_BLOCK", "LEGACY_BLOCK_GATE_ALLOW"].indexOf(item.shadow.comparison) >= 0) cell.mismatchCount += 1;
            if (item.shadow.status === "FAILED" || item.shadow.comparison === "PIPELINE_FAILED") cell.failedCount += 1;
            if (item.shadow.comparison === "NOT_APPLICABLE") cell.notApplicableCount += 1;
            if (item.shadow.comparison === "NOT_COMPARABLE") cell.notComparableCount += 1;
        });
        cells.forEach(function (cell) {
            cell.observationRemaining = Math.max(0, cell.observationTarget - cell.observationCount);
            cell.comparableRemaining = Math.max(0, cell.comparableTarget - cell.comparableCount);
            cell.observationProgress = progress(cell.observationCount, cell.observationTarget);
            cell.comparableProgress = progress(cell.comparableCount, cell.comparableTarget);
            cell.status = cell.observationRemaining === 0 && cell.comparableRemaining === 0
                ? "CELL_TARGET_MET" : cell.observationCount ? "IN_PROGRESS" : "NOT_STARTED";
        });
        var plannedObservations = cells.reduce(function (sum, cell) { return sum + cell.observationCount; }, 0);
        var plannedComparable = cells.reduce(function (sum, cell) { return sum + cell.comparableCount; }, 0);
        var targetObservations = cells.length * normalized.targetObservationsPerCell;
        var targetComparable = cells.length * normalized.targetComparablePerCell;
        var completed = cells.filter(function (cell) { return cell.status === "CELL_TARGET_MET"; }).length;
        var nextTargets = cells.filter(function (cell) { return cell.status !== "CELL_TARGET_MET"; })
            .sort(function (left, right) { return left.observationProgress - right.observationProgress ||
                left.comparableProgress - right.comparableProgress || left.symbol.localeCompare(right.symbol) ||
                left.interval.localeCompare(right.interval); }).slice(0, 6).map(clone);
        return { valid: true, error: null, schemaVersion: SCHEMA_VERSION,
            sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            status: completed === cells.length ? "TARGETS_MET" : plannedObservations ? "IN_PROGRESS" : "NOT_STARTED",
            plan: clone(normalized), cells: clone(cells), cellCount: cells.length,
            completedCellCount: completed, totalObservationCount: source.observations.length,
            plannedObservationCount: plannedObservations, plannedComparableCount: plannedComparable,
            targetObservationCount: targetObservations, targetComparableCount: targetComparable,
            observationRemaining: cells.reduce(function (sum, cell) { return sum + cell.observationRemaining; }, 0),
            comparableRemaining: cells.reduce(function (sum, cell) { return sum + cell.comparableRemaining; }, 0),
            observationProgress: progress(plannedObservations, targetObservations),
            comparableProgress: progress(plannedComparable, targetComparable),
            outOfPlanObservationCount: outCount, outOfPlanMarkets: Array.from(outMarkets).sort(),
            outOfPlanIntervals: Array.from(outIntervals).sort(), nextTargets: nextTargets, disclaimer: DISCLAIMER };
    }
    return { getSchemaVersion: function () { return SCHEMA_VERSION; }, getVocabulary: function () {
        return clone({ schemaVersion: SCHEMA_VERSION, sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
            statuses: ["INVALID_SNAPSHOT", "INVALID_PLAN", "NOT_STARTED", "IN_PROGRESS", "TARGETS_MET"],
            cellStatuses: ["NOT_STARTED", "IN_PROGRESS", "CELL_TARGET_MET"] });
    }, getDefaultPlan: function () { return clone(DEFAULT_PLAN); }, validatePlan: validatePlan,
    evaluateProgress: evaluateProgress };
}));
