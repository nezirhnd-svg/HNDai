// ==========================
// HNDai UI Engine
// ==========================

console.log("HNDai UI v4.5");

let tradeJournalExportControlsInitialized = false;
let structureShadowTelemetryControlsInitialized = false;
let structureShadowAssessmentControlsInitialized = false;
let structureShadowCollectionControlsInitialized = false;
let structureObservationPlanControlsInitialized = false;
let lastStructureObservationProgress = null;
let structureMismatchAnalyzerControlsInitialized = false;
let lastStructureMismatchAnalysis = null;
let structurePaperTrialReadinessControlsInitialized = false;
let lastStructurePaperTrialReadiness = null;
let structureHistoricalShadowReplayControlsInitialized = false;
let lastStructureHistoricalShadowReplay = null;
let structureHistoricalMismatchAnalyzeButton = null;
let structureHistoricalMismatchExportButton = null;
let lastStructureHistoricalMismatchAnalysis = null;
const HND_STRUCTURE_SHADOW_IMPORT_LIMIT = 5 * 1024 * 1024;
const HND_STRUCTURE_SHADOW_COLLECTION_TOTAL_LIMIT = 25 * 1024 * 1024;
const HND_STRUCTURE_SHADOW_COLLECTION_FILE_LIMIT = 20;

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function formatNumber(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function formatMarketPrice(value) {
    if (!Number.isFinite(value) || value <= 0) return "-";
    if (value >= 1000) return value.toFixed(2);
    if (value >= 1) return value.toFixed(4);
    if (value >= 0.01) return value.toFixed(6);
    return value.toFixed(8);
}

function setEvidence(id, evidence, emptyMessage) {
    const container = document.getElementById(id);
    if (!container) return;

    container.replaceChildren();

    if (!Array.isArray(evidence) || evidence.length === 0) {
        container.textContent = emptyMessage;
        return;
    }

    evidence.forEach(item => {
        const line = document.createElement("div");
        line.textContent = String(item);
        container.appendChild(line);
    });
}

function formatSetupStatus(status) {
    return status === "NO_SETUP" ? "NO SETUP" : String(status || "NO SETUP");
}

function formatSetupSource(sourceType) {
    if (sourceType === "OB_FVG_CONFLUENCE") return "OB + FVG";
    if (sourceType === "ORDER_BLOCK") return "ORDER BLOCK";
    if (sourceType === "FVG") return "FVG";
    return "-";
}

function clearSetupStatusClasses(element) {
    if (!element) return;
    [...element.classList].filter(name => name.startsWith("setup-status-"))
        .forEach(name => element.classList.remove(name));
}

function updateSetupUI(setupState, tradePlanState = null, tradeState = null) {
    const setup = setupState?.currentSetup || null;
    const plan = tradePlanState?.currentPlan || null;
    const trade = tradeState?.activeTrade || activeTrade || null;
    const status = setup?.state || "NO_SETUP";
    const statusElement = document.getElementById("setupStatus");
    setText("setupStatus", formatSetupStatus(status));
    clearSetupStatusClasses(statusElement);
    statusElement?.classList.add(`setup-status-${status.toLowerCase().replaceAll("_", "-")}`);
    setText("setupDirection", setup?.direction || "-");
    setText("setupSource", formatSetupSource(setup?.sourceType));
    const entryLow = setup?.entryLow ?? plan?.entryLow;
    const entryHigh = setup?.entryHigh ?? plan?.entryHigh;
    setText("entryZone", finiteSetupBounds(entryLow, entryHigh)
        ? `${formatMarketPrice(entryLow)} - ${formatMarketPrice(entryHigh)}` : "-");
    setText("entry", formatMarketPrice(trade?.entryPrice ?? plan?.entryPrice ?? setup?.entryTarget));
    setText("setupQuality", Number.isFinite(setup?.quality) ? `${setup.quality}%` : "-");
}

function finiteSetupBounds(low, high) {
    return Number.isFinite(low) && low > 0 && Number.isFinite(high) && high >= low;
}

function formatTradePlanStatus(status) {
    if (status === "NO_PLAN") return "NO PLAN";
    if (["CANCELLED_INVALIDATED", "CANCELLED_ORPHANED"].includes(status)) return "CANCELLED";
    if (status === "CANCELLED_MISSED") return "MISSED";
    return String(status || "NO PLAN");
}

function formatTradePlanSource(source, plan = null) {
    if (source === "SOURCE_ZONE_ATR_BUFFER") return "SOURCE ZONE + ATR BUFFER";
    if (source === "RR_FALLBACK") return "2R FALLBACK";
    if (source === "ACTIVE_LIQUIDITY") {
        return plan?.targetLiquidityType === "BUY_SIDE"
            ? "BUY-SIDE LIQUIDITY" : plan?.targetLiquidityType === "SELL_SIDE"
                ? "SELL-SIDE LIQUIDITY" : "ACTIVE LIQUIDITY";
    }
    return "-";
}

function clearTradePlanStatusClasses(element) {
    if (!element) return;
    [...element.classList].filter(name => name.startsWith("trade-plan-status-"))
        .forEach(name => element.classList.remove(name));
}

function updateTradePlanUI(setupState, tradePlanState, tradeState = null) {
    const plan = tradePlanState?.currentPlan || null;
    const trade = tradeState?.activeTrade || activeTrade || null;
    const status = plan?.state || "NO_PLAN";
    const statusElement = document.getElementById("tradePlanStatus");
    setText("tradePlanStatus", formatTradePlanStatus(status));
    clearTradePlanStatusClasses(statusElement);
    statusElement?.classList.add(`trade-plan-status-${status.toLowerCase().replaceAll("_", "-")}`);
    setText("riskReward", Number.isFinite(plan?.riskReward) ? `${plan.riskReward.toFixed(2)}R` : "-");
    setText("stopSource", formatTradePlanSource(plan?.stopSource, plan));
    setText("targetSource", formatTradePlanSource(plan?.targetSource, plan));
    if (trade) {
        setText("sl", formatMarketPrice(trade.stopLoss));
        setText("tp", formatMarketPrice(trade.takeProfit));
    } else if (plan) {
        setText("sl", formatMarketPrice(plan.stopLoss));
        setText("tp", formatMarketPrice(plan.takeProfit));
    } else {
        setText("sl", "-");
        setText("tp", "-");
    }
}

function formatRMultiple(value) {
    if (!Number.isFinite(value)) return "-";
    const normalized = Math.abs(value) < 0.005 ? 0 : value;
    return `${normalized > 0 ? "+" : ""}${normalized.toFixed(2)}R`;
}

function formatTradeStatus(status) {
    const labels = { NO_TRADE: "NO TRADE", WAITING_ENTRY: "WAITING ENTRY", OPEN: "OPEN",
        CLOSED_TP: "TAKE PROFIT", CLOSED_SL: "STOP LOSS",
        CANCELLED_MARKET_CHANGE: "CANCELLED", CANCELLED_MANUAL: "CANCELLED" };
    return labels[status] || String(status || "NO_TRADE").replaceAll("_", " ");
}

function clearTradeStatusClasses(element) {
    if (!element) return;
    [...element.classList].filter(name => name.startsWith("trade-status-"))
        .forEach(name => element.classList.remove(name));
}

function clearStructureShadowClasses(element) {
    if (!element?.classList) return;
    [...element.classList].filter(name => name.startsWith("structure-shadow-state-"))
        .forEach(name => element.classList.remove(name));
}

function updateStructureShadowUI(diagnostic = null) {
    const enabled = diagnostic?.enabled === true;
    const shadow = diagnostic?.shadowResult || null;
    const status = diagnostic?.status || (enabled ? "-" : "DISABLED");
    const mode = enabled ? (shadow?.mode || "SHADOW") : "OFF";
    const mismatch = shadow?.wouldChangeDecision === true;
    const failed = status === "FAILED" || shadow?.status === "FAILED" ||
        shadow?.comparison === "PIPELINE_FAILED";
    const notApplicable = status === "NOT_APPLICABLE";
    const card = document.getElementById("structureShadowCard");
    clearStructureShadowClasses(card);
    const stateClass = failed ? "error" : notApplicable ? "not-applicable"
        : mismatch ? "mismatch" : enabled && shadow ? "match" : "off";
    card?.classList?.add(`structure-shadow-state-${stateClass}`);
    setText("structureShadowMode", mode);
    setText("structureShadowStatus", status);
    setText("structureShadowLegacyDecision",
        shadow?.legacyDecision ?? diagnostic?.legacyResult?.decision ?? "-");
    setText("structureShadowGateDecision", shadow?.gateDecision ?? "-");
    setText("structureShadowComparison", shadow?.comparison ?? "-");
    setText("structureShadowWouldChange", shadow
        ? `${mismatch ? "YES" : "NO"} — diagnostic only` : "-");
    setText("structureShadowGateReason", shadow?.gateReason ??
        (notApplicable ? diagnostic?.reason : null) ?? "-");
    setText("structureShadowError", shadow?.error ??
        (failed ? diagnostic?.reason : null) ?? "-");
    setText("structureShadowFailedStage",
        shadow?.diagnostics?.failedStage ?? shadow?.pipelineEvaluation?.failedStage ?? "-");
    setText("structureShadowCandidateKey", shadow?.candidateKey ??
        diagnostic?.legacyResult?.candidate?.key ?? "-");
}

function updateStructureShadowTelemetryUI(summary = null) {
    const observationCount = Number.isSafeInteger(summary?.observationCount)
        ? summary.observationCount : 0;
    const capacity = Number.isSafeInteger(summary?.capacity) ? summary.capacity : 200;
    setText("structureShadowObservationCount", observationCount);
    setText("structureShadowComparableCount",
        Number.isSafeInteger(summary?.comparableCount) ? summary.comparableCount : 0);
    setText("structureShadowMatchCount",
        Number.isSafeInteger(summary?.matchCount) ? summary.matchCount : 0);
    setText("structureShadowMismatchCount",
        Number.isSafeInteger(summary?.mismatchCount) ? summary.mismatchCount : 0);
    setText("structureShadowMatchRate",
        Number.isFinite(summary?.matchRate) ? `${summary.matchRate.toFixed(2)}%` : "-");
    setText("structureShadowErrorCount",
        Number.isSafeInteger(summary?.failedCount) ? summary.failedCount : 0);
    setText("structureShadowNotApplicableCount",
        Number.isSafeInteger(summary?.notApplicableCount) ? summary.notApplicableCount : 0);
    setText("structureShadowNotComparableCount",
        Number.isSafeInteger(summary?.notComparableCount) ? summary.notComparableCount : 0);
    setText("structureShadowCapacity", `${observationCount} / ${capacity}`);
    const section = document.getElementById("structureShadowObservations");
    section?.classList?.remove("telemetry-mismatch", "telemetry-error");
    if ((summary?.failedCount || 0) > 0) section?.classList?.add("telemetry-error");
    else if ((summary?.mismatchCount || 0) > 0) section?.classList?.add("telemetry-mismatch");
}

function downloadStructureShadowDiagnostics() {
    try {
        const telemetry = window.HNDStructureShadowTelemetry;
        if (!telemetry || typeof telemetry.exportSnapshot !== "function") return;
        const snapshot = telemetry.exportSnapshot();
        const content = JSON.stringify(snapshot, null, 2);
        const blob = new Blob([content], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const date = new Date().toISOString().slice(0, 10);
        link.href = url;
        link.download = `HNDai-structure-shadow-diagnostics-${date}.json`;
        document.body?.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.warn("Structure Shadow diagnostic export could not be created.");
    }
}

function setupStructureShadowTelemetryControls() {
    if (structureShadowTelemetryControlsInitialized) return;
    const resetButton = document.getElementById("resetStructureShadowObservations");
    const exportButton = document.getElementById("exportStructureShadowDiagnostics");
    if (!resetButton || !exportButton) return;
    resetButton.addEventListener("click", () => {
        try {
            const telemetry = window.HNDStructureShadowTelemetry;
            telemetry?.reset?.("UI_RESET");
            updateStructureShadowTelemetryUI(telemetry?.getSummary?.() || null);
        } catch (error) {
            console.warn("Structure Shadow telemetry could not be reset.");
        }
    });
    exportButton.addEventListener("click", downloadStructureShadowDiagnostics);
    structureShadowTelemetryControlsInitialized = true;
}

function formatAssessmentRate(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)}%` : "-";
}

function updateStructureShadowAssessmentUI(result = null, sourceLabel = "") {
    const section = document.getElementById("structureShadowAssessment");
    const status = result?.status || "NOT ASSESSED";
    section?.classList?.remove("assessment-not-assessed", "assessment-invalid-snapshot",
        "assessment-invalid-criteria", "assessment-insufficient-data",
        "assessment-review-required", "assessment-observation-criteria-met");
    section?.classList?.add(`assessment-${status.toLowerCase().replaceAll("_", "-")}`);
    const summary = result?.recomputedSummary || null;
    setText("structureShadowAssessmentStatus", status);
    setText("structureShadowAssessmentIntegrity", result
        ? (result.status === "INVALID_SNAPSHOT" ? result.error || "INVALID" : "VALID") : "-");
    setText("structureShadowAssessmentObservations", Number.isSafeInteger(summary?.observationCount)
        ? summary.observationCount : "-");
    setText("structureShadowAssessmentComparable", Number.isSafeInteger(summary?.comparableCount)
        ? summary.comparableCount : "-");
    setText("structureShadowAssessmentMarkets", Array.isArray(summary?.markets)
        ? `${summary.markets.length} (${summary.markets.join(", ") || "-"})` : "-");
    setText("structureShadowAssessmentIntervals", Array.isArray(summary?.intervals)
        ? `${summary.intervals.length} (${summary.intervals.join(", ") || "-"})` : "-");
    setText("structureShadowAssessmentMismatchRate", formatAssessmentRate(summary?.mismatchRate));
    setText("structureShadowAssessmentFailureRate", formatAssessmentRate(result?.failureRate));
    setText("structureShadowAssessmentFailedChecks", Array.isArray(result?.failedChecks) && result.failedChecks.length
        ? result.failedChecks.join(", ") : result ? "NONE" : "-");
    const disclaimer = result?.disclaimer ||
        "Diagnostic observation criteria only; this result does not authorize entries or trading.";
    setText("structureShadowAssessmentDisclaimer",
        sourceLabel ? `${sourceLabel} — ${disclaimer}` : disclaimer);
}

function showStructureShadowImportError(error) {
    updateStructureShadowAssessmentUI({
        status: "INVALID_SNAPSHOT", error, recomputedSummary: null,
        failureRate: null, failedChecks: [],
        disclaimer: "Diagnostic observation criteria only; this result does not authorize entries or trading."
    });
}

function setupStructureShadowAssessmentControls() {
    if (structureShadowAssessmentControlsInitialized) return;
    const assessButton = document.getElementById("assessCurrentStructureShadowObservations");
    const importButton = document.getElementById("validateStructureShadowDiagnosticJson");
    const fileInput = document.getElementById("structureShadowDiagnosticJsonFile");
    if (!assessButton || !importButton || !fileInput) return;
    assessButton.addEventListener("click", () => {
        try {
            const snapshot = window.HNDStructureShadowTelemetry?.exportSnapshot?.();
            const result = window.HNDStructureShadowAssessment?.assessSnapshot?.(snapshot);
            if (result) updateStructureShadowAssessmentUI(result);
            else showStructureShadowImportError("ASSESSMENT_UNAVAILABLE");
        } catch (error) { showStructureShadowImportError("ASSESSMENT_FAILED"); }
    });
    importButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (!file) { fileInput.value = ""; return; }
        if (file.size > HND_STRUCTURE_SHADOW_IMPORT_LIMIT) {
            showStructureShadowImportError("FILE_TOO_LARGE");
            fileInput.value = "";
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const snapshot = JSON.parse(String(reader.result));
                const result = window.HNDStructureShadowAssessment?.assessSnapshot?.(snapshot);
                if (result) updateStructureShadowAssessmentUI(result);
                else showStructureShadowImportError("ASSESSMENT_UNAVAILABLE");
            } catch (error) { showStructureShadowImportError("INVALID_JSON"); }
            finally { fileInput.value = ""; }
        };
        reader.onerror = () => {
            showStructureShadowImportError("FILE_READ_FAILED");
            fileInput.value = "";
        };
        reader.readAsText(file);
    });
    structureShadowAssessmentControlsInitialized = true;
}

function updateStructureShadowCollectionUI(summary = null) {
    const value = summary || {};
    setText("structureShadowCollectionSourceCount", Number.isSafeInteger(value.sourceCount) ? value.sourceCount : 0);
    setText("structureShadowCollectionAcceptedCount", Number.isSafeInteger(value.acceptedSourceCount) ? value.acceptedSourceCount : 0);
    setText("structureShadowCollectionRejectedCount", Number.isSafeInteger(value.rejectedSourceCount) ? value.rejectedSourceCount : 0);
    setText("structureShadowCollectionObservationCount", Number.isSafeInteger(value.observationCount) ? value.observationCount : 0);
    setText("structureShadowCollectionDuplicateCount", Number.isSafeInteger(value.duplicateCount) ? value.duplicateCount : 0);
    setText("structureShadowCollectionConflictCount", Number.isSafeInteger(value.conflictCount) ? value.conflictCount : 0);
    setText("structureShadowCollectionDroppedCount", Number.isSafeInteger(value.droppedCount) ? value.droppedCount : 0);
    setText("structureShadowCollectionMarkets", Array.isArray(value.markets) ? value.markets.length : 0);
    setText("structureShadowCollectionIntervals", Array.isArray(value.intervals) ? value.intervals.length : 0);
    setText("structureShadowCollectionCompatible", value.assessmentCompatible === true ? "YES — format only" : "NO");
    const section = document.getElementById("structureShadowCollection");
    section?.classList?.toggle("collection-conflict", (value.conflictCount || 0) > 0);
    section?.classList?.toggle("collection-rejected", (value.rejectedSourceCount || 0) > 0);
}

function readStructureShadowCollectionFile(file) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve({ valid: true, text: String(reader.result) });
        reader.onerror = () => resolve({ valid: false, error: "FILE_READ_FAILED" });
        reader.readAsText(file);
    });
}

function downloadStructureShadowCollection() {
    try {
        const snapshot = window.HNDStructureShadowCollection?.getSnapshot?.();
        if (!snapshot) return;
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `HNDai-structure-shadow-collection-${new Date().toISOString().slice(0, 10)}.json`;
        document.body?.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    } catch (error) { console.warn("Structure Shadow collection export could not be created."); }
}

function setupStructureShadowCollectionControls() {
    if (structureShadowCollectionControlsInitialized) return;
    const addButton = document.getElementById("addStructureShadowDiagnosticFiles");
    const assessButton = document.getElementById("assessStructureShadowCollection");
    const exportButton = document.getElementById("exportStructureShadowCollection");
    const resetButton = document.getElementById("resetStructureShadowCollection");
    const fileInput = document.getElementById("structureShadowCollectionFiles");
    if (!addButton || !assessButton || !exportButton || !resetButton || !fileInput) return;
    addButton.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
        const collection = window.HNDStructureShadowCollection;
        const files = Array.from(fileInput.files || []).sort((left, right) =>
            left.name.localeCompare(right.name));
        const importedAt = Date.now();
        try {
            if (files.length > HND_STRUCTURE_SHADOW_COLLECTION_FILE_LIMIT ||
                files.reduce((total, file) => total + file.size, 0) > HND_STRUCTURE_SHADOW_COLLECTION_TOTAL_LIMIT) {
                files.forEach((file, index) => collection?.addSnapshot?.(null,
                    { name: file.name, importedAt: importedAt + index }));
                return;
            }
            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                const source = { name: file.name, importedAt: importedAt + index };
                if (file.size > HND_STRUCTURE_SHADOW_IMPORT_LIMIT) {
                    collection?.addSnapshot?.(null, source);
                    continue;
                }
                const read = await readStructureShadowCollectionFile(file);
                if (!read.valid) { collection?.addSnapshot?.(null, source); continue; }
                try { collection?.addSnapshot?.(JSON.parse(read.text), source); }
                catch (error) { collection?.addSnapshot?.(null, source); }
            }
        } finally {
            updateStructureShadowCollectionUI(collection?.getSummary?.() || null);
            fileInput.value = "";
        }
    });
    assessButton.addEventListener("click", () => {
        try {
            const snapshot = window.HNDStructureShadowCollection?.getSnapshot?.();
            const result = window.HNDStructureShadowAssessment?.assessSnapshot?.(snapshot);
            if (result) updateStructureShadowAssessmentUI(result, "COLLECTION ASSESSMENT");
        } catch (error) { showStructureShadowImportError("COLLECTION_ASSESSMENT_FAILED"); }
    });
    exportButton.addEventListener("click", downloadStructureShadowCollection);
    resetButton.addEventListener("click", () => {
        window.HNDStructureShadowCollection?.reset?.("UI_RESET");
        updateStructureShadowCollectionUI(window.HNDStructureShadowCollection?.getSummary?.() || null);
    });
    updateStructureShadowCollectionUI(window.HNDStructureShadowCollection?.getSummary?.() || null);
    structureShadowCollectionControlsInitialized = true;
}

function formatObservationPlanStatus(status) {
    return String(status || "NOT_STARTED").replaceAll("_", " ");
}

function updateStructureObservationPlanUI(result = null) {
    const value = result || {};
    const status = value.status || "NOT_STARTED";
    setText("structureObservationPlanStatus", formatObservationPlanStatus(status));
    setText("structureObservationCompletedCells", `${value.completedCellCount || 0} / ${value.cellCount || 6}`);
    setText("structureObservationProgress", `${Number(value.observationProgress || 0).toFixed(2)}%`);
    setText("structureComparableProgress", `${Number(value.comparableProgress || 0).toFixed(2)}%`);
    setText("structureObservationRemaining", Number.isSafeInteger(value.observationRemaining) ? value.observationRemaining : 120);
    setText("structureComparableRemaining", Number.isSafeInteger(value.comparableRemaining) ? value.comparableRemaining : 60);
    setText("structureObservationOutOfPlan", Number.isSafeInteger(value.outOfPlanObservationCount) ? value.outOfPlanObservationCount : 0);
    const section = document.getElementById("structureObservationPlan");
    section?.classList?.remove("plan-not-started", "plan-in-progress", "plan-targets-met", "plan-invalid-snapshot", "plan-invalid-plan");
    section?.classList?.add(`plan-${status.toLowerCase().replaceAll("_", "-")}`);
    const body = document.getElementById("structureObservationPlanBody");
    if (body) {
        body.replaceChildren();
        (Array.isArray(value.cells) ? value.cells : []).forEach(cell => {
            const row = document.createElement("tr");
            row.classList.add(cell.status === "CELL_TARGET_MET" ? "cell-target-met"
                : (cell.mismatchCount || cell.failedCount) ? "cell-diagnostic-warning" : "cell-warning");
            [cell.symbol, cell.interval, `${cell.observationCount}/${cell.observationTarget}`,
                `${cell.comparableCount}/${cell.comparableTarget}`, cell.matchCount, cell.mismatchCount,
                cell.failedCount, formatObservationPlanStatus(cell.status)].forEach(content => {
                const column = document.createElement("td");
                column.textContent = String(content);
                row.appendChild(column);
            });
            body.appendChild(row);
        });
    }
    const targets = document.getElementById("structureObservationNextTargets");
    if (targets) {
        targets.replaceChildren();
        const items = Array.isArray(value.nextTargets) ? value.nextTargets : [];
        if (!items.length) {
            const item = document.createElement("li");
            item.textContent = status === "TARGETS_MET" ? "All observation targets met." : "No targets calculated.";
            targets.appendChild(item);
        } else items.forEach(target => {
            const item = document.createElement("li");
            item.textContent = `${target.symbol} ${target.interval} — ${target.observationRemaining} observations, ${target.comparableRemaining} comparable remaining`;
            targets.appendChild(item);
        });
    }
}

function downloadStructureObservationProgress() {
    if (!lastStructureObservationProgress) {
        setText("structureObservationPlanStatus", "NOT EVALUATED");
        return;
    }
    try {
        const blob = new Blob([JSON.stringify(lastStructureObservationProgress, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `HNDai-structure-observation-progress-${new Date().toISOString().slice(0, 10)}.json`;
        document.body?.appendChild(link);
        link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { console.warn("Structure observation progress export could not be created."); }
}

function updateStructureObservationPlanFromCollection() {
    try {
        const snapshot = window.HNDStructureShadowCollection?.getSnapshot?.();
        const result = window.HNDStructureShadowObservationPlan?.evaluateProgress?.(snapshot);
        if (!result) return;
        lastStructureObservationProgress = JSON.parse(JSON.stringify(result));
        updateStructureObservationPlanUI(result);
    } catch (error) { updateStructureObservationPlanUI({ status: "INVALID_SNAPSHOT" }); }
}

function setupStructureObservationPlanControls() {
    if (structureObservationPlanControlsInitialized) return;
    const updateButton = document.getElementById("updateStructureObservationPlan");
    const exportButton = document.getElementById("exportStructureObservationProgress");
    if (!updateButton || !exportButton) return;
    updateButton.addEventListener("click", updateStructureObservationPlanFromCollection);
    exportButton.addEventListener("click", downloadStructureObservationProgress);
    structureObservationPlanControlsInitialized = true;
}

function updateMismatchGroupList(id, groups) {
    const list = document.getElementById(id);
    if (!list) return;
    list.replaceChildren();
    const values = Array.isArray(groups) ? groups.slice(0, 5) : [];
    const rendered = values.length ? values : [{ key: "-", count: 0, percentage: null }];
    rendered.forEach(group => {
        const item = document.createElement("li");
        item.textContent = group.key === "-" ? "-" : `${group.key}: ${group.count} (${Number(group.percentage).toFixed(2)}%)`;
        list.appendChild(item);
    });
}

function updateStructureMismatchAnalyzerUI(result = null) {
    const value = result || {}, status = value.status || "NOT_ANALYZED";
    setText("structureMismatchAnalyzerStatus", String(status).replaceAll("_", " "));
    [["structureMismatchObservationCount","observationCount"],["structureMismatchComparableCount","comparableCount"],
        ["structureMismatchMatchCount","matchCount"],["structureMismatchCount","mismatchCount"],
        ["structureMismatchFailureCount","failureCount"],["structureMismatchNotComparableCount","notComparableCount"],
        ["structureMismatchNotApplicableCount","notApplicableCount"]].forEach(pair =>
        setText(pair[0], Number.isSafeInteger(value[pair[1]]) ? value[pair[1]] : 0));
    setText("structureMismatchMatchRate", Number.isFinite(value.matchRate) ? `${value.matchRate.toFixed(2)}%` : "-");
    setText("structureMismatchRate", Number.isFinite(value.mismatchRate) ? `${value.mismatchRate.toFixed(2)}%` : "-");
    const section = document.getElementById("structureMismatchDiagnostics");
    section?.classList?.remove("analyzer-not-analyzed", "analyzer-no-observations", "analyzer-no-comparable",
        "analyzer-match-only", "analyzer-review-items-found", "analyzer-failures-found", "analyzer-invalid-snapshot");
    section?.classList?.add(`analyzer-${status.toLowerCase().replaceAll("_", "-")}`);
    const body = document.getElementById("structureMismatchReviewBody");
    if (body) {
        body.replaceChildren();
        (Array.isArray(value.reviewItems) ? value.reviewItems.slice(0, 50) : []).forEach(review => {
            const row = document.createElement("tr");
            row.classList.add(`priority-${review.priority.toLowerCase()}`);
            [review.priority, review.symbol, review.interval, review.category, review.comparison,
                review.gateReason || "-", [review.error, review.failedStage].filter(Boolean).join(" / ") || "-",
                review.suggestedReview].forEach(content => {
                const column = document.createElement("td"); column.textContent = String(content); row.appendChild(column);
            });
            body.appendChild(row);
        });
    }
    updateMismatchGroupList("structureMismatchCategorySummary", value.byCategory);
    updateMismatchGroupList("structureMismatchGateReasonSummary", value.byGateReason);
    updateMismatchGroupList("structureMismatchErrorSummary", value.byError);
    updateMismatchGroupList("structureMismatchFailedStageSummary", value.byFailedStage);
}

function analyzeStructureShadowCollection() {
    try {
        const snapshot = window.HNDStructureShadowCollection?.getSnapshot?.();
        const result = window.HNDStructureShadowMismatchAnalyzer?.analyzeSnapshot?.(snapshot);
        if (!result) return;
        lastStructureMismatchAnalysis = JSON.parse(JSON.stringify(result));
        updateStructureMismatchAnalyzerUI(result);
    } catch (error) { updateStructureMismatchAnalyzerUI({ status: "INVALID_SNAPSHOT" }); }
}

function downloadStructureMismatchAnalysis() {
    if (!lastStructureMismatchAnalysis) { setText("structureMismatchAnalyzerStatus", "NOT ANALYZED"); return; }
    try {
        const blob = new Blob([JSON.stringify(lastStructureMismatchAnalysis, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = `HNDai-structure-mismatch-analysis-${new Date().toISOString().slice(0, 10)}.json`;
        document.body?.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { console.warn("Structure mismatch analysis export could not be created."); }
}

function setupStructureMismatchAnalyzerControls() {
    if (structureMismatchAnalyzerControlsInitialized) return;
    const analyzeButton = document.getElementById("analyzeStructureShadowCollection");
    const exportButton = document.getElementById("exportStructureMismatchAnalysis");
    if (!analyzeButton || !exportButton) return;
    analyzeButton.addEventListener("click", analyzeStructureShadowCollection);
    exportButton.addEventListener("click", downloadStructureMismatchAnalysis);
    structureMismatchAnalyzerControlsInitialized = true;
}

function updateStructurePaperTrialReadinessUI(result = null) {
    const value = result || {}, status = value.status || "NOT_EVALUATED";
    setText("structureReadinessStatus", String(status).replaceAll("_", " "));
    setText("structureReadinessEligible", value.eligibleForPaperTrial === true ? "YES — review only" : "NO — diagnostic only");
    setText("structureReadinessAssessment", value.assessmentStatus || "-");
    setText("structureReadinessObservationTargets", value.observationPlanStatus || "-");
    setText("structureReadinessCompletedCells", `${value.completedCellCount || 0} / ${value.cellCount || 6}`);
    setText("structureReadinessObservations", Number.isSafeInteger(value.observationCount) ? value.observationCount : 0);
    setText("structureReadinessComparable", Number.isSafeInteger(value.comparableCount) ? value.comparableCount : 0);
    setText("structureReadinessFailures", Number.isSafeInteger(value.failureCount) ? value.failureCount : 0);
    setText("structureReadinessHighPriority", Number.isSafeInteger(value.highPriorityReviewCount) ? value.highPriorityReviewCount : 0);
    setText("structureReadinessMismatchRate", Number.isFinite(value.mismatchRate) ? `${value.mismatchRate.toFixed(2)}%` : "-");
    setText("structureReadinessOperatorReview", value.operatorContext?.diagnosticsReviewed === true ? "ACKNOWLEDGED" : "NOT ACKNOWLEDGED");
    const section = document.getElementById("structurePaperTrialReadiness");
    [...(section?.classList || [])].filter(name => name.startsWith("readiness-"))
        .forEach(name => section.classList.remove(name));
    section?.classList?.add(`readiness-${status.toLowerCase().replaceAll("_", "-")}`);
}

function evaluateStructurePaperTrialReadiness() {
    try {
        const checked = document.getElementById("structureReadinessAcknowledgement")?.checked === true;
        const context = { diagnosticsReviewed: checked, acknowledgedAt: checked ? Date.now() : null };
        const snapshot = window.HNDStructureShadowCollection?.getSnapshot?.();
        const policy = window.HNDStructurePaperTrialReadinessGate?.getDefaultPolicy?.();
        const result = window.HNDStructurePaperTrialReadinessGate?.evaluateReadiness?.(snapshot, context, policy);
        if (!result) return;
        lastStructurePaperTrialReadiness = JSON.parse(JSON.stringify(result));
        updateStructurePaperTrialReadinessUI(result);
    } catch (error) { updateStructurePaperTrialReadinessUI({ status: "DEPENDENCY_FAILURE" }); }
}

function downloadStructurePaperTrialReadiness() {
    if (!lastStructurePaperTrialReadiness) { setText("structureReadinessStatus", "NOT EVALUATED"); return; }
    try {
        const blob = new Blob([JSON.stringify(lastStructurePaperTrialReadiness, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = `HNDai-paper-trial-readiness-${new Date().toISOString().slice(0, 10)}.json`;
        document.body?.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { console.warn("Paper trial readiness export could not be created."); }
}

function setupStructurePaperTrialReadinessControls() {
    if (structurePaperTrialReadinessControlsInitialized) return;
    const evaluateButton = document.getElementById("evaluateStructurePaperTrialReadiness");
    const exportButton = document.getElementById("exportStructurePaperTrialReadiness");
    const acknowledgement = document.getElementById("structureReadinessAcknowledgement");
    if (!evaluateButton || !exportButton || !acknowledgement) return;
    acknowledgement.checked = false;
    evaluateButton.addEventListener("click", evaluateStructurePaperTrialReadiness);
    exportButton.addEventListener("click", downloadStructurePaperTrialReadiness);
    structurePaperTrialReadinessControlsInitialized = true;
}

function updateStructureHistoricalShadowReplayUI(result = null) {
    const value = result || {};
    setText("historicalShadowReplayStatus", String(value.status || "NOT RUN").replaceAll("_", " "));
    setText("historicalShadowReplaySource", value.source || "HISTORICAL_REPLAY");
    setText("historicalShadowReplayMarket", value.symbol || "-");
    setText("historicalShadowReplayTimeframe", value.interval || "-");
    setText("historicalShadowReplayInputCandles", Number.isSafeInteger(value.inputCandleCount) ? value.inputCandleCount : 0);
    setText("historicalShadowReplayEvaluatedCandles", Number.isSafeInteger(value.evaluatedCandleCount) ? value.evaluatedCandleCount : 0);
    setText("historicalShadowReplayObservations", Number.isSafeInteger(value.observationCount) ? value.observationCount : 0);
    setText("historicalShadowReplayComparable", Number.isSafeInteger(value.comparableCount) ? value.comparableCount : 0);
    setText("historicalShadowReplayMatches", Number.isSafeInteger(value.matchCount) ? value.matchCount : 0);
    setText("historicalShadowReplayMismatches", Number.isSafeInteger(value.mismatchCount) ? value.mismatchCount : 0);
    setText("historicalShadowReplayFailures", Number.isSafeInteger(value.failureCount) ? value.failureCount : 0);
    setText("historicalShadowReplayPendingCreated", Number.isSafeInteger(value.pendingCandidateCreatedCount) ? value.pendingCandidateCreatedCount : 0);
    setText("historicalShadowReplayPendingResolved", Number.isSafeInteger(value.pendingCandidateResolvedCount) ? value.pendingCandidateResolvedCount : 0);
    setText("historicalShadowReplayPendingExpired", Number.isSafeInteger(value.pendingCandidateExpiredCount) ? value.pendingCandidateExpiredCount : 0);
    setText("historicalShadowReplayUnmatchedEvents", Number.isSafeInteger(value.unmatchedStructureEventCount) ? value.unmatchedStructureEventCount : 0);
    setText("historicalShadowReplayDuplicateCandidates", Number.isSafeInteger(value.duplicateCandidateCount) ? value.duplicateCandidateCount : 0);
    setText("historicalShadowReplayLegacyAvailable", Number.isSafeInteger(value.legacyDecisionAvailableCount) ? value.legacyDecisionAvailableCount : 0);
    setText("historicalShadowReplayLegacyAllow", Number.isSafeInteger(value.legacyAllowCount) ? value.legacyAllowCount : 0);
    setText("historicalShadowReplayLegacyBlock", Number.isSafeInteger(value.legacyBlockCount) ? value.legacyBlockCount : 0);
    setText("historicalShadowReplayLegacyUnavailable", Number.isSafeInteger(value.legacyUnavailableCount) ? value.legacyUnavailableCount : 0);
    setText("historicalShadowReplayBuilderReady", Number.isSafeInteger(value.builderReadyCount) ? value.builderReadyCount : 0);
    setText("historicalShadowReplayBuilderUnavailable", Number.isSafeInteger(value.builderUnavailableCount) ? value.builderUnavailableCount : 0);
    setText("historicalShadowReplayGateAvailable", Number.isSafeInteger(value.gateDecisionAvailableCount) ? value.gateDecisionAvailableCount : 0);
    const reasonList = document.getElementById("historicalShadowReplayTopLegacyReasons");
    if (reasonList) {
        const reasons = Array.isArray(value.byLegacyReason) ? value.byLegacyReason.slice(0, 5) : [];
        reasonList.replaceChildren(...(reasons.length ? reasons : [{ key: "-", count: null }]).map(item => {
            const row = document.createElement("li");
            row.textContent = item.count === null ? "-" : `${item.key}: ${item.count}`;
            return row;
        }));
    }
    const builderList = document.getElementById("historicalShadowReplayTopBuilderStatus");
    if (builderList) {
        builderList.textContent = "";
        const statuses = Array.isArray(value.byBuilderStatus) ? value.byBuilderStatus.slice(0, 5) : [];
        (statuses.length ? statuses : [{ key: "-", count: 0 }]).forEach(item => {
            const row = document.createElement("li");
            row.textContent = item.key === "-" ? "-" : `${item.key}: ${item.count}`;
            builderList.appendChild(row);
        });
    }
    setText("historicalShadowReplayMatchRate", Number.isFinite(value.matchRate) ? `${value.matchRate.toFixed(2)}%` : "-");
    setText("historicalShadowReplayMismatchRate", Number.isFinite(value.mismatchRate) ? `${value.mismatchRate.toFixed(2)}%` : "-");
    setText("historicalShadowReplayReadiness", "NONE");
}

async function runStructureHistoricalShadowReplay() {
    const runButton = document.getElementById("runHistoricalShadowReplay");
    try {
        if (runButton) runButton.disabled = true;
        setText("historicalShadowReplayStatus", "LOADING");
        const symbol = document.getElementById("historicalShadowReplaySymbol")?.value || "BTCUSDT";
        const interval = document.getElementById("historicalShadowReplayInterval")?.value || "15m";
        const server = await fetchBinanceServerTime({ silent: true });
        const paged = await window.HNDStructureHistoricalReplayBinancePager?.fetchClosedCandles?.({
            symbol, interval, candleCount: 3000, evaluationCutoffTime: server.serverTime,
            pageSize: 1000, requestDelayMs: 200
        });
        if (!paged?.valid) throw new Error("REPLAY_PAGINATION_FAILED");
        const closed = paged.candles;
        const config = window.HNDStructureHistoricalShadowReplay?.getDefaultConfig?.();
        if (!config) throw new Error("REPLAY_DEPENDENCY_UNAVAILABLE");
        config.symbol = symbol; config.interval = interval;
        config.evaluationCutoffTime = server.serverTime;
        config.maximumEvaluationCandles = Math.min(10000, Math.max(1, closed.length - config.warmupCandles));
        const result = window.HNDStructureHistoricalShadowReplay.runReplay(closed, config);
        result.warnings.push(`BINANCE_PAGES:${paged.pageCount}`);
        result.warnings.push(`DUPLICATES_REMOVED:${paged.duplicateCount}`);
        result.warnings.push(`RATE_LIMIT_RETRIES:${paged.rateLimitRetryCount}`);
        lastStructureHistoricalShadowReplay = JSON.parse(JSON.stringify(result));
        updateStructureHistoricalShadowReplayUI(result);
    } catch (error) {
        lastStructureHistoricalShadowReplay = null;
        updateStructureHistoricalShadowReplayUI({ status: "DEPENDENCY_FAILURE", source: "HISTORICAL_REPLAY",
            symbol: document.getElementById("historicalShadowReplaySymbol")?.value || null,
            interval: document.getElementById("historicalShadowReplayInterval")?.value || null });
    } finally { if (runButton) runButton.disabled = false; }
}

function downloadStructureHistoricalShadowReplay() {
    if (!lastStructureHistoricalShadowReplay) { setText("historicalShadowReplayStatus", "NOT RUN"); return; }
    try {
        const json = window.HNDStructureHistoricalShadowReplay?.exportReplay?.(lastStructureHistoricalShadowReplay);
        if (typeof json !== "string") throw new Error("INVALID_REPLAY_EXPORT");
        const blob = new Blob([json], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = `HNDai-historical-shadow-replay-${new Date().toISOString().slice(0, 10)}.json`;
        document.body?.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { console.warn("Historical shadow replay export could not be created."); }
}

function setupStructureHistoricalShadowReplayControls() {
    if (structureHistoricalShadowReplayControlsInitialized) return;
    const runButton = document.getElementById("runHistoricalShadowReplay");
    const exportButton = document.getElementById("exportHistoricalShadowReplay");
    if (!runButton || !exportButton) return;
    runButton.addEventListener("click", runStructureHistoricalShadowReplay);
    exportButton.addEventListener("click", downloadStructureHistoricalShadowReplay);
    structureHistoricalShadowReplayControlsInitialized = true;
}

function updateStructureHistoricalMismatchUI(result = null, warning = "") {
    const value = result || {};
    const status = value.status || "NOT_ANALYZED";
    setText("historicalMismatchAnalyzerStatus", String(status).replaceAll("_", " "));
    [["historicalMismatchObservations", "observationCount"], ["historicalMismatchComparable", "comparableCount"],
        ["historicalMismatchMatches", "matchCount"], ["historicalMismatchMismatches", "mismatchCount"],
        ["historicalMismatchFailures", "failureCount"], ["historicalMismatchNotComparable", "notComparableCount"]]
        .forEach(pair => setText(pair[0], Number.isSafeInteger(value[pair[1]]) ? value[pair[1]] : 0));
    setText("historicalMismatchMatchRate", Number.isFinite(value.matchRate) ? `${value.matchRate.toFixed(2)}%` : "-");
    setText("historicalMismatchMismatchRate", Number.isFinite(value.mismatchRate) ? `${value.mismatchRate.toFixed(2)}%` : "-");
    setText("historicalMismatchWarning", warning);
    const section = document.getElementById("historicalMismatchReview");
    section?.classList?.remove("analyzer-not-analyzed", "analyzer-invalid-replay", "analyzer-no-observations",
        "analyzer-no-comparable", "analyzer-match-only", "analyzer-review-items-found", "analyzer-failures-found");
    section?.classList?.add(`analyzer-${status.toLowerCase().replaceAll("_", "-")}`);
    const body = document.getElementById("historicalMismatchReviewBody");
    if (!body) return;
    body.replaceChildren();
    const items = Array.isArray(value.reviewItems) ? value.reviewItems.slice(0, 100) : [];
    if (!items.length) {
        const row = document.createElement("tr"), column = document.createElement("td");
        column.colSpan = 10; column.textContent = "No historical review items"; row.appendChild(column); body.appendChild(row);
        return;
    }
    items.forEach(item => {
        const row = document.createElement("tr");
        row.classList.add(`priority-${String(item.priority || "INFO").toLowerCase()}`);
        [item.priority, item.symbol, item.interval, item.category, item.legacyDecision || "-", item.gateDecision || "-",
            item.legacyReason || "-", item.gateReason || "-", item.builderStatus || "-", item.suggestedReview || "-"]
            .forEach(content => { const column = document.createElement("td"); column.textContent = String(content); row.appendChild(column); });
        body.appendChild(row);
    });
}

function analyzeStructureHistoricalReplay() {
    if (!lastStructureHistoricalShadowReplay) {
        lastStructureHistoricalMismatchAnalysis = null;
        updateStructureHistoricalMismatchUI(null, "Run Historical Replay before analysis.");
        return;
    }
    try {
        const replayBefore = JSON.stringify(lastStructureHistoricalShadowReplay);
        const result = window.HNDStructureHistoricalMismatchAnalyzer?.analyzeReplay?.(lastStructureHistoricalShadowReplay);
        if (!result || JSON.stringify(lastStructureHistoricalShadowReplay) !== replayBefore) throw new Error("ANALYZER_MUTATED_REPLAY");
        lastStructureHistoricalMismatchAnalysis = JSON.parse(JSON.stringify(result));
        updateStructureHistoricalMismatchUI(result);
    } catch (error) {
        lastStructureHistoricalMismatchAnalysis = null;
        updateStructureHistoricalMismatchUI({ status: "INVALID_REPLAY" }, "Historical analysis could not be completed.");
    }
}

function downloadStructureHistoricalMismatchAnalysis() {
    if (!lastStructureHistoricalMismatchAnalysis) {
        setText("historicalMismatchWarning", "Analyze Historical Replay before export.");
        return;
    }
    try {
        const json = window.HNDStructureHistoricalMismatchAnalyzer?.exportAnalysis?.(lastStructureHistoricalMismatchAnalysis);
        if (typeof json !== "string") throw new Error("INVALID_ANALYSIS_EXPORT");
        const blob = new Blob([json], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = `HNDai-historical-mismatch-analysis-${new Date().toISOString().slice(0, 10)}.json`;
        document.body?.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (error) { setText("historicalMismatchWarning", "Historical analysis export could not be created."); }
}

function setupStructureHistoricalMismatchControls() {
    const analyzeButton = document.getElementById("analyzeHistoricalMismatch");
    const exportButton = document.getElementById("exportHistoricalMismatchAnalysis");
    if (analyzeButton && analyzeButton !== structureHistoricalMismatchAnalyzeButton) {
        analyzeButton.addEventListener("click", analyzeStructureHistoricalReplay);
        structureHistoricalMismatchAnalyzeButton = analyzeButton;
    }
    if (exportButton && exportButton !== structureHistoricalMismatchExportButton) {
        exportButton.addEventListener("click", downloadStructureHistoricalMismatchAnalysis);
        structureHistoricalMismatchExportButton = exportButton;
    }
}

if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", setupStructureHistoricalMismatchControls, { once: true });
else setupStructureHistoricalMismatchControls();

function updateActiveTradeUI(price, tradeState = null) {
    const trade = tradeState?.activeTrade || activeTrade || null;
    const pending = tradeState?.pendingExecution || null;
    const last = tradeState?.lastClosedTrade || null;
    const rawStatus = trade ? "OPEN" : pending ? "WAITING_ENTRY" : (tradeState?.status || "NO_TRADE");
    const statusElement = document.getElementById("tradeStatus");
    setText("tradeStatus", formatTradeStatus(rawStatus));
    clearTradeStatusClasses(statusElement);
    statusElement?.classList.add(`trade-status-${rawStatus.toLowerCase().replaceAll("_", "-")}`);
    setText("tradeDirection", trade?.direction || pending?.direction || "-");
    setText("tradeEntry", formatMarketPrice(trade?.entryPrice ?? pending?.entryPrice));
    setText("tradeCurrentPrice", trade || pending ? formatMarketPrice(price) : "-");
    setText("tradeUnrealizedR", trade ? formatRMultiple(trade.unrealizedR) : "-");
    setText("tradeMfe", trade ? formatRMultiple(trade.maxFavorableR) : "-");
    setText("tradeMae", trade ? formatRMultiple(-Math.abs(trade.maxAdverseR || 0)) : "-");
    let lastResult = "-";
    if (last?.state === "CLOSED_TP") lastResult = `TAKE PROFIT ${formatRMultiple(last.realizedR)}`;
    else if (last?.state === "CLOSED_SL") lastResult = `STOP LOSS ${formatRMultiple(last.realizedR)}`;
    else if (String(last?.state || "").startsWith("CANCELLED")) lastResult = "CANCELLED";
    setText("lastTradeResult", lastResult);
    setText("lastExitReason", last?.exitReason ? String(last.exitReason).replaceAll("_", " ") : "-");
}

function formatJournalDate(value) {
    if (!Number.isFinite(value) || value <= 0) return "-";
    try { return new Date(value).toLocaleString(); }
    catch (error) { return "-"; }
}

function formatJournalOutcome(trade) {
    if (["WIN", "LOSS", "BREAKEVEN", "CANCELLED"].includes(trade?.journalOutcome)) {
        return trade.journalOutcome;
    }
    return String(trade?.state || "").startsWith("CANCELLED") ? "CANCELLED" : "-";
}

function formatJournalProfitFactor(metrics) {
    if (metrics?.profitFactorInfinite === true) return "∞";
    return Number.isFinite(metrics?.profitFactor) ? metrics.profitFactor.toFixed(2) : "-";
}

function updateJournalPerformanceUI(journalState) {
    const metrics = journalState?.metrics || {};
    const status = journalState?.initialized !== true ? "UNAVAILABLE"
        : journalState?.persistenceActive === true ? "LOCAL STORAGE"
            : journalState?.storageAvailable === false ? "MEMORY ONLY" : "MEMORY ONLY";
    setText("journalStatus", status);
    setText("completedTrades", Number.isFinite(metrics.completedTrades) ? metrics.completedTrades : 0);
    setText("winsLosses", `${Number.isFinite(metrics.wins) ? metrics.wins : 0} / ${Number.isFinite(metrics.losses) ? metrics.losses : 0}`);
    setText("winRate", Number.isFinite(metrics.winRate) ? `${metrics.winRate.toFixed(2)}%` : "-");
    setText("netR", formatRMultiple(Number.isFinite(metrics.netR) ? metrics.netR : 0));
    setText("expectancyR", formatRMultiple(metrics.expectancyR));
    setText("profitFactor", formatJournalProfitFactor(metrics));
    setText("maxDrawdownR", `${Math.max(0, Number.isFinite(metrics.maxDrawdownR)
        ? metrics.maxDrawdownR : 0).toFixed(2)}R`);
    const streakType = metrics.currentStreakType;
    const streakLength = Number.isFinite(metrics.currentStreakLength)
        ? metrics.currentStreakLength : 0;
    setText("currentStreak", streakType === "WIN" && streakLength > 0
        ? `${streakLength} ${streakLength === 1 ? "WIN" : "WINS"}`
        : streakType === "LOSS" && streakLength > 0
            ? `${streakLength} ${streakLength === 1 ? "LOSS" : "LOSSES"}` : "-");
    setText("cancelledTrades", Number.isFinite(metrics.cancelledTrades) ? metrics.cancelledTrades : 0);
}

function formatJournalExitReason(reason) {
    const value = String(reason || "");
    if (value === "TAKE_PROFIT") return "TAKE PROFIT";
    if (value === "STOP_LOSS") return "STOP LOSS";
    if (value === "BOTH_HIT_STOP_FIRST") return "BOTH HIT STOP FIRST";
    if (["SYMBOL_CHANGED", "TIMEFRAME_CHANGED", "MARKET_CHANGE"].includes(value)) return "MARKET CHANGE";
    if (["MANUAL_RESET", "MANUAL"].includes(value)) return "MANUAL";
    return value ? value.replaceAll("_", " ") : "-";
}

function updateTradeJournalTable(journalState) {
    const body = document.getElementById("tradeJournalBody");
    if (!body) return;
    body.replaceChildren();
    const trades = Array.isArray(journalState?.recentTrades)
        ? journalState.recentTrades.slice(0, 20) : [];
    if (!trades.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 9;
        cell.textContent = "No closed paper trades";
        row.appendChild(cell);
        body.appendChild(row);
        return;
    }
    trades.forEach(trade => {
        const outcome = formatJournalOutcome(trade);
        const row = document.createElement("tr");
        row.className = `trade-journal-row-${outcome.toLowerCase()}`;
        [
            formatJournalDate(trade.closedAt), trade.symbol || "-", trade.interval || "-",
            trade.direction || "-", outcome, formatRMultiple(trade.realizedR),
            formatMarketPrice(trade.entryPrice), formatMarketPrice(trade.exitPrice),
            formatJournalExitReason(trade.exitReason)
        ].forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = String(value);
            row.appendChild(cell);
        });
        body.appendChild(row);
    });
}

function downloadTradeJournal(content, type, extension) {
    try {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `HNDai-paper-trade-journal-${new Date().toISOString().slice(0, 10)}.${extension}`;
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
        console.warn("Trade Journal export could not be created.");
    }
}

function setupTradeJournalExportControls() {
    if (tradeJournalExportControlsInitialized) return;
    const csvButton = document.getElementById("exportJournalCsv");
    const jsonButton = document.getElementById("exportJournalJson");
    if (!csvButton || !jsonButton) return;
    csvButton.addEventListener("click", () => downloadTradeJournal(
        window.HNDTradeJournal?.toCSV?.() || "", "text/csv;charset=utf-8", "csv"
    ));
    jsonButton.addEventListener("click", () => downloadTradeJournal(
        window.HNDTradeJournal?.toJSON?.() || "{}", "application/json;charset=utf-8", "json"
    ));
    tradeJournalExportControlsInitialized = true;
}

function updateUI(
    result, price, setupState = null, tradePlanState = null,
    tradeState = null, journalState = null, structureShadow = null,
    structureShadowTelemetry = null
) {
    const signal = document.getElementById("signal");

    const signalValue = result?.signal ?? "WAIT";
    setText("signal", signalValue);

    if (signal) {
        signal.style.color = signalValue === "LONG"
            ? "#22c55e"
            : signalValue === "SHORT"
                ? "#ef4444"
                : "#facc15";
    }

    setText("confidence", Number.isFinite(result?.confidence) ? `${result.confidence}%` : "0%");
    setText("signalReason", result?.signalReason ?? "-");
    setText("marketBias", result?.marketBias ?? "-");
    setText("marketStrength", Number.isFinite(result?.marketStrength) ? `${result.marketStrength}%` : "0%");
    setText("conflictScore", Number.isFinite(result?.conflictScore) ? `${result.conflictScore}%` : "0%");
    setText("scoreDifference", Number.isFinite(result?.scoreDifference) ? result.scoreDifference : "-");

    setEvidence("bullishEvidence", result?.evidence?.bullish, "No bullish evidence");
    setEvidence("bearishEvidence", result?.evidence?.bearish, "No bearish evidence");

    updateSetupUI(setupState, tradePlanState, tradeState);
    updateTradePlanUI(setupState, tradePlanState, tradeState);
    updateActiveTradeUI(price, tradeState);
    updateJournalPerformanceUI(journalState);
    updateTradeJournalTable(journalState);
    updateStructureShadowUI(structureShadow);
    updateStructureShadowTelemetryUI(structureShadowTelemetry);
    setupStructureShadowTelemetryControls();
    setupStructureShadowAssessmentControls();
    setupStructureShadowCollectionControls();
    setupStructureObservationPlanControls();
    setupStructureMismatchAnalyzerControls();
    setupStructurePaperTrialReadinessControls();
    setupStructureHistoricalShadowReplayControls();
    setupStructureHistoricalMismatchControls();
    setupTradeJournalExportControls();

    setText("trend", result?.trend ?? "-");
    setText("bullScore", result?.bullScore ?? "-");
    setText("bearScore", result?.bearScore ?? "-");
    setText("ema20", formatNumber(result?.ema20));
    setText("ema50", formatNumber(result?.ema50));
    setText("ema200", formatNumber(result?.ema200));
    setText("rsi", formatNumber(result?.rsi));
    setText("macd", "Coming Soon");

    const structure = result?.breakdown?.structure;
    const smc = result?.breakdown?.smc;

    setText("bos", structure?.bos || "NO BOS");
    setText("choch", structure?.choch || "NO CHOCH");

    const ob = smc?.orderBlock;
    setText(
        "ob",
        ob
            ? `${ob.type} (${formatNumber(ob.low)} - ${formatNumber(ob.high)})`
            : "NO OB"
    );

    const fvg = smc?.fvg;
    setText(
        "fvg",
        fvg
            ? `${fvg.type} (${formatNumber(fvg.bottom)} - ${formatNumber(fvg.top)})`
            : "NO FVG"
    );

    setText("liq", smc?.liquidity || "-");
}

setupTradeJournalExportControls();
setupStructureShadowTelemetryControls();
setupStructureShadowAssessmentControls();
setupStructureShadowCollectionControls();
setupStructureObservationPlanControls();
setupStructureMismatchAnalyzerControls();
setupStructurePaperTrialReadinessControls();
setupStructureHistoricalShadowReplayControls();
setupStructureHistoricalMismatchControls();
