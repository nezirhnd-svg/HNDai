// ==========================
// HNDai Trade Journal Engine
// ==========================

(function () {
    "use strict";

    const HND_TRADE_JOURNAL_VERSION = "4.5";
    const HND_TRADE_JOURNAL_SCHEMA_VERSION = 1;
    const HND_TRADE_JOURNAL_STORAGE_KEY = "HNDai.paperTradeJournal.v4.5";
    const HND_TRADE_JOURNAL_MAX_TRADES = 1000;
    const HND_TRADE_JOURNAL_RECENT_LIMIT = 20;
    const HND_TRADE_JOURNAL_EPSILON = 1e-9;
    const HND_TRADE_JOURNAL_MAX_DEBUG_SAMPLES = 10;
    const HND_TRADE_JOURNAL_DEBUG_REASONS = Object.freeze({
        JOURNAL_INITIALIZED_EMPTY: "JOURNAL_INITIALIZED_EMPTY",
        JOURNAL_LOADED: "JOURNAL_LOADED",
        JOURNAL_SYNCED: "JOURNAL_SYNCED",
        NO_NEW_TRADES: "NO_NEW_TRADES",
        STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
        STORAGE_READ_ERROR: "STORAGE_READ_ERROR",
        STORAGE_WRITE_ERROR: "STORAGE_WRITE_ERROR",
        INVALID_STORAGE_PAYLOAD: "INVALID_STORAGE_PAYLOAD",
        EXPORT_READY: "EXPORT_READY",
        JOURNAL_ERROR: "JOURNAL_ERROR"
    });
    const HND_TRADE_JOURNAL_TERMINAL_STATES = new Set([
        "CLOSED_TP", "CLOSED_SL", "CANCELLED_MARKET_CHANGE", "CANCELLED_MANUAL"
    ]);

    let journalTrades = [];
    let journalMetrics = createEmptyMetrics();
    let storageAvailable = false;
    let persistenceActive = false;
    let initialized = false;
    let lastEvaluation = null;
    let lastStoredAt = null;

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function createEmptyMetrics() {
        return {
            totalJournalTrades: 0, completedTrades: 0, cancelledTrades: 0,
            wins: 0, losses: 0, breakevenTrades: 0, winRate: null,
            netR: 0, grossProfitR: 0, grossLossR: 0,
            profitFactor: null, profitFactorInfinite: false,
            averageR: null, expectancyR: null, averageWinR: null, averageLossR: null,
            bestTradeR: null, worstTradeR: null,
            maxDrawdownR: 0, peakCumulativeR: 0, finalCumulativeR: 0,
            maxWinStreak: 0, maxLossStreak: 0,
            currentStreakType: "NONE", currentStreakLength: 0,
            longTrades: 0, shortTrades: 0,
            firstTradeAt: null, lastTradeAt: null
        };
    }

    function classifyJournalOutcome(trade) {
        if (String(trade?.state || "").startsWith("CANCELLED")) return "CANCELLED";
        if (trade.realizedR > HND_TRADE_JOURNAL_EPSILON) return "WIN";
        if (trade.realizedR < -HND_TRADE_JOURNAL_EPSILON) return "LOSS";
        return "BREAKEVEN";
    }

    function getJournalTradeIdentity(trade) {
        if (typeof trade?.key === "string" && trade.key) return `KEY:${trade.key}`;
        if (typeof trade?.id === "string" && trade.id) return `ID:${trade.id}`;
        if (typeof trade?.planKey === "string" && trade.planKey &&
            Number.isFinite(trade.openedAt) && Number.isFinite(trade.closedAt)) {
            return `PLAN:${trade.planKey}|${trade.openedAt}|${trade.closedAt}`;
        }
        return null;
    }

    function optionalString(value) {
        return typeof value === "string" && value ? value : null;
    }

    function optionalFinite(value, minimum = -Infinity) {
        return Number.isFinite(value) && value >= minimum ? value : null;
    }

    function normalizeJournalTrade(source) {
        if (!source || !HND_TRADE_JOURNAL_TERMINAL_STATES.has(source.state) ||
            !optionalString(source.symbol) || !optionalString(source.interval) ||
            !["LONG", "SHORT"].includes(source.direction) ||
            ![source.entryPrice, source.stopLoss, source.takeProfit, source.exitPrice,
                source.risk, source.openedAt, source.closedAt].every(value =>
                Number.isFinite(value) && value > 0) ||
            source.closedAt < source.openedAt || !Number.isFinite(source.realizedR)) return null;
        const ordered = source.direction === "LONG"
            ? source.stopLoss < source.entryPrice && source.entryPrice < source.takeProfit
            : source.takeProfit < source.entryPrice && source.entryPrice < source.stopLoss;
        if (!ordered) return null;
        const identity = getJournalTradeIdentity(source);
        if (!identity) return null;
        const trade = {
            id: optionalString(source.id), key: optionalString(source.key),
            planId: optionalString(source.planId), planKey: optionalString(source.planKey),
            setupId: optionalString(source.setupId), setupKey: optionalString(source.setupKey),
            symbol: source.symbol, interval: source.interval,
            direction: source.direction, state: source.state,
            entryPrice: source.entryPrice, stopLoss: source.stopLoss,
            takeProfit: source.takeProfit, exitPrice: source.exitPrice,
            risk: source.risk,
            reward: optionalFinite(source.reward, 0),
            riskATR: optionalFinite(source.riskATR, 0),
            plannedRiskReward: optionalFinite(source.plannedRiskReward, 0),
            realizedPricePnL: Number.isFinite(source.realizedPricePnL)
                ? source.realizedPricePnL : source.realizedR * source.risk,
            realizedR: source.realizedR,
            maxFavorableR: optionalFinite(source.maxFavorableR, 0),
            maxAdverseR: optionalFinite(source.maxAdverseR, 0),
            openedAt: source.openedAt, closedAt: source.closedAt,
            openedAtCandleTime: optionalFinite(source.openedAtCandleTime, 0),
            closedAtCandleTime: optionalFinite(source.closedAtCandleTime, 0),
            durationMs: optionalFinite(source.durationMs, 0) ??
                Math.max(0, source.closedAt - source.openedAt),
            durationBars: optionalFinite(source.durationBars, 0),
            fillSource: optionalString(source.fillSource),
            exitSource: optionalString(source.exitSource),
            exitReason: optionalString(source.exitReason),
            journalOutcome: null,
            journaledAt: Number.isFinite(source.journaledAt) && source.journaledAt > 0
                ? source.journaledAt : source.closedAt
        };
        trade.journalOutcome = classifyJournalOutcome(trade);
        return trade;
    }

    function compareJournalTrades(first, second) {
        return first.closedAt - second.closedAt || first.openedAt - second.openedAt ||
            getJournalTradeIdentity(first).localeCompare(getJournalTradeIdentity(second));
    }

    function preferJournalTrade(first, second) {
        if (second.closedAt !== first.closedAt) return second.closedAt > first.closedAt ? second : first;
        if (second.journaledAt !== first.journaledAt) {
            return second.journaledAt > first.journaledAt ? second : first;
        }
        return JSON.stringify(second) > JSON.stringify(first) ? second : first;
    }

    function dedupeJournalTrades(trades) {
        const map = new Map();
        trades.forEach(trade => {
            const identity = getJournalTradeIdentity(trade);
            if (!identity) return;
            const existing = map.get(identity);
            map.set(identity, existing ? preferJournalTrade(existing, trade) : trade);
        });
        return [...map.values()].sort(compareJournalTrades);
    }

    function retainJournalTrades(trades) {
        const sorted = [...trades].sort(compareJournalTrades);
        return sorted.slice(Math.max(0, sorted.length - HND_TRADE_JOURNAL_MAX_TRADES));
    }

    function calculateJournalMetrics(trades) {
        const metrics = createEmptyMetrics();
        const sorted = [...trades].sort(compareJournalTrades);
        metrics.totalJournalTrades = sorted.length;
        metrics.cancelledTrades = sorted.filter(trade => trade.journalOutcome === "CANCELLED").length;
        metrics.firstTradeAt = sorted[0]?.closedAt ?? null;
        metrics.lastTradeAt = sorted[sorted.length - 1]?.closedAt ?? null;
        const completed = sorted.filter(trade =>
            ["CLOSED_TP", "CLOSED_SL"].includes(trade.state) && Number.isFinite(trade.realizedR)
        );
        metrics.completedTrades = completed.length;
        metrics.wins = completed.filter(trade => trade.journalOutcome === "WIN").length;
        metrics.losses = completed.filter(trade => trade.journalOutcome === "LOSS").length;
        metrics.breakevenTrades = completed.filter(trade => trade.journalOutcome === "BREAKEVEN").length;
        const decisive = metrics.wins + metrics.losses;
        metrics.winRate = decisive ? metrics.wins / decisive * 100 : null;
        const values = completed.map(trade => trade.realizedR);
        metrics.netR = values.reduce((sum, value) => sum + value, 0);
        metrics.grossProfitR = values.filter(value => value > HND_TRADE_JOURNAL_EPSILON)
            .reduce((sum, value) => sum + value, 0);
        metrics.grossLossR = Math.abs(values.filter(value => value < -HND_TRADE_JOURNAL_EPSILON)
            .reduce((sum, value) => sum + value, 0));
        if (metrics.grossLossR > 0) metrics.profitFactor = metrics.grossProfitR / metrics.grossLossR;
        else if (metrics.grossProfitR > 0) metrics.profitFactorInfinite = true;
        metrics.averageR = completed.length ? metrics.netR / completed.length : null;
        metrics.expectancyR = metrics.averageR;
        metrics.averageWinR = metrics.wins ? metrics.grossProfitR / metrics.wins : null;
        metrics.averageLossR = metrics.losses ? -metrics.grossLossR / metrics.losses : null;
        metrics.bestTradeR = values.length ? Math.max(...values) : null;
        metrics.worstTradeR = values.length ? Math.min(...values) : null;
        metrics.longTrades = completed.filter(trade => trade.direction === "LONG").length;
        metrics.shortTrades = completed.filter(trade => trade.direction === "SHORT").length;

        let cumulative = 0;
        let peak = 0;
        let maxDrawdown = 0;
        let streakType = "NONE";
        let streakLength = 0;
        completed.forEach(trade => {
            cumulative += trade.realizedR;
            peak = Math.max(peak, cumulative);
            maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
        });
        sorted.forEach(trade => {
            const outcome = trade.journalOutcome;
            if (outcome !== "WIN" && outcome !== "LOSS") {
                streakType = "NONE"; streakLength = 0; return;
            }
            if (outcome === streakType) streakLength++;
            else { streakType = outcome; streakLength = 1; }
            if (outcome === "WIN") metrics.maxWinStreak = Math.max(metrics.maxWinStreak, streakLength);
            else metrics.maxLossStreak = Math.max(metrics.maxLossStreak, streakLength);
        });
        metrics.maxDrawdownR = maxDrawdown;
        metrics.peakCumulativeR = peak;
        metrics.finalCumulativeR = cumulative;
        metrics.currentStreakType = streakType;
        metrics.currentStreakLength = streakLength;
        return metrics;
    }

    function getJournalStorage() {
        try {
            if (typeof window === "undefined" || !window.localStorage) return null;
            window.localStorage.getItem(HND_TRADE_JOURNAL_STORAGE_KEY);
            return window.localStorage;
        } catch (error) { return null; }
    }

    function readJournalStorage() {
        const storage = getJournalStorage();
        if (!storage) return { ok: false, empty: true, error: null };
        try {
            const raw = storage.getItem(HND_TRADE_JOURNAL_STORAGE_KEY);
            if (raw === null) return { ok: true, empty: true, payload: null };
            const payload = JSON.parse(raw);
            if (!payload || payload.schemaVersion !== HND_TRADE_JOURNAL_SCHEMA_VERSION ||
                payload.journalVersion !== HND_TRADE_JOURNAL_VERSION ||
                !Array.isArray(payload.trades)) {
                return { ok: false, empty: false, invalid: true, error: null };
            }
            return { ok: true, empty: false, payload };
        } catch (error) { return { ok: false, empty: false, error }; }
    }

    function writeJournalStorage(payload) {
        const storage = getJournalStorage();
        if (!storage) return { ok: false, error: null };
        try {
            storage.setItem(HND_TRADE_JOURNAL_STORAGE_KEY, JSON.stringify(payload));
            return { ok: true, error: null };
        } catch (error) { return { ok: false, error }; }
    }

    function makeDebug(reason, details = {}) {
        const error = details.error;
        return {
            version: HND_TRADE_JOURNAL_VERSION,
            schemaVersion: HND_TRADE_JOURNAL_SCHEMA_VERSION,
            primaryReason: reason,
            storage: {
                available: storageAvailable,
                persistenceActive,
                key: HND_TRADE_JOURNAL_STORAGE_KEY,
                readAttempted: details.readAttempted === true,
                writeAttempted: details.writeAttempted === true,
                writeSucceeded: details.writeSucceeded === true,
                errorName: error?.name ? String(error.name).slice(0, 80) : null,
                errorMessage: error?.message ? String(error.message).slice(0, 300) : null
            },
            input: {
                historyReceived: details.historyReceived || 0,
                lastClosedReceived: details.lastClosedReceived || 0,
                normalizedReceived: details.normalizedReceived || 0,
                invalidReceived: details.invalidReceived || 0,
                duplicateReceived: details.duplicateReceived || 0,
                invalidSamples: (details.invalidSamples || []).slice(0, HND_TRADE_JOURNAL_MAX_DEBUG_SAMPLES)
            },
            journal: {
                previousCount: details.previousCount || 0,
                addedCount: details.addedCount || 0,
                replacedCount: details.replacedCount || 0,
                finalCount: journalTrades.length,
                retentionDropped: details.retentionDropped || 0
            },
            metrics: {
                completedTrades: journalMetrics.completedTrades,
                wins: journalMetrics.wins,
                losses: journalMetrics.losses,
                cancelledTrades: journalMetrics.cancelledTrades,
                netR: journalMetrics.netR,
                maxDrawdownR: journalMetrics.maxDrawdownR
            },
            evaluatedAt: Date.now()
        };
    }

    function init() {
        if (initialized) return getState();
        const read = readJournalStorage();
        storageAvailable = Boolean(getJournalStorage());
        persistenceActive = storageAvailable;
        let reason = HND_TRADE_JOURNAL_DEBUG_REASONS.JOURNAL_INITIALIZED_EMPTY;
        let error = read.error || null;
        journalTrades = [];
        if (!storageAvailable) {
            reason = HND_TRADE_JOURNAL_DEBUG_REASONS.STORAGE_UNAVAILABLE;
            persistenceActive = false;
        } else if (!read.ok) {
            reason = read.invalid
                ? HND_TRADE_JOURNAL_DEBUG_REASONS.INVALID_STORAGE_PAYLOAD
                : HND_TRADE_JOURNAL_DEBUG_REASONS.STORAGE_READ_ERROR;
            persistenceActive = false;
        } else if (!read.empty) {
            const normalized = read.payload.trades.map(normalizeJournalTrade).filter(Boolean);
            journalTrades = retainJournalTrades(dedupeJournalTrades(normalized));
            lastStoredAt = Number.isFinite(read.payload.updatedAt) ? read.payload.updatedAt : null;
            reason = HND_TRADE_JOURNAL_DEBUG_REASONS.JOURNAL_LOADED;
        }
        journalMetrics = calculateJournalMetrics(journalTrades);
        initialized = true;
        lastEvaluation = { debug: makeDebug(reason, {
            readAttempted: true,
            error,
            normalizedReceived: journalTrades.length,
            invalidReceived: read.payload?.trades?.length - journalTrades.length || 0
        }) };
        return getState();
    }

    function sync(input = {}) {
        if (!initialized) init();
        try {
            const history = Array.isArray(input.tradeHistory) ? input.tradeHistory : [];
            const received = [...history, ...(input.lastClosedTrade ? [input.lastClosedTrade] : [])];
            const normalized = received.map(normalizeJournalTrade);
            const valid = normalized.filter(Boolean);
            const incoming = dedupeJournalTrades(valid);
            const previousCount = journalTrades.length;
            const existingMap = new Map(journalTrades.map(trade => [getJournalTradeIdentity(trade), trade]));
            let addedCount = 0;
            let replacedCount = 0;
            incoming.forEach(trade => {
                const identity = getJournalTradeIdentity(trade);
                const existing = existingMap.get(identity);
                if (!existing) { existingMap.set(identity, trade); addedCount++; return; }
                const preferred = preferJournalTrade(existing, trade);
                if (JSON.stringify(preferred) !== JSON.stringify(existing)) {
                    existingMap.set(identity, preferred); replacedCount++;
                }
            });
            const merged = dedupeJournalTrades([...existingMap.values()]);
            const retentionDropped = Math.max(0, merged.length - HND_TRADE_JOURNAL_MAX_TRADES);
            const nextTrades = retainJournalTrades(merged);
            const changed = JSON.stringify(nextTrades) !== JSON.stringify(journalTrades);
            journalTrades = nextTrades;
            journalMetrics = calculateJournalMetrics(journalTrades);
            let reason = changed ? HND_TRADE_JOURNAL_DEBUG_REASONS.JOURNAL_SYNCED
                : HND_TRADE_JOURNAL_DEBUG_REASONS.NO_NEW_TRADES;
            let writeAttempted = false;
            let writeSucceeded = false;
            let error = null;
            if (changed && storageAvailable) {
                writeAttempted = true;
                const updatedAt = Date.now();
                const written = writeJournalStorage({
                    schemaVersion: HND_TRADE_JOURNAL_SCHEMA_VERSION,
                    journalVersion: HND_TRADE_JOURNAL_VERSION,
                    updatedAt,
                    trades: journalTrades
                });
                writeSucceeded = written.ok;
                error = written.error;
                persistenceActive = written.ok;
                if (written.ok) lastStoredAt = updatedAt;
                else reason = HND_TRADE_JOURNAL_DEBUG_REASONS.STORAGE_WRITE_ERROR;
            }
            lastEvaluation = { debug: makeDebug(reason, {
                writeAttempted, writeSucceeded, error, previousCount,
                historyReceived: history.length,
                lastClosedReceived: input.lastClosedTrade ? 1 : 0,
                normalizedReceived: valid.length,
                invalidReceived: received.length - valid.length,
                duplicateReceived: valid.length - incoming.length,
                addedCount, replacedCount, retentionDropped
            }) };
            return getState();
        } catch (error) {
            lastEvaluation = { debug: makeDebug(HND_TRADE_JOURNAL_DEBUG_REASONS.JOURNAL_ERROR, { error }) };
            return getState();
        }
    }

    function getTrades() { return clone(journalTrades); }

    function getRecentTrades(limit = HND_TRADE_JOURNAL_RECENT_LIMIT) {
        const safeLimit = Math.min(100, Math.max(1,
            Number.isFinite(limit) ? Math.floor(limit) : HND_TRADE_JOURNAL_RECENT_LIMIT
        ));
        return clone([...journalTrades].sort((first, second) =>
            second.closedAt - first.closedAt || second.openedAt - first.openedAt ||
            getJournalTradeIdentity(first).localeCompare(getJournalTradeIdentity(second))
        ).slice(0, safeLimit));
    }

    function getMetrics() { return clone(journalMetrics); }
    function getLastDebug() { return clone(lastEvaluation?.debug || null); }

    function getState() {
        return {
            version: HND_TRADE_JOURNAL_VERSION,
            schemaVersion: HND_TRADE_JOURNAL_SCHEMA_VERSION,
            initialized,
            storageAvailable,
            persistenceActive,
            tradeCount: journalTrades.length,
            metrics: getMetrics(),
            recentTrades: getRecentTrades(),
            lastStoredAt,
            lastEvaluation: clone(lastEvaluation)
        };
    }

    function explainLastEvaluation() {
        const debug = getLastDebug();
        return {
            primaryReason: debug?.primaryReason || null,
            persistenceActive,
            tradeCount: journalTrades.length,
            metrics: getMetrics(),
            summary: debug ? {
                added: debug.journal.addedCount,
                replaced: debug.journal.replacedCount,
                invalid: debug.input.invalidReceived,
                storageWriteSucceeded: debug.storage.writeSucceeded
            } : null
        };
    }

    function escapeCSVCell(value) {
        let text = value == null ? "" : String(value);
        if (/^[=+\-@]/.test(text)) text = `'${text}`;
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    }

    function formatJournalTimestamp(value) {
        try { return new Date(value).toISOString(); }
        catch (error) { return String(value); }
    }

    function toCSV() {
        const headers = ["Closed At", "Opened At", "Symbol", "Interval", "Direction", "State",
            "Outcome", "Entry", "Stop Loss", "Take Profit", "Exit", "Realized R", "MFE R",
            "MAE R", "Duration Ms", "Duration Bars", "Fill Source", "Exit Source", "Exit Reason",
            "Trade ID", "Plan ID", "Setup ID"];
        const rows = journalTrades.map(trade => [
            formatJournalTimestamp(trade.closedAt), formatJournalTimestamp(trade.openedAt),
            trade.symbol, trade.interval, trade.direction, trade.state, trade.journalOutcome,
            trade.entryPrice, trade.stopLoss, trade.takeProfit, trade.exitPrice, trade.realizedR,
            trade.maxFavorableR, trade.maxAdverseR, trade.durationMs, trade.durationBars,
            trade.fillSource, trade.exitSource, trade.exitReason, trade.id, trade.planId, trade.setupId
        ]);
        const csv = [headers, ...rows].map(row => row.map(escapeCSVCell).join(",")).join("\r\n");
        lastEvaluation = { debug: makeDebug(HND_TRADE_JOURNAL_DEBUG_REASONS.EXPORT_READY) };
        return csv;
    }

    function toJSON() {
        const exportedAt = Date.now();
        const json = JSON.stringify({
            schemaVersion: HND_TRADE_JOURNAL_SCHEMA_VERSION,
            journalVersion: HND_TRADE_JOURNAL_VERSION,
            exportedAt,
            metrics: journalMetrics,
            trades: journalTrades
        }, null, 2);
        lastEvaluation = { debug: makeDebug(HND_TRADE_JOURNAL_DEBUG_REASONS.EXPORT_READY) };
        return json;
    }

    function reload() {
        initialized = false;
        journalTrades = [];
        journalMetrics = createEmptyMetrics();
        lastEvaluation = null;
        lastStoredAt = null;
        return init();
    }

    window.HNDTradeJournal = {
        init, sync, getState, getTrades, getRecentTrades, getMetrics,
        getLastDebug, explainLastEvaluation, toCSV, toJSON, reload
    };
})();
