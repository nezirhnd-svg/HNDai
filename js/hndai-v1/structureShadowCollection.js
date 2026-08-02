(function (root, factory) {
    "use strict";
    var assessment = typeof module === "object" && module.exports
        ? require("./structureShadowAssessment.js")
        : root && root.HNDStructureShadowAssessment;
    var api = factory(assessment);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureShadowCollection = api;
}(typeof window !== "undefined" ? window : null, function (assessment) {
    "use strict";

    var SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_COLLECTION_V1";
    var SOURCE_SCHEMA_VERSION = "HND_STRUCTURE_SHADOW_TELEMETRY_V1";
    var CAPACITY = 200;
    var SOURCE_CAPACITY = 50;
    var observations = [];
    var sources = [];
    var acceptedSourceCount = 0;
    var rejectedSourceCount = 0;
    var duplicateCount = 0;
    var conflictCount = 0;
    var droppedCount = 0;

    function clone(value) {
        if (value === undefined) return undefined;
        return JSON.parse(JSON.stringify(value));
    }

    function exactFields(value, fields) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort();
        var expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (field, index) {
            return keys[index] === field;
        });
    }

    function safeSource(value) {
        if (!exactFields(value, ["name", "importedAt"]) ||
            typeof value.name !== "string" || !value.name || value.name.length > 200 ||
            value.name !== value.name.trim() || /[\\/]/.test(value.name) ||
            value.name === "." || value.name === ".." ||
            typeof value.importedAt !== "number" || !Number.isSafeInteger(value.importedAt) ||
            value.importedAt <= 0) return null;
        return clone(value);
    }

    function compareObservation(left, right) {
        return left.evaluationCloseTime - right.evaluationCloseTime ||
            left.symbol.localeCompare(right.symbol) ||
            left.interval.localeCompare(right.interval) || left.key.localeCompare(right.key);
    }

    function diagnosticContent(item) {
        return JSON.stringify({
            key: item.key, symbol: item.symbol, interval: item.interval,
            evaluationCloseTime: item.evaluationCloseTime, shadow: item.shadow
        });
    }

    function percentage(numerator, denominator) {
        if (!denominator) return null;
        return Math.round((numerator / denominator) * 10000) / 100;
    }

    function telemetrySummary(items) {
        var comparisons = items.map(function (item) { return item.shadow.comparison; });
        function count(value) {
            return comparisons.filter(function (item) { return item === value; }).length;
        }
        var matchAllowCount = count("MATCH_ALLOW");
        var matchBlockCount = count("MATCH_BLOCK");
        var legacyAllowGateBlockCount = count("LEGACY_ALLOW_GATE_BLOCK");
        var legacyBlockGateAllowCount = count("LEGACY_BLOCK_GATE_ALLOW");
        var matchCount = matchAllowCount + matchBlockCount;
        var mismatchCount = legacyAllowGateBlockCount + legacyBlockGateAllowCount;
        var comparableCount = matchCount + mismatchCount;
        var failedCount = items.filter(function (item) {
            return item.shadow.status === "FAILED" || item.shadow.comparison === "PIPELINE_FAILED";
        }).length;
        return {
            observationCount: items.length, comparableCount: comparableCount,
            matchCount: matchCount, mismatchCount: mismatchCount,
            failedCount: failedCount, notApplicableCount: count("NOT_APPLICABLE"),
            notComparableCount: count("NOT_COMPARABLE"),
            matchAllowCount: matchAllowCount, matchBlockCount: matchBlockCount,
            legacyAllowGateBlockCount: legacyAllowGateBlockCount,
            legacyBlockGateAllowCount: legacyBlockGateAllowCount,
            matchRate: percentage(matchCount, comparableCount),
            mismatchRate: percentage(mismatchCount, comparableCount),
            latestObservation: items.length ? clone(items[items.length - 1]) : null,
            markets: Array.from(new Set(items.map(function (item) { return item.symbol; }))).sort(),
            intervals: Array.from(new Set(items.map(function (item) { return item.interval; }))).sort(),
            capacity: CAPACITY, droppedCount: droppedCount
        };
    }

    function getSnapshot() {
        var items = clone(observations);
        return { schemaVersion: SOURCE_SCHEMA_VERSION, summary: telemetrySummary(items), observations: items };
    }

    function validationAvailable() {
        return assessment && typeof assessment.validateSnapshot === "function";
    }

    function rememberSource(source, accepted, error, counts, conflicts) {
        if (!source) return;
        sources.push({
            name: source.name, importedAt: source.importedAt, accepted: accepted,
            error: error, addedCount: counts.added, duplicateCount: counts.duplicates,
            conflictCount: counts.conflicts, conflictKeys: conflicts.slice(0, 20)
        });
        sources.sort(function (left, right) {
            return left.importedAt - right.importedAt || left.name.localeCompare(right.name);
        });
        if (sources.length > SOURCE_CAPACITY) sources = sources.slice(-SOURCE_CAPACITY);
    }

    function result(valid, error, added, duplicates, conflicts, sourceAccepted, conflictKeys) {
        return {
            valid: valid, error: error, addedCount: added, duplicateCount: duplicates,
            conflictCount: conflicts, observationCount: observations.length,
            sourceAccepted: sourceAccepted, conflictKeys: conflictKeys || []
        };
    }

    function addSnapshot(snapshot, source) {
        var input;
        var sourceValue;
        var validation;
        var currentByKey;
        var pending = [];
        var duplicates = 0;
        var conflicts = [];
        try { input = clone(snapshot); sourceValue = safeSource(clone(source)); }
        catch (error) { input = null; sourceValue = null; }
        if (!sourceValue) {
            rejectedSourceCount += 1;
            return result(false, "INVALID_SOURCE", 0, 0, 0, false);
        }
        if (!validationAvailable()) {
            rejectedSourceCount += 1;
            rememberSource(sourceValue, false, "ASSESSMENT_UNAVAILABLE",
                { added: 0, duplicates: 0, conflicts: 0 }, []);
            return result(false, "ASSESSMENT_UNAVAILABLE", 0, 0, 0, false);
        }
        try { validation = assessment.validateSnapshot(input); }
        catch (error) { validation = { valid: false, error: "INVALID_SNAPSHOT" }; }
        if (!validation || validation.valid !== true) {
            rejectedSourceCount += 1;
            var validationError = validation && typeof validation.error === "string"
                ? validation.error : "INVALID_SNAPSHOT";
            rememberSource(sourceValue, false, validationError,
                { added: 0, duplicates: 0, conflicts: 0 }, []);
            return result(false, validationError, 0, 0, 0, false);
        }
        var working = clone(observations);
        currentByKey = new Map(working.map(function (item) { return [item.key, item]; }));
        input.observations.forEach(function (item) {
            var existing = currentByKey.get(item.key);
            if (!existing) {
                pending.push(clone(item));
                currentByKey.set(item.key, item);
            } else if (diagnosticContent(existing) === diagnosticContent(item)) {
                duplicates += 1;
                if (item.observedAt < existing.observedAt) existing.observedAt = item.observedAt;
            } else {
                conflicts.push(item.key);
            }
        });
        if (conflicts.length) {
            conflictCount += conflicts.length;
            rejectedSourceCount += 1;
            rememberSource(sourceValue, false, "OBSERVATION_CONFLICT",
                { added: 0, duplicates: duplicates, conflicts: conflicts.length }, conflicts);
            return result(false, "OBSERVATION_CONFLICT", 0, duplicates,
                conflicts.length, false, clone(conflicts));
        }
        var combined = working.concat(pending).sort(compareObservation);
        var overflow = Math.max(0, combined.length - CAPACITY);
        if (overflow) combined = combined.slice(overflow);
        observations = clone(combined);
        droppedCount += overflow;
        duplicateCount += duplicates;
        acceptedSourceCount += 1;
        rememberSource(sourceValue, true, null,
            { added: pending.length, duplicates: duplicates, conflicts: 0 }, []);
        return result(true, null, pending.length, duplicates, 0, true);
    }

    function getSummary() {
        var snapshot = getSnapshot();
        var compatible = false;
        try { compatible = validationAvailable() && assessment.validateSnapshot(snapshot).valid === true; }
        catch (error) { compatible = false; }
        return {
            sourceCount: acceptedSourceCount + rejectedSourceCount,
            acceptedSourceCount: acceptedSourceCount, rejectedSourceCount: rejectedSourceCount,
            observationCount: observations.length, duplicateCount: duplicateCount,
            conflictCount: conflictCount, droppedCount: droppedCount,
            markets: clone(snapshot.summary.markets), intervals: clone(snapshot.summary.intervals),
            oldestEvaluationCloseTime: observations.length ? observations[0].evaluationCloseTime : null,
            newestEvaluationCloseTime: observations.length
                ? observations[observations.length - 1].evaluationCloseTime : null,
            assessmentCompatible: compatible
        };
    }

    function reset(reason) {
        observations = [];
        sources = [];
        acceptedSourceCount = 0;
        rejectedSourceCount = 0;
        duplicateCount = 0;
        conflictCount = 0;
        droppedCount = 0;
        return { valid: true, error: null,
            reason: typeof reason === "string" && reason ? reason : "MANUAL_RESET",
            observationCount: 0 };
    }

    return {
        getSchemaVersion: function () { return SCHEMA_VERSION; },
        getVocabulary: function () {
            return clone({ schemaVersion: SCHEMA_VERSION,
                sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
                errors: ["INVALID_SOURCE", "ASSESSMENT_UNAVAILABLE", "INVALID_SNAPSHOT", "OBSERVATION_CONFLICT"] });
        },
        addSnapshot: addSnapshot,
        getSummary: function () { return clone(getSummary()); },
        getSnapshot: function () { return clone(getSnapshot()); },
        getSources: function () { return clone(sources); },
        reset: reset
    };
}));
