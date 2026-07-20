(function () {
    "use strict";

    let activeRequestId = null;
    let paused = false;
    let cancelled = false;
    let resumeResolver = null;

    function send(type, requestId, payload = {}) {
        self.postMessage({ type, requestId, timestamp: Date.now(), ...payload });
    }

    function seededRandom(seed) {
        let value = (Number(seed) >>> 0) || 0x6d2b79f5;
        return function random() {
            value += 0x6d2b79f5;
            let result = value;
            result = Math.imul(result ^ result >>> 15, result | 1);
            result ^= result + Math.imul(result ^ result >>> 7, result | 61);
            return ((result ^ result >>> 14) >>> 0) / 4294967296;
        };
    }

    function normalizeSeedCandles(input, maximum) {
        if (!Array.isArray(input)) return [];
        return input.slice(-maximum).map(row => ({
            time: Number(row?.time), open: Number(row?.open), high: Number(row?.high),
            low: Number(row?.low), close: Number(row?.close), volume: Number(row?.volume)
        })).filter(row => Number.isFinite(row.time) && row.time > 0 &&
            Number.isFinite(row.open) && row.open > 0 &&
            Number.isFinite(row.high) && row.high >= Math.max(row.open, row.close) &&
            Number.isFinite(row.low) && row.low > 0 && row.low <= Math.min(row.open, row.close) &&
            Number.isFinite(row.close) && row.close > 0 &&
            Number.isFinite(row.volume) && row.volume >= 0);
    }

    function createDataset(count, seed, seedCandles, maxSeedCandles) {
        const open = new Float64Array(count);
        const high = new Float64Array(count);
        const low = new Float64Array(count);
        const close = new Float64Array(count);
        const volume = new Float64Array(count);
        const time = new Float64Array(count);
        const source = normalizeSeedCandles(seedCandles, maxSeedCandles);
        const random = seededRandom(seed);
        const intervalMs = source.length > 1
            ? Math.max(60000, source.at(-1).time - source.at(-2).time) : 900000;
        let previousClose = source.length ? source[0].close : 100;
        let previousTime = source.length ? source[0].time : 1700000000000;
        let checksum = 2166136261;
        for (let index = 0; index < count; index++) {
            const seeded = index < source.length ? source[index] : null;
            if (seeded) {
                open[index] = seeded.open; high[index] = seeded.high; low[index] = seeded.low;
                close[index] = seeded.close; volume[index] = seeded.volume; time[index] = seeded.time;
            } else {
                const regime = Math.floor(index / 1200) % 4;
                const volatility = [0.0015, 0.004, 0.008, 0.0025][regime];
                const drift = [0.00008, -0.00004, 0.00002, 0.00012][regime];
                const movement = (random() - 0.5) * 2 * volatility + drift;
                const nextOpen = Math.max(0.000001, previousClose * (1 + (random() - 0.5) * volatility));
                const nextClose = Math.max(0.000001, nextOpen * (1 + movement));
                const wick = Math.max(nextOpen, nextClose) * volatility * (0.2 + random());
                open[index] = nextOpen;
                close[index] = nextClose;
                high[index] = Math.max(nextOpen, nextClose) + wick;
                low[index] = Math.max(0.0000001, Math.min(nextOpen, nextClose) - wick * (0.5 + random() * 0.5));
                volume[index] = Math.max(0, 1000 * (1 + regime * 0.4) * (0.3 + random() * 2));
                time[index] = previousTime + intervalMs;
            }
            previousClose = close[index]; previousTime = time[index];
            checksum = Math.imul(checksum ^ Math.round(close[index] * 1e6), 16777619) >>> 0;
            checksum = Math.imul(checksum ^ Math.round(volume[index] * 100), 16777619) >>> 0;
        }
        return { open, high, low, close, volume, time, checksum: checksum.toString(16).padStart(8, "0") };
    }

    function percentile(values, ratio) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    }

    function createKernelState(dataset) {
        return {
            dataset, ema20: dataset.close[0], ema50: dataset.close[0], ema200: dataset.close[0],
            avgGain: 0, avgLoss: 0, atr: 0, volumeSum: 0, volumeSquareSum: 0,
            trend: 0, liquidityTouches: 0, tradeState: 0, entry: 0, stop: 0, target: 0,
            checksum: 2166136261
        };
    }

    function processCandle(state, index) {
        const d = state.dataset;
        const currentClose = d.close[index];
        const previousClose = index ? d.close[index - 1] : currentClose;
        state.ema20 += (currentClose - state.ema20) * (2 / 21);
        state.ema50 += (currentClose - state.ema50) * (2 / 51);
        state.ema200 += (currentClose - state.ema200) * (2 / 201);
        const change = currentClose - previousClose;
        state.avgGain = (state.avgGain * 13 + Math.max(0, change)) / 14;
        state.avgLoss = (state.avgLoss * 13 + Math.max(0, -change)) / 14;
        const rsi = state.avgLoss === 0 ? 100 : 100 - 100 / (1 + state.avgGain / state.avgLoss);
        const trueRange = Math.max(d.high[index] - d.low[index],
            Math.abs(d.high[index] - previousClose), Math.abs(d.low[index] - previousClose));
        state.atr = (state.atr * 13 + trueRange) / 14;
        state.volumeSum += d.volume[index];
        state.volumeSquareSum += d.volume[index] * d.volume[index];
        if (index >= 20) {
            state.volumeSum -= d.volume[index - 20];
            state.volumeSquareSum -= d.volume[index - 20] * d.volume[index - 20];
        }
        const volumeWindow = Math.min(20, index + 1);
        const volumeMean = state.volumeSum / volumeWindow;
        const variance = Math.max(0, state.volumeSquareSum / volumeWindow - volumeMean * volumeMean);
        const volumeZ = variance > 0 ? (d.volume[index] - volumeMean) / Math.sqrt(variance) : 0;
        let swingHigh = false, swingLow = false;
        if (index >= 6) {
            const pivot = index - 3;
            swingHigh = d.high[pivot] > d.high[pivot - 1] && d.high[pivot] > d.high[pivot - 2] &&
                d.high[pivot] > d.high[pivot - 3] && d.high[pivot] > d.high[pivot + 1] &&
                d.high[pivot] > d.high[pivot + 2] && d.high[pivot] > d.high[pivot + 3];
            swingLow = d.low[pivot] < d.low[pivot - 1] && d.low[pivot] < d.low[pivot - 2] &&
                d.low[pivot] < d.low[pivot - 3] && d.low[pivot] < d.low[pivot + 1] &&
                d.low[pivot] < d.low[pivot + 2] && d.low[pivot] < d.low[pivot + 3];
        }
        const bosUp = index >= 4 && currentClose > d.high[index - 3];
        const bosDown = index >= 4 && currentClose < d.low[index - 3];
        if (bosUp) state.trend = 1; else if (bosDown) state.trend = -1;
        const bullishFvg = index >= 2 && d.low[index] > d.high[index - 2];
        const bearishFvg = index >= 2 && d.high[index] < d.low[index - 2];
        const orderBlock = index >= 2 && Math.abs(change) > state.atr * 0.8 &&
            Math.abs(d.close[index - 1] - d.open[index - 1]) < state.atr * 0.5;
        if (index >= 3 && (Math.abs(d.high[index] - d.high[index - 3]) <= state.atr * 0.1 ||
            Math.abs(d.low[index] - d.low[index - 3]) <= state.atr * 0.1)) state.liquidityTouches++;
        const quality = Math.max(0, Math.min(100, 50 + state.trend * 8 +
            (rsi < 35 ? 12 : rsi > 65 ? -12 : 0) + volumeZ * 3 +
            (bullishFvg ? 6 : 0) - (bearishFvg ? 6 : 0) + (orderBlock ? 5 : 0) +
            (swingHigh ? -2 : 0) + (swingLow ? 2 : 0)));
        if (!state.tradeState && quality > 72 && state.atr > 0) {
            state.tradeState = state.trend || 1; state.entry = currentClose;
            state.stop = currentClose - state.tradeState * state.atr;
            state.target = currentClose + state.tradeState * state.atr * 2;
        } else if (state.tradeState === 1 && (d.low[index] <= state.stop || d.high[index] >= state.target)) {
            state.tradeState = 0;
        } else if (state.tradeState === -1 && (d.high[index] >= state.stop || d.low[index] <= state.target)) {
            state.tradeState = 0;
        }
        const numeric = currentClose + state.ema20 + state.ema50 + state.ema200 + rsi +
            state.atr + volumeZ + quality + state.liquidityTouches + state.tradeState;
        state.checksum = Math.imul(state.checksum ^ Math.round(numeric * 1000), 16777619) >>> 0;
    }

    function waitIfPaused(requestId) {
        if (!paused || cancelled || requestId !== activeRequestId) return Promise.resolve(0);
        const pausedAt = performance.now();
        return new Promise(resolve => {
            resumeResolver = () => resolve(performance.now() - pausedAt);
        });
    }

    async function runKernel(dataset, candleCount, chunkSize, progressIntervalMs, requestId, phase, runNumber) {
        const state = createKernelState(dataset);
        const chunks = [];
        const started = performance.now();
        let lastProgressAt = started;
        let processed = 0;
        let pausedDurationMs = 0;
        while (processed < candleCount) {
            if (cancelled || requestId !== activeRequestId) return null;
            pausedDurationMs += await waitIfPaused(requestId);
            if (cancelled || requestId !== activeRequestId) return null;
            const chunkStarted = performance.now();
            const end = Math.min(candleCount, processed + chunkSize);
            for (let index = processed; index < end; index++) processCandle(state, index);
            processed = end;
            chunks.push(performance.now() - chunkStarted);
            const now = performance.now();
            if (now - lastProgressAt >= progressIntervalMs || processed === candleCount) {
                send("PROGRESS", requestId, { phase, runNumber, processedCandles: processed,
                    targetCandles: candleCount, progressPercent: processed / candleCount * 100 });
                lastProgressAt = now;
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        const durationMs = performance.now() - started - pausedDurationMs;
        return {
            runNumber, candleCount, durationMs,
            candlesPerSecond: candleCount / durationMs * 1000,
            millisecondsPerCandle: durationMs / candleCount,
            chunkCount: chunks.length,
            averageChunkMs: chunks.reduce((sum, value) => sum + value, 0) / chunks.length,
            p95ChunkMs: percentile(chunks, 0.95), maximumChunkMs: Math.max(...chunks),
            checksum: state.checksum.toString(16).padStart(8, "0")
        };
    }

    function estimateMemory(candles) {
        const typedArrayBytes = candles * 6 * Float64Array.BYTES_PER_ELEMENT;
        const estimatedStateBytes = candles * 64;
        return { typedArrayBytes, estimatedStateBytes,
            estimatedPeakWorkingBytes: typedArrayBytes + estimatedStateBytes + 2 * 1024 * 1024 };
    }

    async function start(message) {
        const { requestId, config } = message;
        activeRequestId = requestId; paused = false; cancelled = false;
        send("READY", requestId);
        const estimate = estimateMemory(config.maximumCandles);
        send("PHASE_STARTED", requestId, { phase: "PREFLIGHT", memory: estimate });
        if (config.runCandles > config.maximumCandles ||
            estimate.estimatedPeakWorkingBytes > config.maximumEstimatedBytes) {
            send("ERROR", requestId, { error: { name: "PreflightError", message: "Benchmark memory or candle limit exceeded" }, memory: estimate });
            return;
        }
        const datasetCount = Math.max(config.warmupCandles, config.runCandles);
        const dataset = createDataset(datasetCount, config.seed, message.seedCandles, config.maxSeedCandles);
        send("PHASE_STARTED", requestId, { phase: "WARMUP", memory: estimate, datasetChecksum: dataset.checksum });
        const warmup = await runKernel(dataset, config.warmupCandles, config.chunkSize,
            config.progressIntervalMs, requestId, "WARMUP", 0);
        if (!warmup) { send("CANCELLED", requestId); return; }
        const runs = [];
        for (let run = 1; run <= config.repetitions; run++) {
            send("PHASE_STARTED", requestId, { phase: "RUN", runNumber: run, warmup: run === 1 ? warmup : undefined });
            const result = await runKernel(dataset, config.runCandles, config.chunkSize,
                config.progressIntervalMs, requestId, "RUN", run);
            if (!result) { send("CANCELLED", requestId); return; }
            runs.push(result);
        }
        send("COMPLETED", requestId, { warmup, runs, datasetChecksum: dataset.checksum, memory: estimate });
    }

    self.onmessage = event => {
        const message = event.data || {};
        if (message.type === "START") {
            if (activeRequestId && !cancelled) return;
            start(message).catch(error => send("ERROR", message.requestId, {
                error: { name: String(error?.name || "Error"), message: String(error?.message || error).slice(0, 300) }
            }));
            return;
        }
        if (message.requestId !== activeRequestId) return;
        if (message.type === "PAUSE" && !paused) {
            paused = true; send("PAUSED", activeRequestId);
        } else if (message.type === "RESUME" && paused) {
            paused = false; const resolve = resumeResolver; resumeResolver = null; resolve?.();
            send("RESUMED", activeRequestId);
        } else if (message.type === "CANCEL") {
            cancelled = true; paused = false; const resolve = resumeResolver; resumeResolver = null; resolve?.();
        }
    };

    self.HNDBacktestBenchmarkWorkerTest = {
        seededRandom, normalizeSeedCandles, createDataset, createKernelState,
        processCandle, percentile, estimateMemory
    };
})();
