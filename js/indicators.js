// ==========================
// HNDai Indicator Engine
// ==========================

// EMA Hesaplama
function calculateEMA(period, data) {

    if (data.length < period) return [];

    const k = 2 / (period + 1);

    const ema = [];

    let prev = data
        .slice(0, period)
        .reduce((a, b) => a + b, 0) / period;

    ema.push(prev);

    for (let i = period; i < data.length; i++) {

        prev = data[i] * k + prev * (1 - k);

        ema.push(prev);

    }

    return ema;

}

// RSI Hesaplama
function calculateRSI(period = 14, sourceCandles) {

    const data = Array.isArray(sourceCandles) ? sourceCandles : candles;

    if (data.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = data.length - period; i < data.length; i++) {

        const diff = data[i].close - data[i - 1].close;

        if (diff >= 0)
            gains += diff;
        else
            losses -= diff;

    }

    if (losses === 0) return 100;

    const rs = gains / losses;

    return 100 - (100 / (1 + rs));

}

// EMA değerlerini döndür
function getEMAValues(sourceCandles) {

    const data = Array.isArray(sourceCandles) ? sourceCandles : candles;
    const closes = data.map(c => c.close);

    return {

        ema20: calculateEMA(20, closes).at(-1),

        ema50: calculateEMA(50, closes).at(-1),

        ema200: calculateEMA(200, closes).at(-1)

    };

}
