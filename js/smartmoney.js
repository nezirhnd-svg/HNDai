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
                zone.firstTouchIndex ??= j;
                zone.lastInteractionIndex = j;
            }

            const invalidated = type === "BULLISH"
                ? interaction.close < zone.low
                : interaction.close > zone.high;

            if (invalidated) {
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
                zone.firstTouchIndex ??= j;
                zone.lastInteractionIndex = j;
            }

            const invalidated = type === "BULLISH"
                ? interaction.close < zone.bottom
                : interaction.close > zone.top;

            if (invalidated) {
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
                endTime: marketData.lastValidTime
            };

            for (let i = lastTouchIndex + 1; i < data.length; i++) {
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
            previousIndex > swing.swingConfirmationIndex &&
            previousCandle.close > swing.price &&
            currentCandle.close > swing.price
        );
        const bearishBreaks = lows.filter(swing =>
            !consumed.has(swingKey(swing)) &&
            previousIndex > swing.swingConfirmationIndex &&
            previousCandle.close < swing.price &&
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
        const id = `STRUCTURE-${eventType}-${direction}-${swing.time}-${swing.index}-${confirmationIndex}`;

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


window.SM_LOADED = true;

console.log("SMARTMONEY LOADED");
