(function (root, factory) {
    "use strict";
    var api = factory(root);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root && typeof root === "object") root.HNDStructureHistoricalPlanEvidence = api;
}(typeof window !== "undefined" ? window : null, function (root) {
    "use strict";
    var SCHEMA = "HND_STRUCTURE_HISTORICAL_PLAN_EVIDENCE_V1";
    var SOURCE = "HISTORICAL_REPLAY";
    var CONTEXT_FIELDS = ["symbol", "interval", "candidateKey", "evaluationCloseTime"];
    var STATUSES = ["PLAN_EVIDENCE_AVAILABLE", "NOT_APPLICABLE", "NOT_EVALUABLE", "INVALID_INPUT"];

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function exact(value, fields) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        var keys = Object.keys(value).sort(), expected = fields.slice().sort();
        return keys.length === expected.length && expected.every(function (key, index) {
            return key === keys[index];
        });
    }
    function finitePositive(value) { return Number.isFinite(value) && value > 0; }
    function getSchemaVersion() { return SCHEMA; }
    function getVocabulary() {
        return clone({ schemaVersions: [SCHEMA], source: SOURCE, statuses: STATUSES,
            entryModes: ["ZONE"], directions: ["LONG", "SHORT"] });
    }
    function result(status, error, evidence, warnings) {
        return { valid: status !== "INVALID_INPUT", error: error || null, schemaVersion: SCHEMA,
            status: status, source: SOURCE, countsTowardLiveReadiness: false,
            evidence: evidence || null, warnings: Array.isArray(warnings) ? warnings.slice() : [] };
    }
    function validCandle(candle) {
        return candle && typeof candle === "object" && !Array.isArray(candle) &&
            Number.isSafeInteger(candle.time) && Number.isSafeInteger(candle.closeTime) &&
            candle.time > 0 && candle.closeTime > candle.time &&
            [candle.open, candle.high, candle.low, candle.close].every(finitePositive) &&
            (candle.volume === undefined || (Number.isFinite(candle.volume) && candle.volume >= 0)) &&
            candle.high >= Math.max(candle.open, candle.close) &&
            candle.low <= Math.min(candle.open, candle.close);
    }
    function validate(input, decisionBundle, context) {
        if (!input || typeof input !== "object" || Array.isArray(input) ||
            !decisionBundle || typeof decisionBundle !== "object" || Array.isArray(decisionBundle) ||
            !exact(context, CONTEXT_FIELDS) || typeof context.symbol !== "string" ||
            !/^[A-Z0-9]+$/.test(context.symbol) || typeof context.interval !== "string" || !context.interval ||
            typeof context.candidateKey !== "string" || !context.candidateKey ||
            !Number.isSafeInteger(context.evaluationCloseTime) || context.evaluationCloseTime <= 0 ||
            input.symbol !== context.symbol || input.interval !== context.interval ||
            !Array.isArray(input.candles) || !input.candles.length) return "INVALID_CONTEXT";
        var previous = 0;
        for (var index = 0; index < input.candles.length; index += 1) {
            var candle = input.candles[index];
            if (!validCandle(candle)) return "MALFORMED_CANDLE";
            if (candle.closeTime <= previous) return "UNORDERED_CANDLES";
            if (candle.closeTime > context.evaluationCloseTime) return "FUTURE_CANDLE";
            previous = candle.closeTime;
        }
        if (input.candles[input.candles.length - 1].closeTime !== context.evaluationCloseTime)
            return "EVALUATION_CANDLE_MISMATCH";
        if (decisionBundle.valid !== true || !["ALLOW", "BLOCK"].includes(decisionBundle.decision))
            return "MALFORMED_DECISION_BUNDLE";
        return null;
    }
    function dependencies() {
        var setup = root && root.HNDSetupEngine;
        var plan = root && root.HNDTradePlanEngine;
        var smartMoney = root && root.HNDSmartMoney;
        if (!setup || typeof setup.buildSetupFromCandidate !== "function" ||
            !plan || typeof plan.buildPlan !== "function" ||
            !smartMoney || typeof smartMoney.detectLiquidityZones !== "function" ||
            typeof smartMoney.getStrongestLiquidityZones !== "function") return null;
        return { setup: setup, plan: plan, detectLiquidityZones: smartMoney.detectLiquidityZones,
            getStrongestLiquidityZones: smartMoney.getStrongestLiquidityZones };
    }
    function validEvidence(evidence, context, setupCandidateKey) {
        if (!evidence || evidence.source !== SOURCE || evidence.countsTowardLiveReadiness !== false ||
            evidence.symbol !== context.symbol || evidence.interval !== context.interval ||
            evidence.candidateKey !== context.candidateKey || evidence.setupCandidateKey !== setupCandidateKey ||
            evidence.evaluationCloseTime !== context.evaluationCloseTime ||
            !["LONG", "SHORT"].includes(evidence.direction) || evidence.entryMode !== "ZONE" ||
            ![evidence.entryPrice, evidence.entryLow, evidence.entryHigh,
                evidence.stopLoss, evidence.takeProfit].every(finitePositive) ||
            evidence.entryLow > evidence.entryPrice || evidence.entryPrice > evidence.entryHigh) return false;
        return evidence.direction === "LONG"
            ? evidence.stopLoss < evidence.entryPrice && evidence.entryPrice < evidence.takeProfit
            : evidence.takeProfit < evidence.entryPrice && evidence.entryPrice < evidence.stopLoss;
    }
    function buildPlanEvidence(input, decisionBundle, context) {
        var safeInput, safeDecision, safeContext;
        try { safeInput = clone(input); safeDecision = clone(decisionBundle); safeContext = clone(context); }
        catch (error) { return result("INVALID_INPUT", "CLONE_FAILED"); }
        var validation = validate(safeInput, safeDecision, safeContext);
        if (validation) return result("INVALID_INPUT", validation);
        if (safeDecision.decision !== "ALLOW") return result("NOT_APPLICABLE", "LEGACY_DECISION_NOT_ALLOW");
        var candidate = safeDecision.candidate;
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
            typeof candidate.key !== "string" || !candidate.key)
            return result("NOT_EVALUABLE", "DIRECT_SETUP_CANDIDATE_UNAVAILABLE");
        var deps = dependencies();
        if (!deps) return result("NOT_EVALUABLE", "AUTHORITATIVE_PLAN_DEPENDENCY_UNAVAILABLE");
        var setup, liquidityZones, strongestLiquidity, built;
        try {
            setup = deps.setup.buildSetupFromCandidate(clone(candidate), clone(safeInput),
                clone(safeInput.candles), safeContext.evaluationCloseTime);
            if (!setup || typeof setup !== "object")
                return result("NOT_EVALUABLE", "AUTHORITATIVE_SETUP_UNAVAILABLE");
            liquidityZones = deps.detectLiquidityZones({ candles: clone(safeInput.candles) });
            if (!Array.isArray(liquidityZones))
                return result("NOT_EVALUABLE", "AUTHORITATIVE_LIQUIDITY_UNAVAILABLE");
            strongestLiquidity = deps.getStrongestLiquidityZones(clone(liquidityZones));
            built = deps.plan.buildPlan({ symbol: safeContext.symbol, interval: safeContext.interval,
                price: safeInput.price, setupState: { currentSetup: clone(setup) },
                liquidityZones: clone(liquidityZones), strongestLiquidity: clone(strongestLiquidity) },
                { evaluationTime: safeContext.evaluationCloseTime });
        } catch (error2) {
            return result("NOT_EVALUABLE", "AUTHORITATIVE_PLAN_EXCEPTION");
        }
        if (!built || built.valid !== true || !built.plan)
            return result("NOT_EVALUABLE", built && built.reason || "AUTHORITATIVE_PLAN_UNAVAILABLE");
        var plan = built.plan;
        var evidence = { source: SOURCE, countsTowardLiveReadiness: false,
            symbol: safeContext.symbol, interval: safeContext.interval,
            candidateKey: safeContext.candidateKey, setupCandidateKey: candidate.key,
            evaluationCloseTime: safeContext.evaluationCloseTime,
            direction: plan.direction, entryMode: "ZONE", entryPrice: plan.entryPrice,
            entryLow: plan.entryLow, entryHigh: plan.entryHigh,
            stopLoss: plan.stopLoss, takeProfit: plan.takeProfit,
            setupCore: "HND_SETUP_ENGINE_BUILD_SETUP_FROM_CANDIDATE_V4_1",
            planCore: "HND_TRADE_PLAN_ENGINE_BUILD_PLAN_V4_2",
            stopSource: plan.stopSource, targetSource: plan.targetSource };
        if (!validEvidence(evidence, safeContext, candidate.key))
            return result("NOT_EVALUABLE", "MALFORMED_AUTHORITATIVE_PLAN_EVIDENCE");
        return result("PLAN_EVIDENCE_AVAILABLE", null, clone(evidence), []);
    }
    return { getSchemaVersion: getSchemaVersion, getVocabulary: getVocabulary,
        buildPlanEvidence: buildPlanEvidence };
}));
