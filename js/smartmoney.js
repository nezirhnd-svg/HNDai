// ==========================
// HNDai Smart Money Engine v5
// ==========================

console.log("HNDai SmartMoney v5 Loaded");

// ==========================
// Swing Detection
// ==========================

function getSwings(lookback = 3) {

    const highs = [];
    const lows = [];

    if (!candles || candles.length < lookback * 2 + 1) {
        return { highs, lows };
    }

    for (let i = lookback; i < candles.length - lookback; i++) {

        let swingHigh = true;
        let swingLow = true;

        for (let j = 1; j <= lookback; j++) {

            if (
                candles[i].high <= candles[i - j].high ||
                candles[i].high <= candles[i + j].high
            ) {
                swingHigh = false;
            }

            if (
                candles[i].low >= candles[i - j].low ||
                candles[i].low >= candles[i + j].low
            ) {
                swingLow = false;
            }

        }

        if (swingHigh) {

            highs.push({

                index: i,

                price: candles[i].high

            });

        }

        if (swingLow) {

            lows.push({

                index: i,

                price: candles[i].low

            });

        }

    }

    return { highs, lows };

}

// ==========================
// Last Swings
// ==========================

function getLastSwings() {

    const { highs, lows } = getSwings();

    return {

        highs,

        lows,

        lastHigh: highs.length
            ? highs[highs.length - 1]
            : null,

        prevHigh: highs.length > 1
            ? highs[highs.length - 2]
            : null,

        lastLow: lows.length
            ? lows[lows.length - 1]
            : null,

        prevLow: lows.length > 1
            ? lows[lows.length - 2]
            : null

    };

}

// ==========================
// Market Structure
// ==========================

function detectMarketStructure() {

    const swings = getLastSwings();

    if (

        !swings.lastHigh ||

        !swings.prevHigh ||

        !swings.lastLow ||

        !swings.prevLow

    ) {

        return {

            trend: "UNKNOWN",

            HH: false,

            HL: false,

            LH: false,

            LL: false,

            ...swings

        };

    }

    const HH =

        swings.lastHigh.price >
        swings.prevHigh.price;

    const HL =

        swings.lastLow.price >
        swings.prevLow.price;

    const LH =

        swings.lastHigh.price <
        swings.prevHigh.price;

    const LL =

        swings.lastLow.price <
        swings.prevLow.price;

    let trend = "RANGE";

    if (HH && HL)
        trend = "BULLISH";

    if (LH && LL)
        trend = "BEARISH";

    return {

        trend,

        HH,

        HL,

        LH,

        LL,

        ...swings

    };

}

// ==========================
// Trend
// ==========================

function detectTrend() {

    const structure =
        detectMarketStructure();

    return {

        trend: structure.trend,

        bullish:
            structure.trend === "BULLISH",

        bearish:
            structure.trend === "BEARISH",

        ranging:
            structure.trend === "RANGE"

    };

}

// ==========================
// BOS
// ==========================

function detectBOS() {

    const structure =
        detectMarketStructure();

    if (

        !structure.lastHigh ||

        !structure.lastLow ||

        !candles ||

       candles.length < 2

    ) {

        return "NO DATA";

    }

const lastClose = candles[candles.length - 1].close;
const prevClose = candles[candles.length - 2].close;

if (
    lastClose > structure.lastHigh.price &&
    prevClose > structure.lastHigh.price
) {
    return "BULLISH BOS";
}

if (
    lastClose < structure.lastLow.price &&
    prevClose < structure.lastLow.price
) {
    return "BEARISH BOS";
}

return "NO BOS";

}
    
// ==========================
// CHOCH
// ==========================

function detectCHoCH() {

    const structure =
        detectMarketStructure();

    const bos =
        detectBOS();

    if (

        structure.trend === "BEARISH" &&

        bos === "BULLISH BOS"

    ) {

        return "BULLISH CHOCH";

    }

    if (

        structure.trend === "BULLISH" &&

        bos === "BEARISH BOS"

    ) {

        return "BEARISH CHOCH";

    }

    return "NO CHOCH";

}

// ==========================
// Order Block
// ==========================

function detectOrderBlock() {

    if (!candles || candles.length < 5) {
        return null;
    }

    for (let i = candles.length - 2; i >= 1; i--) {

        const candle = candles[i];
        const next = candles[i + 1];

        // Bullish Order Block
        if (
            candle.close < candle.open &&
            next.close > candle.high
        ) {

            return {

                type: "BULLISH",

                high: candle.high,

                low: candle.low,

                index: i

            };

        }

        // Bearish Order Block
        if (
            candle.close > candle.open &&
            next.close < candle.low
        ) {

            return {

                type: "BEARISH",

                high: candle.high,

                low: candle.low,

                index: i

            };

        }

    }

    return null;

}

// ==========================
// Fair Value Gap
// ==========================

function detectFVG() {

    if (!candles || candles.length < 3) {
        return null;
    }

    for (let i = candles.length - 2; i >= 1; i--) {

        const c1 = candles[i - 1];
        const c2 = candles[i];
        const c3 = candles[i + 1];

        // Bullish FVG
        if (c1.high < c3.low) {

            return {

                type: "BULLISH",

                top: c3.low,

                bottom: c1.high,

                index: i

            };

        }

        // Bearish FVG
        if (c1.low > c3.high) {

            return {

                type: "BEARISH",

                top: c1.low,

                bottom: c3.high,

                index: i

            };

        }

    }

    return null;

}

// ==========================
// Liquidity
// ==========================

function detectLiquidity() {

    const swings = getLastSwings();

    if (
        !swings.lastHigh ||
        !swings.lastLow
    ) {

        return "NO DATA";

    }

    const price =
        candles[candles.length - 1].close;

    if (price > swings.lastHigh.price)
        return "BUY SIDE";

    if (price < swings.lastLow.price)
        return "SELL SIDE";

    return "INSIDE RANGE";

}

// ==========================
// Equal High / Equal Low
// ==========================

function detectEqualLevels(tolerance = 0.0015) {

    const swings = getLastSwings();

    if (
        !swings.prevHigh ||
        !swings.lastHigh ||
        !swings.prevLow ||
        !swings.lastLow
    ) {

        return "NONE";

    }

    if (

        Math.abs(
            swings.lastHigh.price -
            swings.prevHigh.price
        ) /
        swings.prevHigh.price
        < tolerance

    ) {

        return "EQUAL HIGH";

    }

    if (

        Math.abs(
            swings.lastLow.price -
            swings.prevLow.price
        ) /
        swings.prevLow.price
        < tolerance

    ) {

        return "EQUAL LOW";

    }

    return "NONE";

}

// ==========================
// Liquidity Sweep v2
// ==========================

function detectLiquiditySweep() {

    const swings = getSwings();

    if (
        !candles ||
        candles.length < 10 ||
        swings.highs.length === 0 ||
        swings.lows.length === 0
    ) {
        return null;
    }

    const candle = candles[candles.length - 1];

    // BUY SIDE
    for (const high of swings.highs) {

        if (
            candle.high > high.price &&
            candle.close < high.price
        ) {

            return {

                type: "BUY SIDE",

                level: high.price,

                index: high.index

            };

        }

    }

    // SELL SIDE
    for (const low of swings.lows) {

        if (

            candle.low < low.price &&

            candle.close > low.price

        ) {

            return {

                type: "SELL SIDE",

                level: low.price,

                index: low.index

            };

        }

    }

    return null;

}

// ==========================
// Smart Money Zones v2
// ==========================

function getSmartMoneyCandleData() {
    return typeof candles !== "undefined" && Array.isArray(candles)
        ? candles
        : [];
}

function isValidSmartMoneyCandle(candle) {
    return Boolean(candle) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        Number.isFinite(candle.time);
}

function getLastValidSmartMoneyTime(data) {
    for (let i = data.length - 1; i >= 0; i--) {
        if (isValidSmartMoneyCandle(data[i])) {
            return data[i].time;
        }
    }

    return null;
}

function getSmartMoneyZoneOptions(options = {}) {
    const requestedLimit = Number.isFinite(options.limit)
        ? Math.floor(options.limit)
        : 50;

    return {
        limit: Math.max(0, requestedLimit),
        includeInvalidated: options.includeInvalidated !== false
    };
}

function applySmartMoneyZoneOptions(zones, options) {
    const filtered = options.includeInvalidated
        ? zones
        : zones.filter(zone => zone.status !== "INVALIDATED");

    return options.limit === 0
        ? []
        : filtered.slice(-options.limit);
}

function detectOrderBlocks(options = {}) {
    const data = getSmartMoneyCandleData();
    const normalizedOptions = getSmartMoneyZoneOptions(options);
    const zones = [];
    const zoneIds = new Set();

    if (data.length < 2) {
        return zones;
    }

    for (let i = 0; i < data.length - 1; i++) {
        const candle = data[i];
        const next = data[i + 1];

        if (
            !isValidSmartMoneyCandle(candle) ||
            !isValidSmartMoneyCandle(next)
        ) {
            continue;
        }

        let type = null;

        if (
            candle.close < candle.open &&
            next.close > candle.high
        ) {
            type = "BULLISH";
        }
        else if (
            candle.close > candle.open &&
            next.close < candle.low
        ) {
            type = "BEARISH";
        }

        if (!type) {
            continue;
        }

        const id = `OB-${type}-${candle.time}-${i}`;

        if (zoneIds.has(id)) {
            continue;
        }

        zoneIds.add(id);

        const zone = {
            id,
            kind: "ORDER_BLOCK",
            type,
            index: i,
            confirmationIndex: i + 1,
            startTime: candle.time,
            confirmationTime: next.time,
            high: candle.high,
            low: candle.low,
            midpoint: candle.high / 2 + candle.low / 2,
            status: "ACTIVE",
            touches: 0,
            firstTouchIndex: null,
            firstTouchTime: null,
            mitigationIndex: null,
            mitigationTime: null,
            invalidationIndex: null,
            invalidationTime: null,
            lastInteractionIndex: null,
            endTime: getLastValidSmartMoneyTime(data)
        };

        for (let j = zone.confirmationIndex + 1; j < data.length; j++) {
            const interaction = data[j];

            if (!isValidSmartMoneyCandle(interaction)) {
                continue;
            }

            const intersects = interaction.high >= zone.low &&
                interaction.low <= zone.high;

            if (intersects) {
                zone.touches++;
                if (zone.firstTouchIndex === null) {
                    zone.firstTouchIndex = j;
                    zone.firstTouchTime = interaction.time;
                }
                zone.lastInteractionIndex = j;
            }

            const invalidated = type === "BULLISH"
                ? interaction.close < zone.low
                : interaction.close > zone.high;

            if (invalidated) {
                zone.invalidationIndex = j;
                zone.invalidationTime = interaction.time;
                zone.status = "INVALIDATED";
                zone.endTime = interaction.time;
                break;
            }

            const mitigated = type === "BULLISH"
                ? interaction.low <= zone.midpoint
                : interaction.high >= zone.midpoint;
            const touched = type === "BULLISH"
                ? interaction.low <= zone.high
                : interaction.high >= zone.low;

            if (mitigated) {
                if (zone.mitigationIndex === null) {
                    zone.mitigationIndex = j;
                    zone.mitigationTime = interaction.time;
                }
                zone.status = "MITIGATED";
            }
            else if (touched && zone.status === "ACTIVE") {
                zone.status = "TOUCHED";
            }
        }

        zones.push(zone);
    }

    return applySmartMoneyZoneOptions(zones, normalizedOptions);
}

function detectFVGs(options = {}) {
    const data = getSmartMoneyCandleData();
    const normalizedOptions = getSmartMoneyZoneOptions(options);
    const zones = [];
    const zoneIds = new Set();

    if (data.length < 3) {
        return zones;
    }

    for (let i = 1; i < data.length - 1; i++) {
        const c1 = data[i - 1];
        const c2 = data[i];
        const c3 = data[i + 1];

        if (
            !isValidSmartMoneyCandle(c1) ||
            !isValidSmartMoneyCandle(c2) ||
            !isValidSmartMoneyCandle(c3)
        ) {
            continue;
        }

        let type = null;
        let top = null;
        let bottom = null;

        if (c1.high < c3.low) {
            type = "BULLISH";
            top = c3.low;
            bottom = c1.high;
        }
        else if (c1.low > c3.high) {
            type = "BEARISH";
            top = c1.low;
            bottom = c3.high;
        }

        if (!type) {
            continue;
        }

        const id = `FVG-${type}-${c1.time}-${i}`;

        if (zoneIds.has(id)) {
            continue;
        }

        zoneIds.add(id);

        const zone = {
            id,
            kind: "FVG",
            type,
            index: i,
            confirmationIndex: i + 1,
            startTime: c1.time,
            confirmationTime: c3.time,
            top,
            bottom,
            midpoint: top / 2 + bottom / 2,
            status: "ACTIVE",
            touches: 0,
            firstTouchIndex: null,
            firstTouchTime: null,
            mitigationIndex: null,
            mitigationTime: null,
            invalidationIndex: null,
            invalidationTime: null,
            lastInteractionIndex: null,
            endTime: getLastValidSmartMoneyTime(data)
        };

        for (let j = zone.confirmationIndex + 1; j < data.length; j++) {
            const interaction = data[j];

            if (!isValidSmartMoneyCandle(interaction)) {
                continue;
            }

            const intersects = interaction.high >= zone.bottom &&
                interaction.low <= zone.top;

            if (intersects) {
                zone.touches++;
                if (zone.firstTouchIndex === null) {
                    zone.firstTouchIndex = j;
                    zone.firstTouchTime = interaction.time;
                }
                zone.lastInteractionIndex = j;
            }

            const invalidated = type === "BULLISH"
                ? interaction.close < zone.bottom
                : interaction.close > zone.top;

            if (invalidated) {
                zone.invalidationIndex = j;
                zone.invalidationTime = interaction.time;
                zone.status = "INVALIDATED";
                zone.endTime = interaction.time;
                break;
            }

            const mitigated = type === "BULLISH"
                ? interaction.low <= zone.bottom
                : interaction.high >= zone.top;
            const touched = type === "BULLISH"
                ? interaction.low <= zone.top
                : interaction.high >= zone.bottom;

            if (mitigated) {
                if (zone.mitigationIndex === null) {
                    zone.mitigationIndex = j;
                    zone.mitigationTime = interaction.time;
                }
                zone.status = "MITIGATED";
            }
            else if (touched && zone.status === "ACTIVE") {
                zone.status = "TOUCHED";
            }
        }

        zones.push(zone);
    }

    return applySmartMoneyZoneOptions(zones, normalizedOptions);
}

function getLiquidityZoneOptions(options = {}) {
    return {
        lookback: Number.isInteger(options.lookback) && options.lookback >= 1
            ? options.lookback
            : 3,
        tolerance: Number.isFinite(options.tolerance) && options.tolerance > 0
            ? options.tolerance
            : 0.0015,
        minTouches: Number.isInteger(options.minTouches) && options.minTouches >= 2
            ? options.minTouches
            : 2,
        limit: Number.isInteger(options.limit) && options.limit >= 0
            ? options.limit
            : 20,
        includeSwept: options.includeSwept !== false,
        includeBroken: options.includeBroken === true
    };
}

function getValidLiquidityMarketData(data) {
    const validIndices = [];
    const volumes = [];

    for (let i = 0; i < data.length; i++) {
        if (!isValidSmartMoneyCandle(data[i])) {
            continue;
        }

        validIndices.push(i);

        if (Number.isFinite(data[i].volume) && data[i].volume >= 0) {
            volumes.push(data[i].volume);
        }
    }

    const averageMarketVolume = volumes.length
        ? volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length
        : null;
    const lastValidCandleIndex = validIndices.length
        ? validIndices[validIndices.length - 1]
        : null;
    const lastCandle = lastValidCandleIndex === null
        ? null
        : data[lastValidCandleIndex];

    return {
        averageMarketVolume: Number.isFinite(averageMarketVolume)
            ? averageMarketVolume
            : null,
        lastValidCandleIndex,
        lastValidTime: lastCandle ? lastCandle.time : null,
        lastClose: lastCandle && Number.isFinite(lastCandle.close) && lastCandle.close !== 0
            ? lastCandle.close
            : null
    };
}

function clusterLiquidityCandidates(candidates, tolerance) {
    const sorted = [...candidates].sort((a, b) =>
        a.price - b.price || a.index - b.index || a.time - b.time
    );
    const clusters = [];

    for (const candidate of sorted) {
        let target = null;

        for (const cluster of clusters) {
            const relativeDifference = Math.abs(candidate.price - cluster.price) /
                cluster.price;

            if (Number.isFinite(relativeDifference) && relativeDifference <= tolerance) {
                target = cluster;
                break;
            }
        }

        if (!target) {
            clusters.push({
                type: candidate.type,
                price: candidate.price,
                points: [candidate]
            });
            continue;
        }

        const nextCount = target.points.length + 1;
        target.price += (candidate.price - target.price) / nextCount;
        target.points.push(candidate);
    }

    return clusters;
}

function detectLiquidityZones(options = {}) {
    const data = getSmartMoneyCandleData();
    const normalizedOptions = getLiquidityZoneOptions(options);

    if (data.length < normalizedOptions.lookback * 2 + 1) {
        return [];
    }

    let swings;

    try {
        swings = getSwings(normalizedOptions.lookback);
    } catch (error) {
        return [];
    }

    const candidatesByType = {
        BUY_SIDE: [],
        SELL_SIDE: []
    };
    const seenCandidates = new Set();

    const addCandidates = (points, type) => {
        if (!Array.isArray(points)) {
            return;
        }

        for (const point of points) {
            if (
                !point ||
                !Number.isInteger(point.index) ||
                point.index < 0 ||
                point.index >= data.length ||
                !Number.isFinite(point.price) ||
                point.price <= 0 ||
                !isValidSmartMoneyCandle(data[point.index])
            ) {
                continue;
            }

            const key = `${type}-${point.index}`;

            if (seenCandidates.has(key)) {
                continue;
            }

            seenCandidates.add(key);
            candidatesByType[type].push({
                type,
                index: point.index,
                price: point.price,
                time: data[point.index].time
            });
        }
    };

    addCandidates(swings && swings.highs, "BUY_SIDE");
    addCandidates(swings && swings.lows, "SELL_SIDE");

    const marketData = getValidLiquidityMarketData(data);
    const zones = [];
    const zoneIds = new Set();

    for (const type of ["BUY_SIDE", "SELL_SIDE"]) {
        const clusters = clusterLiquidityCandidates(
            candidatesByType[type],
            normalizedOptions.tolerance
        );

        for (const cluster of clusters) {
            if (cluster.points.length < normalizedOptions.minTouches) {
                continue;
            }

            const points = [...cluster.points].sort((a, b) =>
                a.index - b.index || a.time - b.time || a.price - b.price
            );
            const uniquePoints = points.filter((point, index) =>
                index === 0 || point.index !== points[index - 1].index
            );

            if (uniquePoints.length < normalizedOptions.minTouches) {
                continue;
            }

            const prices = uniquePoints.map(point => point.price);
            const price = prices.reduce(
                (average, value, index) => average + (value - average) / (index + 1),
                0
            );
            const padding = price * normalizedOptions.tolerance * 0.5;
            const zoneLow = Math.min(...prices, price - padding);
            const zoneHigh = Math.max(...prices, price + padding);

            if (
                !Number.isFinite(price) ||
                !Number.isFinite(padding) ||
                !Number.isFinite(zoneLow) ||
                !Number.isFinite(zoneHigh)
            ) {
                continue;
            }

            const touchIndices = uniquePoints.map(point => point.index);
            const touchTimes = uniquePoints.map(point => point.time);
            const firstTouchIndex = touchIndices[0];
            const lastTouchIndex = touchIndices[touchIndices.length - 1];
            const startTime = touchTimes[0];
            const confirmationPoint = uniquePoints[normalizedOptions.minTouches - 1];
            const confirmedTime = confirmationPoint.time;
            const confirmedIndex = confirmationPoint.index;
            const id = `LIQ-${type}-${startTime}-${firstTouchIndex}`;
            const calculatedDistancePercent = marketData.lastClose === null
                ? null
                : Math.abs(price - marketData.lastClose) /
                    Math.abs(marketData.lastClose) * 100;
            const distancePercent = Number.isFinite(calculatedDistancePercent)
                ? calculatedDistancePercent
                : null;

            if (zoneIds.has(id)) {
                continue;
            }

            zoneIds.add(id);

            const zone = {
                id,
                kind: "LIQUIDITY",
                type,
                price,
                zoneHigh,
                zoneLow,
                touchCount: touchIndices.length,
                touchIndices,
                touchTimes,
                firstTouchIndex,
                lastTouchIndex,
                startTime,
                confirmedTime,
                lastTouchTime: touchTimes[touchTimes.length - 1],
                status: "ACTIVE",
                sweepIndex: null,
                sweepTime: null,
                brokenIndex: null,
                brokenTime: null,
                strength: 0,
                strengthBreakdown: {
                    touchScore: 0,
                    recencyScore: 0,
                    volumeScore: 0,
                    statusScore: 15
                },
                distancePercent,
                endTime: null
            };

            for (let i = confirmedIndex + 1; i < data.length; i++) {
                const interaction = data[i];

                if (!isValidSmartMoneyCandle(interaction)) {
                    continue;
                }

                const broken = type === "BUY_SIDE"
                    ? interaction.close > zoneHigh
                    : interaction.close < zoneLow;

                if (broken) {
                    zone.status = "BROKEN";
                    zone.brokenIndex = i;
                    zone.brokenTime = interaction.time;
                    zone.endTime = interaction.time;
                    break;
                }

                const swept = type === "BUY_SIDE"
                    ? interaction.high > zoneHigh && interaction.close < price
                    : interaction.low < zoneLow && interaction.close > price;

                if (swept && zone.status === "ACTIVE") {
                    zone.status = "SWEPT";
                    zone.sweepIndex = i;
                    zone.sweepTime = interaction.time;
                    zone.endTime = interaction.time;
                    break;
                }
            }

            const touchScore = Math.min(40, zone.touchCount * 10);
            const barsSinceLastTouch = marketData.lastValidCandleIndex === null
                ? 0
                : Math.max(0, marketData.lastValidCandleIndex - zone.lastTouchIndex);
            const recencyScore = marketData.lastValidCandleIndex === null
                ? 0
                : Math.round(Math.max(
                    0,
                    25 * (1 - barsSinceLastTouch /
                        Math.max(1, marketData.lastValidCandleIndex))
                ));
            const touchVolumes = zone.touchIndices
                .map(index => data[index] && data[index].volume)
                .filter(volume => Number.isFinite(volume) && volume >= 0);
            const averageTouchVolume = touchVolumes.length
                ? touchVolumes.reduce((sum, volume) => sum + volume, 0) /
                    touchVolumes.length
                : null;
            const volumeRatio = Number.isFinite(averageTouchVolume) &&
                Number.isFinite(marketData.averageMarketVolume) &&
                marketData.averageMarketVolume > 0
                ? averageTouchVolume / marketData.averageMarketVolume
                : null;
            const volumeScore = Number.isFinite(volumeRatio)
                ? Math.min(20, Math.max(0, Math.round(20 * Math.min(1, volumeRatio))))
                : 0;
            const statusScore = zone.status === "ACTIVE"
                ? 15
                : zone.status === "SWEPT"
                    ? 5
                    : 0;

            zone.strengthBreakdown = {
                touchScore,
                recencyScore,
                volumeScore,
                statusScore
            };
            zone.strength = Math.min(
                100,
                touchScore + recencyScore + volumeScore + statusScore
            );

            zones.push(zone);
        }
    }

    const filtered = zones
        .filter(zone => normalizedOptions.includeSwept || zone.status !== "SWEPT")
        .filter(zone => normalizedOptions.includeBroken || zone.status !== "BROKEN")
        .sort((a, b) =>
            a.firstTouchIndex - b.firstTouchIndex ||
            a.type.localeCompare(b.type) ||
            a.id.localeCompare(b.id)
        );

    return normalizedOptions.limit === 0
        ? []
        : filtered.slice(-normalizedOptions.limit);
}

function getStrongestLiquidityZones(liquidityZones = detectLiquidityZones()) {
    const zones = Array.isArray(liquidityZones)
        ? liquidityZones.filter(zone =>
            zone &&
            (zone.status === "ACTIVE" || zone.status === "SWEPT") &&
            Number.isFinite(zone.strength) &&
            Number.isFinite(zone.touchCount) &&
            Number.isFinite(zone.lastTouchIndex) &&
            typeof zone.id === "string"
        )
        : [];
    const compare = (a, b) =>
        b.strength - a.strength ||
        b.touchCount - a.touchCount ||
        (Number.isFinite(a.distancePercent) ? a.distancePercent : Infinity) -
            (Number.isFinite(b.distancePercent) ? b.distancePercent : Infinity) ||
        b.lastTouchIndex - a.lastTouchIndex ||
        a.id.localeCompare(b.id);
    const select = type => {
        const typed = type
            ? zones.filter(zone => zone.type === type)
            : zones;
        const active = typed.filter(zone => zone.status === "ACTIVE").sort(compare);

        if (active.length) {
            return active[0];
        }

        const swept = typed.filter(zone => zone.status === "SWEPT").sort(compare);
        return swept.length ? swept[0] : null;
    };

    return {
        overall: select(null),
        buySide: select("BUY_SIDE"),
        sellSide: select("SELL_SIDE")
    };
}

function getStructureEventOptions(options = {}) {
    return {
        lookback: Number.isInteger(options.lookback) && options.lookback >= 1
            ? options.lookback
            : 3,
        limit: Number.isInteger(options.limit) && options.limit >= 0
            ? options.limit
            : 50,
        includeBOS: options.includeBOS !== false,
        includeCHoCH: options.includeCHoCH !== false
    };
}

function detectStructureEvents(options = {}) {
    const data = getSmartMoneyCandleData();
    const normalizedOptions = getStructureEventOptions(options);

    if (data.length < normalizedOptions.lookback * 2 + 2) {
        return [];
    }

    let swings;

    try {
        swings = getSwings(normalizedOptions.lookback);
    } catch (error) {
        return [];
    }

    const normalizeSwings = (points, swingType) => {
        if (!Array.isArray(points)) {
            return [];
        }

        const seen = new Set();

        return points
            .filter(point => {
                if (
                    !point ||
                    !Number.isInteger(point.index) ||
                    point.index < 0 ||
                    point.index >= data.length ||
                    !Number.isFinite(point.price) ||
                    point.price <= 0 ||
                    !isValidSmartMoneyCandle(data[point.index])
                ) {
                    return false;
                }

                const key = `${swingType}-${point.index}`;

                if (seen.has(key)) {
                    return false;
                }

                seen.add(key);
                return true;
            })
            .map(point => ({
                swingType,
                index: point.index,
                price: point.price,
                time: data[point.index].time,
                swingConfirmationIndex: point.index + normalizedOptions.lookback
            }))
            .filter(point => point.swingConfirmationIndex < data.length)
            .sort((a, b) =>
                a.swingConfirmationIndex - b.swingConfirmationIndex ||
                a.index - b.index ||
                a.price - b.price
            );
    };

    const highs = normalizeSwings(swings && swings.highs, "HIGH");
    const lows = normalizeSwings(swings && swings.lows, "LOW");
    const consumed = new Set();
    const eventIds = new Set();
    const events = [];
    let structureBias = "NEUTRAL";

    const swingKey = swing => `${swing.swingType}-${swing.index}`;
    const newestSwing = candidates => [...candidates].sort((a, b) =>
        b.swingConfirmationIndex - a.swingConfirmationIndex ||
        b.index - a.index ||
        b.time - a.time ||
        b.price - a.price
    )[0];

    for (let confirmationIndex = 1; confirmationIndex < data.length; confirmationIndex++) {
        const previousIndex = confirmationIndex - 1;
        const previousCandle = data[previousIndex];
        const currentCandle = data[confirmationIndex];

        if (
            !isValidSmartMoneyCandle(previousCandle) ||
            !isValidSmartMoneyCandle(currentCandle)
        ) {
            continue;
        }

        const bullishBreaks = highs.filter(swing =>
            !consumed.has(swingKey(swing)) &&
            confirmationIndex > swing.swingConfirmationIndex &&
            currentCandle.close > swing.price
        );
        const bearishBreaks = lows.filter(swing =>
            !consumed.has(swingKey(swing)) &&
            confirmationIndex > swing.swingConfirmationIndex &&
            currentCandle.close < swing.price
        );

        if (!bullishBreaks.length && !bearishBreaks.length) {
            continue;
        }

        for (const swing of [...bullishBreaks, ...bearishBreaks]) {
            consumed.add(swingKey(swing));
        }

        if (bullishBreaks.length && bearishBreaks.length) {
            continue;
        }

        const direction = bullishBreaks.length ? "BULLISH" : "BEARISH";
        const swing = newestSwing(bullishBreaks.length ? bullishBreaks : bearishBreaks);
        const structureBiasBefore = structureBias;
        const eventType = structureBias === "NEUTRAL" || structureBias === direction
            ? "BOS"
            : "CHOCH";

        structureBias = direction;

        const label = `${direction} ${eventType}`;
        const distance = Math.abs(currentCandle.close - swing.price) /
            swing.price * 100;
        const distancePercent = Number.isFinite(distance) ? distance : null;
        const id = `STRUCTURE-${eventType}-${direction}-${swing.time}-${currentCandle.time}`;

        if (eventIds.has(id)) {
            continue;
        }

        eventIds.add(id);
        events.push({
            id,
            kind: "STRUCTURE_EVENT",
            eventType,
            direction,
            label,
            level: swing.price,
            swingType: swing.swingType,
            swingIndex: swing.index,
            swingTime: swing.time,
            swingConfirmationIndex: swing.swingConfirmationIndex,
            breakStartIndex: previousIndex,
            confirmationIndex,
            breakStartTime: previousCandle.time,
            confirmationTime: currentCandle.time,
            breakTime: currentCandle.time,
            previousClose: previousCandle.close,
            confirmationClose: currentCandle.close,
            structureBiasBefore,
            structureBiasAfter: structureBias,
            distancePercent,
            startTime: swing.time,
            endTime: currentCandle.time
        });
    }

    const filtered = events.filter(event =>
        (normalizedOptions.includeBOS || event.eventType !== "BOS") &&
        (normalizedOptions.includeCHoCH || event.eventType !== "CHOCH")
    );

    return normalizedOptions.limit === 0
        ? []
        : filtered.slice(-normalizedOptions.limit);
}

function getStructureZoneQualificationOptions(options = {}) {
    const safeInteger = (value, fallback) => Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : fallback;
    const safePositiveInteger = (value, fallback) =>
        Number.isInteger(value) && value > 0 ? value : fallback;
    const safeThreshold = (value, fallback) =>
        Number.isFinite(value) && value >= 0 ? value : fallback;
    return {
        maxEvents: safeInteger(options.maxEvents, 20),
        orderBlocksPerEvent: safeInteger(options.orderBlocksPerEvent, 1),
        fvgsPerEvent: safeInteger(options.fvgsPerEvent, 1),
        includeBOS: options.includeBOS !== false,
        includeCHoCH: options.includeCHoCH !== false,
        requireClosedConfirmation: options.requireClosedConfirmation !== false,
        atrPeriod: safePositiveInteger(options.atrPeriod, 14),
        minLegBars: safePositiveInteger(options.minLegBars, 4),
        minLegRangeATR: safeThreshold(options.minLegRangeATR, 1.25),
        minBreakDistanceATR: safeThreshold(options.minBreakDistanceATR, 0.10),
        minConfirmationBodyATR: safeThreshold(options.minConfirmationBodyATR, 0.22),
        minConfirmationBodyRatio: safeThreshold(options.minConfirmationBodyRatio, 0.45),
        minStructureAdvanceATR: safeThreshold(options.minStructureAdvanceATR, 0.08),
        minOrderBlockHeightATR: safeThreshold(options.minOrderBlockHeightATR, 0.12),
        minFVGHeightATR: safeThreshold(options.minFVGHeightATR, 0.06),
        requireExternalProgression: options.requireExternalProgression !== false
    };
}

function isClosedSmartMoneyCandle(candle, index, dataLength, now = Date.now()) {
    if (!isValidSmartMoneyCandle(candle)) return false;
    if (Number.isFinite(candle.closeTime) && candle.closeTime > 0) {
        return candle.closeTime <= now;
    }
    return Number.isInteger(index) && index >= 0 && index < dataLength - 1;
}

function normalizeStructureEventForZoneQualification(
    event,
    data,
    now,
    requireClosedConfirmation
) {
    if (
        !event || typeof event.id !== "string" || !event.id ||
        event.kind !== "STRUCTURE_EVENT" ||
        !["BOS", "CHOCH"].includes(event.eventType) ||
        !["BULLISH", "BEARISH"].includes(event.direction) ||
        !Number.isInteger(event.swingIndex) ||
        !Number.isInteger(event.swingConfirmationIndex) ||
        !Number.isInteger(event.confirmationIndex) ||
        event.swingConfirmationIndex < 0 || event.confirmationIndex < 0 ||
        event.swingConfirmationIndex >= data.length ||
        event.confirmationIndex >= data.length ||
        event.confirmationIndex <= event.swingConfirmationIndex ||
        !isValidSmartMoneyCandle(data[event.confirmationIndex]) ||
        !Number.isFinite(event.confirmationTime) || event.confirmationTime <= 0 ||
        !Number.isFinite(event.level) || event.level <= 0
    ) return null;
    if (requireClosedConfirmation && !isClosedSmartMoneyCandle(
        data[event.confirmationIndex], event.confirmationIndex, data.length, now
    )) return null;
    return { ...event };
}

function getConfirmedStructureImpulseLeg(event, previousEvent, data) {
    if (!event || !Array.isArray(data)) return null;
    const previousConfirmationBoundary = previousEvent
        ? previousEvent.confirmationIndex + 1
        : 0;
    const searchStartIndex = Math.max(
        previousConfirmationBoundary,
        event.swingConfirmationIndex
    );
    const searchEndIndex = event.confirmationIndex;
    if (!Number.isInteger(searchStartIndex) || !Number.isInteger(searchEndIndex) ||
        searchStartIndex < 0 || searchEndIndex >= data.length ||
        searchStartIndex > searchEndIndex) return null;
    let legStartIndex = null;
    for (let index = searchStartIndex; index <= searchEndIndex; index++) {
        if (!isValidSmartMoneyCandle(data[index])) continue;
        if (legStartIndex === null ||
            (event.direction === "BULLISH" && data[index].low <= data[legStartIndex].low) ||
            (event.direction === "BEARISH" && data[index].high >= data[legStartIndex].high)) {
            legStartIndex = index;
        }
    }
    if (legStartIndex === null || !isValidSmartMoneyCandle(data[searchEndIndex])) return null;
    const originPrice = event.direction === "BULLISH"
        ? data[legStartIndex].low
        : data[legStartIndex].high;
    const result = {
        direction: event.direction,
        eventId: event.id,
        eventType: event.eventType,
        legStartIndex,
        legEndIndex: searchEndIndex,
        legStartTime: data[legStartIndex].time,
        legEndTime: data[searchEndIndex].time,
        originPrice,
        breakLevel: event.level,
        confirmationClose: data[searchEndIndex].close
    };
    return Object.values({
        legStartIndex: result.legStartIndex,
        legEndIndex: result.legEndIndex,
        legStartTime: result.legStartTime,
        legEndTime: result.legEndTime,
        originPrice: result.originPrice,
        breakLevel: result.breakLevel,
        confirmationClose: result.confirmationClose
    }).every(Number.isFinite) ? result : null;
}

function isPriceZoneInsideConfirmedStructureLeg(zone, event, leg, expectedKind) {
    return Boolean(
        zone && event && leg && zone.kind === expectedKind &&
        zone.type === event.direction &&
        Number.isInteger(zone.index) && Number.isInteger(zone.confirmationIndex) &&
        zone.index >= leg.legStartIndex &&
        zone.confirmationIndex >= leg.legStartIndex &&
        zone.index <= event.confirmationIndex &&
        zone.confirmationIndex <= event.confirmationIndex &&
        Number.isFinite(zone.startTime) && zone.startTime <= event.confirmationTime &&
        Number.isFinite(zone.confirmationTime) &&
        zone.confirmationTime <= event.confirmationTime
    );
}

function calculateSmartMoneyTrueRange(candle, previousCandle) {
    if (!isValidSmartMoneyCandle(candle)) return null;
    const baseRange = candle.high - candle.low;
    if (!isValidSmartMoneyCandle(previousCandle)) {
        return Number.isFinite(baseRange) && baseRange >= 0 ? baseRange : null;
    }
    const trueRange = Math.max(
        baseRange,
        Math.abs(candle.high - previousCandle.close),
        Math.abs(candle.low - previousCandle.close)
    );
    return Number.isFinite(trueRange) && trueRange >= 0 ? trueRange : null;
}

function calculateStructureATR(data, confirmationIndex, period = 14) {
    if (!Array.isArray(data) || !Number.isInteger(confirmationIndex) ||
        confirmationIndex < 0 || confirmationIndex >= data.length ||
        !Number.isInteger(period) || period <= 0) return null;
    const ranges = [];
    let previousValidCandle = null;
    for (let index = 0; index <= confirmationIndex; index++) {
        const candle = data[index];
        if (!isValidSmartMoneyCandle(candle)) continue;
        const trueRange = calculateSmartMoneyTrueRange(candle, previousValidCandle);
        if (Number.isFinite(trueRange)) ranges.push(trueRange);
        previousValidCandle = candle;
    }
    if (ranges.length < 2) return null;
    const recent = ranges.slice(-period);
    const atr = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    return Number.isFinite(atr) && atr > 0 ? atr : null;
}

function getStructureEventSignificanceMetrics(event, leg, data, options) {
    if (!event || !leg || !Array.isArray(data) ||
        !Number.isInteger(leg.legStartIndex) ||
        !Number.isInteger(event.confirmationIndex) ||
        leg.legStartIndex < 0 || event.confirmationIndex >= data.length ||
        leg.legStartIndex > event.confirmationIndex) return null;
    const atr = calculateStructureATR(data, event.confirmationIndex, options.atrPeriod);
    const confirmationCandle = data[event.confirmationIndex];
    if (!Number.isFinite(atr) || atr <= 0 ||
        !isValidSmartMoneyCandle(confirmationCandle) ||
        !Number.isFinite(event.confirmationClose) ||
        !Number.isFinite(event.level)) return null;
    const legCandles = data.slice(leg.legStartIndex, event.confirmationIndex + 1)
        .filter(isValidSmartMoneyCandle);
    if (!legCandles.length) return null;
    const legHigh = Math.max(...legCandles.map(candle => candle.high));
    const legLow = Math.min(...legCandles.map(candle => candle.low));
    const legRange = legHigh - legLow;
    const breakDistance = Math.abs(event.confirmationClose - event.level);
    const confirmationBody = Math.abs(confirmationCandle.close - confirmationCandle.open);
    const confirmationRange = confirmationCandle.high - confirmationCandle.low;
    const metrics = {
        atr,
        legBars: event.confirmationIndex - leg.legStartIndex + 1,
        legHigh,
        legLow,
        legRange,
        legRangeATR: legRange / atr,
        breakDistance,
        breakDistanceATR: breakDistance / atr,
        confirmationBody,
        confirmationBodyATR: confirmationBody / atr,
        confirmationRange,
        confirmationBodyRatio: confirmationRange > 0
            ? confirmationBody / confirmationRange : 0
    };
    return Object.values(metrics).every(Number.isFinite) ? metrics : null;
}

function passesStructureImpulseThresholds(event, metrics, options) {
    if (!event || !metrics) return false;
    const directionMatches = event.direction === "BULLISH"
        ? event.confirmationClose > event.level
        : event.direction === "BEARISH"
            ? event.confirmationClose < event.level
            : false;
    const strongBody = metrics.confirmationBodyATR >= options.minConfirmationBodyATR &&
        metrics.confirmationBodyRatio >= options.minConfirmationBodyRatio;
    const strongBreak = metrics.breakDistanceATR >= options.minBreakDistanceATR * 2;
    return directionMatches &&
        metrics.legBars >= options.minLegBars &&
        metrics.legRangeATR >= options.minLegRangeATR &&
        metrics.breakDistanceATR >= options.minBreakDistanceATR &&
        (strongBody || strongBreak);
}

function passesExternalStructureProgression(event, previousSignificantEvent, metrics, options) {
    if (!previousSignificantEvent || options.requireExternalProgression === false) return true;
    if (event.direction !== previousSignificantEvent.direction) {
        return event.eventType === "CHOCH";
    }
    const advance = event.direction === "BULLISH"
        ? event.level - previousSignificantEvent.level
        : previousSignificantEvent.level - event.level;
    return Number.isFinite(advance) &&
        advance >= metrics.atr * options.minStructureAdvanceATR;
}

function calculateStructureSignificanceScore(event, metrics, options) {
    if (!event || !metrics) return 0;
    const normalized = (value, threshold, maximum) => threshold > 0
        ? Math.min(maximum, value / threshold * maximum)
        : (value > 0 ? maximum : 0);
    const score =
        normalized(metrics.legRangeATR, options.minLegRangeATR, 35) +
        normalized(metrics.breakDistanceATR, options.minBreakDistanceATR, 25) +
        normalized(metrics.confirmationBodyATR, options.minConfirmationBodyATR, 20) +
        normalized(metrics.confirmationBodyRatio, options.minConfirmationBodyRatio, 10) +
        normalized(metrics.legBars, options.minLegBars, 10);
    return Math.min(100, Math.max(0, Math.round(score)));
}

function selectSignificantStructureEventsForZoneQualification(confirmedEvents, data, options) {
    const significantEvents = [];
    const rejectedEvents = [];
    let previousSignificantEvent = null;
    for (const event of Array.isArray(confirmedEvents) ? confirmedEvents : []) {
        const leg = getConfirmedStructureImpulseLeg(event, previousSignificantEvent, data);
        if (!leg) {
            rejectedEvents.push(rejectedStructureEvent(event, "INVALID_LEG", null));
            continue;
        }
        const metrics = getStructureEventSignificanceMetrics(event, leg, data, options);
        if (!metrics) {
            rejectedEvents.push(rejectedStructureEvent(event, "INVALID_METRICS", null));
            continue;
        }
        let reason = null;
        if (metrics.legBars < options.minLegBars) reason = "MICRO_LEG_BARS";
        else if (metrics.legRangeATR < options.minLegRangeATR) reason = "MICRO_LEG_RANGE";
        else if (metrics.breakDistanceATR < options.minBreakDistanceATR) reason = "WEAK_BREAK_DISTANCE";
        else {
            const strongBody = metrics.confirmationBodyATR >= options.minConfirmationBodyATR &&
                metrics.confirmationBodyRatio >= options.minConfirmationBodyRatio;
            const strongBreak = metrics.breakDistanceATR >= options.minBreakDistanceATR * 2;
            if (!strongBody && !strongBreak) reason = "WEAK_CONFIRMATION";
        }
        if (!reason && !passesStructureImpulseThresholds(event, metrics, options)) {
            reason = "WEAK_CONFIRMATION";
        }
        if (!reason && previousSignificantEvent &&
            event.direction !== previousSignificantEvent.direction &&
            event.eventType !== "CHOCH" && options.requireExternalProgression !== false) {
            reason = "OPPOSITE_EVENT_NOT_CHOCH";
        }
        if (!reason && !passesExternalStructureProgression(
            event, previousSignificantEvent, metrics, options
        )) reason = "NON_PROGRESSIVE_INTERNAL_STRUCTURE";
        if (reason) {
            rejectedEvents.push(rejectedStructureEvent(event, reason, metrics));
            continue;
        }
        const acceptedEvent = { ...event };
        significantEvents.push({
            event: acceptedEvent,
            leg: { ...leg },
            metrics: { ...metrics },
            significanceScore: calculateStructureSignificanceScore(event, metrics, options)
        });
        previousSignificantEvent = acceptedEvent;
    }
    return { significantEvents, rejectedEvents };
}

function rejectedStructureEvent(event, reason, metrics) {
    return {
        id: event?.id ?? null,
        eventType: event?.eventType ?? null,
        direction: event?.direction ?? null,
        confirmationIndex: event?.confirmationIndex ?? null,
        reason,
        metrics: metrics ? { ...metrics } : null
    };
}

function getPriceZoneHeightATR(zone, expectedKind, atr) {
    if (!zone || !Number.isFinite(atr) || atr <= 0) return null;
    const height = expectedKind === "ORDER_BLOCK"
        ? zone.high - zone.low
        : expectedKind === "FVG"
            ? zone.top - zone.bottom
            : null;
    const result = height / atr;
    return Number.isFinite(result) && result >= 0 ? result : null;
}

function selectOrderBlocksForConfirmedLeg(orderBlocks, event, leg, data, limit, context = {}) {
    if (!Array.isArray(orderBlocks) || !Number.isInteger(limit) || limit <= 0) return [];
    const useHeightFilter = Number.isFinite(context.atr) && context.atr > 0 &&
        Number.isFinite(context.minHeightATR) && context.minHeightATR >= 0;
    return orderBlocks
        .filter(zone => isPriceZoneInsideConfirmedStructureLeg(
            zone, event, leg, "ORDER_BLOCK"
        ))
        .filter(zone => !useHeightFilter ||
            getPriceZoneHeightATR(zone, "ORDER_BLOCK", context.atr) >= context.minHeightATR
        )
        .map(zone => {
            const boundary = event.direction === "BULLISH" ? zone.low : zone.high;
            const displacement = event.direction === "BULLISH"
                ? (event.confirmationClose - zone.low) / zone.low * 100
                : (zone.high - event.confirmationClose) / zone.high * 100;
            return {
                zone,
                originDistance: Math.abs(zone.index - leg.legStartIndex),
                displacementPercent: Number.isFinite(boundary) && boundary > 0 &&
                    Number.isFinite(displacement) ? displacement : 0
            };
        })
        .sort((a, b) =>
            a.originDistance - b.originDistance ||
            b.displacementPercent - a.displacementPercent ||
            a.zone.confirmationIndex - b.zone.confirmationIndex ||
            a.zone.index - b.zone.index ||
            a.zone.id.localeCompare(b.zone.id)
        )
        .slice(0, limit)
        .map(candidate => ({ ...candidate.zone }));
}

function selectFVGsForConfirmedLeg(fvgs, event, leg, data, limit, context = {}) {
    if (!Array.isArray(fvgs) || !Number.isInteger(limit) || limit <= 0) return [];
    const useHeightFilter = Number.isFinite(context.atr) && context.atr > 0 &&
        Number.isFinite(context.minHeightATR) && context.minHeightATR >= 0;
    return fvgs
        .filter(zone => isPriceZoneInsideConfirmedStructureLeg(
            zone, event, leg, "FVG"
        ))
        .filter(zone => !useHeightFilter ||
            getPriceZoneHeightATR(zone, "FVG", context.atr) >= context.minHeightATR
        )
        .map(zone => {
            const gapSize = zone.top - zone.bottom;
            const gapPercent = gapSize / zone.midpoint * 100;
            return {
                zone,
                gapPercent: Number.isFinite(gapPercent) ? gapPercent : 0,
                originDistance: Math.abs(zone.index - leg.legStartIndex)
            };
        })
        .sort((a, b) =>
            b.gapPercent - a.gapPercent ||
            a.originDistance - b.originDistance ||
            a.zone.confirmationIndex - b.zone.confirmationIndex ||
            a.zone.id.localeCompare(b.zone.id)
        )
        .slice(0, limit)
        .map(candidate => ({ ...candidate.zone }));
}

function selectStructureConfirmedPriceZones(source = {}, options = {}) {
    const normalizedOptions = getStructureZoneQualificationOptions(options);
    const data = Array.isArray(source.candles)
        ? source.candles.slice()
        : getSmartMoneyCandleData().slice();
    const rawEvents = Array.isArray(source.structureEvents)
        ? source.structureEvents.slice() : [];
    const rawOrderBlocks = Array.isArray(source.orderBlocks)
        ? source.orderBlocks.slice() : [];
    const rawFVGs = Array.isArray(source.fvgs) ? source.fvgs.slice() : [];
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const eventMap = new Map();
    rawEvents.forEach(event => {
        const normalized = normalizeStructureEventForZoneQualification(
            event, data, now, normalizedOptions.requireClosedConfirmation
        );
        if (normalized &&
            (normalizedOptions.includeBOS || normalized.eventType !== "BOS") &&
            (normalizedOptions.includeCHoCH || normalized.eventType !== "CHOCH")) {
            eventMap.set(normalized.id, normalized);
        }
    });
    const confirmedEvents = [...eventMap.values()].sort((a, b) =>
        a.confirmationIndex - b.confirmationIndex ||
        a.swingConfirmationIndex - b.swingConfirmationIndex ||
        a.id.localeCompare(b.id)
    );
    const selectedEvents = normalizedOptions.maxEvents === 0
        ? []
        : confirmedEvents.slice(-normalizedOptions.maxEvents);
    const significance = selectSignificantStructureEventsForZoneQualification(
        selectedEvents, data, normalizedOptions
    );
    const selectedOrderBlocks = [];
    const selectedFVGs = [];
    const legs = [];
    const orderBlockIds = new Set();
    const fvgIds = new Set();
    const suppressedSmallOrderBlockIds = new Set();
    const suppressedSmallFVGIds = new Set();
    significance.significantEvents.forEach(({ event, leg, metrics, significanceScore }) => {
        legs.push({ ...leg });
        const availableOrderBlocks = rawOrderBlocks.filter(zone =>
            !orderBlockIds.has(zone?.id)
        );
        const availableFVGs = rawFVGs.filter(zone => !fvgIds.has(zone?.id));
        availableOrderBlocks.forEach(zone => {
            const heightATR = getPriceZoneHeightATR(zone, "ORDER_BLOCK", metrics.atr);
            if (isPriceZoneInsideConfirmedStructureLeg(
                zone, event, leg, "ORDER_BLOCK"
            ) && Number.isFinite(heightATR) &&
                heightATR < normalizedOptions.minOrderBlockHeightATR) {
                suppressedSmallOrderBlockIds.add(zone.id);
            }
        });
        availableFVGs.forEach(zone => {
            const heightATR = getPriceZoneHeightATR(zone, "FVG", metrics.atr);
            if (isPriceZoneInsideConfirmedStructureLeg(
                zone, event, leg, "FVG"
            ) && Number.isFinite(heightATR) &&
                heightATR < normalizedOptions.minFVGHeightATR) {
                suppressedSmallFVGIds.add(zone.id);
            }
        });
        selectOrderBlocksForConfirmedLeg(
            availableOrderBlocks, event, leg, data,
            normalizedOptions.orderBlocksPerEvent,
            { atr: metrics.atr, minHeightATR: normalizedOptions.minOrderBlockHeightATR }
        ).forEach(zone => {
            if (orderBlockIds.has(zone.id)) return;
            orderBlockIds.add(zone.id);
            selectedOrderBlocks.push(addStructureQualificationMetadata(
                zone, event, leg, metrics, significanceScore
            ));
        });
        selectFVGsForConfirmedLeg(
            availableFVGs, event, leg, data, normalizedOptions.fvgsPerEvent,
            { atr: metrics.atr, minHeightATR: normalizedOptions.minFVGHeightATR }
        ).forEach(zone => {
            if (fvgIds.has(zone.id)) return;
            fvgIds.add(zone.id);
            selectedFVGs.push(addStructureQualificationMetadata(
                zone, event, leg, metrics, significanceScore
            ));
        });
    });
    const sortQualified = (a, b) =>
        a.structureConfirmationIndex - b.structureConfirmationIndex ||
        a.structureLegStartIndex - b.structureLegStartIndex ||
        a.confirmationIndex - b.confirmationIndex ||
        a.id.localeCompare(b.id);
    selectedOrderBlocks.sort(sortQualified);
    selectedFVGs.sort(sortQualified);
    return {
        generatedAt: getLastValidSmartMoneyTime(data),
        orderBlocks: selectedOrderBlocks,
        fvgs: selectedFVGs,
        structureEvents: significance.significantEvents.map(item => ({ ...item.event })),
        legs,
        summary: {
            sourceOrderBlocks: rawOrderBlocks.length,
            sourceFVGs: rawFVGs.length,
            sourceStructureEvents: rawEvents.length,
            confirmedStructureEvents: confirmedEvents.length,
            significantStructureEvents: significance.significantEvents.length,
            suppressedMicroStructureEvents: Math.max(
                0, confirmedEvents.length - significance.significantEvents.length
            ),
            qualifiedOrderBlocks: selectedOrderBlocks.length,
            qualifiedFVGs: selectedFVGs.length,
            suppressedOrderBlocks: Math.max(0, rawOrderBlocks.length - selectedOrderBlocks.length),
            suppressedFVGs: Math.max(0, rawFVGs.length - selectedFVGs.length),
            rejectedMicroLegBars: countRejectedReason(significance.rejectedEvents, "MICRO_LEG_BARS"),
            rejectedMicroLegRange: countRejectedReason(significance.rejectedEvents, "MICRO_LEG_RANGE"),
            rejectedWeakBreakDistance: countRejectedReason(significance.rejectedEvents, "WEAK_BREAK_DISTANCE"),
            rejectedWeakConfirmation: countRejectedReason(significance.rejectedEvents, "WEAK_CONFIRMATION"),
            rejectedInternalProgression: countRejectedReason(
                significance.rejectedEvents, "NON_PROGRESSIVE_INTERNAL_STRUCTURE"
            ),
            rejectedOppositeNonCHoCH: countRejectedReason(
                significance.rejectedEvents, "OPPOSITE_EVENT_NOT_CHOCH"
            ),
            suppressedSmallOrderBlocks: suppressedSmallOrderBlockIds.size,
            suppressedSmallFVGs: suppressedSmallFVGIds.size
        }
    };
}

function countRejectedReason(rejectedEvents, reason) {
    return rejectedEvents.filter(event => event.reason === reason).length;
}

function addStructureQualificationMetadata(
    zone,
    event,
    leg,
    metrics = null,
    significanceScore = null
) {
    const zoneHeightATR = metrics
        ? getPriceZoneHeightATR(zone, zone.kind, metrics.atr)
        : null;
    return {
        ...zone,
        structureQualified: true,
        structureEventId: event.id,
        structureEventType: event.eventType,
        structureDirection: event.direction,
        structureConfirmationIndex: event.confirmationIndex,
        structureConfirmationTime: event.confirmationTime,
        structureLegStartIndex: leg.legStartIndex,
        structureLegStartTime: leg.legStartTime,
        structureLegEndIndex: leg.legEndIndex,
        structureLegEndTime: leg.legEndTime,
        qualificationReason: "CONFIRMED_SIGNIFICANT_EXTERNAL_STRUCTURE",
        qualificationVersion: "3.2",
        structureSignificant: true,
        structureSignificanceScore: Number.isFinite(significanceScore)
            ? significanceScore : null,
        structureATR: metrics?.atr ?? null,
        structureLegBars: metrics?.legBars ?? null,
        structureLegRangeATR: metrics?.legRangeATR ?? null,
        structureBreakDistanceATR: metrics?.breakDistanceATR ?? null,
        structureConfirmationBodyATR: metrics?.confirmationBodyATR ?? null,
        structureConfirmationBodyRatio: metrics?.confirmationBodyRatio ?? null,
        zoneHeightATR
    };
}

function getSmartMoneyZones(options = {}) {
    const data = getSmartMoneyCandleData();
    const resolveLimit = (specificLimit, sharedLimit, defaultLimit) =>
        Number.isInteger(specificLimit) && specificLimit >= 0
            ? specificLimit
            : Number.isInteger(sharedLimit) && sharedLimit >= 0
                ? sharedLimit
                : defaultLimit;
    const orderBlocks = detectOrderBlocks({
        ...options,
        limit: resolveLimit(options.orderBlockLimit, options.limit, 50)
    });
    const fvgs = detectFVGs({
        ...options,
        limit: resolveLimit(options.fvgLimit, options.limit, 50)
    });
    const liquidityZones = detectLiquidityZones({
        ...options,
        limit: resolveLimit(options.liquidityLimit, options.limit, 20)
    });
    const strongestLiquidity = getStrongestLiquidityZones(liquidityZones);
    const structureEvents = detectStructureEvents({
        ...options,
        limit: resolveLimit(options.structureLimit, options.limit, 50)
    });
    const countStatus = (zones, status) =>
        zones.filter(zone => zone.status === status).length;

    return {
        generatedAt: data.length && isValidSmartMoneyCandle(data[data.length - 1])
            ? data[data.length - 1].time
            : null,
        candleCount: data.length,
        orderBlocks,
        fvgs,
        liquidityZones,
        strongestLiquidity,
        structureEvents,
        summary: {
            totalOrderBlocks: orderBlocks.length,
            activeOrderBlocks: countStatus(orderBlocks, "ACTIVE"),
            touchedOrderBlocks: countStatus(orderBlocks, "TOUCHED"),
            mitigatedOrderBlocks: countStatus(orderBlocks, "MITIGATED"),
            invalidatedOrderBlocks: countStatus(orderBlocks, "INVALIDATED"),
            totalFVGs: fvgs.length,
            activeFVGs: countStatus(fvgs, "ACTIVE"),
            touchedFVGs: countStatus(fvgs, "TOUCHED"),
            mitigatedFVGs: countStatus(fvgs, "MITIGATED"),
            invalidatedFVGs: countStatus(fvgs, "INVALIDATED"),
            totalLiquidityZones: liquidityZones.length,
            activeLiquidityZones: countStatus(liquidityZones, "ACTIVE"),
            sweptLiquidityZones: countStatus(liquidityZones, "SWEPT"),
            brokenLiquidityZones: countStatus(liquidityZones, "BROKEN"),
            buySideLiquidityZones: liquidityZones.filter(
                zone => zone.type === "BUY_SIDE"
            ).length,
            sellSideLiquidityZones: liquidityZones.filter(
                zone => zone.type === "SELL_SIDE"
            ).length,
            totalStructureEvents: structureEvents.length,
            bullishBOSEvents: structureEvents.filter(event =>
                event.label === "BULLISH BOS"
            ).length,
            bearishBOSEvents: structureEvents.filter(event =>
                event.label === "BEARISH BOS"
            ).length,
            bullishCHoCHEvents: structureEvents.filter(event =>
                event.label === "BULLISH CHOCH"
            ).length,
            bearishCHoCHEvents: structureEvents.filter(event =>
                event.label === "BEARISH CHOCH"
            ).length
        }
    };
}

// ==========================
// Draw Order Block
// ==========================
    
function drawOrderBlock() {

    const ob = detectOrderBlock();

    if (!ob) return;

    console.log("Order Block :", ob);

}

// ==========================
// Draw FVG
// ==========================

function drawFVG() {

    const fvg = detectFVG();

    if (!fvg) return;

    console.log("FVG :", fvg);

}

// ==========================
// Draw Liquidity Sweep
// ==========================

function drawLiquiditySweep() {

    const sweep = detectLiquiditySweep();

    if (!sweep) return;

    console.log("Liquidity Sweep :", sweep);

}

console.log("HNDai SmartMoney v5 Ready");

window.HNDSmartMoney = {
    ...(window.HNDSmartMoney || {}),
    selectStructureConfirmedPriceZones,
    selectSignificantStructureEventsForZoneQualification
};

window.SM_LOADED = true;

console.log("SMARTMONEY LOADED");
